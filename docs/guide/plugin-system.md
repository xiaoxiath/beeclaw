# 插件系统

> OpenClaw 兼容的插件架构

## 概述

Beeclaw 支持 OpenClaw 兼容的插件系统，允许通过 Hook 机制扩展和定制行为。

## 插件结构

```
plugins/
├── my-plugin/
│   ├── openclaw.plugin.json  # 插件清单（OpenClaw 兼容文件名）
│   ├── src/index.ts          # 插件实现（导出 register() 或函数）
│   └── README.md             # 插件文档
```

## openclaw.plugin.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "My custom plugin",
  "kind": "tool",
  "capabilities": [
    "tool.register",
    "hook.register"
  ]
}
```

字段含义：
- `id` — 全局唯一标识，必填
- `kind` — `tool` / `channel` / `memory` / `provider` / `general`
- `capabilities` — 声明所需能力（见下文）

## 能力模型（Capability Model）

插件加载在主进程，不是 VM/Worker 沙箱（隔离是后续工作）。**Capability 是当前的边界**：插件必须在 manifest 里声明它要用的能力，没声明的调用会抛错。

**已知能力**（源头：`src/adapter/plugins/capabilities/index.ts`）：

| 能力 | 解锁的 API |
|---|---|
| `tool.register` | `registerTool` / `registerCommand` / `registerService` / `registerGatewayMethod` |
| `hook.register` | `registerHook` / `on()` |
| `channel.register` | `registerChannel` |
| `provider.register` | `registerProvider` |
| `http.serve` | `registerHttpRoute` |
| `cli.register` | `registerCli` |
| `state.access` | `runtime.state.*` |
| `runtime.command` | `runtime.system.runCommandWithTimeout` |
| `runtime.media` | `runtime.media.loadWebMedia` |
| `runtime.config.read` | `runtime.config.loadConfig` |
| `runtime.config.write` | `runtime.config.writeConfigFile` |

**永远免费**（无需声明）：`runtime.logging`、`runtime.events`、`runtime.media.detectMime`、`runtime.system.enqueueSystemEvent`、`runtime.system.requestHeartbeatNow`。

**兼容模式**：manifest 里没有 `capabilities` 字段 → "legacy mode"，按需调用全部放行但每对 plugin/cap 第一次会 warn 一次（迁移期）。声明 `capabilities: []` → 严格模式只能用免费 API。

## Hook 系统

通过 `api.on(hookName, handler)` 注册类型安全的钩子。Hook 名称见 `src/adapter/plugins/types.ts` 的 `PluginHookName` 联合类型（覆盖 `before_model_resolve` / `llm_input` / `llm_output` / `message_*` / `tool_*` / `session_*` / `compaction` / `subagent_*` 等 25 个事件）。注册需要 `hook.register` 能力。

### Hook 示例

```typescript
import type { OpenClawPluginApi, PluginRuntime } from 'openclaw/plugin-sdk';

export default {
  async register(api: OpenClawPluginApi, _runtime: PluginRuntime) {
    api.on('llm_input', async (ctx) => {
      api.logger.info(`prompt size: ${ctx.messages.length}`);
    });

    api.registerTool({
      name: 'custom_tool',
      description: 'My tool',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'ok',
    });
  },
};
```

## 配置

在 `beeclaw.json` 中配置：

```json
{
  "plugins": {
    "enabled": true,
    "discoveryPaths": [
      "./plugins",
      "~/.beeclaw/plugins"
    ]
  }
}
```

## 最佳实践

1. **命名规范**: 使用小写 + 连字符
2. **版本管理**: 遵循语义化版本
3. **错误处理**: 优雅处理 Hook 错误
4. **文档完善**: 提供清晰的 README

## 相关文档

- [技能系统](./skill-system.md)
- [子代理系统](./subagent-system.md)
