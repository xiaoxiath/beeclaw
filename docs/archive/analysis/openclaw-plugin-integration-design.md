# Beeclaw 兼容 OpenClaw 插件生态 - 技术方案设计

> **文档版本**：v1.0
> **创建日期**：2026-03-05
> **项目代号**：OpenClaw Plugin Compatibility Layer (OPCL)
> **目标**：让 Beeclaw 能够无缝加载和运行 OpenClaw 插件生态的 40+ 插件

---

## 目录

- [一、项目概述](#一项目概述)
- [二、技术架构](#二技术架构)
- [三、核心模块设计](#三核心模块设计)
- [四、API 设计](#四api-设计)
- [五、数据流与生命周期](#五数据流与生命周期)
- [六、实施计划](#六实施计划)
- [七、测试策略](#七测试策略)
- [八、部署与运维](#八部署与运维)
- [九、风险管理](#九风险管理)
- [十、附录](#十附录)

---

## 一、项目概述

### 1.1 背景与动机

**现状**：
- OpenClaw 拥有成熟的插件生态（40+ 内置插件）
- Beeclaw 需要快速扩展功能，避免重复造轮子
- OpenClaw 插件全部使用 TypeScript 源码，无需预编译

**机会**：
- 通过兼容层直接复用 OpenClaw 生态
- 加速 Beeclaw 功能扩展
- 吸引 OpenClaw 社区开发者

### 1.2 目标定义

#### 核心目标（P0）

1. **无缝加载**：能够加载和运行现有的 OpenClaw 插件，无需修改插件代码
2. **完整 API**：实现 `OpenClawPluginApi` 的全部 10 个注册方法
3. **Runtime 兼容**：提供兼容的 `PluginRuntime` 实现
4. **生命周期钩子**：支持全部 25 个生命周期钩子

#### 扩展目标（P1）

1. **Channel 插件**：支持 Discord、Slack、Telegram 等渠道插件
2. **Provider 插件**：支持自定义 AI 提供商
3. **工具生态**：复用 diffs、phone-control 等工具插件

#### 可选目标（P2）

1. **HTTP 路由**：支持插件注册 HTTP 端点
2. **CLI 扩展**：支持插件注册 CLI 命令
3. **Gateway 方法**：支持插件注册 RPC 方法

### 1.3 成功指标

| 指标 | 目标 | 衡量方式 |
|------|------|---------|
| **插件加载成功率** | ≥ 95% | 加载 40+ OpenClaw 插件的成功率 |
| **API 兼容性** | 100% | TypeScript 类型检查通过 |
| **性能损耗** | ≤ 10% | 插件加载和执行的性能损耗 |
| **测试覆盖率** | ≥ 80% | 核心模块的单元测试覆盖率 |

### 1.4 范围界定

**包含**：
- ✅ 插件发现和加载机制
- ✅ 插件 API 兼容层
- ✅ Plugin Runtime Shim
- ✅ 生命周期钩子系统
- ✅ 工具注册和执行
- ✅ Channel 插件基础支持

**不包含**：
- ❌ OpenClaw Agent 核心重写
- ❌ OpenClaw Gateway 重写
- ❌ 所有 Platform-specific 适配器的完整实现
- ❌ OpenClaw 内部钩子系统

---

## 二、技术架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw Plugin Ecosystem                   │
│          (40+ Plugins: telegram, feishu, diffs, ...)           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│            OpenClaw Plugin Compatibility Layer (OPCL)            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Plugin Discovery Engine                                  │   │
│  │  • 4-Layer Discovery (Bundled/Global/Workspace/Config)   │   │
│  │  • Security Validation (Symlink/Permission/Ownership)    │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Plugin Loader                                            │   │
│  │  • Manifest Parser (JSON Schema Validation)              │   │
│  │  • Jiti Runtime (TypeScript Transpilation)               │   │
│  │  • Dual Export Mode Detection                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Plugin Registry                                          │   │
│  │  • Tools Registry        • Channels Registry             │   │
│  │  • Hooks Registry        • Providers Registry            │   │
│  │  • HTTP Routes Registry  • CLI Registrars                │   │
│  │  • Services Registry     • Commands Registry             │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Plugin API Adapter                                       │   │
│  │  • registerTool()         • registerChannel()            │   │
│  │  • registerHook()         • registerProvider()           │   │
│  │  • registerHttpRoute()    • registerCli()                │   │
│  │  • registerService()      • registerCommand()            │   │
│  │  • on() - Lifecycle Hooks                                │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Plugin Runtime Shim                                      │   │
│  │  • Core Runtime (config/system/media/logging/state)      │   │
│  │  • Channel Runtime (Proxy Stubs for 25 Adapters)         │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Hook Runner                                              │   │
│  │  • Void/Parallel Mode    • Modifying/Sequential Mode     │   │
│  │  • Sync Hooks            • Priority Queue                │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Plugin SDK Shim                                          │   │
│  │  • Type Re-exports (400+ types)                          │   │
│  │  • Alias Mapping (openclaw/plugin-sdk/*)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Beeclaw Core Systems                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Agent System │  │ Tool System  │  │ Channel Mgr  │          │
│  │ (Enhanced)   │  │ (Enhanced)   │  │ (New)        │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Memory Store │  │ Skill Store  │  │ Session Mgr  │          │
│  │ (Existing)   │  │ (Existing)   │  │ (Existing)   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **TypeScript** | ^5.0 | 主语言，100% 类型安全 |
| **Node.js** | ≥22 | 运行时（ESM 模块） |
| **Jiti** | ^2.0 | TypeScript 运行时转译（关键依赖） |
| **AJV** | ^8.0 | JSON Schema 校验 |
| **Bun** | latest | Beeclaw 运行时（兼容 Node.js） |
| **Vitest** | ^2.0 | 单元测试框架 |

### 2.3 设计原则

1. **最小侵入**：不修改 Beeclaw 核心代码，通过适配层集成
2. **渐进式实现**：P0 → P1 → P2，逐步扩展功能
3. **类型安全**：保持 100% 类型兼容，通过 TypeScript 类型检查
4. **性能优先**：使用 Proxy 延迟初始化，避免不必要的开销
5. **友好降级**：未实现的功能通过 Proxy stub 提供友好警告

---

## 三、核心模块设计

### 3.1 Plugin Discovery Engine（插件发现引擎）

#### 职责

- 扫描 4 层来源目录（按优先级）
- 执行安全校验（路径逃逸、权限、所有权）
- 去重和覆盖规则处理

#### 目录结构

```
src/plugins/discovery/
├── index.ts              # 主入口
├── scanner.ts            # 目录扫描逻辑
├── security.ts           # 安全校验
├── priority.ts           # 优先级处理
└── types.ts              # 类型定义
```

#### 核心代码

**`src/plugins/discovery/types.ts`**

```typescript
export type PluginOrigin = "bundled" | "global" | "workspace" | "config";

export interface DiscoveryOptions {
  bundledDir?: string;      // 内置插件目录
  globalDir?: string;       // 全局插件目录
  workspaceDir?: string;    // 工作区目录
  configPaths?: string[];   // 配置指定的路径
}

export interface DiscoveredPlugin {
  id: string;
  rootDir: string;
  origin: PluginOrigin;
  manifestPath: string;
  priority: number;  // 越大优先级越高
}

export interface DiscoveryResult {
  plugins: DiscoveredPlugin[];
  skipped: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; error: Error }>;
}
```

**`src/plugins/discovery/scanner.ts`**

```typescript
import { readdirSync, existsSync, statSync, realpathSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import type { DiscoveryOptions, DiscoveredPlugin, PluginOrigin } from "./types";

const MANIFEST_FILENAME = "openclaw.plugin.json";

/**
 * 按优先级从低到高扫描插件目录
 */
export function discoverPlugins(options: DiscoveryOptions): DiscoveredPlugin[] {
  const seen = new Map<string, DiscoveredPlugin>();

  // 定义 4 层来源及其优先级
  const origins: Array<{
    dirs: string[];
    origin: PluginOrigin;
    priority: number;
  }> = [
    {
      dirs: options.bundledDir ? [options.bundledDir] : [],
      origin: "bundled",
      priority: 0,
    },
    {
      dirs: options.globalDir
        ? [options.globalDir]
        : [join(homedir(), ".config", "openclaw", "extensions")],
      origin: "global",
      priority: 1,
    },
    {
      dirs: options.workspaceDir
        ? [join(options.workspaceDir, ".openclaw", "extensions")]
        : [],
      origin: "workspace",
      priority: 2,
    },
    {
      dirs: options.configPaths ?? [],
      origin: "config",
      priority: 3,
    },
  ];

  // 按优先级从低到高扫描，高优先级覆盖低优先级
  for (const { dirs, origin, priority } of origins) {
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      scanDirectory(dir, origin, priority, seen);
    }
  }

  return Array.from(seen.values());
}

/**
 * 扫描单个目录
 */
function scanDirectory(
  dir: string,
  origin: PluginOrigin,
  priority: number,
  seen: Map<string, DiscoveredPlugin>
): void {
  const manifestPath = join(dir, MANIFEST_FILENAME);

  // Case 1: 当前目录就是插件根目录
  if (existsSync(manifestPath)) {
    registerCandidate(dir, manifestPath, origin, priority, seen);
    return;
  }

  // Case 2: 扫描子目录
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const childDir = join(dir, entry.name);
      const childManifest = join(childDir, MANIFEST_FILENAME);
      if (existsSync(childManifest)) {
        registerCandidate(childDir, childManifest, origin, priority, seen);
      }
    }
  } catch (error) {
    console.warn(`[Discovery] Failed to scan directory ${dir}:`, error);
  }
}

/**
 * 注册候选插件（包含安全校验）
 */
function registerCandidate(
  rootDir: string,
  manifestPath: string,
  origin: PluginOrigin,
  priority: number,
  seen: Map<string, DiscoveredPlugin>
): void {
  // 安全校验
  const securityCheck = validatePluginSecurity(rootDir);
  if (!securityCheck.valid) {
    console.warn(`[Security] Skipping ${rootDir}: ${securityCheck.reason}`);
    return;
  }

  // 解析清单获取 ID
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (!manifest.id || typeof manifest.id !== "string") {
      console.warn(`[Discovery] Missing or invalid 'id' in ${manifestPath}`);
      return;
    }

    // 高优先级覆盖低优先级
    const existing = seen.get(manifest.id);
    if (!existing || priority > existing.priority) {
      seen.set(manifest.id, {
        id: manifest.id,
        rootDir,
        origin,
        manifestPath,
        priority,
      });
    }
  } catch (error) {
    console.warn(`[Discovery] Failed to parse ${manifestPath}:`, error);
  }
}
```

**`src/plugins/discovery/security.ts`**

```typescript
import { statSync, realpathSync } from "fs";
import { resolve } from "path";

export interface SecurityCheckResult {
  valid: boolean;
  reason?: string;
}

/**
 * 插件安全校验（3 项检查）
 */
export function validatePluginSecurity(rootDir: string): SecurityCheckResult {
  try {
    // 1. 路径逃逸检测：确保真实路径在预期的父目录内
    const realPath = realpathSync(rootDir);
    const expectedParent = resolve(rootDir, "..");
    if (!realPath.startsWith(realpathSync(expectedParent))) {
      return {
        valid: false,
        reason: "Symlink escape detected",
      };
    }

    // 2. 目录可写性检测：world-writable 目录可能被恶意写入
    const stat = statSync(rootDir);
    if (stat.mode & 0o002) {
      // world-writable
      return {
        valid: false,
        reason: "World-writable directory (security risk)",
      };
    }

    // 3. 文件所有权验证：确保插件文件属于当前用户
    if (process.getuid && stat.uid !== process.getuid()) {
      return {
        valid: false,
        reason: "File ownership mismatch",
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: `Security check failed: ${error}`,
    };
  }
}
```

---

### 3.2 Manifest Parser（清单解析器）

#### 职责

- 解析 `openclaw.plugin.json` 文件
- 校验清单结构（使用 JSON Schema）
- 校验插件配置（使用插件声明的 configSchema）

#### 目录结构

```
src/plugins/manifest/
├── index.ts              # 主入口
├── parser.ts             # 清单解析
├── validator.ts          # Schema 校验
└── types.ts              # 类型定义
```

#### 核心代码

**`src/plugins/manifest/types.ts`**

```typescript
export type PluginKind = "tool" | "channel" | "memory" | "provider" | "general";

export interface PluginManifest {
  id: string;                          // [必需] 全局唯一标识
  name?: string;                       // 显示名称
  description?: string;                // 功能描述
  version?: string;                    // 语义化版本
  kind?: PluginKind;                   // 插件类型
  configSchema?: Record<string, any>;  // JSON Schema 配置定义
  channels?: string[];                 // 声明支持的频道 ID
  providers?: string[];                // 声明提供的 Provider ID
  skills?: string[];                   // 声明提供的 Skill 名称
  uiHints?: {
    category?: string;
    icon?: string;
    homepage?: string;
  };
}

export interface ManifestLoadResult {
  ok: true;
  manifest: PluginManifest;
  manifestPath: string;
}

export interface ManifestLoadError {
  ok: false;
  error: string;
  manifestPath: string;
}

export type ManifestLoadOutcome = ManifestLoadResult | ManifestLoadError;

export interface ConfigValidationResult {
  valid: boolean;
  errors?: string;
}
```

**`src/plugins/manifest/parser.ts`**

```typescript
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import Ajv from "ajv";
import type { PluginManifest, ManifestLoadOutcome, ConfigValidationResult } from "./types";

const PLUGIN_MANIFEST_FILENAME = "openclaw.plugin.json";

const ajv = new Ajv({ allErrors: true, strict: false });

// 清单自身的 JSON Schema
const manifestSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
    name: { type: "string" },
    description: { type: "string" },
    version: { type: "string" },
    kind: {
      type: "string",
      enum: ["tool", "channel", "memory", "provider", "general"],
    },
    configSchema: { type: "object" },
    channels: { type: "array", items: { type: "string" } },
    providers: { type: "array", items: { type: "string" } },
    skills: { type: "array", items: { type: "string" } },
    uiHints: {
      type: "object",
      properties: {
        category: { type: "string" },
        icon: { type: "string" },
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
export function loadPluginManifest(rootDir: string): ManifestLoadOutcome {
  const manifestPath = join(rootDir, PLUGIN_MANIFEST_FILENAME);

  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      error: `Manifest not found: ${manifestPath}`,
      manifestPath,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON in ${manifestPath}: ${error}`,
      manifestPath,
    };
  }

  // 校验清单结构
  if (!validateManifestSchema(raw)) {
    const errors = ajv.errorsText(validateManifestSchema.errors);
    return {
      ok: false,
      error: `Invalid manifest schema: ${errors}`,
      manifestPath,
    };
  }

  return {
    ok: true,
    manifest: raw as PluginManifest,
    manifestPath,
  };
}

/**
 * 使用插件声明的 configSchema 校验用户提供的配置
 */
export function validatePluginConfig(
  manifest: PluginManifest,
  config: Record<string, any>
): ConfigValidationResult {
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

### 3.3 Plugin Registry（插件注册表）

#### 职责

- 存储所有已注册的插件贡献（工具、钩子、渠道等）
- 为每个插件创建隔离的 API 实例
- 提供全局单例访问（避免跨模块冲突）

#### 目录结构

```
src/plugins/registry/
├── index.ts              # 主入口
├── registry.ts           # Registry 实现
├── api-factory.ts        # API Factory
└── types.ts              # 类型定义
```

#### 核心代码

**`src/plugins/registry/types.ts`**

```typescript
import type {
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
  PluginHookName,
  PluginHookHandlerMap,
} from "../types";

export interface PluginHookRegistration<K extends PluginHookName = PluginHookName> {
  pluginId: string;
  hookName: K;
  handler: PluginHookHandlerMap[K];
  priority: number;
}

export interface PluginRegistry {
  // 插件定义
  plugins: Map<string, any>;

  // 扩展注册表
  tools: Map<string, ToolDefinition & { pluginId: string }>;
  hooks: Map<string, HookDefinition & { pluginId: string }>;
  typedHooks: Map<PluginHookName, PluginHookRegistration[]>;
  channels: Map<string, ChannelPlugin<any, any, any>>;
  providers: Map<string, ProviderPlugin>;
  gatewayHandlers: Map<string, GatewayMethodDefinition & { pluginId: string }>;
  httpRoutes: Map<string, HttpRouteDefinition & { pluginId: string }>;
  cliRegistrars: CliRegistrar[];
  services: Map<string, OpenClawPluginService>;
  commands: Map<string, CommandDefinition & { pluginId: string }>;

  // 诊断信息
  diagnostics: PluginDiagnostic[];
}

export interface RegistryFactory {
  registry: PluginRegistry;
  createApi: (pluginId: string) => any;  // OpenClawPluginApi
}
```

**`src/plugins/registry/registry.ts`**

```typescript
import type { PluginRegistry, RegistryFactory } from "./types";
import { createPluginApi } from "./api-factory";

// 使用 Symbol.for 创建全局单例 key
const REGISTRY_SYMBOL = Symbol.for("beeclaw.pluginRegistryState");

/**
 * 获取或创建全局 Plugin Registry
 */
export function getOrCreatePluginRegistry(): RegistryFactory {
  // 检查全局单例是否已存在
  if ((globalThis as any)[REGISTRY_SYMBOL]) {
    return (globalThis as any)[REGISTRY_SYMBOL];
  }

  // 创建新的 Registry
  const registry: PluginRegistry = {
    plugins: new Map(),
    tools: new Map(),
    hooks: new Map(),
    typedHooks: new Map(),
    channels: new Map(),
    providers: new Map(),
    gatewayHandlers: new Map(),
    httpRoutes: new Map(),
    cliRegistrars: [],
    services: new Map(),
    commands: new Map(),
    diagnostics: [],
  };

  // 创建 API Factory
  const createApi = (pluginId: string) => createPluginApi(pluginId, registry);

  const factory: RegistryFactory = { registry, createApi };

  // 存储到全局
  (globalThis as any)[REGISTRY_SYMBOL] = factory;

  return factory;
}

/**
 * 获取当前 Registry（必须已初始化）
 */
export function getPluginRegistry(): PluginRegistry {
  const factory = (globalThis as any)[REGISTRY_SYMBOL];
  if (!factory) {
    throw new Error("Plugin registry not initialized. Call getOrCreatePluginRegistry() first.");
  }
  return factory.registry;
}
```

**`src/plugins/registry/api-factory.ts`**

```typescript
import type { PluginRegistry } from "./types";
import type { OpenClawPluginApi, PluginHookName, PluginHookHandlerMap } from "../types";

/**
 * 为每个插件创建隔离的 API 实例
 */
export function createPluginApi(
  pluginId: string,
  registry: PluginRegistry
): OpenClawPluginApi {
  return {
    // 基础信息
    id: pluginId,
    name: pluginId,
    source: pluginId,
    config: {} as any,  // TODO: 从 Beeclaw 配置传入
    pluginConfig: {},
    runtime: {} as any,  // TODO: 从外部传入
    logger: createPluginLogger(pluginId),

    // ═══════════════════════════════════════════
    //  10 种扩展注册方法
    // ═══════════════════════════════════════════

    registerTool(tool: any) {
      if (registry.tools.has(tool.name)) {
        console.warn(
          `[Registry] Tool "${tool.name}" already registered, overwriting (plugin: ${pluginId})`
        );
      }
      registry.tools.set(tool.name, { ...tool, pluginId });
    },

    registerHook(hook: any) {
      const key = `${pluginId}:${hook.name}`;
      registry.hooks.set(key, { ...hook, pluginId });
    },

    registerChannel(channel: any) {
      if (registry.channels.has(channel.id)) {
        console.warn(
          `[Registry] Channel "${channel.id}" already registered, overwriting (plugin: ${pluginId})`
        );
      }
      registry.channels.set(channel.id, channel);
    },

    registerCommand(command: any) {
      if (registry.commands.has(command.name)) {
        console.warn(
          `[Registry] Command "${command.name}" already registered, overwriting (plugin: ${pluginId})`
        );
      }
      registry.commands.set(command.name, { ...command, pluginId });
    },

    registerHttpRoute(route: any) {
      const key = `${route.method.toUpperCase()}:${route.path}`;
      if (registry.httpRoutes.has(key)) {
        console.warn(`[Registry] HTTP route "${key}" replaced by plugin: ${pluginId}`);
      }
      registry.httpRoutes.set(key, { ...route, pluginId });
    },

    registerProvider(provider: any) {
      if (registry.providers.has(provider.id)) {
        console.warn(
          `[Registry] Provider "${provider.id}" already registered, overwriting (plugin: ${pluginId})`
        );
      }
      registry.providers.set(provider.id, provider);
    },

    registerCli(registrar: any) {
      registry.cliRegistrars.push(registrar);
    },

    registerService(service: any) {
      if (registry.services.has(service.id)) {
        console.warn(
          `[Registry] Service "${service.id}" already registered, overwriting (plugin: ${pluginId})`
        );
      }
      registry.services.set(service.id, service);
    },

    registerGatewayMethod(method: any) {
      registry.gatewayHandlers.set(method.name, { ...method, pluginId });
    },

    // ═══════════════════════════════════════════
    //  类型安全的生命周期钩子注册
    // ═══════════════════════════════════════════

    on<K extends PluginHookName>(
      hookName: K,
      handler: PluginHookHandlerMap[K],
      options?: { priority?: number }
    ): void {
      if (!registry.typedHooks.has(hookName)) {
        registry.typedHooks.set(hookName, []);
      }
      const list = registry.typedHooks.get(hookName)!;
      list.push({
        pluginId,
        hookName,
        handler,
        priority: options?.priority ?? 0,
      });
      // 按优先级降序排列（高优先级先执行）
      list.sort((a, b) => b.priority - a.priority);
    },

    resolvePath(input: string): string {
      return input;  // TODO: 实现相对路径解析
    },
  };
}

function createPluginLogger(pluginId: string) {
  return {
    info: (...args: any[]) => console.log(`[${pluginId}]`, ...args),
    warn: (...args: any[]) => console.warn(`[${pluginId}]`, ...args),
    error: (...args: any[]) => console.error(`[${pluginId}]`, ...args),
    debug: (...args: any[]) => console.debug(`[${pluginId}]`, ...args),
  };
}
```

---

### 3.4 Plugin Loader（插件加载器）

#### 职责

- 编排插件加载全流程
- 使用 Jiti 动态加载 TypeScript 模块
- 处理双导出模式（对象 vs 函数）
- 管理 memory 插件独占槽位

#### 目录结构

```
src/plugins/loader/
├── index.ts              # 主入口
├── loader.ts             # 加载逻辑
├── jiti.ts               # Jiti 配置
└── types.ts              # 类型定义
```

#### 核心代码

**`src/plugins/loader/jiti.ts`**

```typescript
import { createJiti } from "jiti";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

/**
 * 创建配置好的 Jiti 实例
 */
export function createConfiguredJiti() {
  const modulePath = fileURLToPath(import.meta.url);
  const baseDir = dirname(modulePath);

  return createJiti({
    importMetaURL: import.meta.url,
    interopDefault: true,  // ✅ 关键：正确处理 default export

    // SDK 别名映射
    alias: {
      "openclaw/plugin-sdk": join(baseDir, "../sdk-shim/index.ts"),
      "openclaw/plugin-sdk/core": join(baseDir, "../sdk-shim/core.ts"),
      "openclaw/plugin-sdk/telegram": join(baseDir, "../sdk-shim/telegram.ts"),
      "openclaw/plugin-sdk/feishu": join(baseDir, "../sdk-shim/feishu.ts"),
      "openclaw/plugin-sdk/discord": join(baseDir, "../sdk-shim/discord.ts"),
      "openclaw/plugin-sdk/slack": join(baseDir, "../sdk-shim/slack.ts"),
      // ... 其他 SDK 模块
    },
  });
}
```

**`src/plugins/loader/loader.ts`**

```typescript
import { join } from "path";
import { discoverPlugins } from "../discovery";
import { loadPluginManifest, validatePluginConfig } from "../manifest";
import { getOrCreatePluginRegistry } from "../registry";
import { createConfiguredJiti } from "./jiti";
import { createPluginRuntimeShim } from "../runtime-shim";
import type { PluginManifest } from "../manifest/types";

export interface LoadPluginsOptions {
  discovery?: {
    bundledDir?: string;
    globalDir?: string;
    workspaceDir?: string;
    configPaths?: string[];
  };
  runtimeOptions?: any;
  pluginConfigs?: Record<string, any>;
  disabledPlugins?: string[];
}

export interface LoadPluginsResult {
  registry: any;
  hookRunner: any;
  loaded: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * 加载所有插件（主入口）
 */
export async function loadPlugins(options: LoadPluginsOptions): Promise<LoadPluginsResult> {
  const { registry, createApi } = getOrCreatePluginRegistry();
  const jiti = createConfiguredJiti();
  const runtime = createPluginRuntimeShim(options.runtimeOptions || {});

  const loaded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  let memorySlotOccupied: string | null = null;

  // 1. ─── 发现插件 ───
  const candidates = discoverPlugins(options.discovery || {});
  console.log(`[Loader] Discovered ${candidates.length} plugins`);

  // 2. ─── 过滤禁用的插件 ───
  const filtered = candidates.filter(
    (c) => !options.disabledPlugins?.includes(c.id)
  );

  // 3. ─── 逐一加载 ───
  for (const candidate of filtered) {
    try {
      // 3a. 解析清单
      const manifestResult = loadPluginManifest(candidate.rootDir);
      if (!manifestResult.ok) {
        throw new Error(manifestResult.error);
      }
      const manifest = manifestResult.manifest;

      // 3b. 独占槽位检查（memory 类型）
      if (manifest.kind === "memory") {
        if (memorySlotOccupied) {
          console.warn(
            `[Loader] Skipping memory plugin "${manifest.id}" — ` +
              `slot occupied by "${memorySlotOccupied}"`
          );
          failed.push({
            id: manifest.id,
            error: `Memory slot occupied by "${memorySlotOccupied}"`,
          });
          continue;
        }
        memorySlotOccupied = manifest.id;
      }

      // 3c. 配置校验
      const pluginConfig = options.pluginConfigs?.[manifest.id] ?? {};
      const validation = validatePluginConfig(manifest, pluginConfig);
      if (!validation.valid) {
        throw new Error(`Config validation failed: ${validation.errors}`);
      }

      // 3d. 通过 Jiti 导入 TypeScript 模块
      const entryPath = join(candidate.rootDir, "src", "index.ts");
      const mod = (await jiti.import(entryPath)) as any;
      const pluginDef = mod.default ?? mod;

      // 3e. 创建 API 并注册
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

      // 3f. 激活（可选）
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

  // 4. ─── 创建 Hook Runner ───
  const { createHookRunner } = await import("../hook-runner");
  const hookRunner = createHookRunner(registry);

  console.log(`[Loader] Done. Loaded: ${loaded.length}, Failed: ${failed.length}`);

  return { registry, hookRunner, loaded, failed };
}
```

---

### 3.5 Hook Runner（钩子运行器）

#### 职责

- 实现三种钩子执行模式（Void/Parallel、Modifying/Sequential、同步）
- 支持钩子优先级
- 提供具名便捷方法

#### 目录结构

```
src/plugins/hook-runner/
├── index.ts              # 主入口
├── runner.ts             # 运行器实现
├── modes.ts              # 执行模式
└── types.ts              # 类型定义
```

#### 核心代码

**`src/plugins/hook-runner/runner.ts`**

```typescript
import type { PluginRegistry, PluginHookRegistration } from "../registry/types";
import type { PluginHookName, PluginHookHandlerMap } from "../types";

export interface HookRunnerOptions {
  timeout?: number;  // 钩子执行超时（毫秒），默认 30000
  onError?: (hookName: string, pluginId: string, error: unknown) => void;
}

export function createHookRunner(
  registry: PluginRegistry,
  options: HookRunnerOptions = {}
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
    event: Parameters<PluginHookHandlerMap[K]>[0]
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
                setTimeout(() => reject(new Error("Hook timeout")), timeout)
              ),
            ]);
          }
        } catch (err) {
          handleError(hookName, reg.pluginId, err);
        }
      })
    );
  }

  // ═══════════════════════════════════════════
  //  Modifying / Sequential 模式
  //  串行执行，前一个输出合并到后一个输入
  // ═══════════════════════════════════════════
  async function runModifyingHook<K extends PluginHookName>(
    hookName: K,
    event: Parameters<PluginHookHandlerMap[K]>[0]
  ): Promise<typeof event> {
    const registrations = registry.typedHooks.get(hookName) ?? [];
    if (registrations.length === 0) return event;

    let current = event;

    for (const reg of registrations) {
      try {
        const result = await (reg.handler as Function)(current);
        if (result != null) {
          current = { ...current, ...result };  // 默认浅合并
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
    event: Parameters<PluginHookHandlerMap[K]>[0]
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

    // 模型 / Prompt（Modifying）
    runBeforeModelResolve: (e: any) => runModifyingHook("before_model_resolve", e),
    runBeforePromptBuild: (e: any) => runModifyingHook("before_prompt_build", e),
    runLlmInput: (e: any) => runModifyingHook("llm_input", e),
    runLlmOutput: (e: any) => runModifyingHook("llm_output", e),

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
    runBeforeMessageWrite: (e: any) => runSyncHook("before_message_write", e),

    // Sub-Agent
    runSubagentSpawning: (e: any) => runModifyingHook("subagent_spawning", e),
    runSubagentDeliveryTarget: (e: any) => runModifyingHook("subagent_delivery_target", e),
    runSubagentSpawned: (e: any) => runVoidHook("subagent_spawned", e),
    runSubagentEnded: (e: any) => runVoidHook("subagent_ended", e),

    // 网关
    runGatewayStart: (e: any) => runVoidHook("gateway_start", e),
    runGatewayStop: (e: any) => runVoidHook("gateway_stop", e),
  };
}
```

---

### 3.6 Plugin Runtime Shim（运行时垫片）

#### 职责

- 提供兼容的 `PluginRuntime` 实现
- 使用 Proxy 延迟初始化
- 为未实现的功能提供友好警告

#### 目录结构

```
src/plugins/runtime-shim/
├── index.ts              # 主入口
├── core.ts               # Core Runtime
├── channel.ts            # Channel Runtime (Proxy Stubs)
└── types.ts              # 类型定义
```

#### 核心代码

**`src/plugins/runtime-shim/core.ts`**

```typescript
import { EventEmitter } from "events";

export interface RuntimeShimOptions {
  configLoader?: () => Record<string, any>;
  configWriter?: (patch: Record<string, any>) => void;
  logger?: {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
  };
  commandRunner?: (cmd: string, timeout: number) => Promise<string>;
  mediaLoader?: (url: string) => Promise<Buffer>;
}

/**
 * 创建 PluginRuntime Core
 */
export function createPluginRuntimeCore(options: RuntimeShimOptions = {}) {
  const events = new EventEmitter();
  const stateStore = new Map<string, any>();

  const logger = options.logger || {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  return {
    config: {
      loadConfig: options.configLoader || (() => ({})),
      writeConfigFile: options.configWriter || (() => {}),
    },

    system: {
      enqueueSystemEvent(event: any) {
        events.emit("system-event", event);
      },
      requestHeartbeatNow() {
        events.emit("heartbeat-request");
      },
      runCommandWithTimeout:
        options.commandRunner ??
        (async () => {
          throw new Error("[RuntimeShim] Command execution not supported");
        }),
    },

    media: {
      loadWebMedia:
        options.mediaLoader ??
        (async () => {
          throw new Error("[RuntimeShim] Media loading not supported");
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

    tts: createStubProxy("tts", logger),
    stt: createStubProxy("stt", logger),

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
    logging: logger,

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
}

/**
 * 为未实现的子模块创建 Proxy stub
 */
function createStubProxy(moduleName: string, logger: any): any {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return (...args: any[]) => {
          logger.warn(
            `[RuntimeShim] ${moduleName}.${String(prop)}() called but not implemented`
          );
          return undefined;
        };
      },
    }
  );
}
```

**`src/plugins/runtime-shim/channel.ts`**

```typescript
/**
 * Channel Runtime 全部使用 Proxy stub
 */
export function createChannelRuntimeStub(logger: any): any {
  const adapters = [
    "text", "reply", "routing", "pairing", "media",
    "activity", "session", "mentions", "reactions", "groups",
    "debounce", "commands", "discord", "slack", "telegram",
    "signal", "imessage", "whatsapp", "line",
  ];

  const stub: any = {};

  for (const adapter of adapters) {
    stub[adapter] = new Proxy(
      {},
      {
        get(_target, prop) {
          return (...args: any[]) => {
            logger.warn(
              `[RuntimeShim] channel.${adapter}.${String(prop)}() called but not implemented`
            );
            return undefined;
          };
        },
      }
    );
  }

  return stub;
}
```

**`src/plugins/runtime-shim/index.ts`**

```typescript
import { createPluginRuntimeCore } from "./core";
import { createChannelRuntimeStub } from "./channel";
import type { RuntimeShimOptions } from "./core";

/**
 * 创建完整的 Plugin Runtime Shim
 */
export function createPluginRuntimeShim(options: RuntimeShimOptions = {}) {
  const core = createPluginRuntimeCore(options);
  const channel = createChannelRuntimeStub(options.logger || console);

  return {
    ...core,
    channel,
  };
}
```

---

## 四、API 设计

### 4.1 OpenClawPluginApi 接口

```typescript
export interface OpenClawPluginApi {
  // ═══════════════════════════════════════════
  //  基础信息
  // ═══════════════════════════════════════════
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;

  // ═══════════════════════════════════════════
  //  10 种扩展注册方法
  // ═══════════════════════════════════════════
  registerTool(tool: ToolDefinition, opts?: ToolOptions): void;
  registerHook(hook: HookDefinition): void;
  registerChannel(channel: ChannelPlugin): void;
  registerCommand(command: CommandDefinition): void;
  registerHttpRoute(route: HttpRouteDefinition): void;
  registerProvider(provider: ProviderPlugin): void;
  registerCli(registrar: CliRegistrar): void;
  registerService(service: OpenClawPluginService): void;
  registerGatewayMethod(method: GatewayMethodDefinition): void;

  // ═══════════════════════════════════════════
  //  生命周期钩子注册
  // ═══════════════════════════════════════════
  on<K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    options?: { priority?: number }
  ): void;

  // ═══════════════════════════════════════════
  //  工具方法
  // ═══════════════════════════════════════════
  resolvePath(input: string): string;
}
```

### 4.2 使用示例

```typescript
// plugins/my-plugin/index.ts
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk";

export default {
  id: "my-plugin",
  name: "My Custom Plugin",
  version: "1.0.0",
  kind: "tool" as const,

  register(api: OpenClawPluginApi, runtime: PluginRuntime) {
    // 注册一个工具
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

---

## 五、数据流与生命周期

### 5.1 插件加载流程

```
┌─────────────────────────────────────────────────────────────┐
│  1. Discovery Engine                                        │
│  • 扫描 4 层目录                                             │
│  • 安全校验（路径/权限/所有权）                              │
│  • 去重和优先级处理                                          │
└────────────────────┬────────────────────────────────────────┘
                     │ DiscoveredPlugin[]
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Manifest Parser                                         │
│  • 读取 openclaw.plugin.json                                │
│  • JSON Schema 校验                                         │
│  • 配置校验（使用插件的 configSchema）                       │
└────────────────────┬────────────────────────────────────────┘
                     │ PluginManifest
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Plugin Loader                                           │
│  • Memory 插件独占槽位检查                                   │
│  • Jiti 动态加载 TypeScript 模块                            │
│  • 双导出模式识别（对象 vs 函数）                            │
└────────────────────┬────────────────────────────────────────┘
                     │ PluginDefinition
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Registration                                            │
│  • 创建 Plugin API 实例                                     │
│  • 创建 Plugin Runtime Shim                                 │
│  • 调用 plugin.register(api, runtime)                       │
│  • 将扩展注册到 Registry                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Activation                                              │
│  • 调用 plugin.activate()（可选）                           │
│  • 插件进入运行态                                            │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 钩子执行流程

#### Void/Parallel 模式

```
┌──────────────┐
│ Trigger Hook │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│ Promise.allSettled([                 │
│   handler1(event),  // 并发          │
│   handler2(event),  // 并发          │
│   handler3(event),  // 并发          │
│ ])                                   │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│  Complete    │
└──────────────┘
```

#### Modifying/Sequential 模式

```
┌──────────────┐
│ Initial Event│
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│ handler1(event)      │
│ → result1            │
└──────┬───────────────┘
       │ merge(result1)
       ▼
┌──────────────────────┐
│ handler2(event')     │
│ → result2            │
└──────┬───────────────┘
       │ merge(result2)
       ▼
┌──────────────────────┐
│ handler3(event'')    │
│ → result3            │
└──────┬───────────────┘
       │
       ▼
┌──────────────┐
│ Final Event  │
└──────────────┘
```

---

## 六、实施计划

### 6.1 阶段划分

#### Phase 1: 核心基础设施（P0，5-9 天）

| 模块 | 工作内容 | 预估时间 |
|------|---------|---------|
| Manifest Parser | 清单解析 + JSON Schema 校验 | 1 天 |
| Discovery Engine | 4 层目录扫描 + 安全校验 | 1-2 天 |
| Plugin Registry | Registry + API Factory | 1-2 天 |
| Plugin Loader | Jiti 加载 + 双导出模式 | 1-2 天 |
| Hook Runner | Void/Parallel + Modifying/Sequential + 同步 | 1-2 天 |

**里程碑**：能够加载并注册一个简单的 OpenClaw 插件

#### Phase 2: Runtime 集成（P1，4-6 天）

| 模块 | 工作内容 | 预估时间 |
|------|---------|---------|
| Runtime Shim (Core) | config/system/media/logging/state | 2-3 天 |
| Tool Executor | 工具注册和执行集成 | 1-2 天 |
| Plugin SDK | 类型重导出 + Alias 映射 | 1 天 |

**里程碑**：能够执行插件注册的工具

#### Phase 3: 测试和验证（3-5 天）

| 任务 | 工作内容 | 预估时间 |
|------|---------|---------|
| 单元测试 | 核心模块测试 | 2 天 |
| 集成测试 | 加载真实 OpenClaw 插件 | 1-2 天 |
| 端到端测试 | 完整流程测试 | 1 天 |

**里程碑**：通过所有测试，插件加载成功率 ≥ 95%

### 6.2 甘特图

```
Week 1:
├─ Day 1-2: Manifest Parser + Discovery Engine
├─ Day 3-4: Plugin Registry + Plugin Loader
└─ Day 5-7: Hook Runner + 基础测试

Week 2:
├─ Day 1-3: Runtime Shim (Core)
├─ Day 4-5: Tool Executor
├─ Day 6-7: Plugin SDK + 集成测试

Week 3:
├─ Day 1-2: 端到端测试
├─ Day 3-4: 性能优化
└─ Day 5: 文档和发布
```

---

## 七、测试策略

### 7.1 单元测试

#### 测试覆盖率目标

- **核心模块**：≥ 80%
- **工具函数**：≥ 90%
- **关键路径**：100%

#### 测试用例

**Manifest Parser**

```typescript
describe("ManifestParser", () => {
  it("should parse valid manifest", () => {
    const result = loadPluginManifest("./test/fixtures/valid-plugin");
    expect(result.ok).toBe(true);
    expect(result.manifest.id).toBe("test-plugin");
  });

  it("should reject invalid manifest schema", () => {
    const result = loadPluginManifest("./test/fixtures/invalid-manifest");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid manifest schema");
  });

  it("should validate plugin config", () => {
    const manifest = { id: "test", configSchema: { type: "object" } };
    const result = validatePluginConfig(manifest, { foo: "bar" });
    expect(result.valid).toBe(true);
  });
});
```

**Discovery Engine**

```typescript
describe("DiscoveryEngine", () => {
  it("should discover plugins from all layers", () => {
    const plugins = discoverPlugins({
      bundledDir: "./test/fixtures/bundled",
      workspaceDir: "./test/fixtures/workspace",
    });
    expect(plugins.length).toBeGreaterThan(0);
  });

  it("should prioritize workspace over bundled", () => {
    const plugins = discoverPlugins({
      bundledDir: "./test/fixtures/bundled",
      workspaceDir: "./test/fixtures/workspace",
    });
    const plugin = plugins.find(p => p.id === "test-plugin");
    expect(plugin?.origin).toBe("workspace");
  });

  it("should reject world-writable directories", () => {
    const result = validatePluginSecurity("./test/fixtures/world-writable");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("World-writable");
  });
});
```

**Hook Runner**

```typescript
describe("HookRunner", () => {
  it("should run void hooks in parallel", async () => {
    const registry = createTestRegistry();
    const runner = createHookRunner(registry);

    const order: number[] = [];
    registry.typedHooks.set("message_received", [
      { pluginId: "p1", handler: async () => { order.push(1); }, priority: 0 },
      { pluginId: "p2", handler: async () => { order.push(2); }, priority: 0 },
    ]);

    await runner.runVoidHook("message_received", {});
    // 并发执行，顺序不确定
    expect(order.length).toBe(2);
  });

  it("should run modifying hooks sequentially", async () => {
    const registry = createTestRegistry();
    const runner = createHookRunner(registry);

    registry.typedHooks.set("llm_input", [
      { pluginId: "p1", handler: async (e: any) => ({ value: e.value + 1 }), priority: 0 },
      { pluginId: "p2", handler: async (e: any) => ({ value: e.value + 10 }), priority: 0 },
    ]);

    const result = await runner.runModifyingHook("llm_input", { value: 0 });
    expect(result.value).toBe(11);
  });
});
```

### 7.2 集成测试

#### 测试场景

1. **加载真实 OpenClaw 插件**
   - `diffs` 插件（Tool Plugin）
   - `telegram` 插件（Channel Plugin）
   - `memory-core` 插件（Memory Plugin）

2. **工具执行**
   - 注册工具 → AI 调用 → 执行 → 返回结果

3. **钩子触发**
   - 触发钩子 → 多个插件响应 → 验证执行顺序

### 7.3 端到端测试

#### 测试流程

```
1. 启动 Beeclaw
2. 加载 OpenClaw 插件
3. 发送消息
4. 验证插件响应
5. 检查日志和诊断信息
```

---

## 八、部署与运维

### 8.1 部署方式

#### 独立部署

```bash
# 安装依赖
bun install

# 运行 Beeclaw
bun run cli

# 或 Bot 模式
bun run bot
```

#### Docker 部署

```dockerfile
FROM oven/bun:1

WORKDIR /app
COPY . .

RUN bun install

CMD ["bun", "run", "bot"]
```

### 8.2 配置管理

#### beeclaw.json

```json
{
  "plugins": {
    "enabled": true,
    "discovery": {
      "bundledDir": "./plugins/bundled",
      "globalDir": "~/.beeclaw/plugins",
      "workspaceDir": ".beeclaw/plugins",
      "configPaths": []
    },
    "disabledPlugins": ["deprecated-plugin"],
    "pluginConfigs": {
      "smart-summary": {
        "maxTokens": 4096,
        "language": "zh"
      }
    }
  }
}
```

### 8.3 监控和日志

#### 日志级别

```typescript
// INFO: 插件加载成功
console.log(`[Loader] ✅ Loaded: ${pluginId}`);

// WARN: 插件加载失败（非致命）
console.warn(`[Loader] ⚠️  Skipping: ${pluginId}`);

// ERROR: 插件加载失败（致命）
console.error(`[Loader] ❌ Failed: ${pluginId}`);
```

#### 诊断信息

```typescript
// 获取插件诊断
const registry = getPluginRegistry();
console.log("Diagnostics:", registry.diagnostics);

// 输出
[
  {
    pluginId: "test-plugin",
    level: "error",
    message: "Config validation failed"
  }
]
```

---

## 九、风险管理

### 9.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| **API 不兼容** | 高 | 中 | 逐个实现 API，优先支持常用功能 |
| **性能影响** | 中 | 低 | 使用 Proxy 延迟初始化，缓存编译结果 |
| **类型系统不匹配** | 中 | 中 | 创建类型声明文件，使用 `any` 后备 |
| **依赖冲突** | 高 | 低 | 使用 pnpm workspaces |

### 9.2 维护风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| **OpenClaw API 变化** | 高 | 中 | 定期同步 OpenClaw 更新，版本锁定 |
| **测试覆盖不足** | 中 | 中 | 使用真实插件进行集成测试 |
| **文档过时** | 低 | 高 | 文档与代码同步更新 |

### 9.3 应急预案

#### 回滚策略

1. **Feature Flag**：通过配置开关插件兼容层
2. **版本锁定**：锁定 OpenClaw 插件版本
3. **降级方案**：禁用不兼容的插件

---

## 十、附录

### 10.1 文件清单

```
src/plugins/
├── discovery/
│   ├── index.ts
│   ├── scanner.ts
│   ├── security.ts
│   ├── priority.ts
│   └── types.ts
├── manifest/
│   ├── index.ts
│   ├── parser.ts
│   ├── validator.ts
│   └── types.ts
├── registry/
│   ├── index.ts
│   ├── registry.ts
│   ├── api-factory.ts
│   └── types.ts
├── loader/
│   ├── index.ts
│   ├── loader.ts
│   ├── jiti.ts
│   └── types.ts
├── hook-runner/
│   ├── index.ts
│   ├── runner.ts
│   ├── modes.ts
│   └── types.ts
├── runtime-shim/
│   ├── index.ts
│   ├── core.ts
│   ├── channel.ts
│   └── types.ts
├── sdk-shim/
│   ├── index.ts
│   ├── core.ts
│   ├── telegram.ts
│   ├── feishu.ts
│   └── ...
└── types.ts
```

### 10.2 依赖清单

```json
{
  "dependencies": {
    "jiti": "^2.0.0",
    "ajv": "^8.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

### 10.3 参考资料

- [OpenClaw 官方仓库](https://github.com/openclaw/openclaw)
- [OpenClaw 插件开发文档](https://docs.openclaw.ai/plugins)
- [Jiti 文档](https://github.com/unjs/jiti)
- [AJV 文档](https://ajv.js.org/)

---

**文档版本**：v1.0
**最后更新**：2026-03-05
**维护者**：Beeclaw Team
