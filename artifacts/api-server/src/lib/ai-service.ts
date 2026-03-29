export interface AiProcessingResult {
  sectionSlug: string;
  bodyMarkdown: string;
  keyInsights: string[];
}

export async function processUpload(
  rawText: string,
  targetSections: string[],
  contentType: string,
): Promise<AiProcessingResult[]> {
  const results: AiProcessingResult[] = [];

  for (const slug of targetSections) {
    const sentences = rawText.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    const insights = sentences.slice(0, 3).map((s) => s.trim());

    const processedBody = `## Updated Content\n\n${rawText}\n\n*This section was updated with new ${contentType.replace(/_/g, " ")} content.*`;

    results.push({
      sectionSlug: slug,
      bodyMarkdown: processedBody,
      keyInsights: insights.length > 0 ? insights : ["New content has been integrated into this section."],
    });
  }

  return results;
}
