/**
 * MCP CLI client for cron scripts.
 * Usage: tsx scripts/mcp-cli.ts <tool-name> [json-args]
 * Example: tsx scripts/mcp-cli.ts gm_maintain '{"force":true}'
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const toolName = process.argv[2];
  const rawArgs = process.argv[3] ?? "{}";

  if (!toolName) {
    // eslint-disable-next-line no-console
    console.error("Usage: tsx scripts/mcp-cli.ts <tool-name> [json-args]");
    process.exit(1);
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs);
  } catch {
    // eslint-disable-next-line no-console
    console.error(`Invalid JSON args: ${rawArgs}`);
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/mcp-server.js"],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client(
    { name: "gm-cron-cli", version: "1.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    // Output structured JSON line to stdout for potential pipe parsing
    const text = (result.content as any[])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");

    // eslint-disable-next-line no-console
    console.log(text);
    await client.close();
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(String(err));
    try {
      await client.close();
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

main();
