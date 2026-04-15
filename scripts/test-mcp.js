import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "mcp-server.ts"],
    env: {
      ...process.env,
      GRAPH_MEMORY_LLM_API_KEY: process.env.GRAPH_MEMORY_LLM_API_KEY,
      GRAPH_MEMORY_LLM_BASE_URL: process.env.GRAPH_MEMORY_LLM_BASE_URL,
      GRAPH_MEMORY_LLM_MODEL: process.env.GRAPH_MEMORY_LLM_MODEL,
      GRAPH_MEMORY_EMBED_API_KEY: process.env.GRAPH_MEMORY_EMBED_API_KEY,
      GRAPH_MEMORY_EMBED_BASE_URL: process.env.GRAPH_MEMORY_EMBED_BASE_URL,
      GRAPH_MEMORY_EMBED_MODEL: process.env.GRAPH_MEMORY_EMBED_MODEL,
    },
  });

  const client = new Client({ name: "test", version: "1.0" }, { capabilities: {} });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("Tools:", tools.tools.map((t) => t.name));

  // Test gm_stats
  const statsCall = await client.callTool({ name: "gm_stats", arguments: {} });
  console.log("gm_stats result:", statsCall.content[0].text);

  // Test gm_ingest
  const ingestCall = await client.callTool({
    name: "gm_ingest",
    arguments: {
      session_id: "test-session",
      role: "user",
      content: "Hello graph-memory",
      turn_index: 1,
    },
  });
  console.log("gm_ingest result:", ingestCall.content[0].text);

  // Test gm_recall
  const recallCall = await client.callTool({
    name: "gm_recall",
    arguments: { query: "Hello", session_id: "test-session" },
  });
  console.log("gm_recall result:", recallCall.content[0].text.slice(0, 200));

  await client.close();
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
