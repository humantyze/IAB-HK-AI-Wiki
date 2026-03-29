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
