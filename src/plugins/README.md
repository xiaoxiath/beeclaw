# Beeclaw Plugin System

OpenClaw 插件兼容层，让 Beeclaw 能够加载和运行 OpenClaw 生态的 40+ 插件。

## 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 创建插件

在 `plugins/` 目录下创建新插件：

```bash
mkdir -p plugins/my-plugin/src
```

创建清单文件 `plugins/my-plugin/openclaw.plugin.json`：

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "A custom plugin",
  "version": "1.0.0",
  "kind": "tool",
  "configSchema": {
    "type": "object",
    "properties": {}
  }
}
```

创建入口文件 `plugins/my-plugin/src/index.ts`：

```typescript
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk";

export default {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  kind: "tool" as const,

  register(api: OpenClawPluginApi, runtime: PluginRuntime) {
    // 注册工具
    api.registerTool({
      name: "my_tool",
      description: "My custom tool",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string" }
        },
        required: ["input"]
      },
      execute: async (params: any) => {
        runtime.logging.info("Tool called:", params);
        return { result: "success" };
      }
    });

    // 注册钩子
    api.on("message_received", async (event) => {
      runtime.logging.info("Message:", event);
    });
  },

  activate() {
    console.log("Plugin activated!");
  }
};
```

### 3. 加载插件

```typescript
import { loadPlugins } from "./plugins";

async function main() {
  const result = await loadPlugins({
    discovery: {
      bundledDir: "./plugins",
    },
  });

  console.log(`Loaded: ${result.loaded.join(", ")}`);
  console.log(`Failed: ${result.failed.map(f => f.id).join(", ")}`);
}
```

## 插件类型

### Tool Plugin（工具插件）

提供可被 AI 调用的工具：

```typescript
api.registerTool({
  name: "tool_name",
  description: "Tool description",
  parameters: {
    type: "object",
    properties: {
      param1: { type: "string" }
    }
  },
  execute: async (params) => ({ result: "ok" })
});
```

### Channel Plugin（渠道插件）

提供通讯渠道集成（Discord、Slack、Telegram 等）：

```typescript
api.registerChannel({
  id: "my_channel",
  meta: { label: "My Channel" },
  // ... 渠道实现
});
```

### Memory Plugin（内存插件）

提供内存存储后端（独占槽位）：

```typescript
export default {
  id: "my_memory",
  kind: "memory" as const,
  register(api, runtime) {
    // 实现内存存储接口
  }
};
```

## 生命周期钩子

### 25 个钩子

```typescript
// 模型相关
"before_model_resolve"  // 模型解析前
"before_prompt_build"   // 提示构建前
"llm_input"            // LLM 输入
"llm_output"           // LLM 输出

// Agent 生命周期
"before_agent_start"   // Agent 启动前
"agent_end"            // Agent 结束

// 消息处理
"message_received"     // 消息接收
"message_sending"      // 消息发送
"message_sent"         // 消息发送后

// 工具调用
"before_tool_call"     // 工具调用前
"after_tool_call"      // 工具调用后
"tool_result_persist"  // 工具结果持久化（同步）

// 会话管理
"session_start"        // 会话开始
"session_end"          // 会话结束

// 上下文压缩
"before_compaction"    // 压缩前
"after_compaction"     // 压缩后
"before_reset"         // 重置前

// 消息持久化
"before_message_write" // 消息写入前（同步）

// Sub-Agent
"subagent_spawning"    // 子 Agent 生成
"subagent_delivery_target" // 子 Agent 投递目标
"subagent_spawned"     // 子 Agent 已生成
"subagent_ended"       // 子 Agent 结束

// 网关
"gateway_start"        // Gateway 启动
"gateway_stop"         // Gateway 停止
```

### 注册钩子

```typescript
api.on("message_received", async (event) => {
  console.log("Message:", event.from, event.content);
});

// 带优先级
api.on("llm_input", handler, { priority: 10 });  // 高优先级先执行
```

### 钩子执行模式

1. **Void/Parallel**：并发执行，互不干扰
   - `message_received`, `message_sent`, `session_start` 等

2. **Modifying/Sequential**：串行执行，前一个输出传递给后一个
   - `before_model_resolve`, `before_tool_call` 等

3. **同步钩子**：不能是 async
   - `tool_result_persist`, `before_message_write`

## 插件发现

### 4 层来源（按优先级）

1. **Bundled**（最低）：内置插件目录
2. **Global**：`~/.config/openclaw/extensions/`
3. **Workspace**：`.openclaw/extensions/`
4. **Config**（最高）：配置文件指定路径

同名插件会被高优先级来源覆盖。

## Plugin Runtime

### Core Runtime

```typescript
runtime.config.loadConfig();           // 加载配置
runtime.config.writeConfigFile(patch); // 写入配置

runtime.system.enqueueSystemEvent(event); // 入队系统事件
runtime.system.requestHeartbeatNow();     // 请求心跳

runtime.media.loadWebMedia(url);      // 加载网络媒体
runtime.media.detectMime(buffer);     // 检测 MIME 类型

runtime.logging.info("message");      // 日志
runtime.logging.warn("warning");
runtime.logging.error("error");

runtime.state.get("key");             // 状态存储
runtime.state.set("key", value);
```

### Channel Runtime

```typescript
runtime.channel.text.*;        // 文本适配器
runtime.channel.reply.*;       // 回复适配器
runtime.channel.routing.*;     // 路由适配器
runtime.channel.discord.*;     // Discord 适配器
runtime.channel.telegram.*;    // Telegram 适配器
// ... 等 25 个适配器
```

## 配置

在 `beeclaw.json` 中配置：

```json
{
  "plugins": {
    "enabled": true,
    "discovery": {
      "bundledDir": "./plugins",
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

## 测试

```bash
# 运行所有测试
bun test src/plugins/

# 运行核心测试
bun test src/plugins/__tests__/core.test.ts

# 运行特定测试
bun test -t "should load test plugin"
```

## 开发工具

### 查看 Registry 状态

```typescript
import { getPluginRegistry } from "./plugins";

const registry = getPluginRegistry();
console.log("Tools:", Array.from(registry.tools.keys()));
console.log("Hooks:", Array.from(registry.typedHooks.keys()));
console.log("Diagnostics:", registry.diagnostics);
```

### 重置 Registry（测试用）

```typescript
import { resetPluginRegistry } from "./plugins";

resetPluginRegistry();  // 清空所有状态
```

## 示例插件

查看 `plugins/test-plugin/` 获取完整示例。

## 架构

```
┌─────────────────────────────────────────────┐
│          OpenClaw Plugin Ecosystem          │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│       Plugin Compatibility Layer            │
│  ┌────────────────────────────────────────┐ │
│  │  Discovery Engine                      │ │
│  │  Manifest Parser                       │ │
│  │  Plugin Registry                       │ │
│  │  Plugin Loader (Jiti)                  │ │
│  │  Hook Runner                           │ │
│  │  Runtime Shim                          │ │
│  │  SDK Shim                              │ │
│  └────────────────────────────────────────┘ │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│           Beeclaw Core Systems              │
│  Agent System | Tool System | Channel Mgr  │
└─────────────────────────────────────────────┘
```

## 文档

- [Phase 1 实现完成](../../docs/phase1-implementation-complete.md)
- [技术方案设计](../../docs/openclaw-plugin-integration-design.md)
- [插件生态分析](../../docs/openclaw-extends.md)
- [兼容性分析](../../docs/openclaw-plugin-compatibility-analysis.md)

## 状态

- ✅ Phase 1: 核心基础设施（已完成）
- 🚧 Phase 2: Runtime 集成（进行中）
- 📅 Phase 3: 高级功能（计划中）

## 许可证

MIT
