# Beeclaw Framework 转型规划

> **目标**：将 Beeclaw 从单一应用重构为可复用的 AI Agent 框架
>
> **时间线**：8-10 周（分 3 个阶段）
>
> **日期**：2026-03-18

---

## 目录

1. [项目背景与目标](#1-项目背景与目标)
2. [当前架构分析](#2-当前架构分析)
3. [框架化设计方案](#3-框架化设计方案)
4. [分阶段实施计划](#4-分阶段实施计划)
5. [技术细节与示例](#5-技术细节与示例)
6. [风险与挑战](#6-风险与挑战)
7. [成功指标](#7-成功指标)

---

## 1. 项目背景与目标

### 1.1 为什么需要框架化？

**当前问题**：
- ❌ 模块耦合度高，难以在其他项目中复用
- ❌ 初始化流程固定（700+ 行 `initApp`），难以定制
- ❌ 缺少清晰的抽象接口，难以替换实现
- ❌ 无法独立使用某个模块（如只用 Memory 系统）

**框架化后的价值**：
- ✅ 其他项目可独立使用各个模块
- ✅ 社区可以贡献插件和扩展
- ✅ 更容易测试和维护
- ✅ 成为 Beeclaw 生态系统的基石

### 1.2 核心目标

1. **模块解耦**：定义清晰的接口，模块间依赖抽象而非实现
2. **插件化**：所有可选功能通过插件机制加载
3. **配置驱动**：通过配置文件组装和定制框架
4. **向后兼容**：现有 Beeclaw 应用不受影响

---

## 2. 当前架构分析

### 2.1 现有模块清单

| 模块 | 位置 | 职责 | 耦合度 | 框架化难度 |
|------|------|------|--------|-----------|
| Agent | `src/domain/agent/` | AI 交互、工具调用 | 中 | 🔸 中等 |
| Memory | `src/domain/memory/` | 持久化存储、检索 | 低 | ✅ 简单 |
| Skills | `src/domain/skills/` | 技能管理、匹配 | 中 | 🔸 中等 |
| Session | `src/domain/session/` | 会话管理 | 中 | 🔸 中等 |
| Subagent | `src/domain/subagent/` | 并行任务编排 | 低 | ✅ 简单 |
| MCP | `src/adapter/mcp/` | MCP 协议集成 | 低 | ✅ 简单 |
| Plugins | `src/adapter/plugins/` | 插件系统 | 中 | 🔸 中等 |
| Proactive | `src/domain/proactive/` | 主动任务调度 | 低 | ✅ 简单 |

### 2.2 依赖关系图

```
Agent (核心)
  ├─→ Memory (读取/写入记忆)
  ├─→ Skills (加载技能)
  ├─→ Tools (工具执行)
  │    ├─→ Memory Tools
  │    ├─→ Skill Tools
  │    └─→ Builtin Tools
  ├─→ Session (会话持久化)
  └─→ MCP (外部工具)

Session
  └─→ Agent (创建代理实例)

Plugins
  └─→ Hooks (拦截 Agent 行为)
```

### 2.3 关键耦合点

#### 问题 1：Agent 直接依赖具体实现

```typescript
// src/domain/agent/index.ts (当前)
import { getMemoryStore } from '../memory';
import { getSkillStore } from '../skills/store';
import { executeMemoryTool } from '../memory/tools';

// ❌ 问题：硬编码依赖，无法替换实现
```

**解决方案**：依赖注入
```typescript
// 改造后
interface AgentDeps {
  memoryStore?: IMemoryStore;
  skillStore?: ISkillStore;
  toolRegistry?: IToolRegistry;
}

class Agent {
  constructor(private deps: AgentDeps) {}
}
```

#### 问题 2：初始化流程固定

```typescript
// src/app/index.ts (当前 700+ 行)
export async function initApp() {
  // 1. 加载配置
  // 2. 初始化存储
  // 3. 初始化 Agent
  // 4. 初始化 MCP
  // 5. 初始化 Plugins
  // ... (顺序固定，难以定制)
}
```

**解决方案**：模块化初始化器
```typescript
// 改造后
class Framework {
  private modules = new Map<string, IModule>();

  registerModule(name: string, module: IModule) {
    this.modules.set(name, module);
  }

  async initialize() {
    // 按依赖顺序自动初始化
    for (const module of this.modules.values()) {
      await module.onInit(this);
    }
  }
}
```

---

## 3. 框架化设计方案

### 3.1 分层架构

```
┌─────────────────────────────────────────┐
│         Applications (CLI, Bot)         │  ← 应用层
├─────────────────────────────────────────┤
│         Framework (组装层)              │  ← 框架层
├─────────────────────────────────────────┤
│  Core Modules (Agent, Memory, Skills)   │  ← 核心层
├─────────────────────────────────────────┤
│  Infrastructure (Config, Logger, DB)    │  ← 基础设施层
└─────────────────────────────────────────┘
```

### 3.2 核心接口设计

#### 3.2.1 Agent 接口

```typescript
// src/core/interfaces/agent.ts

/**
 * Agent 核心接口
 */
export interface IAgent {
  // 基础对话
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  // 工具管理
  registerTool(tool: Tool): void;
  getTools(): Tool[];

  // 生命周期
  onStart?(): Promise<void>;
  onStop?(): Promise<void>;
}

/**
 * Agent 依赖项
 */
export interface AgentDependencies {
  memoryStore?: IMemoryStore;
  skillStore?: ISkillStore;
  toolRegistry?: IToolRegistry;
  sessionManager?: ISessionManager;
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  provider: AIProvider;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  deps?: AgentDependencies;
}
```

#### 3.2.2 Memory 接口

```typescript
// src/core/interfaces/memory.ts

/**
 * Memory 存储接口
 */
export interface IMemoryStore {
  // 基础操作
  write(category: MemoryCategory, entry: MemoryEntry): Promise<void>;
  read(category: MemoryCategory, query?: MemoryQuery): Promise<MemoryEntry[]>;
  delete(category: MemoryCategory, id: string): Promise<void>;

  // 高级功能
  search(query: string, options?: SearchOptions): Promise<MemoryEntry[]>;
  compress(): Promise<CompressResult>;
  score(entry: MemoryEntry): Promise<ImportanceScore>;

  // 生命周期
  init(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Memory 配置
 */
export interface MemoryConfig {
  basePath: string;
  compression?: CompressionConfig;
  search?: SearchConfig;
}
```

#### 3.2.3 Plugin 接口

```typescript
// src/core/interfaces/plugin.ts

/**
 * Agent 插件接口
 */
export interface IAgentPlugin {
  name: string;
  version: string;

  // 生命周期钩子
  onInit?(agent: IAgent): Promise<void>;
  onStart?(agent: IAgent): Promise<void>;
  onStop?(agent: IAgent): Promise<void>;

  // 功能扩展
  tools?: Tool[];
  hooks?: HookDefinition[];
  middleware?: Middleware[];
}

/**
 * Hook 定义
 */
export interface HookDefinition {
  event: HookEvent;
  handler: HookHandler;
}

export type HookEvent =
  | 'before:chat'
  | 'after:chat'
  | 'before:tool'
  | 'after:tool'
  | 'on:error';
```

### 3.3 插件系统设计

#### 3.3.1 插件生命周期

```
┌──────────┐
│  Load    │  ← 加载插件代码
└────┬─────┘
     ↓
┌──────────┐
│  Init    │  ← 初始化插件（onInit）
└────┬─────┘
     ↓
┌──────────┐
│  Start   │  ← 启动插件（onStart）
└────┬─────┘
     ↓
┌──────────┐
│  Active  │  ← 插件运行中
└────┬─────┘
     ↓
┌──────────┐
│  Stop    │  ← 停止插件（onStop）
└──────────┘
```

#### 3.3.2 内置插件迁移

| 现有模块 | 迁移为插件 | 优先级 |
|---------|-----------|--------|
| Memory | `@beeclaw/plugin-memory` | 🔥 高 |
| Skills | `@beeclaw/plugin-skills` | 🔥 高 |
| Session | `@beeclaw/plugin-session` | 🔥 高 |
| Subagent | `@beeclaw/plugin-subagent` | 🔸 中 |
| MCP | `@beeclaw/plugin-mcp` | 🔸 中 |
| Proactive | `@beeclaw/plugin-proactive` | 🔹 低 |

#### 3.3.3 插件示例

```typescript
// packages/plugin-memory/src/index.ts
import { IAgentPlugin, IMemoryStore, Tool } from '@beeclaw/core';
import { MemoryStore } from './store';
import { memoryTools } from './tools';

export class MemoryPlugin implements IAgentPlugin {
  name = 'memory';
  version = '1.0.0';

  private store: IMemoryStore;

  constructor(private config: MemoryConfig) {
    this.store = new MemoryStore(config);
  }

  async onInit(agent: IAgent) {
    // 初始化存储
    await this.store.init();

    // 注册工具
    memoryTools.forEach(tool => agent.registerTool(tool));
  }

  async onStop() {
    await this.store.close();
  }

  tools = memoryTools;
}
```

### 3.4 配置系统设计

#### 3.4.1 配置文件结构

```typescript
// beeclaw.config.ts
import { defineConfig } from '@beeclaw/framework';
import { MemoryPlugin } from '@beeclaw/plugin-memory';
import { SkillsPlugin } from '@beeclaw/plugin-skills';

export default defineConfig({
  // Agent 配置
  agent: {
    provider: 'openai',
    model: 'gpt-4',
    systemPrompt: 'You are a helpful assistant.',
  },

  // 插件配置
  plugins: [
    new MemoryPlugin({
      basePath: './data/memory',
      compression: { enabled: true, schedule: '0 3 * * *' },
    }),
    new SkillsPlugin({
      basePath: './skills',
      matcher: 'llm',
    }),
  ],

  // 适配器配置
  adapters: {
    cli: { enabled: true },
    feishu: {
      enabled: true,
      appId: process.env.LARK_BEECLAW_APPID!,
      appSecret: process.env.LARK_BEECLAW_AS!,
    },
  },
});
```

#### 3.4.2 配置加载器

```typescript
// src/core/config/loader.ts
export class ConfigLoader {
  static async load(path: string): Promise<FrameworkConfig> {
    const configModule = await import(path);
    return configModule.default;
  }

  static validate(config: FrameworkConfig): ValidationResult {
    // 验证配置完整性
    // 检查插件兼容性
    // 检查依赖关系
  }
}
```

---

## 4. 分阶段实施计划

### 阶段 1：核心接口定义与解耦（2-3 周）

**目标**：建立抽象层，解耦现有模块

#### Week 1：定义核心接口

- [ ] 创建 `src/core/interfaces/` 目录
- [ ] 定义 `IAgent` 接口
- [ ] 定义 `IMemoryStore` 接口
- [ ] 定义 `ISkillStore` 接口
- [ ] 定义 `ISessionManager` 接口
- [ ] 定义 `IToolRegistry` 接口
- [ ] 定义 `IAgentPlugin` 接口

**产出**：
```typescript
// src/core/interfaces/index.ts
export * from './agent';
export * from './memory';
export * from './skills';
export * from './session';
export * from './tools';
export * from './plugin';
```

#### Week 2：解耦 Agent 模块

- [ ] 重构 `Agent` 类，接收依赖注入
- [ ] 提取工具注册逻辑为 `ToolRegistry`
- [ ] 移除硬编码的 Memory/Skill 依赖
- [ ] 添加依赖注入容器（简单版）
- [ ] 编写单元测试

**改造对比**：
```typescript
// Before
export async function createAgent(options: AgentOptions) {
  const memoryStore = getMemoryStore(); // ❌ 硬编码
  const skillStore = getSkillStore();   // ❌ 硬编码
  // ...
}

// After
export async function createAgent(options: AgentOptions) {
  const deps = options.deps || {};
  const memoryStore = deps.memoryStore || getMemoryStore(); // ✅ 可注入
  const skillStore = deps.skillStore || getSkillStore();    // ✅ 可注入
  // ...
}
```

#### Week 3：解耦其他核心模块

- [ ] 解耦 Memory 模块（移除全局单例）
- [ ] 解耦 Skills 模块
- [ ] 解耦 Session 模块
- [ ] 统一使用依赖注入
- [ ] 更新现有测试

**验收标准**：
- ✅ 所有核心模块支持依赖注入
- ✅ 现有测试全部通过
- ✅ 可以独立创建 Agent 实例（不依赖全局状态）

---

### 阶段 2：插件化改造（3-4 周）

**目标**：将可选功能迁移为插件

#### Week 4：实现插件系统

- [ ] 实现 `PluginManager` 类
- [ ] 实现插件生命周期管理
- [ ] 实现 Hook 系统
- [ ] 实现中间件机制
- [ ] 编写插件开发文档

**核心代码**：
```typescript
// src/core/plugin/manager.ts
export class PluginManager {
  private plugins = new Map<string, IAgentPlugin>();

  register(plugin: IAgentPlugin) {
    this.plugins.set(plugin.name, plugin);
  }

  async initialize(agent: IAgent) {
    for (const plugin of this.plugins.values()) {
      if (plugin.onInit) {
        await plugin.onInit(agent);
      }
    }
  }
}
```

#### Week 5：迁移 Memory 插件

- [ ] 创建 `packages/plugin-memory/`
- [ ] 迁移 MemoryStore 到插件
- [ ] 迁移 Memory Tools 到插件
- [ ] 实现压缩和评分逻辑
- [ ] 编写插件测试

**目录结构**：
```
packages/plugin-memory/
├── src/
│   ├── index.ts          # 插件入口
│   ├── store.ts          # MemoryStore 实现
│   ├── tools.ts          # Memory 工具
│   ├── compression.ts    # 压缩逻辑
│   └── scoring.ts        # 评分逻辑
├── tests/
│   └── plugin.test.ts
└── package.json
```

#### Week 6：迁移 Skills 和 Session 插件

- [ ] 创建 `packages/plugin-skills/`
- [ ] 迁移 SkillStore 到插件
- [ ] 迁移 Skill Tools 到插件
- [ ] 创建 `packages/plugin-session/`
- [ ] 迁移 SessionManager 到插件
- [ ] 编写测试

#### Week 7：迁移可选插件

- [ ] 创建 `packages/plugin-subagent/`
- [ ] 创建 `packages/plugin-mcp/`
- [ ] 创建 `packages/plugin-proactive/`
- [ ] 验证所有插件独立可用

**验收标准**：
- ✅ 所有插件可独立安装和使用
- ✅ 插件测试覆盖率 > 80%
- ✅ 插件文档完整

---

### 阶段 3：框架组装与文档（2-3 周）

**目标**：提供易用的框架 API 和完整文档

#### Week 8：实现 Framework 组装层

- [ ] 创建 `packages/framework/`
- [ ] 实现 `BeeclawFramework` 类
- [ ] 实现配置加载器
- [ ] 实现模块自动发现
- [ ] 提供便捷 API

**示例代码**：
```typescript
// packages/framework/src/index.ts
export class BeeclawFramework {
  private agent: IAgent;
  private pluginManager: PluginManager;

  constructor(private config: FrameworkConfig) {}

  async start() {
    // 1. 创建 Agent
    this.agent = createAgent(this.config.agent);

    // 2. 加载插件
    for (const plugin of this.config.plugins) {
      this.pluginManager.register(plugin);
    }

    // 3. 初始化插件
    await this.pluginManager.initialize(this.agent);
  }

  async chat(message: string) {
    return this.agent.chat([{ role: 'user', content: message }]);
  }
}
```

#### Week 9：完善文档和示例

- [ ] 编写 API 文档（TypeDoc）
- [ ] 编写快速开始指南
- [ ] 编写插件开发指南
- [ ] 创建示例项目
  - [ ] `examples/minimal/` - 最小示例
  - [ ] `examples/custom-plugin/` - 自定义插件
  - [ ] `examples/multi-agent/` - 多代理系统
- [ ] 编写迁移指南（从旧版升级）

**文档结构**：
```
docs/
├── getting-started.md       # 快速开始
├── api/                     # API 文档
│   ├── agent.md
│   ├── memory.md
│   └── plugins.md
├── guides/                  # 开发指南
│   ├── plugin-development.md
│   ├── configuration.md
│   └── migration.md
└── examples/                # 示例代码
    ├── minimal/
    └── custom-plugin/
```

#### Week 10：发布准备

- [ ] 配置 Monorepo（Bun Workspaces）
- [ ] 配置 CI/CD（测试、构建、发布）
- [ ] 版本管理策略（Changesets）
- [ ] 发布到 npm
  - [ ] `@beeclaw/core`
  - [ ] `@beeclaw/framework`
  - [ ] `@beeclaw/plugin-memory`
  - [ ] `@beeclaw/plugin-skills`
  - [ ] `@beeclaw/plugin-session`
- [ ] 创建 GitHub Release

**验收标准**：
- ✅ 所有包发布到 npm
- ✅ 文档网站上线（VitePress）
- ✅ 示例项目可运行
- ✅ CI/CD 流程完整

---

## 5. 技术细节与示例

### 5.1 依赖注入实现

```typescript
// src/core/di/container.ts
export class DIContainer {
  private services = new Map<string, any>();

  register<T>(name: string, factory: () => T) {
    this.services.set(name, factory);
  }

  resolve<T>(name: string): T {
    const factory = this.services.get(name);
    if (!factory) {
      throw new Error(`Service ${name} not registered`);
    }
    return factory();
  }
}

// 使用示例
const container = new DIContainer();
container.register('memoryStore', () => new MemoryStore(config));
container.register('skillStore', () => new SkillStore(config));

const agent = createAgent({
  deps: {
    memoryStore: container.resolve('memoryStore'),
    skillStore: container.resolve('skillStore'),
  },
});
```

### 5.2 插件通信机制

```typescript
// 插件间通过 Agent Context 通信
interface AgentContext {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

// MemoryPlugin 设置数据
class MemoryPlugin {
  onInit(agent: IAgent) {
    agent.context.set('memory:store', this.store);
  }
}

// SkillsPlugin 读取数据
class SkillsPlugin {
  onInit(agent: IAgent) {
    const memoryStore = agent.context.get<IMemoryStore>('memory:store');
    // 使用 memoryStore
  }
}
```

### 5.3 配置验证

```typescript
// 使用 Zod 验证配置
import { z } from 'zod';

const PluginConfigSchema = z.object({
  name: z.string(),
  version: z.string(),
  config: z.record(z.any()),
});

const FrameworkConfigSchema = z.object({
  agent: z.object({
    provider: z.string(),
    model: z.string(),
    systemPrompt: z.string().optional(),
  }),
  plugins: z.array(z.any()),
});

// 验证配置
function validateConfig(config: unknown): FrameworkConfig {
  return FrameworkConfigSchema.parse(config);
}
```

---

## 6. 风险与挑战

### 6.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| 接口设计不合理 | 高 | 中 | 充分调研现有代码，渐进式重构 |
| 性能下降 | 中 | 低 | 性能基准测试，优化关键路径 |
| 向后兼容性破坏 | 高 | 中 | 保留旧 API，提供迁移工具 |
| 插件冲突 | 中 | 中 | 实现依赖检查和冲突检测 |

### 6.2 项目风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| 时间延期 | 高 | 中 | 分阶段交付，优先核心功能 |
| 文档不完善 | 中 | 高 | 并行开发文档，社区贡献 |
| 社区接受度低 | 高 | 低 | 提供完整示例，积极推广 |

### 6.3 应对策略

1. **渐进式重构**：保持向后兼容，分阶段迁移
2. **充分测试**：每个阶段都要有完整的测试覆盖
3. **文档先行**：先写文档和示例，再实现功能
4. **社区参与**：早期发布 RFC，收集反馈

---

## 7. 成功指标

### 7.1 技术指标

- ✅ 核心模块测试覆盖率 > 85%
- ✅ 插件测试覆盖率 > 80%
- ✅ 文档覆盖率 > 90%
- ✅ TypeScript 类型完整度 100%
- ✅ 性能损失 < 5%（对比旧版）

### 7.2 可用性指标

- ✅ 新用户能在 5 分钟内运行第一个示例
- ✅ 插件开发者能在 30 分钟内创建第一个插件
- ✅ 迁移指南能在 1 小时内完成升级

### 7.3 社区指标（发布后 3 个月）

- ✅ GitHub Stars > 100
- ✅ npm 周下载量 > 500
- ✅ 社区贡献插件 > 3
- ✅ 文档网站访问量 > 1000/月

---

## 8. 附录

### 8.1 参考资料

- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Dependency Injection in TypeScript](https://inversify.io/)
- [Plugin Architecture Patterns](https://www.martinfowler.com/articles/patterns-of-distributed-systems/single-socket-channel.html)
- [LangChain Architecture](https://js.langchain.com/docs/)
- [AutoGPT Plugin System](https://github.com/Significant-Gravitas/Auto-GPT-Plugins)

### 8.2 相关 Issue

- [RFC] Beeclaw Framework 转型
- 插件系统设计讨论
- 配置系统改进提案

### 8.3 联系方式

- 项目负责人：Keith
- 技术讨论：GitHub Discussions
- 问题反馈：GitHub Issues

---

**文档版本**：v1.0
**最后更新**：2026-03-18
**状态**：Draft → Review → Approved
