# OpenClaw 插件体系深度分析与兼容工具技术方案

> **文档版本**：v1.0  
> **分析仓库**：[openclaw/openclaw](https://github.com/openclaw/openclaw)  
> **日期**：2026-03-05  

---

## 目录

- [一、项目概览](#一项目概览)
- [二、插件体系核心架构](#二插件体系核心架构)
  - [2.1 插件生命周期（全链路）](#21-插件生命周期全链路)
  - [2.2 插件发现的 4 层来源](#22-插件发现的-4-层来源)
  - [2.3 启用/禁用的决议链](#23-启用禁用的决议链)
- [三、核心类型定义（源码提取）](#三核心类型定义源码提取)
  - [3.1 插件定义 OpenClawPluginDefinition](#31-插件定义-openclawplugindefinition)
  - [3.2 插件 API OpenClawPluginApi](#32-插件-api-openclawpluginapi)
  - [3.3 插件清单 openclaw.plugin.json](#33-插件清单-openclawpluginjson)
  - [3.4 全部 25 个生命周期钩子](#34-全部-25-个生命周期钩子)
  - [3.5 Plugin Runtime 运行时 API](#35-plugin-runtime-运行时-api)
  - [3.6 Channel Plugin 泛型接口](#36-channel-plugin-泛型接口)
  - [3.7 Plugin Registry 结构](#37-plugin-registry-结构)
- [四、插件导出模式](#四插件导出模式)
- [五、插件目录结构规范](#五插件目录结构规范)
- [六、兼容 OpenClaw 插件体系的工具——技术方案设计](#六兼容-openclaw-插件体系的工具技术方案设计)
  - [6.1 目标定义](#61-目标定义)
  - [6.2 整体架构](#62-整体架构)
  - [6.3 分模块实现方案](#63-分模块实现方案)
  - [6.4 完整集成示例](#64-完整集成示例)
- [七、实施路线图](#七实施路线图)
- [八、关键注意事项](#八关键注意事项)

---

## 一、项目概览

OpenClaw 是一个基于 **TypeScript / Node.js** 的多通道 AI 网关系统，采用 **pnpm monorepo** 组织代码，全部使用 **ESM 模块**，运行时通过 **Jiti** 实现 TypeScript 的即时转译加载。其插件体系是整个系统的核心扩展机制，允许开发者注册工具（Tools）、生命周期钩子（Hooks）、频道适配器（Channels）、HTTP 路由、CLI 命令、网关方法等多种扩展类型。

**核心技术栈**：

| 技术 | 用途 |
|------|------|
| TypeScript | 主语言，所有插件均为 TS 源码 |
| Node.js (ESM) | 运行时，全量 ESM 模块 |
| Jiti >= 2.x | TS 即时转译加载，插件无需预编译 |
| pnpm monorepo | 项目组织结构 |
| AJV | 基于 JSON Schema 的配置校验 |

**项目规模**：内置 40+ 扩展插件，覆盖 7 个通信平台（Discord、Slack、Telegram、Signal、iMessage、WhatsApp、LINE），提供 25 个生命周期钩子和 10 种插件注册方法。

---

## 二、插件体系核心架构

### 2.1 插件生命周期（全链路）

```
发现 (Discovery) → 清单加载 (Manifest) → 配置校验 (Config Validation)
  → 模块导入 (Jiti Import) → 注册 (Registration) → 激活 (Activation)
```

| 阶段 | 核心逻辑 | 关键源文件 |
|------|---------|-----------|
| **Discovery** | 扫描 4 个来源目录，按优先级去重 | `src/plugins/discovery.ts` |
| **Manifest** | 读取 `openclaw.plugin.json`，解析插件元数据 | `src/plugins/manifest.ts` |
| **Config** | 通过 AJV + JSON Schema 校验插件配置 | `src/plugins/config-state.ts` |
| **Import** | Jiti 运行时转译 TypeScript，Proxy 延迟初始化 Runtime | `src/plugins/loader.ts` |
| **Registration** | 调用插件 `register()` 方法，向 Registry 注册各类扩展 | `src/plugins/registry.ts` |
| **Activation** | 调用可选的 `activate()` 方法，进入运行态 | `src/plugins/loader.ts` |

整个流程的编排逻辑位于 `src/plugins/loader.ts` 的 `loadOpenClawPlugins(options)` 函数中。其中一个关键设计是：**使用 JavaScript Proxy 创建延迟初始化的 `PluginRuntime`**，使得插件在注册阶段就能引用 Runtime 对象，即便此时部分子系统尚未完成初始化。

### 2.2 插件发现的 4 层来源

发现引擎按优先级从低到高扫描以下目录，同 ID 的插件高优先级覆盖低优先级：

| 来源 | 典型路径 | 优先级 | 说明 |
|------|---------|--------|------|
| **Bundled** | 内置 `bundled/` 目录 | 最低 | 40+ 内置扩展 |
| **Global** | `~/.config/openclaw/extensions/` | 中 | 用户全局安装 |
| **Workspace** | `.openclaw/extensions/` | 高 | 项目工作区级别 |
| **Config** | `config.plugins.loadPaths` 指定 | 最高 | 显式配置路径 |

发现过程包含严格的 **安全校验**：

- **路径逃逸检测**：通过 `openBoundaryFileSync` 防止 symlink 逃逸
- **目录可写性检测**：world-writable 目录会被标记为不安全
- **文件所有权验证**：确保插件文件属于当前用户

### 2.3 启用/禁用的决议链

插件是否最终加载，经过多层决议：

```
allowlist/denylist → per-entry config → bundled defaults → channel-config override
```

- **默认启用的内置插件**：`"device-pair"`, `"phone-control"`, `"talk-voice"`
- **内存插件独占槽位**：同时只能激活一个 `kind: "memory"` 的插件，由 `resolveMemorySlotDecision()` 函数管控

---

## 三、核心类型定义（源码提取）

以下所有类型定义均直接从 OpenClaw 仓库源码中提取，是编写兼容插件/工具的核心契约。

### 3.1 插件定义 `OpenClawPluginDefinition`

**源文件**：`src/plugins/types.ts`

```typescript
interface OpenClawPluginDefinition {
  id: string;                          // 唯一标识符，需匹配 /^[a-z0-9-]+$/
  name: string;                        // 人类可读的显示名称
  description?: string;                // 插件功能描述
  version?: string;                    // 语义化版本号
  kind?: PluginKind;                   // 插件类型分类
  configSchema?: Record<string, any>;  // JSON Schema 格式的配置模式定义

  // 核心方法：注册阶段调用，接收 API 和 Runtime
  register(api: OpenClawPluginApi, runtime: PluginRuntime): void | Promise<void>;

  // 可选：激活阶段调用，在所有插件注册完成后执行
  activate?(): void | Promise<void>;
}

type PluginKind = "tool" | "channel" | "memory" | "provider" | "general";
```

### 3.2 插件 API `OpenClawPluginApi`

**源文件**：`src/plugins/types.ts`

这是传递给插件 `register()` 方法的第一个参数，提供 **10 种扩展注册方法** 和 **类型安全的钩子注册**：

```typescript
interface OpenClawPluginApi {
  // ═══════════════════════════════════════════
  //  10 种扩展注册方法
  // ═══════════════════════════════════════════

  /** 注册一个可被 LLM 调用的工具 */
  registerTool(tool: ToolDefinition): void;

  /** 注册一个 Hook 脚本（文件级 Hook，区别于 typed hook） */
  registerHook(hook: HookDefinition): void;

  /** 注册一个频道适配器（Discord / Slack / Telegram 等） */
  registerChannel(channel: ChannelPlugin): void;

  /** 注册一个斜杠命令 */
  registerCommand(command: CommandDefinition): void;

  /** 注册一个 HTTP 路由端点 */
  registerHttpRoute(route: HttpRouteDefinition): void;

  /** 注册一个 LLM Provider（如自定义模型接入） */
  registerProvider(provider: ProviderPlugin): void;

  /** 注册 CLI 命令扩展 */
  registerCli(registrar: CliRegistrar): void;

  /** 注册一个后台服务 */
  registerService(service: OpenClawPluginService): void;

  /** 注册一个网关 RPC 方法 */
  registerGatewayMethod(method: GatewayMethodDefinition): void;

  // ═══════════════════════════════════════════
  //  类型安全的生命周期钩子注册
  // ═══════════════════════════════════════════

  /** 注册一个带类型约束的生命周期钩子 */
  on<K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    options?: { priority?: number }
  ): void;
}
```

### 3.3 插件清单 `openclaw.plugin.json`

**源文件**：`src/plugins/manifest.ts`

每个插件根目录必须包含一个 `openclaw.plugin.json` 文件：

```typescript
// 清单文件名常量
const PLUGIN_MANIFEST_FILENAME = "openclaw.plugin.json";

interface PluginManifest {
  id: string;                          // [必需] 全局唯一标识
  name?: string;                       // 显示名称
  description?: string;                // 功能描述
  version?: string;                    // 语义化版本
  kind?: PluginKind;                   // 插件类型
  configSchema?: Record<string, any>;  // JSON Schema 配置定义
  channels?: string[];                 // 声明支持的频道 ID
  providers?: string[];                // 声明提供的 Provider ID
  skills?: string[];                   // 声明提供的 Skill 名称
  uiHints?: {                          // 给前端 UI 的渲染提示
    category?: string;
    icon?: string;
    homepage?: string;
  };
}
```

**最小合法清单示例**：

```json
{
  "id": "my-plugin",
  "name": "My Custom Plugin",
  "description": "A plugin compatible with OpenClaw",
  "version": "1.0.0",
  "kind": "tool"
}
```

**带配置 Schema 的完整示例**：

```json
{
  "id": "smart-summary",
  "name": "Smart Summary",
  "description": "Automatically summarizes long conversations",
  "version": "2.1.0",
  "kind": "tool",
  "configSchema": {
    "type": "object",
    "properties": {
      "maxTokens": {
        "type": "number",
        "default": 4096,
        "description": "Maximum tokens for summary"
      },
      "language": {
        "type": "string",
        "enum": ["en", "zh", "ja"],
        "default": "en"
      }
    }
  },
  "uiHints": {
    "category": "productivity",
    "icon": "summarize",
    "homepage": "https://github.com/example/smart-summary"
  }
}
```

### 3.4 全部 25 个生命周期钩子

**源文件**：`src/plugins/types.ts`（类型定义）、`src/plugins/hooks.ts`（执行器）

钩子按 **两种执行模式** 运行：

| 执行模式 | 特征 | 适用场景 |
|---------|------|---------|
| **Void / Parallel** | 并发执行 (`Promise.allSettled`)，互不干扰，无返回值 | 通知类（session_start, message_sent 等） |
| **Modifying / Sequential** | 串行执行，前一个输出合并到后一个输入 | 数据变换类（llm_input, before_prompt_build 等） |

此外有 **2 个同步钩子**：`tool_result_persist` 和 `before_message_write`，它们的 handler 不能是 async。

**完整钩子列表**：

```typescript
type PluginHookHandlerMap = {
  // ─── 模型与 Prompt（Modifying/Sequential） ───
  before_model_resolve: (event: BeforeModelResolveEvent) => BeforeModelResolveResult | void;
  before_prompt_build:  (event: BeforePromptBuildEvent)  => BeforePromptBuildResult  | void;
  llm_input:            (event: LlmInputEvent)           => LlmInputResult           | void;
  llm_output:           (event: LlmOutputEvent)          => LlmOutputResult          | void;

  // ─── Agent 生命周期 ───
  before_agent_start:   (event: BeforeAgentStartEvent)   => void;        // Void
  agent_end:            (event: AgentEndEvent)            => void;        // Void

  // ─── 消息处理 ───
  message_received:     (event: MessageReceivedEvent)     => void;        // Void
  message_sending:      (event: MessageSendingEvent)      => MessageSendingResult | void;  // Modifying
  message_sent:         (event: MessageSentEvent)         => void;        // Void

  // ─── 工具调用 ───
  before_tool_call:     (event: BeforeToolCallEvent)      => BeforeToolCallResult | void;  // Modifying
  after_tool_call:      (event: AfterToolCallEvent)       => AfterToolCallResult  | void;  // Modifying
  tool_result_persist:  (event: ToolResultPersistEvent)   => ToolResultPersistResult | void; // ⚠️ 同步

  // ─── 会话管理 ───
  session_start:        (event: SessionStartEvent)        => void;        // Void
  session_end:          (event: SessionEndEvent)          => void;        // Void

  // ─── 上下文压缩 ───
  before_compaction:    (event: BeforeCompactionEvent)    => BeforeCompactionResult | void; // Modifying
  after_compaction:     (event: AfterCompactionEvent)     => void;        // Void
  before_reset:         (event: BeforeResetEvent)         => void;        // Void

  // ─── 消息持久化 ───
  before_message_write: (event: BeforeMessageWriteEvent)  => BeforeMessageWriteResult | void; // ⚠️ 同步

  // ─── Sub-Agent ───
  subagent_spawning:        (event: SubagentSpawningEvent)        => SubagentSpawningResult | void; // Modifying
  subagent_delivery_target: (event: SubagentDeliveryTargetEvent)  => SubagentDeliveryTargetResult | void; // Modifying
  subagent_spawned:         (event: SubagentSpawnedEvent)         => void;  // Void
  subagent_ended:           (event: SubagentEndedEvent)           => void;  // Void

  // ─── 网关 ───
  gateway_start:        (event: GatewayStartEvent)        => void;        // Void
  gateway_stop:         (event: GatewayStopEvent)         => void;        // Void
};
```

**钩子分类速查表**：

| 分类 | 钩子名称 | 执行模式 |
|------|---------|---------|
| 模型/Prompt | `before_model_resolve`, `before_prompt_build`, `llm_input`, `llm_output` | Modifying |
| Agent | `before_agent_start`, `agent_end` | Void |
| 消息 | `message_received`, `message_sent` | Void |
| 消息 | `message_sending` | Modifying |
| 工具 | `before_tool_call`, `after_tool_call` | Modifying |
| 工具 | `tool_result_persist` | **同步** Modifying |
| 会话 | `session_start`, `session_end` | Void |
| 压缩 | `before_compaction` | Modifying |
| 压缩 | `after_compaction`, `before_reset` | Void |
| 持久化 | `before_message_write` | **同步** Modifying |
| Sub-Agent | `subagent_spawning`, `subagent_delivery_target` | Modifying |
| Sub-Agent | `subagent_spawned`, `subagent_ended` | Void |
| 网关 | `gateway_start`, `gateway_stop` | Void |

### 3.5 Plugin Runtime 运行时 API

**源文件**：`src/plugins/runtime/types.ts`、`src/plugins/runtime/types-core.ts`、`src/plugins/runtime/types-channel.ts`

插件在 `register()` 中通过第二个参数获得 `PluginRuntime` 对象，它暴露了系统的全部内部能力：

```typescript
type PluginRuntime = PluginRuntimeCore & { channel: PluginRuntimeChannel };
```

#### PluginRuntimeCore

```typescript
interface PluginRuntimeCore {
  /** 配置读写 */
  config: {
    loadConfig(): ResolvedConfig;
    writeConfigFile(patch: Partial<Config>): void;
  };

  /** 系统控制 */
  system: {
    enqueueSystemEvent(event: SystemEvent): void;
    requestHeartbeatNow(): void;
    runCommandWithTimeout(cmd: string, timeout: number): Promise<string>;
  };

  /** 媒体处理 */
  media: {
    loadWebMedia(url: string): Promise<Buffer>;
    detectMime(buffer: Buffer): string;
  };

  /** 语音合成 */
  tts: { /* TTS 相关方法 */ };

  /** 语音识别 */
  stt: { /* STT 相关方法 */ };

  /** 内置工具工厂 */
  tools: {
    createMemoryGetTool(): ToolDefinition;
    createMemorySearchTool(): ToolDefinition;
  };

  /** 事件总线 */
  events: EventEmitter;

  /** 日志 */
  logging: Logger;

  /** 插件状态管理（key-value） */
  state: PluginStateManager;
}
```

#### PluginRuntimeChannel

```typescript
interface PluginRuntimeChannel {
  // 通用适配器
  text: TextAdapter;
  reply: ReplyAdapter;
  routing: RoutingAdapter;
  pairing: PairingAdapter;
  media: MediaAdapter;
  activity: ActivityAdapter;
  session: SessionAdapter;
  mentions: MentionsAdapter;
  reactions: ReactionsAdapter;
  groups: GroupsAdapter;
  debounce: DebounceAdapter;
  commands: CommandsAdapter;

  // 平台特定适配器
  discord: DiscordAdapter;
  slack: SlackAdapter;
  telegram: TelegramAdapter;
  signal: SignalAdapter;
  imessage: IMessageAdapter;
  whatsapp: WhatsAppAdapter;
  line: LineAdapter;
}
```

### 3.6 Channel Plugin 泛型接口

**源文件**：`src/channels/plugins/types.plugin.ts`、`src/channels/plugins/types.adapters.ts`

Channel Plugin 使用泛型设计，支持 ~25 个可选适配器：

```typescript
interface ChannelPlugin<ResolvedAccount, Probe, Audit> {
  // 必需字段
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  // 可选字段
  defaults?: ChannelDefaults;
  configSchema?: Record<string, any>;

  // ~25 个可选适配器（按功能分组）
  setup?: ChannelSetupAdapter;
  config?: ChannelConfigAdapter<ResolvedAccount>;
  reload?: () => void | Promise<void>;

  // 连接与认证
  onboarding?: ChannelOnboardingAdapter;
  pairing?: ChannelPairingAdapter;
  security?: ChannelSecurityAdapter;
  auth?: ChannelAuthAdapter;
  elevated?: ChannelElevatedAdapter;

  // 消息与通信
  outbound?: ChannelOutboundAdapter;
  streaming?: ChannelStreamingAdapter;
  threading?: ChannelThreadingAdapter;
  messaging?: ChannelMessagingAdapter;
  gateway?: ChannelGatewayAdapter<ResolvedAccount>;

  // 状态与目录
  status?: ChannelStatusAdapter;
  directory?: ChannelDirectoryAdapter;
  resolver?: ChannelResolverAdapter;

  // 群组与协作
  groups?: ChannelGroupAdapter;
  mentions?: ChannelMentionsAdapter;
  actions?: ChannelActionsAdapter;
  commands?: ChannelCommandsAdapter;

  // Agent 集成
  agentPrompt?: ChannelAgentPromptAdapter;
  agentTools?: ChannelAgentToolsAdapter;

  // 运维
  heartbeat?: ChannelHeartbeatAdapter;
}
```

### 3.7 Plugin Registry 结构

**源文件**：`src/plugins/registry.ts`

Registry 是所有已注册插件贡献的集中存储：

```typescript
interface PluginRegistry {
  plugins:          Map<string, OpenClawPluginDefinition>;
  tools:            Map<string, ToolDefinition>;
  hooks:            Map<string, HookDefinition>;
  typedHooks:       Map<PluginHookName, PluginHookRegistration<any>[]>;
  channels:         Map<ChannelId, ChannelPlugin<any, any, any>>;
  providers:        Map<string, ProviderPlugin>;
  gatewayHandlers:  Map<string, GatewayMethodDefinition>;
  httpRoutes:       Map<string, HttpRouteDefinition>;     // key = "METHOD:path"，支持覆盖
  cliRegistrars:    CliRegistrar[];
  services:         Map<string, OpenClawPluginService>;
  commands:         Map<string, CommandDefinition>;
  diagnostics:      PluginDiagnostic[];
}
```

Registry 通过 `createPluginRegistry()` 创建，同时返回一个 `createApi(pluginId)` 工厂函数，用于为每个插件生成隔离的 `OpenClawPluginApi` 实例。

**全局单例模式**：Registry 通过 `Symbol.for("openclaw.pluginRegistryState")` 挂载在 `globalThis` 上，确保跨模块/跨 chunk 共享。

---

## 四、插件导出模式

OpenClaw 支持两种插件导出方式，加载器会自动识别：

### 模式 A：对象导出（推荐）

```typescript
// src/index.ts
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk";

export default {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  kind: "tool" as const,

  register(api: OpenClawPluginApi, runtime: PluginRuntime) {
    // 注册一个 Tool
    api.registerTool({
      name: "my_tool",
      description: "A custom tool that does something useful",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      execute: async (params, context) => {
        runtime.logging.info("Tool invoked with:", params);
        return { result: "done" };
      },
    });

    // 注册生命周期钩子
    api.on("message_received", async (event) => {
      runtime.logging.info("Message received:", event);
    });

    // 注册 HTTP 路由
    api.registerHttpRoute({
      method: "GET",
      path: "/api/my-plugin/status",
      handler: async (req, res) => {
        res.json({ status: "ok" });
      },
    });
  },

  activate() {
    console.log("Plugin activated!");
  },
};
```

### 模式 B：函数导出

```typescript
// src/index.ts
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk";

export default function register(api: OpenClawPluginApi, runtime: PluginRuntime) {
  api.registerTool({
    name: "quick_tool",
    description: "A lightweight tool",
    parameters: {},
    execute: async () => ({ result: "ok" }),
  });
}
```

**加载器识别逻辑**（伪代码）：

```typescript
const mod = await jiti.import(entryPath);
const pluginDef = mod.default ?? mod;

if (typeof pluginDef === "function") {
  // 模式 B：直接调用
  await pluginDef(api, runtime);
} else if (pluginDef && typeof pluginDef.register === "function") {
  // 模式 A：调用 register 方法
  await pluginDef.register(api, runtime);
}
```

---

## 五、插件目录结构规范

```
my-openclaw-plugin/
├── openclaw.plugin.json          # [必需] 插件清单
├── package.json                  # [必需] Node.js 包描述
├── src/
│   └── index.ts                  # [必需] 插件入口（default export）
├── tsconfig.json                 # [推荐] TypeScript 配置
├── README.md                     # [推荐] 文档
└── tests/                        # [推荐] 测试
    └── index.test.ts
```

**package.json 推荐配置**：

```json
{
  "name": "my-openclaw-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.ts",
  "peerDependencies": {
    "openclaw": ">=1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

---

## 六、兼容 OpenClaw 插件体系的工具——技术方案设计

### 6.1 目标定义

构建一个**独立工具/框架**，能够：

1. **加载并运行**现有 OpenClaw 插件，无需修改插件代码
2. **提供完全兼容的 API Surface**（`OpenClawPluginApi` 的全部 10 个注册方法 + `on()` 钩子注册）
3. **实现兼容的 `PluginRuntime`**，至少覆盖 Core 部分能力
4. **保留扩展空间**，允许在兼容基础上增加自有能力

### 6.2 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                     你的工具（Host）                       │
│                                                         │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────┐  │
│  │ Plugin       │  │ Plugin         │  │ Hook        │  │
│  │ Discovery    │→ │ Loader         │→ │ Runner      │  │
│  │ Engine       │  │ (Jiti-based)   │  │ (Dual-mode) │  │
│  └──────┬───────┘  └───────┬────────┘  └──────┬──────┘  │
│         │                  │                   │         │
│         ▼                  ▼                   ▼         │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────┐  │
│  │ Manifest     │  │ Plugin         │  │ Plugin      │  │
│  │ Parser       │  │ Registry       │  │ Runtime     │  │
│  │ (AJV)        │  │ (Compatible)   │  │ (Shim)      │  │
│  └──────────────┘  └───────┬────────┘  └─────────────┘  │
│                            │                             │
│                   ┌────────┴────────┐                    │
│                   ▼                 ▼                    │
│            ┌────────────┐   ┌────────────┐              │
│            │ Tool       │   │ Channel    │              │
│            │ Executor   │   │ Adapter    │              │
│            └────────────┘   └────────────┘              │
└─────────────────────────────────────────────────────────┘
```

**核心模块清单**：

| 模块 | 职责 | 对应 OpenClaw 源文件 |
|------|------|---------------------|
| PluginDiscoveryEngine | 4 层文件系统扫描 + 安全校验 | `src/plugins/discovery.ts` |
| ManifestParser | 清单读取 + JSON Schema 校验 | `src/plugins/manifest.ts` |
| PluginRegistry | 扩展注册表 + API Factory | `src/plugins/registry.ts` |
| PluginLoader | 编排加载全流程 + Jiti 导入 | `src/plugins/loader.ts` |
| HookRunner | 双模式钩子执行器 | `src/plugins/hooks.ts` |
| RuntimeShim | PluginRuntime 兼容层 | `src/plugins/runtime/` |

### 6.3 分模块实现方案

---

#### 模块 1：插件发现引擎 (`PluginDiscoveryEngine`)

**职责**：扫描文件系统，按 4 层优先级发现插件，执行安全校验。

```typescript
// src/discovery.ts
import { readFileSync, readdirSync, existsSync, realpathSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

export interface DiscoveryOptions {
  configPaths?: string[];       // 最高优先级：配置文件指定的路径
  workspaceDir?: string;        // 项目级：.openclaw/extensions/
  globalDir?: string;           // 用户级：~/.config/openclaw/extensions/
  bundledDir?: string;          // 内置：bundled plugins 目录
}

export interface DiscoveredPlugin {
  id: string;
  rootDir: string;
  origin: "config" | "workspace" | "global" | "bundled";
  manifestPath: string;
}

const MANIFEST_FILENAME = "openclaw.plugin.json";

export function discoverPlugins(options: DiscoveryOptions): DiscoveredPlugin[] {
  const seen = new Map<string, DiscoveredPlugin>();

  // 按优先级从低到高扫描，高优先级覆盖低优先级
  const origins: Array<{ dirs: string[]; origin: DiscoveredPlugin["origin"] }> = [
    {
      dirs: options.bundledDir ? [options.bundledDir] : [],
      origin: "bundled",
    },
    {
      dirs: options.globalDir
        ? [options.globalDir]
        : [join(homedir(), ".config", "openclaw", "extensions")],
      origin: "global",
    },
    {
      dirs: options.workspaceDir
        ? [join(options.workspaceDir, ".openclaw", "extensions")]
        : [],
      origin: "workspace",
    },
    {
      dirs: options.configPaths ?? [],
      origin: "config",
    },
  ];

  for (const { dirs, origin } of origins) {
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      scanDirectory(dir, origin, seen);
    }
  }

  return Array.from(seen.values());
}

function scanDirectory(
  dir: string,
  origin: DiscoveredPlugin["origin"],
  seen: Map<string, DiscoveredPlugin>,
): void {
  const manifestPath = join(dir, MANIFEST_FILENAME);

  // Case 1: 当前目录就是插件根目录
  if (existsSync(manifestPath)) {
    registerCandidate(dir, manifestPath, origin, seen);
    return;
  }

  // Case 2: 扫描子目录
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const childManifest = join(dir, entry.name, MANIFEST_FILENAME);
    if (existsSync(childManifest)) {
      registerCandidate(join(dir, entry.name), childManifest, origin, seen);
    }
  }
}

function registerCandidate(
  rootDir: string,
  manifestPath: string,
  origin: DiscoveredPlugin["origin"],
  seen: Map<string, DiscoveredPlugin>,
): void {
  // ——— 安全校验 ———

  // 1. 路径逃逸检测：确保真实路径在预期的父目录内
  const realPath = realpathSync(rootDir);
  const expectedParent = resolve(rootDir, "..");
  if (!realPath.startsWith(realpathSync(expectedParent))) {
    console.warn(`[Security] Symlink escape detected, skipping: ${rootDir}`);
    return;
  }

  // 2. 解析清单获取 ID
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (!raw.id || typeof raw.id !== "string") {
      console.warn(`[Discovery] Missing or invalid 'id' in ${manifestPath}`);
      return;
    }

    // 高优先级覆盖低优先级
    seen.set(raw.id, { id: raw.id, rootDir, origin, manifestPath });
  } catch (err) {
    console.warn(`[Discovery] Failed to parse ${manifestPath}:`, err);
  }
}
```

---

#### 模块 2：清单解析器 (`ManifestParser`)

**职责**：解析 `openclaw.plugin.json`，校验清单结构和插件配置。

```typescript
// src/manifest.ts
import { readFileSync } from "fs";
import { join } from "path";
import Ajv from "ajv";

export interface PluginManifest {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: "tool" | "channel" | "memory" | "provider" | "general";
  configSchema?: Record<string, any>;
  channels?: string[];
  providers?: string[];
  skills?: string[];
  uiHints?: {
    category?: string;
    icon?: string;
    homepage?: string;
  };
}

const PLUGIN_MANIFEST_FILENAME = "openclaw.plugin.json";
const ajv = new Ajv({ allErrors: true, strict: false });

// 清单自身结构的 JSON Schema
const manifestSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id:           { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
    name:         { type: "string" },
    description:  { type: "string" },
    version:      { type: "string" },
    kind: {
      type: "string",
      enum: ["tool", "channel", "memory", "provider", "general"],
    },
    configSchema: { type: "object" },
    channels:     { type: "array", items: { type: "string" } },
    providers:    { type: "array", items: { type: "string" } },
    skills:       { type: "array", items: { type: "string" } },
    uiHints: {
      type: "object",
      properties: {
        category: { type: "string" },
        icon:     { type: "string" },
        homepage: { type: "string" },
      },
    },
  },
  additionalProperties: false,
};

const validateManifestSchema = ajv.compile(manifestSchema);

/**
 * 从插件根目录加载并校验清单
 */
export function loadPluginManifest(rootDir: string): PluginManifest {
  const manifestPath = join(rootDir, PLUGIN_MANIFEST_FILENAME);
  const rawText = readFileSync(manifestPath, "utf-8");

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new Error(`Invalid JSON in ${manifestPath}`);
  }

  if (!validateManifestSchema(raw)) {
    const errors = ajv.errorsText(validateManifestSchema.errors);
    throw new Error(`Invalid manifest at ${manifestPath}: ${errors}`);
  }

  return raw as PluginManifest;
}

/**
 * 使用插件声明的 configSchema 校验用户提供的配置
 */
export function validatePluginConfig(
  manifest: PluginManifest,
  config: Record<string, any>,
): { valid: boolean; errors?: string } {
  if (!manifest.configSchema) {
    return { valid: true };
  }

  const validate = ajv.compile(manifest.configSchema);
  const valid = validate(config) as boolean;

  if (!valid) {
    return {
      valid: false,
      errors: ajv.errorsText(validate.errors),
    };
  }

  return { valid: true };
}
```

---

#### 模块 3：插件注册表 (`PluginRegistry`)

**职责**：提供与 OpenClaw 完全兼容的 Registry 数据结构和 API Factory。

```typescript
// src/registry.ts
import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  PluginHookName,
  PluginHookHandlerMap,
  ToolDefinition,
  HookDefinition,
  ChannelPlugin,
  CommandDefinition,
  HttpRouteDefinition,
  ProviderPlugin,
  CliRegistrar,
  OpenClawPluginService,
  GatewayMethodDefinition,
  PluginDiagnostic,
} from "./types";

export interface PluginHookRegistration<K extends PluginHookName = PluginHookName> {
  pluginId: string;
  handler: PluginHookHandlerMap[K];
  priority: number;
}

export interface PluginRegistry {
  plugins:          Map<string, OpenClawPluginDefinition>;
  tools:            Map<string, ToolDefinition & { pluginId: string }>;
  hooks:            Map<string, HookDefinition & { pluginId: string }>;
  typedHooks:       Map<PluginHookName, PluginHookRegistration[]>;
  channels:         Map<string, ChannelPlugin<any, any, any>>;
  providers:        Map<string, ProviderPlugin>;
  gatewayHandlers:  Map<string, GatewayMethodDefinition & { pluginId: string }>;
  httpRoutes:       Map<string, HttpRouteDefinition & { pluginId: string }>;
  cliRegistrars:    CliRegistrar[];
  services:         Map<string, OpenClawPluginService>;
  commands:         Map<string, CommandDefinition & { pluginId: string }>;
  diagnostics:      PluginDiagnostic[];
}

export function createPluginRegistry() {
  const registry: PluginRegistry = {
    plugins:         new Map(),
    tools:           new Map(),
    hooks:           new Map(),
    typedHooks:      new Map(),
    channels:        new Map(),
    providers:       new Map(),
    gatewayHandlers: new Map(),
    httpRoutes:      new Map(),
    cliRegistrars:   [],
    services:        new Map(),
    commands:        new Map(),
    diagnostics:     [],
  };

  /**
   * 为每个插件创建隔离的 API 实例
   */
  function createApi(pluginId: string): OpenClawPluginApi {
    return {
      registerTool(tool) {
        if (registry.tools.has(tool.name)) {
          console.warn(
            `[Registry] Tool "${tool.name}" already registered, overwriting (plugin: ${pluginId})`,
          );
        }
        registry.tools.set(tool.name, { ...tool, pluginId });
      },

      registerHook(hook) {
        const key = `${pluginId}:${hook.name}`;
        registry.hooks.set(key, { ...hook, pluginId });
      },

      registerChannel(channel) {
        registry.channels.set(channel.id, channel);
      },

      registerCommand(command) {
        registry.commands.set(command.name, { ...command, pluginId });
      },

      registerHttpRoute(route) {
        // HTTP 路由支持覆盖（后注册的替换先注册的）
        const key = `${route.method.toUpperCase()}:${route.path}`;
        if (registry.httpRoutes.has(key)) {
          console.warn(`[Registry] HTTP route "${key}" replaced by plugin: ${pluginId}`);
        }
        registry.httpRoutes.set(key, { ...route, pluginId });
      },

      registerProvider(provider) {
        registry.providers.set(provider.id, provider);
      },

      registerCli(registrar) {
        registry.cliRegistrars.push(registrar);
      },

      registerService(service) {
        registry.services.set(service.id, service);
      },

      registerGatewayMethod(method) {
        registry.gatewayHandlers.set(method.name, { ...method, pluginId });
      },

      on<K extends PluginHookName>(
        hookName: K,
        handler: PluginHookHandlerMap[K],
        options?: { priority?: number },
      ) {
        if (!registry.typedHooks.has(hookName)) {
          registry.typedHooks.set(hookName, []);
        }
        const list = registry.typedHooks.get(hookName)!;
        list.push({
          pluginId,
          handler,
          priority: options?.priority ?? 0,
        });
        // 按优先级降序排列（高优先级先执行）
        list.sort((a, b) => b.priority - a.priority);
      },
    };
  }

  return { registry, createApi };
}
```

---

#### 模块 4：Hook Runner（双模式钩子执行器）

**职责**：精确复现 OpenClaw 的两种钩子执行模式 + 同步钩子。

```typescript
// src/hook-runner.ts
import type {
  PluginRegistry,
  PluginHookRegistration,
} from "./registry";
import type {
  PluginHookName,
  PluginHookHandlerMap,
} from "./types";

export interface HookRunnerOptions {
  /** 钩子执行超时（毫秒），默认 30000 */
  timeout?: number;
  /** 自定义错误处理 */
  onError?: (hookName: string, pluginId: string, error: unknown) => void;
}

export function createHookRunner(
  registry: PluginRegistry,
  options: HookRunnerOptions = {},
) {
  const { timeout = 30_000, onError } = options;

  function handleError(hookName: string, pluginId: string, err: unknown) {
    if (onError) {
      onError(hookName, pluginId, err);
    } else {
      console.error(`[Hook:${hookName}] Plugin "${pluginId}" error:`, err);
    }
  }

  // ═══════════════════════════════════════════
  //  Void / Parallel 模式
  //  并发执行，互不干扰，无返回值
  // ═══════════════════════════════════════════
  async function runVoidHook<K extends PluginHookName>(
    hookName: K,
    event: Parameters<PluginHookHandlerMap[K]>[0],
  ): Promise<void> {
    const registrations = registry.typedHooks.get(hookName) ?? [];
    if (registrations.length === 0) return;

    await Promise.allSettled(
      registrations.map(async (reg) => {
        try {
          const promise = (reg.handler as Function)(event);
          if (promise instanceof Promise) {
            await Promise.race([
              promise,
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Hook timeout")), timeout),
              ),
            ]);
          }
        } catch (err) {
          handleError(hookName, reg.pluginId, err);
        }
      }),
    );
  }

  // ═══════════════════════════════════════════
  //  Modifying / Sequential 模式
  //  串行执行，前一个输出合并到后一个输入
  // ═══════════════════════════════════════════
  async function runModifyingHook<K extends PluginHookName>(
    hookName: K,
    event: Parameters<PluginHookHandlerMap[K]>[0],
    mergeFn?: (
      currentEvent: any,
      handlerResult: any,
    ) => any,
  ): Promise<typeof event> {
    const registrations = registry.typedHooks.get(hookName) ?? [];
    if (registrations.length === 0) return event;

    let current = event;

    for (const reg of registrations) {
      try {
        const result = await (reg.handler as Function)(current);
        if (result != null) {
          current = mergeFn
            ? mergeFn(current, result)
            : { ...current, ...result };   // 默认浅合并
        }
      } catch (err) {
        handleError(hookName, reg.pluginId, err);
        // Modifying 模式下出错不中断，继续传递 current
      }
    }

    return current;
  }

  // ═══════════════════════════════════════════
  //  同步钩子（仅 tool_result_persist / before_message_write）
  // ═══════════════════════════════════════════
  function runSyncHook<K extends PluginHookName>(
    hookName: K,
    event: Parameters<PluginHookHandlerMap[K]>[0],
  ): typeof event {
    const registrations = registry.typedHooks.get(hookName) ?? [];
    if (registrations.length === 0) return event;

    let current = event;

    for (const reg of registrations) {
      try {
        const result = (reg.handler as Function)(current);
        if (result != null) {
          current = { ...current, ...result };
        }
      } catch (err) {
        handleError(hookName, reg.pluginId, err);
      }
    }

    return current;
  }

  // ═══════════════════════════════════════════
  //  具名便捷方法（对齐 OpenClaw 的 HookRunner）
  // ═══════════════════════════════════════════
  return {
    // 底层方法
    runVoidHook,
    runModifyingHook,
    runSyncHook,

    // 模型 / Prompt
    runBeforeModelResolve: (e: any) =>
      runModifyingHook("before_model_resolve", e),
    runBeforePromptBuild: (e: any) =>
      runModifyingHook("before_prompt_build", e),
    runLlmInput: (e: any) =>
      runModifyingHook("llm_input", e),
    runLlmOutput: (e: any) =>
      runModifyingHook("llm_output", e),

    // Agent
    runBeforeAgentStart: (e: any) => runVoidHook("before_agent_start", e),
    runAgentEnd: (e: any) => runVoidHook("agent_end", e),

    // 消息
    runMessageReceived: (e: any) => runVoidHook("message_received", e),
    runMessageSending: (e: any) => runModifyingHook("message_sending", e),
    runMessageSent: (e: any) => runVoidHook("message_sent", e),

    // 工具
    runBeforeToolCall: (e: any) => runModifyingHook("before_tool_call", e),
    runAfterToolCall: (e: any) => runModifyingHook("after_tool_call", e),
    runToolResultPersist: (e: any) => runSyncHook("tool_result_persist", e),

    // 会话
    runSessionStart: (e: any) => runVoidHook("session_start", e),
    runSessionEnd: (e: any) => runVoidHook("session_end", e),

    // 压缩
    runBeforeCompaction: (e: any) => runModifyingHook("before_compaction", e),
    runAfterCompaction: (e: any) => runVoidHook("after_compaction", e),
    runBeforeReset: (e: any) => runVoidHook("before_reset", e),

    // 持久化
    runBeforeMessageWrite: (e: any) =>
      runSyncHook("before_message_write", e),

    // Sub-Agent
    runSubagentSpawning: (e: any) =>
      runModifyingHook("subagent_spawning", e),
    runSubagentDeliveryTarget: (e: any) =>
      runModifyingHook("subagent_delivery_target", e),
    runSubagentSpawned: (e: any) => runVoidHook("subagent_spawned", e),
    runSubagentEnded: (e: any) => runVoidHook("subagent_ended", e),

    // 网关
    runGatewayStart: (e: any) => runVoidHook("gateway_start", e),
    runGatewayStop: (e: any) => runVoidHook("gateway_stop", e),
  };
}
```

---

#### 模块 5：Plugin Runtime 兼容层 (`RuntimeShim`)

**职责**：提供与 OpenClaw `PluginRuntime` API 兼容的实现，桥接到你自己工具的内部能力。对于暂时不支持的能力，使用 Proxy 提供友好的 stub。

```typescript
// src/runtime-shim.ts
import { EventEmitter } from "events";
import type {
  PluginRuntime,
  PluginRuntimeCore,
  PluginRuntimeChannel,
} from "./types";

export interface RuntimeShimOptions {
  /** 配置加载器 */
  configLoader: () => Record<string, any>;
  /** 配置写入器 */
  configWriter: (patch: Record<string, any>) => void;
  /** 日志实例 */
  logger: {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
  };
  /** 命令执行器（可选） */
  commandRunner?: (cmd: string, timeout: number) => Promise<string>;
  /** 媒体加载器（可选） */
  mediaLoader?: (url: string) => Promise<Buffer>;
}

/**
 * 创建与 OpenClaw PluginRuntime 兼容的 shim
 * 核心理念：已实现的提供真实功能，未实现的通过 Proxy 返回友好警告
 */
export function createPluginRuntimeShim(
  options: RuntimeShimOptions,
): PluginRuntime {
  const events = new EventEmitter();
  const stateStore = new Map<string, any>();

  // ─── Core Runtime ───
  const core: PluginRuntimeCore = {
    config: {
      loadConfig: options.configLoader,
      writeConfigFile: options.configWriter,
    },

    system: {
      enqueueSystemEvent(event) {
        events.emit("system-event", event);
      },
      requestHeartbeatNow() {
        events.emit("heartbeat-request");
      },
      runCommandWithTimeout:
        options.commandRunner ??
        (async () => {
          throw new Error(
            "[RuntimeShim] Command execution not supported in this host",
          );
        }),
    },

    media: {
      loadWebMedia:
        options.mediaLoader ??
        (async () => {
          throw new Error(
            "[RuntimeShim] Media loading not supported in this host",
          );
        }),
      detectMime(buffer: Buffer): string {
        // 基础 magic bytes 检测
        if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
        if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
        if (buffer[0] === 0x47 && buffer[1] === 0x49) return "image/gif";
        if (buffer[0] === 0x52 && buffer[1] === 0x49) return "audio/wav";
        if (buffer[0] === 0x25 && buffer[1] === 0x50) return "application/pdf";
        return "application/octet-stream";
      },
    },

    tts: createStubProxy("tts"),
    stt: createStubProxy("stt"),

    tools: {
      createMemoryGetTool() {
        return {
          name: "memory_get",
          description: "Retrieve a memory entry by key",
          parameters: {
            type: "object",
            properties: { key: { type: "string" } },
            required: ["key"],
          },
          execute: async () => ({ result: null }),
        } as any;
      },
      createMemorySearchTool() {
        return {
          name: "memory_search",
          description: "Search memory entries",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          execute: async () => ({ results: [] }),
        } as any;
      },
    },

    events,
    logging: options.logger,

    state: {
      get<T>(key: string): T | undefined {
        return stateStore.get(key);
      },
      set<T>(key: string, value: T): void {
        stateStore.set(key, value);
      },
      delete(key: string): boolean {
        return stateStore.delete(key);
      },
      clear(): void {
        stateStore.clear();
      },
    },
  };

  // ─── Channel Runtime（Stub） ───
  const channel = createChannelRuntimeStub(options.logger);

  return { ...core, channel } as PluginRuntime;
}

/**
 * 为未实现的子模块创建 Proxy stub，访问时打印警告而非抛错
 */
function createStubProxy(moduleName: string): any {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return (...args: any[]) => {
          console.warn(
            `[RuntimeShim] ${moduleName}.${String(prop)}() called but not implemented`,
          );
          return undefined;
        };
      },
    },
  );
}

/**
 * Channel Runtime 全部使用 Proxy stub
 * 插件访问 channel.xxx.method() 时会收到友好警告
 */
function createChannelRuntimeStub(logger: any): PluginRuntimeChannel {
  return new Proxy({} as any, {
    get(_target, adapterName: string) {
      return new Proxy(
        {},
        {
          get(_t, methodName: string) {
            return (...args: any[]) => {
              logger.warn(
                `[RuntimeShim] channel.${adapterName}.${methodName}() not implemented`,
              );
              return undefined;
            };
          },
        },
      );
    },
  }) as PluginRuntimeChannel;
}
```

---

#### 模块 6：插件加载器（核心入口）

**职责**：编排整个加载流程，是外部使用的主入口。

```typescript
// src/loader.ts
import { createJiti } from "jiti";
import { resolve, join } from "path";
import { discoverPlugins, type DiscoveryOptions } from "./discovery";
import { loadPluginManifest, validatePluginConfig } from "./manifest";
import { createPluginRegistry, type PluginRegistry } from "./registry";
import { createHookRunner, type HookRunnerOptions } from "./hook-runner";
import {
  createPluginRuntimeShim,
  type RuntimeShimOptions,
} from "./runtime-shim";

export interface LoaderOptions {
  /** 插件发现配置 */
  discovery: DiscoveryOptions;
  /** 每个插件的配置，key = pluginId */
  pluginConfigs?: Record<string, Record<string, any>>;
  /** Runtime shim 配置 */
  runtimeOptions: RuntimeShimOptions;
  /** 允许加载的插件白名单（为空则加载全部） */
  enabledPlugins?: string[];
  /** 禁止加载的插件黑名单 */
  disabledPlugins?: string[];
  /** Hook runner 配置 */
  hookRunnerOptions?: HookRunnerOptions;
}

export interface LoadResult {
  registry: PluginRegistry;
  hookRunner: ReturnType<typeof createHookRunner>;
  runtime: ReturnType<typeof createPluginRuntimeShim>;
  /** 成功加载的插件 ID 列表 */
  loaded: string[];
  /** 加载失败的插件及原因 */
  failed: Array<{ id: string; error: string }>;
}

export async function loadPlugins(options: LoaderOptions): Promise<LoadResult> {
  const { registry, createApi } = createPluginRegistry();
  const loaded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  // 1. ─── 发现 ───
  const discovered = discoverPlugins(options.discovery);
  console.log(`[Loader] Discovered ${discovered.length} plugin candidates`);

  // 2. ─── 过滤（启用/禁用） ───
  const filtered = discovered.filter((p) => {
    if (options.disabledPlugins?.includes(p.id)) return false;
    if (
      options.enabledPlugins &&
      options.enabledPlugins.length > 0 &&
      !options.enabledPlugins.includes(p.id)
    ) {
      return false;
    }
    return true;
  });
  console.log(`[Loader] ${filtered.length} plugins after filtering`);

  // 3. ─── 创建 Runtime Shim ───
  const runtime = createPluginRuntimeShim(options.runtimeOptions);

  // 4. ─── 创建 Jiti 实例 ───
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    alias: {
      // 关键：将插件的 SDK import 映射到你的兼容类型模块
      "openclaw/plugin-sdk": resolve(__dirname, "./plugin-sdk/index.ts"),
      "openclaw/plugin-sdk/core": resolve(__dirname, "./plugin-sdk/core.ts"),
    },
  });

  // 5. ─── 内存插件独占槽位跟踪 ───
  let memorySlotOccupied: string | null = null;

  // 6. ─── 逐一加载 ───
  for (const candidate of filtered) {
    try {
      // 6a. 解析清单
      const manifest = loadPluginManifest(candidate.rootDir);

      // 6b. 独占槽位检查（memory 类型）
      if (manifest.kind === "memory") {
        if (memorySlotOccupied) {
          console.warn(
            `[Loader] Skipping memory plugin "${manifest.id}" — ` +
            `slot occupied by "${memorySlotOccupied}"`,
          );
          failed.push({
            id: manifest.id,
            error: `Memory slot occupied by "${memorySlotOccupied}"`,
          });
          continue;
        }
        memorySlotOccupied = manifest.id;
      }

      // 6c. 配置校验
      const pluginConfig = options.pluginConfigs?.[manifest.id] ?? {};
      const validation = validatePluginConfig(manifest, pluginConfig);
      if (!validation.valid) {
        console.error(
          `[Loader] Config validation failed for "${manifest.id}": ${validation.errors}`,
        );
        failed.push({ id: manifest.id, error: `Config validation: ${validation.errors}` });
        continue;
      }

      // 6d. 通过 Jiti 导入 TypeScript 模块
      const entryPath = join(candidate.rootDir, "src", "index.ts");
      const mod = (await jiti.import(entryPath)) as any;
      const pluginDef = mod.default ?? mod;

      // 6e. 创建 API 并注册
      const api = createApi(manifest.id);

      if (typeof pluginDef === "function") {
        // 模式 B：函数导出
        await pluginDef(api, runtime);
      } else if (pluginDef && typeof pluginDef.register === "function") {
        // 模式 A：对象导出
        registry.plugins.set(manifest.id, pluginDef);
        await pluginDef.register(api, runtime);
      } else {
        throw new Error("No valid export (expected default object with register() or function)");
      }

      // 6f. 激活（可选）
      if (typeof pluginDef.activate === "function") {
        await pluginDef.activate();
      }

      loaded.push(manifest.id);
      console.log(`[Loader] ✅ Loaded: ${manifest.id} (${manifest.kind ?? "general"})`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Loader] ❌ Failed: "${candidate.id}" — ${errMsg}`);
      failed.push({ id: candidate.id, error: errMsg });
      registry.diagnostics.push({
        pluginId: candidate.id,
        level: "error",
        message: errMsg,
      });
    }
  }

  // 7. ─── 创建 Hook Runner ───
  const hookRunner = createHookRunner(registry, options.hookRunnerOptions);

  console.log(
    `[Loader] Done. Loaded: ${loaded.length}, Failed: ${failed.length}`,
  );

  return { registry, hookRunner, runtime, loaded, failed };
}
```

---

### 6.4 完整集成示例

```typescript
// app.ts — 你的工具主入口
import { loadPlugins } from "./loader";

async function main() {
  // ─── 加载所有插件 ───
  const { registry, hookRunner, loaded, failed } = await loadPlugins({
    discovery: {
      workspaceDir: process.cwd(),
      bundledDir: "./bundled-plugins",
    },
    runtimeOptions: {
      configLoader: () => loadYourConfig(),
      configWriter: (patch) => writeYourConfig(patch),
      logger: console,
    },
    pluginConfigs: {
      "smart-summary": { maxTokens: 4096, language: "zh" },
    },
    disabledPlugins: ["deprecated-plugin"],
  });

  console.log(`Loaded plugins: ${loaded.join(", ")}`);
  if (failed.length > 0) {
    console.warn(`Failed plugins:`, failed);
  }

  // ─── 使用已注册的 Tools ───
  for (const [name, tool] of registry.tools) {
    console.log(`Available tool: ${name} (from plugin: ${tool.pluginId})`);
    // 将 tool.execute 集成到你的 Agent / LLM function-calling 调用链
  }

  // ─── 在 LLM 调用链中触发 Hooks ───
  // 发送给 LLM 前
  const modifiedInput = await hookRunner.runLlmInput({
    messages: [{ role: "user", content: "Hello" }],
    model: "gpt-4",
  });

  // 调用 LLM...
  const llmResponse = await callYourLLM(modifiedInput);

  // LLM 响应后
  const modifiedOutput = await hookRunner.runLlmOutput({
    response: llmResponse,
  });

  // ─── 使用 HTTP 路由 ───
  for (const [key, route] of registry.httpRoutes) {
    yourHttpServer.route(route.method, route.path, route.handler);
  }

  // ─── 使用 CLI 扩展 ───
  for (const registrar of registry.cliRegistrars) {
    registrar(yourCliProgram);
  }

  // ─── 使用网关方法 ───
  for (const [name, method] of registry.gatewayHandlers) {
    yourGateway.registerMethod(name, method.handler);
  }
}

main().catch(console.error);
```

---

## 七、实施路线图

| 阶段 | 模块 | 内容说明 | 优先级 | 预估工作量 |
|------|------|---------|--------|-----------|
| **Phase 1** | ManifestParser | 清单解析 + JSON Schema 校验（AJV） | P0 必须 | 1 天 |
| **Phase 1** | DiscoveryEngine | 4 层目录扫描 + 安全校验 | P0 必须 | 1-2 天 |
| **Phase 1** | PluginRegistry | Registry 数据结构 + createApi() Factory | P0 必须 | 1-2 天 |
| **Phase 1** | PluginLoader | Jiti 加载 + 双导出模式 + 独占槽位 | P0 必须 | 1-2 天 |
| **Phase 1** | HookRunner | Void/Parallel + Modifying/Sequential + 同步钩子 | P0 必须 | 1-2 天 |
| **Phase 2** | RuntimeShim (Core) | config / system / logging / state / events | P1 重要 | 2-3 天 |
| **Phase 2** | Tool Executor | Tool 注册后的调用执行集成 | P1 重要 | 1-2 天 |
| **Phase 2** | Plugin SDK | 类型重导出模块（兼容 `openclaw/plugin-sdk`） | P1 重要 | 1 天 |
| **Phase 3** | Channel Adapters | ChannelPlugin 适配器体系 | P2 按需 | 3-5 天 |
| **Phase 3** | RuntimeShim (Channel) | 平台适配器（Discord/Slack/Telegram 等） | P2 按需 | 5-10 天 |
| **Phase 4** | HTTP Routes | Express/Fastify 路由集成 | P3 可选 | 1-2 天 |
| **Phase 4** | CLI Extension | Commander.js / Yargs 集成 | P3 可选 | 1 天 |
| **Phase 4** | Gateway Methods | RPC 方法注册 | P3 可选 | 1-2 天 |
| **Phase 4** | Diagnostics UI | 插件配置界面 + 诊断系统 | P3 可选 | 3-5 天 |

**总计**：P0 阶段约 **5-9 天**，P0+P1 约 **9-15 天**，完整实现约 **20-35 天**。

---

## 八、关键注意事项

### 8.1 Jiti 是必须依赖

OpenClaw 插件均为 **TypeScript 源码**，不经预编译。你必须使用 **Jiti >= 2.x** 做运行时转译：

```bash
npm install jiti@^2
```

关键配置：
- `interopDefault: true` — 正确处理 default export
- `alias` — 映射 `openclaw/plugin-sdk` 到你的类型模块

### 8.2 SDK 别名映射

插件通过 `import ... from "openclaw/plugin-sdk"` 引入类型。你需要：

1. 创建 `src/plugin-sdk/index.ts`，重导出所有兼容类型
2. 在 Jiti 的 `alias` 中配置映射
3. OpenClaw 的 SDK 导出约 **400+ 个类型/工具函数**，建议分批实现

### 8.3 Global Singleton 冲突

OpenClaw 使用 `Symbol.for("openclaw.pluginRegistryState")` 在 `globalThis` 上存储全局状态。如果你的工具需要与 OpenClaw 共存于同一 Node.js 进程：

- 使用不同的 Symbol key（如 `Symbol.for("your-tool.pluginRegistryState")`）
- 或者隔离在不同的 Worker Thread 中

### 8.4 内存插件独占槽位

同一时间只允许一个 `kind: "memory"` 的插件激活。加载器必须实现：

1. 跟踪当前 memory slot 占用状态
2. 后续 memory 插件被跳过并记录诊断信息
3. 用户可通过 `config.plugins.slots.memory` 指定优先哪个

### 8.5 安全模型

务必实现以下安全检查（OpenClaw 发现系统的核心约束）：

| 检查项 | 说明 | 实现方式 |
|--------|------|---------|
| 路径逃逸检测 | 防止 symlink 指向受保护目录 | `realpathSync()` + 父目录前缀校验 |
| 目录可写性 | world-writable 目录可能被恶意写入 | `statSync().mode` 检查 `0o002` 位 |
| 文件所有权 | 确保插件文件属于当前用户 | `statSync().uid` === `process.getuid()` |

### 8.6 Hook 优先级

`on()` 方法支持 `{ priority: number }` 参数：

- 数值越大，优先级越高，越先执行
- 默认值为 0
- 在 Modifying 模式下，执行顺序直接影响最终数据

### 8.7 类型兼容性策略

推荐做法：

1. **直接 fork** OpenClaw 的 `src/plugin-sdk/index.ts`（约 400+ 导出），作为你的 SDK 基础
2. 保持类型签名 100% 一致，仅修改实现
3. 使用 `tsc --noEmit` 做类型兼容性回归测试

---

## 附录 A：OpenClaw 内置扩展分类参考

| 类型 | 内置插件示例 | 数量 |
|------|------------|------|
| Channel | discord, slack, telegram, signal, imessage, whatsapp, line | 7 |
| Tool | phone-control, device-pair, talk-voice | 3+ |
| Memory | (独占槽位) | 1+ |
| Provider | 各类 LLM provider 适配 | 多个 |
| General | 通用扩展 | 20+ |

**总计**：约 40+ 内置扩展。

---

## 附录 B：内部钩子事件系统

除了面向插件的 25 个 typed hooks，OpenClaw 还有一套 **内部钩子事件系统**（`src/hooks/internal-hooks.ts`），使用 `globalThis.__openclaw_internal_hook_handlers__` 单例 Map：

```typescript
// 内部事件类型
type InternalHookEvents =
  | AgentBootstrapHookEvent
  | GatewayStartupHookEvent
  | MessageReceivedHookEvent
  | MessageSentHookEvent
  | MessageTranscribedHookEvent
  | MessagePreprocessedHookEvent;

// 注册/触发 API
registerInternalHook(eventKey: string, handler: Function): void;
unregisterInternalHook(eventKey: string, handlerId: string): void;
triggerInternalHook(event: InternalHookEvents): void;
```

这套系统用于 OpenClaw 核心模块间的 cross-chunk 通信，通常不需要在兼容工具中实现，除非你需要深度集成其 Agent 或 Gateway 模块。
