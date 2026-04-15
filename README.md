<p align="center">
  <img src="docs/images/banner.jpg" alt="graph-memory" width="100%" />
</p>

<h1 align="center">graph-memory</h1>

<p align="center">
  <strong>Knowledge Graph Memory MCP Server</strong><br>
  For Hermes and other MCP-compatible agents<br>
  原作者 <a href="mailto:Wywelljob@gmail.com">adoresever</a>
</p>

<p align="center">
  <a href="#installation">Installation</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="README_CN.md">中文文档</a>
</p>

---

<p align="center">
  <img src="docs/images/hero.png" alt="graph-memory overview" width="90%" />
</p>

## Acknowledgment

This repository is a **fork and MCP adaptation** of the original [adoresever/graph-memory](https://github.com/adoresever/graph-memory).
All core knowledge-graph engine logic — extraction, dual-path recall, Personalized PageRank, community detection, and vector dedup — was created by **[adoresever](https://github.com/adoresever)**.
This fork only wraps the engine as a standalone **MCP Server** for Hermes and other MCP-compatible agents.

## What it does

When conversations grow long, agents lose track of what happened. graph-memory solves three problems at once:

1. **Context explosion** — 174 messages eat 95K tokens. graph-memory compresses to ~24K by replacing raw history with structured knowledge graph nodes
2. **Cross-session amnesia** — Yesterday's bugs, solved problems, all gone in a new session. graph-memory recalls relevant knowledge automatically via FTS5/vector search + graph traversal
3. **Skill islands** — Self-improving agents record learnings as isolated markdown. graph-memory connects them: "installed libgl1" and "ImportError: libGL.so.1" are linked by a `SOLVED_BY` edge

**It feels like talking to an agent that learns from experience. Because it does.**

<p align="center">
  <img src="docs/images/graph-ui.png" alt="graph-memory knowledge graph visualization with community detection" width="95%" />
</p>

> *58 nodes, 40 edges, 3 communities — automatically extracted from conversations. Right panel shows the knowledge graph with community clusters (GitHub ops, B站 MCP, session management). Left panel shows agent using `gm_stats` and `gm_search` tools.*

## Core features

### Community-aware recall

Recall runs **two parallel paths** that merge results:

- **Precise path**: vector/FTS5 search → community expansion → graph walk → PPR ranking
- **Generalized path**: query vector vs community summary embeddings → community members → PPR ranking

Community summaries are generated immediately after each community detection cycle (every 7 turns), so the generalized path is available from the first maintenance window.

### Episodic context (conversation traces)

The top 3 PPR-ranked nodes pull their **original user/assistant conversation snippets** into the context. The agent sees not just structured triples, but the actual dialogue that produced them — improving accuracy when reapplying past solutions.

### Universal embedding support

The embedding module uses raw `fetch` instead of the `openai` SDK, making it compatible with **any OpenAI-compatible endpoint** out of the box:

- OpenAI, Azure OpenAI
- Alibaba DashScope (`text-embedding-v4`)
- MiniMax (`embo-01`)
- Ollama, llama.cpp, vLLM (local models)
- Any endpoint that implements `POST /embeddings`

## Real-world results

<p align="center">
  <img src="docs/images/token-comparison.png" alt="Token comparison: 7 rounds" width="85%" />
</p>

7-round conversation installing bilibili-mcp + login + query:

| Round | Without graph-memory | With graph-memory |
|-------|---------------------|-------------------|
| R1 | 14,957 | 14,957 |
| R4 | 81,632 | 29,175 |
| R7 | **95,187** | **23,977** |

**75% compression.** Red = linear growth without graph-memory. Blue = stabilized with graph-memory.

<p align="center">
  <img src="docs/images/token-sessions.png" alt="Cross-session recall" width="85%" />
</p>

## How it works

### The Knowledge Graph

graph-memory builds a typed property graph from conversations:

- **3 node types**: `TASK` (what was done), `SKILL` (how to do it), `EVENT` (what went wrong)
- **5 edge types**: `USED_SKILL`, `SOLVED_BY`, `REQUIRES`, `PATCHES`, `CONFLICTS_WITH`
- **Personalized PageRank**: ranks nodes by relevance to the current query, not global popularity
- **Community detection**: automatically groups related skills (Docker cluster, Python cluster, etc.)
- **Community summaries**: LLM-generated descriptions + embeddings for each community, enabling semantic community-level recall
- **Episodic traces**: original conversation snippets linked to graph nodes for faithful context reconstruction
- **Vector dedup**: merges semantically duplicate nodes via cosine similarity

### Dual-path recall

```
User query
  │
  ├─ Precise path (entity-level)
  │    vector/FTS5 search → seed nodes
  │    → community peer expansion
  │    → graph walk (N hops)
  │    → Personalized PageRank ranking
  │
  ├─ Generalized path (community-level)
  │    query embedding vs community summary embeddings
  │    → matched community members
  │    → graph walk (1 hop)
  │    → Personalized PageRank ranking
  │
  └─ Merge & deduplicate → final context
```

Both paths run in parallel. Precise results take priority; generalized results fill gaps from uncovered knowledge domains.

### Data flow

```
Message in → ingest (zero LLM)
  ├─ All messages saved to gm_messages
  └─ turn_index continues from DB max (survives restart)

assemble (zero LLM)
  ├─ Graph nodes → XML with community grouping
  ├─ PPR ranking decides injection priority
  ├─ Episodic traces for top 3 nodes
  └─ Keep last turn raw messages

afterTurn (async, non-blocking)
  ├─ LLM extracts triples → gm_nodes + gm_edges
  ├─ Every 7 turns: PageRank + community detection + community summaries
  └─ User sends new message → extract auto-interrupted

session_end
  ├─ finalize (LLM): EVENT → SKILL promotion
  └─ maintenance: dedup → PageRank → community detection

Next session → recall
  ├─ Dual-path recall (precise + generalized)
  └─ Personalized PageRank ranking → inject into context
```

### Personalized PageRank (PPR)

Unlike global PageRank, PPR ranks nodes **relative to your current query**:

- Ask about "Docker deployment" → Docker-related SKILLs rank highest
- Ask about "conda environment" → conda-related SKILLs rank highest
- Same graph, completely different rankings per query
- Computed in real-time at recall (~5ms for thousands of nodes)

## Installation

### Prerequisites

- Node.js 22+
- npm / pnpm

### Build from source

```bash
git clone https://github.com/zhuanxqq/graph-memory-hermes-mcp.git
cd graph-memory-hermes-mcp
npm install
npm run build        # compiles TypeScript to dist/
npm test             # verify 80 tests pass
```

After build, the MCP server entry is `dist/mcp-server.js`.

### Configure environment variables

Create `~/.hermes/graph-memory.env` (or export directly):

```bash
GRAPH_MEMORY_LLM_API_KEY=your-llm-api-key
GRAPH_MEMORY_LLM_BASE_URL=https://api.openai.com/v1
GRAPH_MEMORY_LLM_MODEL=gpt-4o-mini

GRAPH_MEMORY_EMBED_API_KEY=your-embedding-api-key
GRAPH_MEMORY_EMBED_BASE_URL=https://api.openai.com/v1
GRAPH_MEMORY_EMBED_MODEL=text-embedding-3-small
```

### Run the MCP server

```bash
node dist/mcp-server.js
```

You should see:

```
{"ts":...,"level":"info","source":"graph-memory-mcp","message":"graph-memory-hermes-mcp started on stdio"}
```

If embedding is configured correctly, you will also see `vector search ready` shortly after startup.

## Configuration

All parameters have defaults. Override them by creating `~/.hermes/graph-memory-config.json`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `dbPath` | `~/.hermes/graph-memory.db` | SQLite database path |
| `compactTurnCount` | `7` | Turns between maintenance cycles |
| `recallMaxNodes` | `6` | Max nodes injected per recall |
| `recallMaxDepth` | `2` | Graph traversal hops from seed nodes |
| `dedupThreshold` | `0.90` | Cosine similarity threshold for node dedup |
| `pagerankDamping` | `0.85` | PPR damping factor |
| `pagerankIterations` | `20` | PPR iteration count |

## MCP Tools

| Tool | Description |
|------|-------------|
| `gm_ingest` | Write a message into graph-memory (idempotent by `session_id` + `turn_index`) |
| `gm_recall` | Recall relevant knowledge via vector/FTS5 + graph traversal + PPR |
| `gm_record` | Manually record a `TASK` / `SKILL` / `EVENT` node |
| `gm_stats` | View graph statistics: nodes, edges, communities, top PageRank |
| `gm_maintain` | Trigger maintenance: dedup → PageRank → community detection + summaries |
| `gm_config` | Read current runtime configuration (MVP: get only) |

## CLI Usage

A small MCP client is provided for cron jobs or manual testing:

```bash
# After build
node dist/scripts/mcp-cli.js gm_stats
node dist/scripts/mcp-cli.js gm_maintain '{"force":true}'
node dist/scripts/mcp-cli.js gm_recall '{"query":"Docker deployment"}'
```

Or run directly with `tsx` during development:

```bash
npx tsx scripts/mcp-cli.ts gm_stats
```

## Database

SQLite via `@photostructure/sqlite` (prebuilt binaries, zero native compilation). Default: `~/.hermes/graph-memory.db`.

| Table | Purpose |
|-------|---------|
| `gm_nodes` | Knowledge nodes with pagerank + community_id |
| `gm_edges` | Typed relationships |
| `gm_nodes_fts` | FTS5 full-text index |
| `gm_messages` | Raw conversation messages |
| `gm_signals` | Detected signals |
| `gm_vectors` | Embedding vectors (optional) |
| `gm_communities` | Community summaries + embeddings |

## vs lossless-claw

| | lossless-claw | graph-memory |
|--|---|---|
| **Approach** | DAG of summaries | Knowledge graph (triples) |
| **Recall** | FTS grep + sub-agent expansion | Dual-path: entity PPR + community vector matching |
| **Cross-session** | Per-conversation only | Automatic cross-session recall |
| **Compression** | Summaries (lossy text) | Structured triples (lossless semantics) |
| **Graph algorithms** | None | PageRank, community detection, vector dedup |
| **Context traces** | None | Episodic snippets from source conversations |

## Development

```bash
git clone https://github.com/zhuanxqq/graph-memory-hermes-mcp.git
cd graph-memory-hermes-mcp
npm install
npm test        # 80 tests
npx vitest      # watch mode
```

### Project structure

```
graph-memory-hermes-mcp/
├── mcp-server.ts                # MCP server entry point
├── src/
│   ├── types.ts                 # Type definitions
│   ├── store/                   # SQLite CRUD / FTS5 / CTE traversal / community CRUD
│   ├── engine/                  # LLM (fetch-based) + Embedding (fetch-based, SDK-free)
│   ├── extractor/               # Knowledge extraction prompts
│   ├── recaller/                # Dual-path recall (precise + generalized + PPR)
│   ├── format/                  # Context assembly + transcript repair
│   ├── graph/                   # PageRank, community detection + summaries, dedup, maintenance
│   └── mcp/                     # MCP tool schemas + handlers
├── scripts/                     # CLI helpers and cron scripts
├── test/                        # 80 vitest tests
└── config/                      # Optional default config files
```

## License

MIT
