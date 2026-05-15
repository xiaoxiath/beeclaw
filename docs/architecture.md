# Beeclaw 架构设计

> 本文档描述 Beeclaw 的核心系统架构和各子系统概要。

## 系统概览

```
┌──────────────────────────────────────────────────────────────┐
│                        Entry Points                          │
│              CLI (cli.ts) · Bot (bot.ts) · Web (web.ts)      │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                     Adapter Layer                            │
│          CLI Adapter · Feishu Adapter · Web Adapter          │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   App Layer (bootstrap)                       │
│     initApp() · Dispatcher · Queue Handlers · Routes         │
└──────────────────────────┬───────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────────┐ ┌──────────┐ ┌──────────────────┐
│   Agent System   │ │  Tools   │ │   Subagent       │
│ createAgent()    │ │ Registry │ │   Orchestrator   │
│ chat() / stream  │ │          │ │ DAG Scheduling   │
│ Context Manager  │ │          │ │ Shared State     │
└────────┬─────────┘ └──────────┘ └──────────────────┘
         │
    ┌────┼────┬─────────┬──────────┐
    ▼    ▼    ▼         ▼          ▼
┌──────┐┌──────┐┌──────────┐┌──────────┐┌──────────┐
│Memory││Skills││  Search  ││ Sandbox  ││ Proactive│
│Store ││System││ Providers││ Executor ││ Scheduler│
└──────┘└──────┘└──────────┘└──────────┘└──────────┘
```

---

## Agent 系统

Agent 是系统的核心，负责对话循环、工具调度和上下文管理。

**核心组件**（`src/domain/agent/`）：
- `agent-factory.ts` — `createAgent()` 工厂函数，配置 Provider、模型和工具
- `orchestrator.ts` — `Agent` 类，实现主对话循环 `chat()`
- `stream-handler.ts` — `chatStream()` 异步生成器，流式对话
- `context-manager.ts` — 上下文窗口管理，Token 预算分配和自动压缩
- `prompt-builder.ts` — 系统提示词组装（记忆注入、技能加载）
- `tool-dispatcher.ts` — 工具调用分发
- `fast-llm-judge.ts` — 统一工程判断引擎（模式选择、工具选择、任务分解等）

**支持的 Provider**: OpenAI、智谱 GLM、Anthropic、MiniMax

**关键流程**:
1. 用户消息进入 → 组装 System Prompt（含记忆、技能、人格）
2. 调用 LLM → 解析响应（文本 / 工具调用）
3. 执行工具调用 → 结果注入上下文 → 继续对话循环
4. 上下文超限时自动压缩旧消息

---

## 工具系统

工具通过统一注册机制管理（`src/domain/tools/`）：

**注册方式**（`builtin.ts`）：
- `coreBuiltinTools` — 始终加载的核心工具
- `conditionalDeepResearchTools` — 仅当 `search.enabled` 时加载（含 `deep_research`、`request_deep_analysis`）
- `conditionalSubagentStateTools` — 子代理编排激活后加载
- 部分历史工具（如 stock_*）已在 v0.5.0 弃用，迁移至 `beeclaw-hedge-fund-research` skill

**工具分类**（`categories/`）：search、shell、finance、sandbox、subagent、utility

工具以 OpenAI Function 格式定义，`getBuiltinToolsForAI()` 自动从注册表收集。

详见 [工具参考](./references/tools.md)。

---

## 子代理系统

### 子代理类型

| 类型 | 职责 | 可用工具 |
|------|------|----------|
| `research` | 搜索、调研、信息收集 | web_search, web_fetch, memory_read |
| `memory` | 记忆读写、知识管理 | memory_read, memory_write, keyword_* |
| `skill` | 技能创建、执行、评估 | skill_* tools |
| `code` | 代码生成、文件操作 | file_*, shell |
| `general` | 通用任务 | 所有工具 |

### DAG 任务编排

系统支持自动任务分解和 DAG 调度：

```
1. 分解任务 (decompose) → LLM 分解 + 验证依赖
2. 初始化调度器 → 创建任务状态映射
3. 执行循环 → 获取可并行任务 → 并行执行 → 进度回调
4. 聚合结果 → 按类型分组 → 合并输出
```

### 工具接口

```typescript
// 单个子代理
spawn_subagent({ type: "research", task: "Search React 19 features" })

// 并行多个子代理
spawn_parallel({
  tasks: [
    { type: "research", task: "Search official docs" },
    { type: "memory", task: "Read existing knowledge" }
  ],
  maxParallelism: 3
})
```

详见 [子代理系统](./guide/subagent-system.md)。

---

## 会话管理

CLI、Bot 和 Web 共享同一个 SessionManager：

```
┌─────────────────────────────────────────────────┐
│              SessionManager                      │
├─────────────────────────────────────────────────┤
│  CLI Channel · Feishu Channel · Web Channel     │
│                    │                             │
│  Session 双源持久化:                              │
│   • SQLite 主存（data/memory/beeclaw.db）          │
│   • JSONL 兼容（data/memory/sessions/）—— 旧路径   │
│  通过 USE_SQLITE_SESSIONS=true 切换               │
│                    │                             │
│         Memory System (共享记忆)                  │
└─────────────────────────────────────────────────┘
```

**Session 接口**（`src/domain/session/index.ts`）：

```typescript
interface Session {
  id: string;
  userId: string;
  channel: string;       // 'cli' | 'feishu' | 'web' | 'webhook' | 'api'
  messages: SessionMessage[];
  summary?: string;      // 压缩后的旧消息摘要
  createdAt: string;
  updatedAt: string;
  pendingRecovery?: boolean;
  responseDelivered?: boolean;
  // ... 更多字段
}
```

**会话 ID 格式**: `{channel}-{userId}-{timestamp}`

**关键特性**:
- 自动持久化，重启后恢复
- 消息去重（dedup）
- 上下文超限时自动压缩
- HITL（Human-in-the-Loop）管理

---

## 共享状态

子代理间通过共享状态交换数据（条件加载，需子代理编排激活）。

### 状态工具（整合后）

| 工具 | 说明 |
|------|------|
| `state_manage` | 组合 set / get / update / delete 操作 |
| `state_query` | 组合 list / exists / stats 操作 |
| `state_lock_manage` | 组合 acquire / release 锁操作 |

每个工具通过 `action` 参数区分具体操作，取代旧版的 9 个独立工具。

### Key 命名规范

```
category:subcategory:item

示例：
- research:react19:hooks
- config:api:timeout
- counter:tasks_completed
```

---

## 记忆系统

文件系统持久化记忆（`src/domain/memory/`），支持关键词索引和混合搜索。

**核心组件**:
- `store.ts` — MemoryStore，支持 JSONL/SQLite 双模式
- `scoring.ts` — 重要性评分
- `compression.ts` — 记忆压缩
- `vector-store.ts` — 向量嵌入搜索
- `hybrid-search.ts` — 混合检索（关键词 + 语义）
- `short-term-cache.ts` — 短期记忆缓存
- `dynamic-injector.ts` — 动态记忆注入到上下文

**分类**: conversations, facts, decisions, skills

详见 [记忆系统](./guide/memory-system.md)。

---

## 技能系统

可复用提示词模块（`src/domain/skills/`），支持自动创建和进化。

- Markdown 文件 + YAML frontmatter
- 成熟度级别: seed → growing → mature → deprecated
- 自动发现、推荐和 A/B 测试
- 基于使用反馈的自我进化

详见 [技能系统](./guide/skill-system.md)。

---

## 插件系统

OpenClaw 兼容插件架构（`src/adapter/plugins/`）：

- **发现** — 自动扫描插件目录
- **注册** — 插件注册表管理
- **加载** — 动态加载和运行时（manifest 文件名：`openclaw.plugin.json`）
- **Hook** — 事件钩子系统（onToolCall, onAgentMessage 等）
- **SDK Shim** — OpenClaw 兼容层
- **能力声明（Capability Model）** — manifest 里 `capabilities: string[]` 声明所需能力（如 `tool.register`、`http.serve`、`runtime.config.write`），未声明 → 严格模式拒绝；缺字段 → 兼容 legacy 模式（warn + 放行）。能力清单见 `src/adapter/plugins/capabilities/index.ts`。当前在主进程内 gating，VM/Worker 隔离是后续工作。

详见 [插件系统](./guide/plugin-system.md)。

---

## MCP 集成

Model Context Protocol 客户端（`src/adapter/mcp/`）：

- 支持 `stdio`、`http`、`sse` 传输（HTTP 失败自动回退 SSE）
- 自动发现 MCP 服务端工具
- 转换为 OpenAI Function 格式
- 与内置工具统一管理
- 主机侧超时守卫包裹 `callTool` 与连接期 `listTools/Resources/Prompts`，防止 SDK 不超时时挂死

配置在 `beeclaw.json` 的 `mcp.servers` 字段。

---

## 可观测性

`/stats` 端点（`src/adapter/web/server/routes/stats.ts`）和结构化日志暴露：

- **Token 使用**：SQLite `usage_events` 表持久化 + `tokensLast24h`/`tokensLast7d` rolling window；进程启动 hydrate 最近 7d 计数
- **压缩 telemetry**：每次三层压缩（L1/L2/L3）emit `[Compression] tier complete` 事件（method/ratio/latency/infoRetention），聚合在 `/stats.compression`
- **HybridToolSelector**：`/stats.toolSelector`（calls/successes/failures + 平均输入输出工具数）
- **Circuit Breaker**：`/stats.circuits`（每 breaker 状态 + open 列表）
- **Skill DAG 健康**：`/stats.skillDeps`（缺失依赖、循环依赖）
- **Logger**：内置 secret redaction（sk-*、Bearer *、api_key=*、`apiKey/token/password` 等键名值全部 mask）

---

## 配置系统

Zod 验证的配置管理（`src/infra/config/`）：

- 源头：`src/infra/config/schema.ts`（Zod）
- 编辑器自动补全：`beeclaw.schema.json`（由 `bun run gen:config-schema` 生成；CI drift guard 拒绝二者不同步）
- 支持环境变量插值: `${VAR_NAME}` 和 `${VAR:-default}`
- 配置文件: `beeclaw.json`

详见 [配置指南](./configuration.md)。

---

## 搜索系统

多 Provider 搜索（`src/domain/search/`）：

- **Provider**: Bocha、Tavily、Google、Bing、Brave
- **深度研究**: 多角度系统搜索 + 自动综合报告
- **网页抓取**: URL 内容提取和格式转换

---

## 相关文档

- [记忆系统](./guide/memory-system.md) — 记忆存储详细设计
- [技能系统](./guide/skill-system.md) — 技能管理详细说明
- [子代理系统](./guide/subagent-system.md) — 子代理编排详细说明
- [工具参考](./references/tools.md) — 所有工具参数和示例
- [配置指南](./configuration.md) — 完整配置参考
- [故障排查](./troubleshooting/README.md) — 问题诊断和解决方案
