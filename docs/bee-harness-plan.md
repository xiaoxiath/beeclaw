# "bee" — 从 beeclaw 提炼 AI Agent Harness 规划

## Context

beeclaw v0.4.0 经过数月迭代，其核心 Agent 循环、多 Provider 抽象、工具系统、上下文压缩等模块已趋于稳定且高度通用（约 70-80% 代码可复用）。业界 2025-2026 年涌现大量 Agent 框架（Mastra、Vercel AI SDK、Pydantic AI、Claude Agent SDK），但 TypeScript 生态缺少一个**从生产环境提炼**的、内置上下文管理和弹性的轻量 harness。

**目标**：提炼 "bee" 作为独立 npm 包，先服务 beeclaw，成熟后开源。

---

## 与现有框架的差异化定位

| 能力 | Mastra / Vercel AI SDK / LangChain | bee |
|------|-------------------------------------|-----|
| 上下文管理 | 手动或无 | 内置 L1/L2/L3 分层压缩 + SimHash 去重 |
| Token 感知 | 无/手动 | 内置预算管理、中英双语 token 估算 |
| 工具弹性 | 无 | 内置熔断器、重试、循环检测、超时 |
| MCP | 社区包 | 内置客户端，含重连和健康检查 |
| 并行工具 | 全串行/全并行 | 自动依赖分析，按需批量并行 |
| 来源 | 自顶向下设计 | **从生产 Agent 提炼** |

**bee 不做的事**：无工作流引擎、无 UI 组件、无内置向量库、无多 Agent 编排、无内置工具。

---

## 包结构

```
packages/bee/
  src/
    index.ts                    # 公共出口
    core/
      types.ts                  # ChatMessage, ToolCall, ToolResult 等
      logger.ts                 # Logger 接口（不提供实现）
    agent/
      agent.ts                  # Agent 类: chat() / chatStream()
      agent-factory.ts          # createAgent() 工厂
      stream-handler.ts         # 流式处理
    provider/
      call-ai.ts                # callAI() / streamAI() 统一 API
      registry.ts               # Provider 注册
      router.ts                 # 分层路由 (fast/standard/advanced)
      concurrency.ts            # 并发控制
      format/
        anthropic.ts            # Anthropic 格式转换
        openai.ts               # OpenAI 兼容格式（默认）
    tool/
      registry.ts               # ToolRegistry 类
      dispatcher.ts             # 工具调度（批量、循环检测）
      executor.ts               # 工具执行管线
    context/
      token-estimator.ts        # Token 估算（中英双语）
      budget.ts                 # TokenBudgetManager
      context-manager.ts        # 上下文裁剪和压缩触发
      compression/
        tiered-compressor.ts    # L1/L2/L3 分层压缩
        l1-format.ts            # L1 格式压缩
        l2-extractive.ts        # L2 抽取式压缩
        l3-abstractive.ts       # L3 LLM 摘要压缩
    memory/
      interface.ts              # IMemoryStore 接口（无实现）
    mcp/
      client.ts                 # MCPClientManager
      executor.ts               # MCP 工具执行
    hooks/
      types.ts                  # IHookRunner 接口
      runner.ts                 # Hook 基础实现
    resilience/
      retry.ts                  # 统一重试
      circuit-breaker.ts        # 熔断器
      loop-detector.ts          # 工具循环检测
      timeout.ts                # 超时控制
    config/
      schema.ts                 # Zod 配置 schema（子集）
      env.ts                    # 环境变量插值
```

---

## 核心 API

### 1. Agent 创建与对话

```typescript
import { createAgent } from 'bee';

const agent = createAgent({
  provider: { type: 'openai', apiKey: process.env.OPENAI_API_KEY! },
  model: 'gpt-4o',
  systemPrompt: 'You are a helpful assistant.',
  tools: [/* ToolDefinition[] */],
  toolExecutor: async (name, params) => { /* ... */ },
});

// 同步对话
const response = await agent.chat('What is the weather in Tokyo?');

// 流式对话
for await (const event of agent.chatStream('What is the weather?')) {
  if (event.type === 'content') process.stdout.write(event.content);
  if (event.type === 'tool_call') console.log(`[Tool] ${event.name}`);
}
```

### 2. 工具定义（Zod 类型安全）

```typescript
import { ToolRegistry } from 'bee';
import { z } from 'zod';

const tools = new ToolRegistry();

tools.register({
  name: 'get_weather',
  description: 'Get weather for a city',
  parameters: z.object({
    city: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  execute: async ({ city, unit }) => {
    const res = await fetch(`https://api.weather.com/${city}?unit=${unit ?? 'celsius'}`);
    return res.json();
  },
});

// 转换为 OpenAI function format
agent.registerTool(tools.get('get_weather')!);
```

### 3. Provider 抽象

```typescript
// 内置支持 OpenAI 兼容格式和 Anthropic 原生格式
const provider = {
  type: 'openai' as const,  // 或 'anthropic'
  apiKey: '...',
  baseUrl: 'https://...',   // 可选，覆盖默认
  models: { fast: 'gpt-4o-mini', standard: 'gpt-4o', advanced: 'o1' },
};

// 扩展自定义 Provider
import { registerProviderAdapter } from 'bee';
registerProviderAdapter('zhipu', { formatMessages, parseResponse, getHeaders });
```

### 4. Memory 接口

```typescript
// bee 只提供接口，消费者提供实现
interface IMemoryStore {
  read(path: string): Promise<MemoryReadResult>;
  write(path: string, content: string, mode?: 'append' | 'overwrite'): Promise<MemoryWriteResult>;
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult>;
  record(category: string, entry: string): Promise<MemoryWriteResult>;
}
```

### 5. MCP 集成

```typescript
import { MCPClientManager } from 'bee';

const mcp = new MCPClientManager();
await mcp.connect({
  id: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
});

// MCP 工具自动转为 OpenAI format，注入 Agent
const mcpTools = mcp.getAllToolsAsOpenAI();
```

---

## 提取边界

### 迁移到 bee（通用、可复用）

| 模块 | 来源 |
|------|------|
| Agent 类 (orchestrator) | `src/domain/agent/orchestrator.ts` |
| AI API (callAI/streamAI) | `src/domain/agent/api.ts` |
| Anthropic 格式转换 | `api.ts` 内联代码 |
| Tool 类型 | `src/domain/agent/types.ts` |
| Tool 调度/执行 | `tool-dispatcher.ts`, `tool-executor.ts` |
| 上下文管理 | `context-manager.ts`, `token-budget.ts`, `context.ts` |
| 压缩系统 | `compression/` 整个目录 |
| MCP 客户端 | `src/adapter/mcp/client.ts`, `executor.ts` |
| 并发控制 | `src/infra/ai/concurrency-limiter.ts` |
| 分层路由 | `src/infra/ai/tiered-router.ts` |
| 弹性模块 | `resilience/` (retry, circuit-breaker, loop-detector, timeout) |
| Port 接口 | `src/domain/ports/index.ts` |
| 流处理 | `stream-handler.ts` |

### 留在 beeclaw（应用特定）

| 模块 | 原因 |
|------|------|
| 所有适配器 (CLI/Feishu/Web) | 传输层/UI |
| 内置工具 (search/finance/weather 等) | 业务工具 |
| Memory 文件系统实现 | 存储实现 |
| 技能系统 | beeclaw 特有 |
| 会话管理 | beeclaw 特有 |
| 主动系统/定时任务 | beeclaw 特有 |
| 子代理编排 | beeclaw 特有 |
| 进化/人格/目标 | beeclaw 特有 |
| 插件系统 | beeclaw 特有 |
| 数据库/队列 | 应用基础设施 |
| App bootstrap | 应用组装 |

---

## 迁移策略（6 周，5 个阶段）

### Phase 1: 基础设施（第 1-2 周）
1. 创建 monorepo 结构 `packages/bee/`
2. 提取 `core/types.ts` — ChatMessage, ToolCall, ToolResult, OpenAITool, AIResponse
3. 提取 `resilience/` — retry, circuit-breaker, loop-detector, timeout（纯函数，无耦合）
4. 提取 `context/token-estimator.ts`, `context/budget.ts`（纯函数）
5. 提取 `logger.ts` 接口（不提供实现）

### Phase 2: Provider 系统（第 2-3 周）
6. 从 `api.ts` 提取 `callAI()`/`streamAI()`，用 `ProviderConfig` 替代 `AIProvider`
7. 提取 Anthropic 格式转换到 `format/anthropic.ts`
8. 提取 `concurrency-limiter.ts`, `tiered-router.ts`

### Phase 3: Agent 核心（第 3-4 周）
9. 新建 `ToolRegistry` 类，聚合现有工具注册逻辑
10. 提取 `ToolDispatcher`（依赖注入替代全局单例）
11. 提取压缩系统 `compression/` 整个目录
12. 提取 `context-manager.ts`
13. 提取 `Agent` 类 — **关键**：构造函数注入替代全局单例访问（`getMemoryStore` → 注入 `IMemoryStore`）
14. 提取 `stream-handler.ts`（简化依赖）

### Phase 4: 集成（第 4-5 周）
15. beeclaw 新增适配层 `createBeeclawAgent()`，组合 bee 的 Agent + beeclaw 的工具/记忆/技能
16. 替换 beeclaw 的 `createAgent()` 内部实现为代理到 bee
17. 保持 beeclaw 公共 API 不变，验证所有入口（CLI/Bot/Web）正常工作

### Phase 5: 测试与文档（第 5-6 周）
18. bee 各模块独立单元测试
19. beeclaw 集成测试（CLI/Bot/Web 全量回归）
20. bee README：5 分钟快速开始 + API 参考

---

## 关键提取文件

- `src/domain/agent/orchestrator.ts` — Agent 类，最深耦合，需构造函数注入重构
- `src/domain/agent/api.ts` — callAI/streamAI，需解耦 AIProvider 类型依赖
- `src/domain/agent/types.ts` — 基础类型，几乎原样迁移
- `src/domain/agent/compression/tiered-compressor.ts` — L1/L2/L3 压缩，关键差异化
- `src/adapter/mcp/client.ts` — MCP 客户端，几乎可直接迁移

## 验证方式

1. bee 包独立编译 (`bun run typecheck`)
2. bee 包独立测试 (`bun run test`)
3. beeclaw 集成回归：`bun run cli` / `bun run bot` / `bun run web` 全部正常
4. beeclaw 全量测试通过：`bun run test`
