import { Router, type IRouter } from "express";
import { eq, asc, desc, isNull } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, sectionsTable, sectionVersionsTable } from "@workspace/db";
import {
  GetSectionBySlugParams,
  ListSectionVersionsParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { generateSectionImage } from "../lib/ai-service";
import { logger } from "../lib/logger";

const sectionImagesDir = path.join(process.cwd(), "public", "section-images");
if (!fs.existsSync(sectionImagesDir)) {
  fs.mkdirSync(sectionImagesDir, { recursive: true });
}

const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

const imageStorage = multer.diskStorage({
  destination: sectionImagesDir,
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    cb(null, `upload-${uniqueSuffix}${ext}`);
  },
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
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

router.post("/admin/generate-images", requireAuth, async (req, res) => {
  const promptExtra = typeof req.body?.promptExtra === "string" ? req.body.promptExtra.trim() : undefined;

  const rows = await db
    .select({
      sectionSlug: sectionsTable.slug,
      versionId: sectionVersionsTable.id,
      keyInsights: sectionVersionsTable.keyInsights,
    })
    .from(sectionsTable)
    .innerJoin(
      sectionVersionsTable,
      eq(sectionsTable.currentVersionId, sectionVersionsTable.id),
    )
    .where(isNull(sectionVersionsTable.imageUrl));

  if (rows.length === 0) {
    res.json({ generated: 0, failed: 0, skipped: 0, message: "All sections already have images." });
    return;
  }

  let generated = 0;
  let failed = 0;

  for (const row of rows) {
    const keyInsights = (row.keyInsights as string[]) ?? [];
    try {
      const imageUrl = await generateSectionImage(row.sectionSlug, keyInsights, promptExtra);
      if (imageUrl) {
        await db
          .update(sectionVersionsTable)
          .set({ imageUrl })
          .where(eq(sectionVersionsTable.id, row.versionId));
        generated++;
      } else {
        failed++;
      }
    } catch (err) {
      logger.error({ err, sectionSlug: row.sectionSlug }, "Backfill image generation failed");
      failed++;
    }
  }

  res.json({
    generated,
    failed,
    skipped: 0,
    message: `Generated ${generated} image(s); ${failed} failed.`,
  });
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

  const imageUrl = `/api/section-images/${req.file.filename}`;

  await db
    .update(sectionVersionsTable)
    .set({ imageUrl })
    .where(eq(sectionVersionsTable.id, section.currentVersionId));

  logger.info({ sectionId, imageUrl }, "Section image uploaded manually");
  res.json({ imageUrl });
});

export default router;
