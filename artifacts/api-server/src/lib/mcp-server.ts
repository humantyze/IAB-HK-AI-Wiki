import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, wikiPagesTable } from "@workspace/db";
import { retrieve } from "./knowledge-index";
import { getStoredQuestions } from "./question-generator";

/**
 * Build a fresh McpServer with all four read-only tools registered.
 * Called once per HTTP request (stateless Streamable HTTP transport).
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "hk-ai-marketing-playbook",
    version: "1.0.0",
  });

  server.tool(
    "search_knowledge",
    "Search the HK AI Marketing Playbook knowledge base with a natural-language question. " +
      "Returns the most relevant passages from wiki pages, grounded in the playbook's content. " +
      "Use this to answer questions about AI in Hong Kong marketing, regulations, adtech, and industry trends.",
    { query: z.string().min(3).describe("The question or search query (at least 3 characters)") },
    async ({ query }) => {
      const chunks = await retrieve(query.trim(), { limit: 6, sourceTypes: ["wiki"] });
      if (chunks.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No relevant content found in the knowledge base for this query.",
            },
          ],
        };
      }
      const text = chunks
        .map((c, i) => `[${i + 1}] **${c.title}**\n${c.content.slice(0, 600)}`)
        .join("\n\n---\n\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "list_wiki_pages",
    "List all wiki pages in the HK AI Marketing Playbook. " +
      "Returns each page's slug and title. Use slugs with get_wiki_page to fetch full content.",
    {},
    async () => {
      const pages = await db
        .select({ slug: wikiPagesTable.slug, title: wikiPagesTable.title })
        .from(wikiPagesTable)
        .orderBy(asc(wikiPagesTable.title));
      if (pages.length === 0) {
        return { content: [{ type: "text", text: "No wiki pages found." }] };
      }
      const text = pages.map((p) => `${p.slug}\t${p.title}`).join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "get_wiki_page",
    "Retrieve the full markdown content of a specific wiki page by its slug. " +
      "Use list_wiki_pages first to discover available slugs.",
    { slug: z.string().describe("The page slug, e.g. 'bipa-and-adtech' or 'eu-ai-act-overview'") },
    async ({ slug }) => {
      const [page] = await db
        .select({
          title: wikiPagesTable.title,
          bodyMarkdown: wikiPagesTable.bodyMarkdown,
          tags: wikiPagesTable.tags,
          updatedAt: wikiPagesTable.updatedAt,
        })
        .from(wikiPagesTable)
        .where(eq(wikiPagesTable.slug, slug))
        .limit(1);

      if (!page) {
        return {
          content: [{ type: "text", text: `No wiki page found with slug: "${slug}". Use list_wiki_pages to see available slugs.` }],
        };
      }

      const tags = (page.tags as string[]) ?? [];
      const header = `# ${page.title}\n\nTags: ${tags.length > 0 ? tags.join(", ") : "none"}\nLast updated: ${page.updatedAt.toISOString().slice(0, 10)}\n\n`;
      return { content: [{ type: "text", text: header + page.bodyMarkdown }] };
    },
  );

  server.tool(
    "get_sample_questions",
    "Return the AI-generated list of sample questions that represent the key topics covered by the knowledge base. " +
      "Use these to understand what the playbook covers, or as prompts for search_knowledge.",
    {},
    async () => {
      const questions = await getStoredQuestions();
      if (questions.length === 0) {
        return { content: [{ type: "text", text: "No sample questions available yet." }] };
      }
      const text = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  return server;
}
