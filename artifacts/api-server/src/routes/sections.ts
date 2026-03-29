import { Router, type IRouter } from "express";
import { eq, asc, desc } from "drizzle-orm";
import { db, sectionsTable, sectionVersionsTable } from "@workspace/db";
import {
  GetSectionBySlugParams,
  ListSectionVersionsParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/sections", async (_req, res) => {
  const sections = await db
    .select({
      id: sectionsTable.id,
      slug: sectionsTable.slug,
      title: sectionsTable.title,
      description: sectionsTable.description,
      displayOrder: sectionsTable.displayOrder,
      currentVersionId: sectionsTable.currentVersionId,
    })
    .from(sectionsTable)
    .orderBy(asc(sectionsTable.displayOrder));

  const result = [];
  for (const section of sections) {
    let bodyMarkdown = "";
    let keyInsights: string[] = [];
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
        lastUpdated = version.createdAt.toISOString();
      }
    }

    result.push({
      id: section.id,
      slug: section.slug,
      title: section.title,
      description: section.description,
      displayOrder: section.displayOrder,
      bodyMarkdown,
      keyInsights,
      lastUpdated,
    });
  }

  res.json(result);
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

export default router;
