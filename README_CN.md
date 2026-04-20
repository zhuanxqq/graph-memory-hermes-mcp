<p align="center">
  <img src="docs/images/banner.jpg" alt="graph-memory" width="100%" />
</p>

<h1 align="center">graph-memory</h1>

<p align="center">
  <strong>知识图谱记忆 MCP Server</strong><br>
  供 Hermes 及其他兼容 MCP 的 Agent 使用<br>
  作者 <a href="mailto:Wywelljob@gmail.com">adoresever</a> · MIT 许可证
</p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="#配置参数">配置</a> ·
  <a href="README.md">English</a>
</p>

---

<p align="center">
  <img src="docs/images/hero.png" alt="graph-memory 概览" width="90%" />
</p>

## 致谢

本仓库是原始项目 [adoresever/graph-memory](https://github.com/adoresever/graph-memory) 的 **Fork 与 MCP 封装版本**。
核心的知识图谱引擎逻辑——知识提取、双路径召回、个性化 PageRank、社区检测与向量去重——全部由 **[adoresever](https://github.com/adoresever)** 创作。
本仓库仅将其封装为独立的 **MCP Server**，供 Hermes 及其他兼容 MCP 的 Agent 使用。

## 记忆、Skills、Agent——难道不是一个东西吗？

大道至简——其实都是**上下文工程**。但现在有三个致命问题：

🔴 **上下文爆炸** — Agent 执行任务反复试错，pip 日志、git 输出、报错堆栈疯狂堆积。174 条消息吃掉 95K token，噪音远大于信号，且无法祛除。

🔴 **跨对话失忆** — 昨天踩过的坑、解过的 bug，新对话全部归零。MEMORY.md 全量加载？单次召回成本 49 万 token。不加载？同样的错误来一遍。

🔴 **技能孤岛** — self-improving-agent 记录的学习条目是孤立的 markdown 列表，没有因果关系、没有依赖链、没有知识体系。"装了 libgl1" 和 "ImportError: libGL.so.1" 之间毫无关联。

**graph-memory 用一个方案同时解决这三个问题。**

<p align="center">
  <img src="docs/images/graph-ui.png" alt="graph-memory 知识图谱可视化与社区检测" width="95%" />
</p>

> *58 个节点、40 条边、3 个社区——全部从对话中自动提取。右侧面板展示知识图谱的社区聚类（GitHub 操作、B站 MCP、会话管理）。左侧面板展示 Agent 使用 `gm_stats` 和 `gm_search` 工具查询图谱。*

## 核心特性

### 社区感知召回（双路径并行）

召回有**两条并行路径**，结果合并去重：

- **精确路径**：向量/FTS5 搜索 → 社区扩展 → 图遍历 → 个性化 PageRank 排序
- **泛化路径**：查询向量 vs 社区摘要 embedding → 匹配社区成员 → 个性化 PageRank 排序

社区摘要会在每次社区检测周期（每 7 轮）结束后立即生成，因此从第一个维护窗口起，泛化路径即可生效。

###  episodic 上下文（对话痕迹）

排名前 3 的 PPR 节点会将它们**原始的用户/ assistant 对话片段**一并拉入上下文。Agent 看到的不仅是结构化的三元组，还有产生这些知识的真实对话——在复用旧方案时准确率更高。

### 通用 Embedding 支持

Embedding 模块使用原生 `fetch` 代替 `openai` SDK，开箱即可兼容**任何 OpenAI 兼容端点**：

- OpenAI、Azure OpenAI
- 阿里云 DashScope（`text-embedding-v4`）
- MiniMax（`embo-01`）
- Ollama、llama.cpp、vLLM（本地模型）
- 任何实现了 `POST /embeddings` 的端点

## 实测效果

<p align="center">
  <img src="docs/images/token-comparison.png" alt="Token 对比：7 轮对话" width="85%" />
</p>

安装 bilibili-mcp + 登录 + 查询 的 7 轮对话：

| 轮次 | 无 graph-memory | 有 graph-memory |
|------|----------------|----------------|
| R1 | 14,957 | 14,957 |
| R4 | 81,632 | 29,175 |
| R7 | **95,187** | **23,977** |

**压缩率 75%。** 红色 = 无 graph-memory 的线性增长；蓝色 = 启用 graph-memory 后的稳定态。

<p align="center">
  <img src="docs/images/token-sessions.png" alt="跨对话召回" width="85%" />
</p>

## 工作原理

### 知识图谱

graph-memory 从对话中构建带类型的属性图：

- **3 种节点**：`TASK`（做了什么）、`SKILL`（怎么做）、`EVENT`（出了什么问题）
- **5 种边**：`USED_SKILL`、`SOLVED_BY`、`REQUIRES`、`PATCHES`、`CONFLICTS_WITH`
- **个性化 PageRank**：根据当前查询对相关节点排序，而非全局热度
- **社区检测**：自动把相关技能聚类（Docker 簇、Python 簇等）
- **社区摘要**：为每个社区生成 LLM 描述 + embedding，实现语义级的社区召回
- ** episodic 痕迹**：把原始对话片段关联到图谱节点，用于忠实重建上下文
- **向量去重**：通过余弦相似度合并语义重复的节点

### 双路径召回

```
用户查询
  │
  ├─ 精确路径（实体级）
  │    向量/FTS5 搜索 → 种子节点
  │    → 社区同伴扩展
  │    → 图遍历（N 跳）
  │    → 个性化 PageRank 排序
  │
  ├─ 泛化路径（社区级）
  │    查询向量 vs 社区摘要 embedding
  │    → 匹配社区成员
  │    → 图遍历（1 跳）
  │    → 个性化 PageRank 排序
  │
  └─ 合并去重 → 最终上下文
```

两条路径并行运行。精确结果优先；泛化结果补充未被覆盖的知识域。

### 数据流

```
消息流入 → ingest（零 LLM）
  ├─ 所有消息存入 gm_messages
  └─ turn_index 从 DB 最大值续接（重启不重叠）

assemble（零 LLM）
  ├─ 图谱节点 → 按社区分组的 XML
  ├─ PPR 排序决定注入优先级
  ├─ Top 3 节点附带 episodic 痕迹
  └─ 保留最后一轮原始消息

afterTurn（异步、不阻塞）
  ├─ LLM 提取三元组 → gm_nodes + gm_edges
  ├─ 每 7 轮：PageRank + 社区检测 + 社区摘要
  └─ 用户发送新消息 → 自动中断提取

session_end
  ├─ finalize（LLM）：EVENT 提升为 SKILL
  └─ maintenance：去重 → PageRank → 社区检测

下一场对话 → recall
  ├─ 双路径召回（精确 + 泛化）
  └─ 个性化 PageRank 排序 → 注入上下文
```

### 个性化 PageRank（PPR）

与全局 PageRank 不同，PPR **相对于你的当前查询**对节点排序：

- 问 "Docker 部署" → Docker 相关 SKILL 排名最高
- 问 "conda 环境" → conda 相关 SKILL 排名最高
- 同一张图，不同查询得到完全不同的排序
- 召回时实时计算（数千节点约 5ms）

## 安装

### 环境要求

- Node.js 22+
- npm / pnpm

### 从源码构建

```bash
git clone https://github.com/zhuanxqq/graph-memory-hermes-mcp.git
cd graph-memory-hermes-mcp
npm install
npm run build        # 编译 TypeScript 到 dist/
npm test             # 验证 80 个测试通过
```

构建完成后，MCP Server 入口为 `dist/mcp-server.js`。

### 配置环境变量

创建 `~/.hermes/graph-memory.env`（或直接 export）：

```bash
GRAPH_MEMORY_LLM_API_KEY=your-llm-api-key
GRAPH_MEMORY_LLM_BASE_URL=https://api.openai.com/v1
GRAPH_MEMORY_LLM_MODEL=gpt-4o-mini

GRAPH_MEMORY_EMBED_API_KEY=your-embedding-api-key
GRAPH_MEMORY_EMBED_BASE_URL=https://api.openai.com/v1
GRAPH_MEMORY_EMBED_MODEL=text-embedding-3-small
```

### 启动 MCP Server

```bash
node dist/mcp-server.js
```

正常启动后会看到：

```
{"ts":...,"level":"info","source":"graph-memory-mcp","message":"graph-memory-hermes-mcp started on stdio"}
```

如果 Embedding 配置正确，稍后还会看到 `vector search ready`。

## 配置

### graph-memory 参数

所有参数都有默认值。通过创建 `~/.hermes/graph-memory-config.json` 覆盖：

| 参数 | 默认值 | 说明 |
|-----------|---------|-------------|
| `dbPath` | `~/.hermes/graph-memory.db` | SQLite 数据库路径 |
| `compactTurnCount` | `7` | 维护周期间隔的对话轮数 |
| `recallMaxNodes` | `6` | 每次 recall 注入的最大节点数 |
| `recallMaxDepth` | `2` | 图遍历跳数 |
| `dedupThreshold` | `0.90` | 节点去重的余弦相似度阈值 |
| `pagerankDamping` | `0.85` | PPR 阻尼系数 |
| `pagerankIterations` | `20` | PPR 迭代次数 |

### Hermes Agent 配置

在 `~/.hermes/config.yaml` 的 `mcp_servers` 下添加 server：

```yaml
mcp_servers:
  graph-memory:
    command: /path/to/graph-memory-hermes-mcp/node_modules/.bin/tsx
    args:
      - /path/to/graph-memory-hermes-mcp/mcp-server.ts
    env:
      PATH: /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/path/to/graph-memory-hermes-mcp/node_modules/.bin
    connect_timeout: 120   # 推荐：graph-memory 冷启动可能需要额外时间
```

> **注意：**建议设置 `connect_timeout: 120`。随着知识图谱增长，冷启动初始化（SQLite + vector search）可能超过默认的 60 秒超时，导致 Hermes 静默地跳过工具注册。

## MCP 工具

| 工具 | 说明 |
|------|-------------|
| `gm_ingest` | 将一条消息写入 graph-memory（按 `session_id` + `turn_index` 幂等） |
| `gm_recall` | 通过向量/FTS5 + 图遍历 + PPR 召回相关知识 |
| `gm_record` | 手动记录 `TASK` / `SKILL` / `EVENT` 节点 |
| `gm_stats` | 查看图谱统计：节点数、边数、社区数、Top PageRank |
| `gm_maintain` | 手动触发维护：去重 → PageRank → 社区检测 + 摘要 |
| `gm_config` | 读取当前运行配置（MVP 阶段仅支持 get） |

## CLI 使用

项目内置了一个小型 MCP 客户端，方便定时任务或手动测试：

```bash
# 构建后
node dist/scripts/mcp-cli.js gm_stats
node dist/scripts/mcp-cli.js gm_maintain '{"force":true}'
node dist/scripts/mcp-cli.js gm_recall '{"query":"Docker 部署"}'
```

开发阶段也可以直接用 `tsx` 运行：

```bash
npx tsx scripts/mcp-cli.ts gm_stats
```

## 数据库

使用 `@photostructure/sqlite`（预编译二进制，无需本地编译）。默认路径：`~/.hermes/graph-memory.db`。

| 表 | 用途 |
|-------|---------|
| `gm_nodes` | 知识节点（含 pagerank + community_id） |
| `gm_edges` | 带类型的关系边 |
| `gm_nodes_fts` | FTS5 全文索引 |
| `gm_messages` | 原始对话消息 |
| `gm_signals` | 检测到的信号 |
| `gm_vectors` | 向量 embedding（可选） |
| `gm_communities` | 社区摘要 + embedding |

## vs lossless-claw

| | lossless-claw | graph-memory |
|--|---|---|
| **思路** | 摘要 DAG | 知识图谱（三元组） |
| **召回** | FTS 正则 + 子 Agent 扩展 | 双路径：实体 PPR + 社区向量匹配 |
| **跨对话** | 仅单对话内 | 自动跨对话召回 |
| **压缩** | 摘要（有损文本） | 结构化三元组（语义无损） |
| **图算法** | 无 | PageRank、社区检测、向量去重 |
| **上下文痕迹** | 无 | 源对话的 episodic 片段 |

## 开发

```bash
git clone https://github.com/zhuanxqq/graph-memory-hermes-mcp.git
cd graph-memory-hermes-mcp
npm install
npm test        # 80 个测试
npx vitest      # watch 模式
```

### 项目结构

```
graph-memory-hermes-mcp/
├── mcp-server.ts                # MCP Server 入口
├── src/
│   ├── types.ts                 # 类型定义
│   ├── store/                   # SQLite CRUD / FTS5 / 图遍历 / 社区 CRUD
│   ├── engine/                  # LLM（fetch 调用）+ Embedding（无 SDK）
│   ├── extractor/               # 知识提取 Prompt
│   ├── recaller/                # 双路径召回（精确 + 泛化 + PPR）
│   ├── format/                  # 上下文组装 + 对话修复
│   ├── graph/                   # PageRank、社区检测与摘要、去重、维护
│   └── mcp/                     # MCP 工具定义与处理器
├── scripts/                     # CLI 辅助脚本与定时任务
├── test/                        # 80 个 vitest 测试
└── config/                      # 可选默认配置文件
```

## 许可证

MIT
