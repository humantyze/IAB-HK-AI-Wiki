import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../lib/mcp-server";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const mcpRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute before trying again." },
});

/**
 * MCP endpoint — Streamable HTTP transport, stateless (no sessions).
 *
 * Any MCP client can connect by pointing at:
 *   POST <deployed-url>/api/mcp
 *
 * Claude Desktop config example:
 *   {
 *     "mcpServers": {
 *       "hk-ai-playbook": { "url": "https://<your-app>.replit.app/api/mcp" }
 *     }
 *   }
 *
 * Exposed tools (read-only):
 *   search_knowledge  — RAG search over wiki pages
 *   list_wiki_pages   — all slugs + titles
 *   get_wiki_page     — full markdown for a given slug
 *   get_sample_questions — stored AI-generated question list
 *
 * Rate limits:
 *   - 30 req/min per IP (HTTP level, all tools)
 *   - 10 req/min per IP (tool level, search_knowledge only)
 */
router.post("/mcp", mcpRateLimit, async (req, res) => {
  let transport: StreamableHTTPServerTransport | null = null;
  try {
    const ip = req.ip ?? "unknown";
    const server = createMcpServer(ip);
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("finish", () => {
      transport?.close().catch(() => {});
      server.close().catch(() => {});
    });
  } catch (err) {
    logger.error({ err }, "MCP request failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "MCP request failed" });
    }
  }
});

export default router;
