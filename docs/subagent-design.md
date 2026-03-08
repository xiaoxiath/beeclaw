# Beeclaw 子代理系统设计文档

> 创建时间: 2026-02-28
> 状态: 草案

## 背景

Beeclaw 当前采用单线程、顺序执行的架构。随着功能复杂度增加，以下问题日益凸显：

| 问题 | 影响 |
|------|------|
| 工具顺序执行 | 多个独立工具调用串行等待，延迟累积 |
| 无任务分解 | 复杂请求在单一上下文中处理，容易超限 |
| 上下文压力 | 长对话快速消耗 128k token 上限 |
| 单会话处理 | 多飞书用户时消息排队 |
| Goal 分解但无执行 | 只有数据模型，没有自动分配执行 |

## 目标

1. 支持并行工具执行，减少延迟
2. 支持任务自动分解和子代理委托
3. 支持上下文隔离，减轻主上下文压力
4. 支持子代理间协作和结果聚合

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestrator Agent                          │
│  (主代理 - 任务分解、调度、结果聚合)                              │
└───────────────────────┬─────────────────────────────────────────┘
                        │
          ┌─────────────┼─────────────┬─────────────┐
          ▼             ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
    │ Research │  │  Memory  │  │  Skill   │  │  Code    │
    │ Subagent │  │ Subagent │  │ Subagent │  │ Subagent │
    │ (搜索/调研)│  │ (记忆操作)│  │ (技能执行)│  │ (代码任务)│
    └──────────┘  └──────────┘  └──────────┘  └──────────┘
          │             │             │             │
          └─────────────┴─────────────┴─────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Shared State   │
                    │  (任务状态/结果) │
                    └─────────────────┘
```

### 子代理类型

| 类型 | 职责 | 可用工具 |
|------|------|----------|
| `research` | 搜索、调研、信息收集 | web_search, web_fetch, memory_read |
| `memory` | 记忆读写、知识管理 | memory_read, memory_write, keyword_* |
| `skill` | 技能创建、执行、评估 | skill_* tools |
| `code` | 代码生成、文件操作 | file_*, shell |
| `general` | 通用任务 | 所有工具 |

---

## Phase 1: 并行工具执行

**目标**: 独立工具调用并行执行

**改动文件**: `src/agent/index.ts`

### 当前实现

```typescript
// 顺序执行
for (const call of toolCalls) {
  const result = await this.toolExecutor(call.function.name, params);
}
```

### 目标实现

```typescript
// 并行执行独立工具
const independentCalls = toolCalls.filter(call =>
  !call.dependsOnPrevious  // 标记依赖关系
);
const dependentCalls = toolCalls.filter(call => call.dependsOnPrevious);

// 并行执行独立工具
const parallelResults = await Promise.all(
  independentCalls.map(call => this.toolExecutor(call.function.name, call.function.arguments))
);

// 然后执行依赖工具
for (const call of dependentCalls) {
  // ...
}
```

### 工具依赖声明

在 tool definition 中添加依赖标记：

```typescript
// src/tools/registry.ts
const toolDependencies = {
  'memory_write': { independent: true },
  'memory_read': { independent: true },
  'web_search': { independent: true },
  'goal_create': { independent: false, dependsOn: [] },
};
```

### TODO

- [x] 分析所有现有工具的依赖关系
- [x] 实现工具依赖标记机制 (`src/agent/tool-dependencies.ts`)
- [x] 修改 `src/agent/index.ts` 支持并行执行
- [x] 添加并行执行的日志和监控
- [x] 编写测试用例验证并行执行正确性

**Status: ✅ COMPLETED (2026-02-28)**

---

## Phase 2: 子代理运行时

**目标**: 创建独立的子代理执行环境

**新文件**: `src/subagent/runtime.ts`

### 核心接口

```typescript
interface SubagentConfig {
  type: 'research' | 'memory' | 'skill' | 'code' | 'general';
  task: string;
  context?: string;
  tools?: string[];  // 限制可用工具集
  maxTokens?: number;
  timeout?: number;
}

interface SubagentResult {
  success: boolean;
  output: string;
  artifacts?: Record<string, any>;
  tokensUsed: number;
}

class SubagentRuntime {
  async spawn(config: SubagentConfig): Promise<SubagentResult>;
  async spawnParallel(configs: SubagentConfig[]): Promise<SubagentResult[]>;
}
```

### 专业化 System Prompt

每种类型的子代理有专门的 system prompt：

```typescript
const SPECIALIZED_PROMPTS = {
  research: `你是一个专门负责信息收集和调研的子代理。
你的任务是高效地搜索、收集和整理信息。
输出应该简洁、结构化，便于主代理整合。`,

  memory: `你是一个专门负责记忆管理的子代理。
你的任务是读取、写入和组织用户的知识库。
保持信息的准确性和一致性。`,

  // ... 其他类型
};
```

### TODO

- [x] 创建 `src/subagent/` 目录结构
- [x] 实现 `SubagentRuntime` 类
- [x] 实现专业化 system prompt
- [x] 实现工具过滤机制
- [x] 实现超时和错误处理
- [x] 添加子代理执行日志

**Status: ✅ COMPLETED (2026-02-28)**

**Implementation**: `src/subagent/`
- `types.ts` - Type definitions
- `prompts.ts` - Specialized system prompts
- `runtime.ts` - Core runtime engine
- `index.ts` - Public API exports

---

## Phase 3: 任务分解与调度

**目标**: 自动分解复杂任务并调度执行

**新文件**: `src/subagent/orchestrator.ts`

### 任务分解

使用 LLM 辅助分解任务：

```typescript
interface SubTask {
  id: number;
  type: SubagentType;
  description: string;
  parallel: boolean;
  dependsOn: number[];  // 依赖的任务 ID
}

class TaskOrchestrator {
  async decompose(complexTask: string): Promise<SubTask[]>;
  async execute(subtasks: SubTask[]): Promise<Map<number, SubagentResult>>;
}
```

### DAG 调度

```typescript
async execute(subtasks: SubTask[]): Promise<Map<number, SubagentResult>> {
  const results = new Map<number, SubagentResult>();
  const completed = new Set<number>();

  while (completed.size < subtasks.length) {
    // 找到所有依赖已满足的任务
    const ready = subtasks.filter((st, idx) =>
      !completed.has(idx) &&
      st.dependsOn.every(dep => completed.has(dep))
    );

    // 并行执行就绪任务
    const readyResults = await this.runtime.spawnParallel(
      ready.map(st => this.toConfig(st))
    );

    // 记录结果
    ready.forEach((st, i) => {
      const idx = subtasks.indexOf(st);
      results.set(idx, readyResults[i]);
      completed.add(idx);
    });
  }

  return results;
}
```

### TODO

- [x] 设计任务分解 prompt 模板
- [x] 实现 DAG 调度器
- [x] 处理循环依赖检测
- [x] 实现任务失败重试机制
- [x] 添加执行进度追踪

**Status: ✅ COMPLETED (2026-02-28)**

**Implementation**: `src/subagent/`
- `orchestration-types.ts` - Orchestration type definitions
- `decompose.ts` - LLM-assisted task decomposition
- `scheduler.ts` - DAG scheduler with parallel execution
- `orchestrator.ts` - Main orchestrator class

---

## Phase 4: 子代理工具集成

**目标**: 让 LLM 可以主动调用子代理

**新文件**: `src/tools/subagent.ts`

### 工具定义

```typescript
export const subagentTools = {
  spawn_subagent: {
    description: '生成一个子代理来执行特定任务',
    parameters: {
      type: 'object',
      properties: {
        task_type: {
          type: 'string',
          enum: ['research', 'memory', 'skill', 'code', 'general']
        },
        task_description: { type: 'string' },
        context: { type: 'string' },
      },
      required: ['task_type', 'task_description'],
    },
    handler: async (params: any, ctx: ToolContext) => { /* ... */ },
  },

  spawn_parallel: {
    description: '并行生成多个子代理执行独立任务',
    parameters: { /* ... */ },
    handler: async (params: any, ctx: ToolContext) => { /* ... */ },
  },
};
```

### TODO

- [x] 实现 `spawn_subagent` 工具
- [x] 实现 `spawn_parallel` 工具
- [x] 在 `src/tools/builtin.ts` 中注册新工具
- [x] 编写工具使用文档和示例
- [x] 测试工具在真实场景中的表现

**Status: ✅ COMPLETED (2026-02-28)**

**Implementation**: `src/subagent/`
- `tools.ts` - Tool definitions and result formatting
- `executor.ts` - Tool execution functions

**Integration**: `src/tools/builtin.ts`
- Registered spawn_subagent and spawn_parallel tools
- Added executor functions
- Integrated into executeBuiltinTool() switch

**Configuration**: `src/agent/tool-dependencies.ts`
- Added dependency configs for subagent tools

---

## Phase 5: 共享状态管理

**目标**: 支持子代理间共享数据和协作

**新文件**: `src/subagent/state.ts`

### 核心实现

```typescript
class SharedState {
  private store: Map<string, any> = new Map();
  private locks: Map<string, Promise<void>> = new Map();

  async set(key: string, value: any): Promise<void>;
  async get(key: string): Promise<any>;
  async update(key: string, updater: (current: any) => any): Promise<void>;
}
```

### TODO

- [x] 实现基于锁的状态管理
- [x] 设计状态 key 命名规范
- [x] 实现状态过期和清理机制
- [x] 添加状态变更通知机制
- [x] 考虑持久化需求

**Status: ✅ COMPLETED (2026-02-28)**

**Implementation**: `src/subagent/`
- `state.ts` - SharedState core class with locking, TTL, and subscriptions
- `state-tools.ts` - Tool definitions for state operations
- `state-executor.ts` - Tool executors

**Integration**: `src/tools/builtin.ts`
- Registered 9 state management tools (set, get, delete, update, exists, list, stats, lock, unlock)
- Integrated into executeBuiltinTool() switch

**Features**:
- Thread-safe with lock-based concurrency control
- TTL support with automatic cleanup
- Pub-sub notification system
- Atomic update operations
- Metadata support
- Import/export functionality

---

## 使用示例

### 场景 1: 并行研究

用户请求: "帮我研究 React 19 的新特性，并更新我的知识库"

```typescript
// LLM 自动分解并调用
spawn_parallel({
  tasks: [
    {
      task_type: "research",
      task_description: "搜索 React 19 新特性官方文档和社区讨论"
    },
    {
      task_type: "memory",
      task_description: "读取现有 React 相关知识条目"
    },
  ]
})
// 研究完成后，合成结果
spawn_subagent({
  task_type: "general",
  task_description: "整合研究结果，更新知识库",
  context: "前两个子代理的输出结果..."
})
```

### 场景 2: 技能评估

用户请求: "帮我评估 skill-creator 技能的效果"

```typescript
spawn_parallel({
  tasks: [
    {
      task_type: "skill",
      task_description: "使用 skill-creator 创建一个测试技能"
    },
    {
      task_type: "skill",
      task_description: "评估 baseline (无技能) 的表现"
    },
  ]
})
// 对比结果
spawn_subagent({
  task_type: "general",
  task_description: "对比两组结果，生成评估报告"
})
```

---

## 实施路线图

| 阶段 | 工作内容 | 预期收益 | 复杂度 | 预计工时 |
|------|----------|----------|--------|----------|
| **Phase 1** | 并行工具执行 | 减少多工具调用延迟 50-70% | 低 | 1-2 天 |
| **Phase 2** | 子代理运行时 | 支持上下文隔离、专业化任务 | 中 | 3-5 天 |
| **Phase 3** | 任务分解调度 | 复杂任务自动分解执行 | 中 | 3-5 天 |
| **Phase 4** | 子代理工具集成 | LLM 可主动调用子代理 | 低 | 1-2 天 |
| **Phase 5** | 共享状态管理 | 子代理协作、结果聚合 | 中 | 2-3 天 |

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 并行执行导致状态冲突 | 实现锁机制，Phase 5 统一解决 |
| 子代理嵌套过深 | 限制最大嵌套层级 (建议 2 层) |
| 任务分解不准确 | 提供用户确认机制，支持手动分解 |
| Token 消耗增加 | 监控用量，优化子代理 prompt |
| 超时处理 | 每个子代理设置合理超时，支持取消 |

---

## 参考资源

- Claude Code 的 Task tool 实现 (本系统)
- OpenAI Assistants API 的 run 机制
- AutoGPT 的任务分解模式
- LangChain 的 AgentExecutor

---

## 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-02-28 | v0.1 | 初始草案 |
