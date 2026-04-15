/**
 * graph-memory-hermes-mcp
 * MCP Server entry using @modelcontextprotocol/sdk low-level Server API
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ALL_TOOLS } from "./src/mcp/tools.js";
import {
  handleGmIngest,
  handleGmRecall,
  handleGmRecord,
  handleGmStats,
  handleGmMaintain,
  handleGmConfig,
  log,
} from "./src/mcp/handlers.js";

async function main() {
  const server = new Server(
    {
      name: "graph-memory-hermes-mcp",
      version: "1.5.8",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "gm_ingest":
        return handleGmIngest(args);
      case "gm_recall":
        return handleGmRecall(args);
      case "gm_record":
        return handleGmRecord(args);
      case "gm_stats":
        return handleGmStats(args);
      case "gm_maintain":
        return handleGmMaintain(args);
      case "gm_config":
        return handleGmConfig(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("info", "graph-memory-hermes-mcp started on stdio");
}

main().catch((err) => {
  log("error", "Server crashed", { error: String(err) });
  process.exit(1);
});
