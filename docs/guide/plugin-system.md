# 插件系统

Beeclaw 的插件系统基于 OpenClaw 兼容层构建，支持加载和运行 OpenClaw 生态的 40+ 插件，同时提供完整的 Hook 机制用于扩展 Agent 行为。

---

## 概述

### 插件能力

| 类型 | 说明 | 示例 |
|------|------|------|
| **Tool 插件** | 注册新的工具供 Agent 调用 | 数据库查询、API 集成 |
| **Hook 插件** | 在 Agent 生命周期中注入自定义逻辑 | 审计日志、内容过滤 |
| **混合插件** | 同时提供工具和 Hook | 完整的业务集成方案 |

### 架构

```
┌─────────────────────────────────────────┐
│              Agent Core                  │
│  ┌──────────────────────────────────┐   │
│  │        Plugin Registry            │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐     │   │
│  │  │Tool A│ │Tool B│ │Tool C│     │   │
│  │  └──────┘ └──────┘ └──────┘     │   │
│  │  ┌──────────────────────────┐    │   │
│  │  │      Hook Runner         │    │   │
│  │  │  before_tool_call        │    │   │
│  │  │  after_tool_call         │    │   │
│  │  │  before_prompt_build     │    │   │
│  │  │  message_sending         │    │   │
│  │  │  ...22 hooks total       │    │   │
│  │  └──────────────────────────┘    │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## 快速开始

### 1. 创建插件目录

```bash
mkdir -p plugins/my-plugin/src
```

### 2. 创建清单文件

`plugins/my-plugin/openclaw.plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "A custom plugin",
  "version": "1.0.0",
  "kind": "tool",
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": { "type": "string" }
    }
  }
}
```

### 3. 实现插件

`plugins/my-plugin/src/index.ts`:

```typescript
import type { PluginContext, ToolDefinition } from '@beeclaw/plugin-api';

export function activate(context: PluginContext): ToolDefinition[] {
  return [{
    name: 'my_tool',
    description: 'My custom tool',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Input query' }
      },
      required: ['query']
    },
    execute: async (params) => {
      return { success: true, data: `Result for: ${params.query}` };
    }
  }];
}
```

### 4. 在配置中启用

```json
{
  "plugins": {
    "my-plugin": {
      "enabled": true,
      "config": {
        "apiKey": "${MY_PLUGIN_API_KEY}"
      }
    }
  }
}
```

---

## Hook 系统

### 可用 Hook 列表

| Hook | 类型 | 触发时机 |
|------|------|----------|
| `before_model_resolve` | Modifying | Agent 构造时，选择模型之前 |
| `before_agent_start` | Notify | Agent 启动时 |
| `before_prompt_build` | Modifying | 构建系统提示词之前 |
| `before_tool_call` | Notify | 工具调用之前 |
| `after_tool_call` | Notify | 工具调用之后 |
| `tool_result_persist` | Modifying | 工具结果保存到消息历史之前 |
| `llm_input` | Notify | 发送请求到 LLM 之前 |
| `llm_output` | Notify | 收到 LLM 响应之后 |
| `message_received` | Notify | 收到用户消息时 |
| `message_sending` | Modifying | 发送回复给用户之前 |
| `message_sent` | Notify | 回复发送完成后 |
| `before_compaction` | Notify | 上下文压缩之前 |
| `after_compaction` | Notify | 上下文压缩之后 |
| `before_reset` | Notify | 会话重置之前 |
| `agent_end` | Notify | Agent 对话结束时 |

### Hook 类型说明

- **Notify**: 只读通知，不影响执行流程
- **Modifying**: 可修改参数，返回值将替换原始数据
- **Sync**: 同步执行的 Hook

### Hook 合并策略

Hook Runner 支持两种合并策略：

```typescript
const runner = createHookRunner(registry, {
  mergeStrategy: 'deep'  // 'shallow' | 'deep'
});
```

- `shallow`（默认）：浅拷贝合并返回值
- `deep`：递归深度合并，适合复杂对象修改

---

## 插件注册表

### Typed Global Singleton

插件注册表使用类型安全的全局单例模式：

```typescript
// 获取注册表
const registry = getPluginRegistry();

// 检查工具
registry.tools.has('my_tool');

// 测试隔离
const isolated = createIsolatedPluginRegistry();
```

### 注册表生命周期

1. **初始化**：应用启动时扫描 `plugins/` 目录
2. **加载**：按依赖关系加载插件，执行 `activate()`
3. **注册**：工具和 Hook 注册到全局 Registry
4. **运行**：Agent 通过 Registry 调用工具和 Hook
5. **卸载**：应用关闭时执行 `deactivate()`

---

## 相关文档

- [工具参考](../tools-reference.md) — 内置工具列表
- [系统架构](../architecture.md) — 整体架构设计
- [错误处理](./error-handling.md) — 插件错误处理
