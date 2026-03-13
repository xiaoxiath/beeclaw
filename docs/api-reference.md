# Beeclaw API 参考文档

**版本**: 1.0.0
**更新日期**: 2026-03-13

---

## 📚 目录

1. [Card V2 API](#card-v2-api)
2. [Streaming API](#streaming-api)
3. [Evolution API](#evolution-api)
4. [Plugin API](#plugin-api)
5. [Tool API](#tool-api)

---

## Card V2 API

### 概述

Card V2 是飞书卡片消息的新版本，支持流式更新和更好的用户体验。

### 类型定义

#### Card

```typescript
interface Card {
  schema: '2.0';
  config?: CardConfig;
  header?: CardHeader;
  body: CardBody;
}
```

#### CardConfig

```typescript
interface CardConfig {
  streaming_mode?: boolean;  // 启用流式更新
  width_mode?: 'fit' | 'fill';  // 卡片宽度模式
}
```

#### CardBody

```typescript
interface CardBody {
  elements: CardElement[];
}
```

### 使用示例

#### 创建简单卡片

```typescript
import { createCard, createCardBody, createMarkdownElement } from '@/adapter/feishu/card-v2';

const card = createCard(
  createCardBody([
    createMarkdownElement('# 标题\n\n这是内容')
  ]),
  {
    config: { streaming_mode: false }
  }
);
```

#### 创建流式卡片

```typescript
import { createCard, createStreamingConfig } from '@/adapter/feishu/card-v2';

const card = createCard(
  createCardBody([
    createCollapsiblePanel({
      title: 'Agent 推理过程',
      elements: [
        createDivElement({
          text: '正在执行工具...',
          icon: { token: 'loading', color: 'blue' }
        })
      ],
      expanded: true
    })
  ]),
  { config: createStreamingConfig() }
);
```

### Card Elements

#### Markdown Element

```typescript
interface MarkdownElement {
  tag: 'markdown';
  content: string;
}
```

#### Collapsible Panel

```typescript
interface CollapsiblePanel {
  tag: 'collapsible_panel';
  header: {
    title: { tag: 'plain_text'; content: string };
    icon?: StandardIconElement;
    icon_position?: 'left' | 'right';
    icon_expanded_angle?: number;
  };
  elements: CardElement[];
  expanded?: boolean;
  vertical_spacing?: string;
  border?: {
    color?: string;
    corner_radius?: string;
  };
}
```

### API 方法

#### renderMessageCard

渲染内容块为卡片 JSON

```typescript
function renderMessageCard(
  blocks: ContentBlock[],
  options?: RenderOptions
): Card;
```

**参数**:
- `blocks`: 内容块数组
- `options.rendering`: 是否启用流式模式
- `options.summary`: 卡片摘要

**返回**: Card 对象

#### StreamingMessageController

管理流式消息更新

```typescript
class StreamingMessageController {
  constructor(options: StreamingControllerOptions);

  async pushContent(block: ContentBlock): Promise<void>;
  async finish(): Promise<void>;
  getBlocks(): ContentBlock[];
  isFinished(): boolean;
  getMessageId(): string | undefined;
}
```

**使用示例**:

```typescript
const controller = new StreamingMessageController({
  client: feishuClient,
  parentMessageId: 'msg_xxxxxx',
  chatId: 'chat_xxxxxx',
  debounceMs: 500
});

// 推送内容块
await controller.pushContent({
  type: 'text',
  content: '处理中...'
});

await controller.pushContent({
  type: 'tool_use',
  name: 'feishu_drive_list',
  input: { folderToken: 'root' }
});

// 完成流式更新
await controller.finish();
```

---

## Streaming API

### 概述

流式 API 支持实时更新消息内容，提供更好的用户体验。

### ContentBlock 类型

#### Text Block

```typescript
interface TextBlock {
  type: 'text';
  content: string;
}
```

#### Tool Use Block

```typescript
interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
```

#### Image Block

```typescript
interface ImageBlock {
  type: 'image';
  url: string;
  alt?: string;
}
```

### Agent Integration

Agent 支持流式输通过 `onContentBlock` 回调：

```typescript
const response = await agent.chat(message, {
  onContentBlock: (block) => {
    console.log('Content block:', block);
    // 实时推送到流式控制器
    streamingController.pushContent(block);
  }
});
```

---

## Evolution API

### 概述

Evolution 系统使用 LLM + 数据驱动的方式进行自我进化。

### Query Tracking API

#### recordQuery

记录用户查询

```typescript
function recordQuery(
  query: string,
  context?: {
    userId?: string;
    chatId?: string;
    timestamp?: number;
  }
): void;
```

**示例**:

```typescript
import { recordQuery } from '@/domain/agent/evolution';

recordQuery('帮我分析这个季度的销售数据', {
  userId: 'ou_xxxxxx',
  chatId: 'chat_xxxxxx'
});
```

#### detectPatterns

检测查询模式

```typescript
function detectPatterns(): QueryPattern[];
```

**返回**:

```typescript
interface QueryPattern {
  pattern: string;
  frequency: number;
  firstSeen: number;
  lastSeen: number;
  examples: string[];
}
```

**示例**:

```typescript
import { detectPatterns } from '@/domain/agent/evolution';

const patterns = detectPatterns();
// [
//   {
//     pattern: '销售数据分析',
//     frequency: 5,
//     firstSeen: 1705660800000,
//     lastSeen: 1705747200000,
//     examples: ['帮我分析这个季度的销售数据', ...]
//   }
// ]
```

### Reflection Statistics API

#### recordSkillFailure

记录技能失败

```typescript
function recordSkillFailure(
  skillName: string,
  context: string
): void;
```

**示例**:

```typescript
import { recordSkillFailure } from '@/domain/agent/evolution';

try {
  await executeSkill('data-analysis', params);
} catch (error) {
  recordSkillFailure('data-analysis', error.message);
}
```

#### checkConsecutiveFailures

检查连续失败次数

```typescript
function checkConsecutiveFailures(skillName: string): number;
```

**示例**:

```typescript
import { checkConsecutiveFailures } from '@/domain/agent/evolution';

const failures = checkConsecutiveFailures('data-analysis');
if (failures >= 3) {
  console.warn('技能连续失败 3 次，可能需要优化');
}
```

#### getReflectionStats

获取反思统计

```typescript
function getReflectionStats(): {
  recentFailures: number;
  failureDetails: Array<{
    skillName: string;
    count: number;
  }>;
};
```

**示例**:

```typescript
import { getReflectionStats } from '@/domain/agent/evolution';

const stats = getReflectionStats();
console.log(`最近失败: ${stats.recentFailures} 次`);
console.log('失败详情:', stats.failureDetails);
```

### LLM 集成

Evolution 系统现在由 LLM 通过 System Prompt 驱动：

```
你可以通过以下工具进行自我反思和进化：

1. skill_maturity - 查看技能成熟度统计数据
2. skill_ensure - 创建或更新技能
3. memory_write - 记录学习到的知识

当检测到以下情况时，主动进行反思：
- 技能连续失败 3 次以上
- 用户重复提出相同需求
- 用户表达不满意（如"不对"、"不是这样"）
```

---

## Plugin API

### 概述

Plugin API 提供了插件开发和集成的完整接口。

### Plugin Manifest

```typescript
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  kind?: 'memory' | 'general';
  main: string;
  icon?: string;
  author?: string;
  license?: string;
  repository?: string;
  keywords?: string[];
  compatibility?: {
    beeclaw: string;
    node?: string;
  };
  configSchema?: any;
  defaultConfig?: Record<string, unknown>;
}
```

### OpenClawPluginApi

```typescript
interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  source: string;
  config: any;
  pluginConfig?: Record<string, unknown>;
  runtime: any;
  logger: PluginLogger;

  // 注册方法
  registerTool(tool: ToolDefinition): void;
  registerHook(hook: HookDefinition): void;
  registerChannel(channel: ChannelDefinition): void;
  registerCommand(command: CommandDefinition): void;
  registerHttpRoute(route: HttpRouteDefinition): void;
  registerProvider(provider: ProviderDefinition): void;
  registerCli(registrar: CliRegistrar): void;
  registerService(service: ServiceDefinition): void;
  registerGatewayMethod(method: GatewayMethodDefinition): void;

  // 钩子注册
  on<K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    options?: { priority?: number }
  ): void;

  // 路径解析
  resolvePath(input: string): string;
}
```

### Plugin Development

#### 创建插件

**1. 创建 manifest.json**

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A sample plugin",
  "main": "src/index.ts",
  "kind": "general"
}
```

**2. 实现插件逻辑**

```typescript
// src/index.ts
import type { OpenClawPluginApi, PluginRuntime } from 'openclaw/plugin-sdk';

export default async function(api: OpenClawPluginApi, runtime: PluginRuntime) {
  // 注册工具
  api.registerTool({
    name: 'my_tool',
    description: 'My custom tool',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string' }
      }
    },
    async execute(params: any) {
      return { result: 'success' };
    }
  });

  // 注册钩子
  api.on('message_received', async (event) => {
    console.log('Message received:', event);
  });
}
```

### Plugin Hooks

#### 可用钩子列表

| 钩子名称 | 描述 | 参数 |
|---------|------|------|
| `before_model_resolve` | 模型解析前 | `{ prompt: string }` |
| `before_prompt_build` | Prompt 构建前 | `{ prompt: string; messages: unknown[] }` |
| `llm_input` | LLM 输入时 | `{ runId: string; provider: string; model: string; prompt: string }` |
| `llm_output` | LLM 输出时 | `{ response: any }` |
| `before_agent_start` | Agent 启动前 | `{ config: any }` |
| `agent_end` | Agent 结束后 | `{ result: any }` |
| `message_received` | 收到消息 | `{ from: string; content: string; timestamp?: number }` |
| `message_sending` | 发送消息前 | `{ to: string; content: string }` |
| `message_sent` | 消息发送后 | `{ to: string; content: string }` |
| `before_tool_call` | 工具调用前 | `{ toolName: string; params: Record<string, unknown> }` |
| `after_tool_call` | 工具调用后 | `{ toolName: string; result: unknown }` |
| `tool_result_persist` | 工具结果持久化 | `{ toolName: string; result: unknown }` (同步) |
| `session_start` | 会话开始 | `{ sessionId: string }` |
| `session_end` | 会话结束 | `{ sessionId: string }` |
| `before_compaction` | 上下文压缩前 | `{ messages: any[] }` |
| `after_compaction` | 上下文压缩后 | `{ result: any }` |
| `before_reset` | 重置前 | `{ reason: string }` |
| `before_message_write` | 消息写入前 | `{ message: any }` (同步) |
| `subagent_spawning` | 子代理创建时 | `{ taskId: string; config: any }` |
| `subagent_delivery_target` | 子代理交付目标 | `{ taskId: string; target: any }` |
| `subagent_spawned` | 子代理创建后 | `{ taskId: string; subagentId: string }` |
| `subagent_ended` | 子代理结束时 | `{ taskId: string; result: any }` |
| `gateway_start` | Gateway 启动 | `{ config: any }` |
| `gateway_stop` | Gateway 停止 | `{ reason: string }` |

---

## Tool API

### 概述

Tool API 提供了工具的注册和执行接口。

### Tool Definition

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: any, context?: ToolContext) => Promise<any>;
}
```

### Registering Tools

#### 在插件中注册

```typescript
api.registerTool({
  name: 'my_tool',
  description: 'My custom tool',
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Input parameter'
      }
    },
    required: ['input']
  },
  async execute(params: { input: string }, context?: ToolContext) {
    // 工具逻辑
    return { result: params.input.toUpperCase() };
  }
});
```

#### 工具上下文

```typescript
interface ToolContext {
  agent?: Agent;
  session?: Session;
  user?: UserInfo;
  logger?: Logger;
}
```

### Tool Categories

Beeclaw 工具分为以下类别：

| 类别 | 描述 | 示例工具 |
|------|------|---------|
| Memory | 记忆管理 | memory_ls, memory_grep, memory_read, memory_write |
| Skills | 技能管理 | skill_list, skill_get, skill_ensure |
| Builtin | 内置工具 | weather, holiday, timezone, user_settings |
| Feishu | 飞书工具 | feishu_drive_list, feishu_wiki_search |

---

## 🔧 高级用法

### 自定义 Agent

```typescript
import { createAgent } from '@/domain/agent';

const agent = createAgent({
  provider: 'openai',
  model: 'gpt-4',
  systemPrompt: 'You are a helpful assistant.',
  tools: ['memory_ls', 'skill_list']
});

const response = await agent.chat('Hello!', {
  onToolCall: (name, params) => {
    console.log(`Tool called: ${name}`);
  },
  onToolResult: (name, result) => {
    console.log(`Tool result: ${name}`, result);
  },
  onContentBlock: (block) => {
    console.log('Content block:', block);
  }
});
```

### 批量操作

```typescript
// 批量注册工具
const tools = [tool1, tool2, tool3];

for (const tool of tools) {
  api.registerTool(tool);
}
```

### 错误处理

```typescript
try {
  const result = await executeTool('my_tool', params);
  return { success: true, data: result };
} catch (error) {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error'
  };
}
```

---

## 📚 参考资料

- [Feishu 开发文档](https://open.feishu.cn/document/)
- [Beeclaw 架构设计](./architecture.md)
- [插件开发指南](./plugin-development.md)
- [工具开发指南](./tool-development.md)

---

## 💡 最佳实践

1. **API 使用**
   - ✅ 阅读文档了解参数要求
   - ✅ 处理错误和异常情况
   - ✅ 使用类型提示提高代码质量

2. **性能优化**
   - ✅ 使用批量 API 减少调用次数
   - ✅ 实现缓存机制
   - ✅ 避免重复请求

3. **安全考虑**
   - ✅ 验证输入参数
   - ✅ 处理敏感信息
   - ✅ 实现权限检查

4. **错误处理**
   - ✅ 提供有意义的错误信息
   - ✅ 实现重试机制
   - ✅ 记录详细日志

---

**需要帮助？**

- 查看 [故障排除指南](./troubleshooting.md)
- 提交 Issue 到 GitHub
- 查看 [示例代码](../examples/)

---

**Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>**
