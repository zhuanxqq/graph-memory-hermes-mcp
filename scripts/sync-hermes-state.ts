/**
 * Sync Hermes state.db messages into graph-memory.
 * Reads ~/.hermes/state.db incrementally and writes to graph-memory.db via saveMessage.
 * Conditionally triggers gm_maintain if >=7 new messages and >=10min since last maintain.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolvePath, getDb } from "../src/store/db.js";
import {
  saveMessage,
  getUnextracted,
  markExtracted,
  upsertNode,
  upsertEdge,
} from "../src/store/store.js";
import { runMaintenance } from "../src/graph/maintenance.js";
import { createEmbedFn } from "../src/engine/embed.js";
import { Recaller } from "../src/recaller/recall.js";
import { Extractor } from "../src/extractor/extract.js";
import { cfg, db, llm } from "../src/mcp/handlers.js";

const SYNC_STATE_PATH = resolvePath("~/.hermes/graph-memory-sync-state.json");
const HERMES_DB_PATH = resolvePath("~/.hermes/state.db");

interface SyncState {
  last_synced_msg_id: number;
  last_maintenance_at: number;
}

function loadSyncState(): SyncState {
  if (!existsSync(SYNC_STATE_PATH)) {
    return { last_synced_msg_id: 0, last_maintenance_at: 0 };
  }
  try {
    return JSON.parse(readFileSync(SYNC_STATE_PATH, "utf-8"));
  } catch {
    return { last_synced_msg_id: 0, last_maintenance_at: 0 };
  }
}

function saveSyncState(state: SyncState): void {
  writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2));
}

async function main() {
  if (!existsSync(HERMES_DB_PATH)) {
    console.error(`[sync] Hermes state.db not found at ${HERMES_DB_PATH}`);
    process.exit(1);
  }

  const state = loadSyncState();
  const now = Date.now();

  // Connect to Hermes state.db with read-only nolock
  const { DatabaseSync } = await import("@photostructure/sqlite");
  const hermesDb = new DatabaseSync(HERMES_DB_PATH, { readOnly: true });
  hermesDb.exec("PRAGMA busy_timeout = 5000");

  const rows = hermesDb.prepare(
    "SELECT id, session_id, role, content, timestamp FROM messages WHERE id > ? ORDER BY id ASC"
  ).all(state.last_synced_msg_id) as Array<{
    id: number;
    session_id: string;
    role: string;
    content: string | null;
    timestamp: number;
  }>;

  let maxId = state.last_synced_msg_id;
  let syncedCount = 0;
  const sessionTurns = new Map<string, number>();

  if (rows.length) {
    for (const row of rows) {
      maxId = Math.max(maxId, row.id);
      const sid = row.session_id;
      const role = row.role;
      const content = row.content ?? "";
      const ts = Math.floor(row.timestamp * 1000); // hermes timestamp is in seconds

      let turn = sessionTurns.get(sid) ?? 0;
      turn += 1;
      sessionTurns.set(sid, turn);

      const payload = { role, content, timestamp: ts };
      const inserted = saveMessage(db, sid, turn, role, payload);
      if (inserted) syncedCount++;
    }
    console.log(`[sync] Processed ${rows.length} messages, ${syncedCount} newly synced (max_id=${maxId})`);
  } else {
    console.log("[sync] No new messages to sync");
  }

  hermesDb.close();

  // ─── Knowledge Extraction for all sessions with unextracted messages ───────────
  if (llm) {
    const extractor = new Extractor(cfg, llm);
    const recaller = new Recaller(db, cfg);
    const embedFn = await createEmbedFn(cfg.embedding);
    if (embedFn) recaller.setEmbedFn(embedFn);

    const existingNames = (db.prepare("SELECT name FROM gm_nodes WHERE status='active'").all() as any[]).map((r) => r.name);
    let totalExtractedNodes = 0;
    let totalExtractedEdges = 0;
    let syncedEmbeddings = 0;

    const sessionRows = db.prepare(
      "SELECT session_id, COUNT(*) as c FROM gm_messages WHERE extracted=0 GROUP BY session_id"
    ).all() as Array<{ session_id: string; c: number }>;

    for (const { session_id: sid, c: count } of sessionRows) {
      if (count < cfg.compactTurnCount) continue;
      const unextracted = getUnextracted(db, sid, cfg.compactTurnCount);
      if (!unextracted.length) continue;

      try {
        const result = await extractor.extract({ messages: unextracted, existingNames });
        const maxTurn = unextracted[unextracted.length - 1].turn_index;

        for (const n of result.nodes) {
          const { node: upsertedNode } = upsertNode(db, n, sid);
          if (embedFn) {
            await recaller.syncEmbed(upsertedNode);
            syncedEmbeddings++;
          }
          if (!existingNames.includes(n.name)) existingNames.push(n.name);
        }
        for (const e of result.edges) {
          const fromNode = db.prepare("SELECT id FROM gm_nodes WHERE name=? AND status='active'").get(e.from) as any;
          const toNode = db.prepare("SELECT id FROM gm_nodes WHERE name=? AND status='active'").get(e.to) as any;
          if (fromNode && toNode) {
            upsertEdge(db, {
              fromId: fromNode.id,
              toId: toNode.id,
              type: e.type as any,
              instruction: e.instruction,
              condition: (e as any).condition,
              sessionId: sid,
            });
          }
        }

        markExtracted(db, sid, maxTurn);
        totalExtractedNodes += result.nodes.length;
        totalExtractedEdges += result.edges.length;
      } catch (err) {
        console.error(`[sync] extraction failed for ${sid}: ${err}`);
      }
    }

    if (totalExtractedNodes > 0 || totalExtractedEdges > 0 || syncedEmbeddings > 0) {
      console.log(`[sync] extracted nodes=${totalExtractedNodes}, edges=${totalExtractedEdges}, embeddings=${syncedEmbeddings}`);
    }
  }

  // Update state
  state.last_synced_msg_id = maxId;

  // Conditional maintain trigger
  const minutesSinceLastMaintain = (now - state.last_maintenance_at) / 60000;
  if (syncedCount >= 7 && minutesSinceLastMaintain >= 10) {
    try {
      const recaller = new Recaller(db, cfg);
      const embedFn = await createEmbedFn(cfg.embedding);
      if (embedFn) recaller.setEmbedFn(embedFn);

      const result = await runMaintenance(db, cfg, llm, embedFn ?? undefined);
      state.last_maintenance_at = now;
      console.log(
        `[sync] maintenance triggered: ${result.durationMs}ms, dedup=${result.dedup.merged}, communities=${result.community.count}`
      );
    } catch (err) {
      console.error(`[sync] maintenance failed: ${err}`);
    }
  }

  saveSyncState(state);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[sync] Fatal error: ${err}`);
  process.exit(1);
});
