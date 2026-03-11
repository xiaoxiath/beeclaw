# Feishu Card V2 调试日志

## 问题分析

Card V2 功能没有生效的原因有两个主要问题：

### 问题 1: 缺少 parentMessageId ❌ (已修复)
- **位置**: `src/routes/proactive.ts:242-245`
- **问题**: 传递给 `sendProactiveMessage` 的 context 中只有 `messageId` 和 `chatId`，缺少 `parentMessageId`
- **影响**: `src/session/index.ts:881` 的条件 `options.context?.parentMessageId` 永远为 false

### 问题 2: 传递错误的 client 对象 ❌ (已修复)
- **位置**: `src/session/index.ts:882`
- **问题**: 传递 `getFeishuWSClient()?.getApiClient()` 给 `StreamingMessageController`
- **实际**: `getApiClient()` 返回 Lark SDK 的 `Client` 对象，没有 `replyCard` 和 `patchCard` 方法
- **应该**: 传递 `FeishuWSClient` 实例本身，它有这些方法
- **错误**: `TypeError: this.options.client.replyCard is not a function`

### 问题 3: 误导性的调试日志 ⚠️ (已改进)
- **位置**: `src/session/index.ts:879`
- **问题**: 在检查条件之前就打印 "useCardV2 is false"，无论配置如何都会打印
- **影响**: 调试时产生混淆

## 修复方案

### 修复 1: 添加 parentMessageId 到 context
**文件**: `src/routes/proactive.ts:235-247`

```typescript
// ❌ 之前
context: {
  chatId,
  messageId,
}

// ✅ 现在
context: {
  chatId,
  messageId,
  parentMessageId: messageId, // ✅ 添加这行 - Card V2 流式消息需要
},
```

### 修复 2: 传递正确的 client 对象
**文件**: `src/session/index.ts:882`

```typescript
// ❌ 之前 - 返回 Lark.Client，没有 replyCard/patchCard 方法
const feishuClient = getFeishuWSClient()?.getApiClient();

// ✅ 现在 - 返回 FeishuWSClient 实例，有 replyCard/patchCard 方法
const feishuClient = getFeishuWSClient();
```

**原因分析**:
- `FeishuWSClient` 是自定义的封装类，实现了 `replyCard()` 和 `patchCard()` 方法
- `getApiClient()` 返回底层的 `Lark.Client` SDK 对象，只有基础的 API 方法
- `StreamingMessageController` 需要使用 `FeishuWSClient` 的高层封装方法

### 修复 3: 改进调试日志
**文件**: `src/session/index.ts:877-895`

```typescript
// ❌ 移除误导性日志
// logger.debug('[Session] useCardV2 is false, skipping...');

// ✅ 添加条件分支日志
if (channel === 'feishu' && useCardV2 && options.context?.parentMessageId) {
  logger.debug('[Session] Card V2 conditions met, creating StreamingMessageController');
  // ... 创建 controller
  console.log('[Session] 🚀 Card V2 streaming enabled');
} else {
  logger.debug('[Session] Card V2 NOT enabled', {
    channel,
    useCardV2,
    hasParentMessageId: !!options.context?.parentMessageId,
  });
}
```

## 验证步骤

### 1. 配置检查
确保 `beeclaw.json` 中启用 Card V2:
```json
{
  "feishu": {
    "enabled": true,
    "useCardV2": true  // ✅ 必须为 true
  }
}
```

### 2. 启动 bot
```bash
bun run bot --daemon
```

### 3. 发送测试消息
在 Feishu 中发送任意消息给 bot

### 4. 检查日志输出
应该看到以下日志：

**✅ Card V2 启用成功:**
```
[Session] Card V2 conditions met, creating StreamingMessageController
[Session] 🚀 Card V2 streaming enabled
```

**❌ 如果看到这个，说明有问题:**
```
[Session] Card V2 NOT enabled {
  channel: 'feishu',
  useCardV2: false,  // 配置未启用
  hasParentMessageId: false  // context 传递问题
}
```

**✅ Card V2 完成:**
```
[Session] ✅ Card V2 streaming completed
```

**❌ 如果出现这个错误，说明 client 对象错误:**
```
TypeError: this.options.client.replyCard is not a function
```

## Card V2 启用条件

```typescript
if (channel === 'feishu' && useCardV2 && options.context?.parentMessageId) {
  // 创建 StreamingMessageController
}
```

必须同时满足：
1. `channel === 'feishu'` - 消息来自 Feishu ✅
2. `useCardV2 === true` - 配置中启用了 Card V2 ✅
3. `options.context?.parentMessageId` - 有父消息 ID（用于回复）✅

## 调试技巧

### 查看配置是否正确加载
```typescript
logger.debug('[Session] Feishu config:', feishuConfig);
logger.debug('[Session] useCardV2:', feishuConfig?.useCardV2);
```

### 查看 context 传递
```typescript
logger.debug('[Session] parentMessageId:', options.context?.parentMessageId);
logger.debug('[Session] chatId:', options.context?.chatId);
```

### 查看 Card V2 创建状态
```typescript
logger.debug('[Session] Card V2 NOT enabled', {
  channel,
  useCardV2,
  hasParentMessageId: !!options.context?.parentMessageId,
});
```

### 检查 client 对象类型
```typescript
const feishuClient = getFeishuWSClient();
console.log('Client type:', feishuClient?.constructor.name); // 应该是 'FeishuWSClient'
console.log('Has replyCard:', typeof feishuClient?.replyCard); // 应该是 'function'
```

## 相关文件

- `src/routes/proactive.ts` - Feishu 消息处理，传递 context
- `src/session/index.ts` - Session 管理，创建 StreamingMessageController
- `src/feishu/card-v2/streaming-controller.ts` - 流式消息控制器
- `src/feishu/ws-client.ts` - Feishu WebSocket 客户端，实现 replyCard/patchCard
- `beeclaw.json` - 配置文件，设置 `feishu.useCardV2: true`

## API 调用流程

```
1. Feishu 消息到达
   ↓
2. src/routes/proactive.ts
   - 提取 messageId, chatId
   - 调用 sendProactiveMessage({ context: { chatId, messageId, parentMessageId: messageId } })
   ↓
3. src/session/index.ts
   - 检查条件: channel === 'feishu' && useCardV2 && parentMessageId
   - 创建 StreamingMessageController({ client: FeishuWSClient, parentMessageId, chatId })
   - 调用 agent.chat({ onContentBlock })
   ↓
4. src/agent/index.ts
   - 生成 ContentBlock (TextBlock, ToolUseBlock, etc.)
   - 通过 onContentBlock 回调推送到 StreamingMessageController
   ↓
5. src/feishu/card-v2/streaming-controller.ts
   - pushContent(block) 接收内容块
   - sendInitialMessage() 调用 client.replyCard() 发送初始卡片
   - debouncedUpdate() 调用 client.patchCard() 更新卡片
   ↓
6. src/feishu/ws-client.ts
   - replyCard(): 调用 Lark SDK 的 message.reply API
   - patchCard(): 调用 Lark SDK 的 message.patch API
   ↓
7. Feishu API
   - 创建/更新 Card V2 消息
```

## 测试验证

### 手动测试
1. 启动 bot: `bun run bot --daemon`
2. 在 Feishu 中发送消息: "帮我搜索伊朗最新局势"
3. 观察 bot 响应：
   - 应该看到实时更新的卡片
   - 工具调用应该显示为可折叠面板
   - 最终答案应该格式化显示

### 自动化测试
```bash
# 运行 Card V2 相关测试
bun test src/feishu/card-v2/__tests__/
bun test src/feishu/__tests__/ws-client-card.test.ts
```

## 已知问题

### 1. 消息撤回处理
如果用户撤回消息，`replyCard` 和 `patchCard` 会失败，返回错误码 230011 或 231003。

**解决方案**: 在 `StreamingMessageController` 中捕获这些错误并优雅处理。

### 2. 并发更新
多个工具同时返回结果时，可能会触发多次 `patchCard` 调用。

**解决方案**: 使用 debounce（500ms）来合并更新。

### 3. 大量内容
如果工具返回大量文本，可能导致卡片内容过大。

**解决方案**: 在 `MessageCardRenderer` 中实现内容截断或分页。

## 更新历史

- **2026-03-11**: 修复 parentMessageId 缺失和 client 对象错误的问题
- **2026-03-11**: 改进调试日志，添加条件分支提示
- **2026-03-11**: 创建调试文档
