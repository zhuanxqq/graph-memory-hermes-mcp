/**
 * MCP Tool Handlers for graph-memory-hermes-mcp
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { resolvePath, getDb } from "../store/db.js";
import {
  saveMessage,
  getMessages,
  upsertNode,
  upsertEdge,
  findByName,
  getStats,
} from "../store/store.js";
import { createCompleteFn } from "../engine/llm.js";
import { createEmbedFn } from "../engine/embed.js";
import { Recaller } from "../recaller/recall.js";
import { runMaintenance } from "../graph/maintenance.js";
import { DEFAULT_CONFIG, type GmConfig } from "../types.js";
import type { DatabaseSyncInstance } from "@photostructure/sqlite";

// ─── Env File Loading ───────────────────────────────────────

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  try {
    const lines = readFileSync(path, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore
  }
}

loadEnvFile(resolvePath("~/.hermes/graph-memory.env"));

// ─── Logger ───────────────────────────────────────────────────

export function log(level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>): void {
  const entry = {
    ts: Date.now(),
    level,
    source: "graph-memory-mcp",
    message,
    ...extra,
  };
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(entry));
}

// ─── Config Loading ───────────────────────────────────────────

function loadConfig(): GmConfig {
  const defaultPath = new URL("../../config/default.json", import.meta.url);
  let cfg: GmConfig = { ...DEFAULT_CONFIG };

  try {
    const raw = readFileSync(defaultPath, "utf-8");
    cfg = { ...cfg, ...JSON.parse(raw) };
  } catch {
    // ignore
  }

  const userPath = resolvePath("~/.hermes/graph-memory-config.json");
  if (existsSync(userPath)) {
    try {
      const raw = readFileSync(userPath, "utf-8");
      cfg = { ...cfg, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
  }

  // Env overrides for LLM
  if (process.env.GRAPH_MEMORY_LLM_API_KEY) {
    cfg.llm = {
      ...cfg.llm,
      apiKey: process.env.GRAPH_MEMORY_LLM_API_KEY,
      baseURL: process.env.GRAPH_MEMORY_LLM_BASE_URL || cfg.llm?.baseURL,
      model: process.env.GRAPH_MEMORY_LLM_MODEL || cfg.llm?.model,
    };
  }

  // Env overrides for Embedding
  if (process.env.GRAPH_MEMORY_EMBED_API_KEY) {
    cfg.embedding = {
      ...cfg.embedding,
      apiKey: process.env.GRAPH_MEMORY_EMBED_API_KEY,
      baseURL: process.env.GRAPH_MEMORY_EMBED_BASE_URL || cfg.embedding?.baseURL,
      model: process.env.GRAPH_MEMORY_EMBED_MODEL || cfg.embedding?.model,
    };
  }

  return cfg;
}

// ─── State ────────────────────────────────────────────────────

const cfg = loadConfig();
const db = getDb(cfg.dbPath);

// LLM initialization
const anthropicApiKey = cfg.llm?.apiKey && !cfg.llm?.baseURL
  ? cfg.llm.apiKey
  : undefined;
const llm = createCompleteFn(
  cfg.llm?.model?.split("/")[0] ?? "openai",
  cfg.llm?.model ?? "gpt-4o-mini",
  cfg.llm,
  anthropicApiKey,
);

const recaller = new Recaller(db, cfg);

// Async embed init
createEmbedFn(cfg.embedding)
  .then((fn) => {
    if (fn) {
      recaller.setEmbedFn(fn);
      log("info", "vector search ready");
    } else {
      recaller.setEmbedFn(null);
      log("info", "FTS5 search mode (configure embedding for semantic search)");
    }
  })
  .catch(() => {
    recaller.setEmbedFn(null);
    log("info", "FTS5 search mode");
  });

// Session-level turn counters for auto turn_index
const msgSeq = new Map<string, number>();

// ─── Helpers ──────────────────────────────────────────────────

function getNextTurnIndex(dbInst: DatabaseSyncInstance, sessionId: string): number {
  let seq = msgSeq.get(sessionId);
  if (seq === undefined) {
    const row = dbInst.prepare(
      "SELECT MAX(turn_index) as maxTurn FROM gm_messages WHERE session_id=?"
    ).get(sessionId) as any;
    seq = Number(row?.maxTurn) || 0;
  }
  seq += 1;
  msgSeq.set(sessionId, seq);
  return seq;
}

function checkExistingMessage(dbInst: DatabaseSyncInstance, sessionId: string, turnIndex: number): boolean {
  const row = dbInst.prepare(
    "SELECT id FROM gm_messages WHERE session_id=? AND turn_index=?"
  ).get(sessionId, turnIndex) as any;
  return !!row;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    isError,
  };
}

// ─── Handlers ─────────────────────────────────────────────────

export async function handleGmIngest(args: any) {
  try {
    const sessionId = args.session_id;
    const role = args.role ?? "unknown";
    const content = args.content ?? "";
    const timestamp = args.timestamp || Date.now();
    const turnIndexArg = args.turn_index;

    if (!sessionId) {
      return textResult("Missing required field: session_id", true);
    }

    let turnIndex: number;
    if (typeof turnIndexArg === "number") {
      turnIndex = turnIndexArg;
      if (checkExistingMessage(db, sessionId, turnIndex)) {
        return textResult(JSON.stringify({ ingested: true, turn_index: turnIndex, deduped: true }));
      }
    } else {
      turnIndex = getNextTurnIndex(db, sessionId);
    }

    const payload = {
      role,
      content,
      timestamp,
      ...(args.metadata ? { metadata: args.metadata } : {}),
    };

    const inserted = saveMessage(db, sessionId, turnIndex, role, payload);
    log("info", "gm_ingest success", { sessionId, turnIndex, role, deduped: !inserted });
    return textResult(JSON.stringify({ ingested: true, turn_index: turnIndex, deduped: !inserted }));
  } catch (err) {
    log("error", "gm_ingest failed", { error: formatError(err) });
    return textResult(formatError(err), true);
  }
}

export async function handleGmRecall(args: any) {
  try {
    const query = args.query;
    if (!query) {
      return textResult("Missing required field: query", true);
    }

    const sessionId = args.session_id;
    if (sessionId && typeof args.max_nodes === "number") {
      cfg.recallMaxNodes = args.max_nodes;
    }
    if (sessionId && typeof args.max_depth === "number") {
      cfg.recallMaxDepth = args.max_depth;
    }

    const res = await recaller.recall(query);

    // Add session-aware boost if sessionId provided (simple re-sort)
    if (sessionId && res.nodes.length) {
      res.nodes.sort((a, b) => {
        const aInSession = a.sourceSessions.includes(sessionId) ? 1 : 0;
        const bInSession = b.sourceSessions.includes(sessionId) ? 1 : 0;
        if (aInSession !== bInSession) return bInSession - aInSession;
        return b.pagerank - a.pagerank || b.updatedAt - a.updatedAt;
      });
    }

    const output = {
      nodes: res.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name,
        description: n.description,
        content: n.content,
        pagerank: n.pagerank,
        community_id: n.communityId,
        episodic_trace: "", // populated externally if needed
      })),
      edges: res.edges.map((e) => ({
        id: e.id,
        from_id: e.fromId,
        to_id: e.toId,
        type: e.type,
        instruction: e.instruction,
        condition: e.condition,
      })),
      token_estimate: res.tokenEstimate,
      search_mode: recaller["embed"] ? "vector" : "fts5",
    };

    log("info", "gm_recall success", { query: query.slice(0, 80), nodes: res.nodes.length });
    return textResult(JSON.stringify(output));
  } catch (err) {
    log("error", "gm_recall failed", { error: formatError(err) });
    return textResult(formatError(err), true);
  }
}

export async function handleGmRecord(args: any) {
  try {
    const type = args.type;
    const name = args.name;
    const description = args.description;
    const content = args.content;
    const sessionId = args.session_id || "manual";

    if (!type || !name || !description || !content) {
      return textResult("Missing required fields: type, name, description, content", true);
    }

    const { node } = upsertNode(db, { type, name, description, content }, sessionId);
    recaller.syncEmbed(node).catch(() => {});

    log("info", "gm_record success", { name: node.name, type: node.type });
    return textResult(JSON.stringify({ recorded: true, id: node.id, name: node.name, type: node.type }));
  } catch (err) {
    log("error", "gm_record failed", { error: formatError(err) });
    return textResult(formatError(err), true);
  }
}

export async function handleGmStats(_args: any) {
  try {
    const stats = getStats(db);
    const topPr = (db.prepare(
      "SELECT name, type, pagerank FROM gm_nodes WHERE status='active' ORDER BY pagerank DESC LIMIT 5"
    ).all() as any[]);

    const lastMaintRow = db.prepare(
      "SELECT MAX(at) as last_at FROM _migrations WHERE v=?"
    ).get(999) as any; // 999 is a placeholder; we don't have a true maintenance log table

    // NOTE: _migrations doesn't track maintenance. We'll use a pragmatic approach:
    // Check the latest community update time as a proxy for last maintenance.
    const commRow = db.prepare(
      "SELECT MAX(updated_at) as last_at FROM gm_communities"
    ).get() as any;

    const output = {
      node_count: stats.totalNodes,
      edge_count: stats.totalEdges,
      community_count: stats.communities,
      by_type: stats.byType,
      by_edge_type: stats.byEdgeType,
      top_nodes: topPr.map((n) => n.name),
      last_maintenance_at: commRow?.last_at || null,
    };

    return textResult(JSON.stringify(output));
  } catch (err) {
    log("error", "gm_stats failed", { error: formatError(err) });
    return textResult(formatError(err), true);
  }
}

export async function handleGmMaintain(args: any) {
  try {
    const embedFn = (recaller as any).embed ?? undefined;
    const result = await runMaintenance(db, cfg, llm, embedFn);

    const output = {
      duration_ms: result.durationMs,
      dedup_merged: result.dedup.merged,
      dedup_pairs: result.dedup.pairs.length,
      community_count: result.community.count,
      community_summaries: result.communitySummaries,
      top_pagerank: result.pagerank.topK.slice(0, 5).map((n) => ({
        name: n.name,
        score: n.score,
      })),
    };

    log("info", "gm_maintain success", { durationMs: result.durationMs });
    return textResult(JSON.stringify(output));
  } catch (err) {
    log("error", "gm_maintain failed", { error: formatError(err) });
    return textResult(formatError(err), true);
  }
}

export async function handleGmConfig(args: any) {
  try {
    const action = args.action;
    if (action !== "get") {
      return textResult("Only action='get' is supported in MVP", true);
    }

    const key = args.key;
    const flatConfig: Record<string, unknown> = {
      dbPath: cfg.dbPath,
      compactTurnCount: cfg.compactTurnCount,
      recallMaxNodes: cfg.recallMaxNodes,
      recallMaxDepth: cfg.recallMaxDepth,
      freshTailCount: cfg.freshTailCount,
      dedupThreshold: cfg.dedupThreshold,
      pagerankDamping: cfg.pagerankDamping,
      pagerankIterations: cfg.pagerankIterations,
      "llm.model": cfg.llm?.model,
      "llm.baseURL": cfg.llm?.baseURL,
      "embedding.model": cfg.embedding?.model,
      "embedding.baseURL": cfg.embedding?.baseURL,
    };

    if (key) {
      return textResult(JSON.stringify({ key, value: flatConfig[key] ?? null }));
    }
    return textResult(JSON.stringify(flatConfig));
  } catch (err) {
    log("error", "gm_config failed", { error: formatError(err) });
    return textResult(formatError(err), true);
  }
}

export { cfg, db, recaller, llm };
