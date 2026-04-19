import { Router, type IRouter } from "express";
import { eq, asc, desc } from "drizzle-orm";
import multer from "multer";
import { db, sectionsTable, sectionVersionsTable } from "@workspace/db";
import {
  GetSectionBySlugParams,
  ListSectionVersionsParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { generateSectionImage } from "../lib/ai-service";
import { logger } from "../lib/logger";
import {
  uploadSectionImage,
  streamSectionImage,
  sectionImageExists,
  extractFilenameFromUrl,
} from "../lib/sectionImageStorage";

const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const MIME_TO_EXT: Record<AllowedImageMime, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed. Allowed: PNG, JPEG, WebP`));
    }
  },
});

const router: IRouter = Router();

router.get("/sections", async (_req, res) => {
  const rows = await db
    .select({
      id: sectionsTable.id,
      slug: sectionsTable.slug,
      title: sectionsTable.title,
      description: sectionsTable.description,
      displayOrder: sectionsTable.displayOrder,
      bodyMarkdown: sectionVersionsTable.bodyMarkdown,
      keyInsights: sectionVersionsTable.keyInsights,
      chartData: sectionVersionsTable.chartData,
      imageUrl: sectionVersionsTable.imageUrl,
      versionCreatedAt: sectionVersionsTable.createdAt,
    })
    .from(sectionsTable)
    .leftJoin(
      sectionVersionsTable,
      eq(sectionsTable.currentVersionId, sectionVersionsTable.id),
    )
    .orderBy(asc(sectionsTable.displayOrder));

  res.json(
    rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      displayOrder: row.displayOrder,
      bodyMarkdown: row.bodyMarkdown ?? "",
      keyInsights: (row.keyInsights as string[]) ?? [],
      chartData: (row.chartData as Array<{ label: string; value: number; unit: string }>) ?? [],
      imageUrl: row.imageUrl ?? null,
      lastUpdated: row.versionCreatedAt?.toISOString() ?? new Date().toISOString(),
    })),
  );
});

router.get("/sections/:slug", async (req, res) => {
  const { slug } = GetSectionBySlugParams.parse(req.params);

  const [section] = await db
    .select()
    .from(sectionsTable)
    .where(eq(sectionsTable.slug, slug))
    .limit(1);

  if (!section) {
    res.status(404).json({ error: "Section not found" });
    return;
  }

  let bodyMarkdown = "";
  let keyInsights: string[] = [];
  let chartData: Array<{ label: string; value: number; unit: string }> = [];
  let imageUrl: string | null = null;
  let lastUpdated = new Date().toISOString();

  if (section.currentVersionId) {
    const [version] = await db
      .select()
      .from(sectionVersionsTable)
      .where(eq(sectionVersionsTable.id, section.currentVersionId))
      .limit(1);
    if (version) {
      bodyMarkdown = version.bodyMarkdown;
      keyInsights = (version.keyInsights as string[]) || [];
      chartData = (version.chartData as Array<{ label: string; value: number; unit: string }>) || [];
      imageUrl = version.imageUrl ?? null;
      lastUpdated = version.createdAt.toISOString();
    }
  }

  res.json({
    id: section.id,
    slug: section.slug,
    title: section.title,
    description: section.description,
    displayOrder: section.displayOrder,
    bodyMarkdown,
    keyInsights,
    chartData,
    imageUrl,
    lastUpdated,
  });
});

router.get("/sections/:sectionId/versions", requireAuth, async (req, res) => {
  const { sectionId } = ListSectionVersionsParams.parse(req.params);

  const versions = await db
    .select()
    .from(sectionVersionsTable)
    .where(eq(sectionVersionsTable.sectionId, Number(sectionId)))
    .orderBy(desc(sectionVersionsTable.createdAt));

  res.json(
    versions.map((v) => ({
      id: v.id,
      sectionId: v.sectionId,
      bodyMarkdown: v.bodyMarkdown,
      keyInsights: v.keyInsights,
      createdAt: v.createdAt.toISOString(),
      createdByUploadId: v.createdByUploadId,
    })),
  );
});

router.get("/section-images/:filename", async (req, res) => {
  const { filename } = req.params;
  if (!filename || filename.includes("..") || filename.includes("/")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const result = await streamSectionImage(filename);
  if (!result) {
    res.status(404).json({ error: "Image not found" });
    return;
  }

  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  result.stream.pipe(res);
});

router.post("/admin/generate-images", requireAuth, async (req, res) => {
  const promptExtra = typeof req.body?.promptExtra === "string" ? req.body.promptExtra.trim() : undefined;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const allRows = await db
    .select({
      sectionSlug: sectionsTable.slug,
      sectionTitle: sectionsTable.title,
      versionId: sectionVersionsTable.id,
      keyInsights: sectionVersionsTable.keyInsights,
      imageUrl: sectionVersionsTable.imageUrl,
    })
    .from(sectionsTable)
    .innerJoin(
      sectionVersionsTable,
      eq(sectionsTable.currentVersionId, sectionVersionsTable.id),
    );

  const rowsToGenerate: Array<{ sectionSlug: string; sectionTitle: string; versionId: number; keyInsights: string[] }> = [];

  for (const row of allRows) {
    if (!row.imageUrl) {
      rowsToGenerate.push({ sectionSlug: row.sectionSlug, sectionTitle: row.sectionTitle, versionId: row.versionId, keyInsights: (row.keyInsights as string[]) ?? [] });
      continue;
    }
    const filename = extractFilenameFromUrl(row.imageUrl);
    if (!filename) {
      rowsToGenerate.push({ sectionSlug: row.sectionSlug, sectionTitle: row.sectionTitle, versionId: row.versionId, keyInsights: (row.keyInsights as string[]) ?? [] });
      continue;
    }
    const exists = await sectionImageExists(filename);
    if (!exists) {
      logger.info({ sectionSlug: row.sectionSlug, imageUrl: row.imageUrl }, "Stale imageUrl found, clearing for regeneration");
      await db
        .update(sectionVersionsTable)
        .set({ imageUrl: null })
        .where(eq(sectionVersionsTable.id, row.versionId));
      rowsToGenerate.push({ sectionSlug: row.sectionSlug, sectionTitle: row.sectionTitle, versionId: row.versionId, keyInsights: (row.keyInsights as string[]) ?? [] });
    }
  }

  if (rowsToGenerate.length === 0) {
    send({ type: "complete", generated: 0, failed: 0, message: "All sections already have images." });
    res.end();
    return;
  }

  send({ type: "start", total: rowsToGenerate.length });

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < rowsToGenerate.length; i++) {
    const row = rowsToGenerate[i];
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    send({ type: "generating", current: i + 1, total: rowsToGenerate.length, sectionSlug: row.sectionSlug, sectionTitle: row.sectionTitle });

    try {
      const imageUrl = await generateSectionImage(row.sectionSlug, row.keyInsights, promptExtra);
      if (imageUrl) {
        await db
          .update(sectionVersionsTable)
          .set({ imageUrl })
          .where(eq(sectionVersionsTable.id, row.versionId));
        generated++;
        send({ type: "done", current: i + 1, total: rowsToGenerate.length, sectionSlug: row.sectionSlug, sectionTitle: row.sectionTitle, imageUrl });
      } else {
        failed++;
        send({ type: "failed", current: i + 1, total: rowsToGenerate.length, sectionSlug: row.sectionSlug, sectionTitle: row.sectionTitle });
      }
    } catch (err) {
      logger.error({ err, sectionSlug: row.sectionSlug }, "Backfill image generation failed");
      failed++;
      send({ type: "failed", current: i + 1, total: rowsToGenerate.length, sectionSlug: row.sectionSlug, sectionTitle: row.sectionTitle });
    }
  }

  send({ type: "complete", generated, failed, message: `Generated ${generated} image(s)${failed > 0 ? `; ${failed} failed` : ""}.` });
  res.end();
});

router.post("/admin/sections/:sectionId/upload-image", requireAuth, (req, res, next) => {
  imageUpload.single("image")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err instanceof multer.MulterError ? `Upload error: ${err.message}` : (err.message || "Image upload failed") });
      return;
    }
    next();
  });
}, async (req, res) => {
  const sectionId = parseInt(String(req.params.sectionId), 10);
  if (isNaN(sectionId)) {
    res.status(400).json({ error: "Invalid section ID" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }

  const [section] = await db
    .select()
    .from(sectionsTable)
    .where(eq(sectionsTable.id, sectionId))
    .limit(1);

  if (!section) {
    res.status(404).json({ error: "Section not found" });
    return;
  }

  if (!section.currentVersionId) {
    res.status(400).json({ error: "Section has no current version to attach image to" });
    return;
  }

  const ext = MIME_TO_EXT[req.file.mimetype as AllowedImageMime] ?? ".png";
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const filename = `upload-${uniqueSuffix}${ext}`;

  await uploadSectionImage(filename, req.file.buffer, req.file.mimetype);

  const imageUrl = `/api/section-images/${filename}`;

  await db
    .update(sectionVersionsTable)
    .set({ imageUrl })
    .where(eq(sectionVersionsTable.id, section.currentVersionId));

  logger.info({ sectionId, imageUrl }, "Section image uploaded manually to GCS");
  res.json({ imageUrl });
});

export default router;
