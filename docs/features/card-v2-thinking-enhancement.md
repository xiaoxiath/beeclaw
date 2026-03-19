# Card V2 思考过程增强

## 改动概述

增强了飞书 Card V2 的输出，现在可以显示 Agent 的思考过程和 React 模式的决策步骤。

## 修改内容

### 1. Message Renderer (`src/adapter/feishu/card-v2/message-renderer.ts`)

**新增功能**:
- 添加 `renderThinkingStep()` 函数，渲染思考过程块
- 在步骤循环中处理 `thinking` 类型的 ContentBlock

**显示效果**:
- 💭 图标 + 思考内容
- 与工具调用步骤一起显示在可折叠面板中

### 2. Agent (`src/domain/agent/index.ts`)

**新增功能**:
1. **提取 `<thinking>` 标签**:
   - 从 LLM 响应中提取 `<thinking>...</thinking>` 标签内容
   - 生成 `ThinkingBlock` 并通过 `onContentBlock` 回调发送
   - 从最终内容中移除 thinking 标签

2. **工具选择决策**:
   - 在工具调用前，生成思考块说明选择了哪些工具
   - 格式: "Decided to use N tool(s): tool1, tool2, ..."

**效果**:
- 捕获 LLM 内部推理（MiniMax reasoning_details, Zhipu reasoning_content）
- 显示工具选择决策过程
- 让用户看到 Agent 的"思考过程"

## 使用示例

### 示例 1: LLM 内部推理

当使用支持推理的模型（如 MiniMax, GLM-4.7-flashx）时：

```
💭 Let me analyze this step by step:
1. First, I need to understand what the user is asking
2. Then, I should check if I have the relevant tools
3. Finally, I'll formulate a response
```

### 示例 2: 工具选择决策

当 Agent 决定调用工具时：

```
💭 Decided to use 2 tool(s): memory_read, skill_get
```

## 技术细节

### Content Block 流程

```
User Message
    ↓
Agent.chat()
    ↓
LLM Response (with <thinking> tags)
    ↓
Extract thinking content → ThinkingBlock
    ↓
Remove <thinking> tags from content
    ↓
Tool call decision → ThinkingBlock
    ↓
Tool execution → ToolUseBlock
    ↓
StreamingMessageController.pushContent()
    ↓
Message Renderer:
  - ThinkingBlock → 💭 + thinking text
  - ToolUseBlock → 🔧 + tool name
    ↓
Feishu Card V2 (可折叠面板)
```

### 数据结构

```typescript
// ThinkingBlock 类型 (已存在于 src/types/content-block.ts)
{
  type: 'thinking',
  thinking: string
}

// 生成位置 1: Agent 提取 <thinking> 标签
if (cleanedContent.includes('<thinking>')) {
  options.onContentBlock({
    type: 'thinking',
    thinking: thinkingContent
  });
}

// 生成位置 2: 工具选择决策
if (hasToolCalls(response)) {
  options.onContentBlock({
    type: 'thinking',
    thinking: `Decided to use ${toolCalls.length} tool(s): ${toolNames}`
  });
}
```

## 未来增强

可以考虑添加更多思考过程：

1. **React 模式步骤**:
   - Thought: 当前状态分析
   - Action: 选择的行动
   - Observation: 执行结果

2. **工具执行结果**:
   - 显示工具返回的关键信息
   - 过长结果自动折叠

3. **多轮对话跟踪**:
   - 显示当前是第几轮
   - 显示累计 token 使用

## 兼容性

- ✅ 向后兼容：不支持 thinking 的客户端会忽略这些块
- ✅ 不影响非飞书渠道（CLI, Web）
- ✅ 不破坏现有功能

## 测试

```bash
# 测试 thinking 标签提取
bun run cli

# 使用支持推理的模型（如 GLM-4.7-flashx）
# 观察飞书 Card 中是否显示 💭 图标和思考内容
```

---

**修改文件**:
- `src/adapter/feishu/card-v2/message-renderer.ts`
- `src/domain/agent/index.ts`

**测试状态**: ✅ 逻辑验证通过
