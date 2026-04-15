/**
 * MCP Tool Schemas for graph-memory-hermes-mcp
 */

export const GM_INGEST_SCHEMA = {
  name: "gm_ingest",
  description:
    "将一条对话消息写入 graph-memory 数据库，供后续知识提取使用。幂等设计：同一 (session_id, turn_index) 不会重复写入。",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: { type: "string" },
      role: { type: "string", enum: ["user", "assistant", "system"] },
      content: { type: "string" },
      timestamp: { type: "integer", description: "Unix timestamp (ms)，可选" },
      metadata: {
        type: "object",
        description: "可选附加上下文。若数据库 schema 暂不支持则先忽略",
      },
      turn_index: {
        type: "integer",
        description: "可选，用于幂等去重。如不传则由 server 自增",
      },
    },
    required: ["session_id", "role", "content"],
  },
};

export const GM_RECALL_SCHEMA = {
  name: "gm_recall",
  description:
    "根据查询文本从知识图谱召回相关记忆。支持向量搜索、FTS5、图遍历和 PPR 排序。Server 端不做 token 截断。",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string" },
      session_id: {
        type: "string",
        description: "当前会话ID，用于优先召回本会话知识",
      },
      max_nodes: { type: "integer", default: 6 },
      max_depth: { type: "integer", default: 2 },
    },
    required: ["query"],
  },
};

export const GM_RECORD_SCHEMA = {
  name: "gm_record",
  description: "手动记录一条结构化知识到图谱中",
  inputSchema: {
    type: "object" as const,
    properties: {
      type: { type: "string", enum: ["TASK", "SKILL", "EVENT"] },
      name: { type: "string" },
      description: { type: "string" },
      content: { type: "string" },
      session_id: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["type", "name", "description", "content"],
  },
};

export const GM_STATS_SCHEMA = {
  name: "gm_stats",
  description: "查看 graph-memory 的统计信息：节点数、边数、社区数、Top PageRank 节点",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export const GM_MAINTAIN_SCHEMA = {
  name: "gm_maintain",
  description: "触发图维护：向量去重 → PageRank 计算 → 社区检测 → 社区摘要生成",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "可选，指定只维护某会话的数据",
      },
      force: { type: "boolean", default: false },
    },
  },
};

export const GM_CONFIG_SCHEMA = {
  name: "gm_config",
  description:
    "读取 graph-memory MCP Server 的当前运行配置。注意：MVP 阶段仅支持 get，不支持 set/热更新。",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["get"] },
      key: {
        type: "string",
        description: "配置键，如 llm.model、dbPath。不传则返回全部",
      },
    },
    required: ["action"],
  },
};

export const ALL_TOOLS = [
  GM_INGEST_SCHEMA,
  GM_RECALL_SCHEMA,
  GM_RECORD_SCHEMA,
  GM_STATS_SCHEMA,
  GM_MAINTAIN_SCHEMA,
  GM_CONFIG_SCHEMA,
];
