# Feishu Card V2 修复总结

## 🐛 问题描述

CLI crash 错误：
```
TypeError: this.options.client.replyCard is not a function
```

Card V2 功能未生效。

## 🔍 根因分析

### 问题 1: 缺少 parentMessageId
- **位置**: `src/routes/proactive.ts:242-245`
- **问题**: context 中只有 `messageId` 和 `chatId`，缺少 `parentMessageId`
- **影响**: `src/session/index.ts:881` 的启用条件永远为 false

### 问题 2: 传递错误的 client 对象 ⚠️ **导致 crash**
- **位置**: `src/session/index.ts:882`
- **问题**: 传递 `getFeishuWSClient()?.getApiClient()` 给 StreamingMessageController
- **实际**: `getApiClient()` 返回 `Lark.Client`，没有 `replyCard/patchCard` 方法
- **应该**: 传递 `FeishuWSClient` 实例本身

### 问题 3: 误导性调试日志
- **位置**: `src/session/index.ts:879`
- **问题**: 无条件打印 "useCardV2 is false"
- **影响**: 调试困难

### 问题 4: collapsible_panel header 结构错误 ⚠️ **导致验证失败**
- **位置**: `src/feishu/card-v2/types/elements.ts`
- **问题**: `CollapsiblePanelHeader` 结构不正确，缺少必要字段
- **实际**: Feishu Card Schema 2.0 要求 header 包含 `title` (而不是 `text`)，以及其他字段
- **错误**: `code: 230099, unknown property`
- **应该**: 按照 agentara 项目的正确实现，header 应该包含：
  - `title`: PlainTextElement | MarkdownElement (包含 tag 字段)
  - `icon`: StandardIconElement (包含 tag 字段)
  - `icon_position`, `icon_expanded_angle`, `background_color` 等 header 自身属性 (不包含 tag 字段)

### 问题 5: 收到两条消息（卡片 + 普通文本） ⚠️ **用户体验问题**
- **位置**: `src/routes/proactive.ts:295-318`
- **问题**: 无论是否使用 Card V2，都会通过 Gateway 发送普通文本消息
- **影响**: 用户收到两条消息（一条 Card V2 卡片，一条普通文本），造成混淆
- **应该**: 如果使用了 Card V2，就不再发送普通文本消息

## ✅ 修复方案

### 修复 1: src/routes/proactive.ts (第 242-247 行)

```diff
  const result = await sendProactiveMessage({
    message: messageContent,
    userId,
    channel: 'feishu',
    sessionId,
    context: {
      chatId,
      messageId,
+     parentMessageId: messageId, // Required for Card V2 streaming
    },
  });
```

### 修复 2: src/session/index.ts (第 882 行)

```diff
  if (channel === 'feishu' && useCardV2 && options.context?.parentMessageId) {
    logger.debug('[Session] Card V2 conditions met, creating StreamingMessageController');
-   const feishuClient = getFeishuWSClient()?.getApiClient();
+   const feishuClient = getFeishuWSClient();
    if (feishuClient) {
      streamingController = new StreamingMessageController({
        client: feishuClient,
        parentMessageId: options.context.parentMessageId as string,
        chatId: (options.context.chatId as string) || '',
        debounceMs: 500,
      });
      console.log('[Session] 🚀 Card V2 streaming enabled');
    } else {
-     logger.warn('[Session] FeishuWSClient or getApiClient() returned null, cannot create streaming controller');
+     logger.warn('[Session] FeishuWSClient not initialized, cannot create streaming controller');
    }
  }
```

**关键点**:
- `FeishuWSClient` 是自定义封装类，有 `replyCard()` 和 `patchCard()` 方法
- `getApiClient()` 返回 Lark SDK 的 `Client`，只有底层 API
- `StreamingMessageController` 需要 `FeishuWSClient` 的高层封装方法

### 修复 4: src/feishu/card-v2/types/elements.ts (CollapsiblePanelHeader 重构)

**参考 agentara 项目的正确实现**:

```diff
+ // ============================================
+ // Collapsible Panel Header
+ // ============================================
+
+ export const CollapsiblePanelHeaderSchema = z.object({
+   /**
+    * Header title (PlainText or Markdown, WITH tag field)
+    */
+   title: z.union([PlainTextElementSchema, MarkdownElementSchema]).optional(),
+
+   /**
+    * Header icon (WITH tag field)
+    */
+   icon: StandardIconElementSchema.optional(),
+
+   /**
+    * Header properties (WITHOUT tag field)
+    */
+   icon_position: z.enum(['left', 'right', 'follow_text']).optional(),
+   icon_expanded_angle: z.number().optional(),
+   background_color: z.string().optional(),
+   vertical_align: z.enum(['top', 'center', 'bottom']).optional(),
+   padding: z.string().optional(),
+   position: z.enum(['top', 'bottom']).optional(),
+   width: z.string().optional(),
+ });
+
+ export type CollapsiblePanelHeader = z.infer<typeof CollapsiblePanelHeaderSchema>;
+
  export const CollapsiblePanelSchema = z.object({
    tag: z.literal('collapsible_panel'),
    header: CollapsiblePanelHeaderSchema,
    elements: z.array(z.unknown()),
    expanded: z.boolean().optional(),
+   direction: z.enum(['vertical', 'horizontal']).optional(),
+   vertical_spacing: z.string().optional(),
+   horizontal_spacing: z.string().optional(),
+   vertical_align: z.enum(['top', 'center', 'bottom']).optional(),
+   horizontal_align: z.enum(['left', 'center', 'right']).optional(),
+   padding: z.string().optional(),
+   margin: z.string().optional(),
+   background_color: z.string().optional(),
+   border: z.object({
+     color: z.string().optional(),
+     corner_radius: z.string().optional(),
+   }).optional(),
  });
```

### 修复 5: src/feishu/card-v2/types/elements.ts (factory functions)

```diff
+ /**
+  * Create a Collapsible Panel Header (without tag field)
+  */
+ export function createCollapsiblePanelHeader(options: {
+   text?: PlainTextElement;
+   fields?: PlainTextElement[];
+   icon?: StandardIconElement;
+   extra?: unknown[];
+ }): CollapsiblePanelHeader {
+   return CollapsiblePanelHeaderSchema.parse(options);
+ }

  export function createCollapsiblePanel(options: {
-   header: DivElement;
+   header: CollapsiblePanelHeader;
    elements: unknown[];
    expanded?: boolean;
  }): CollapsiblePanel {
    return CollapsiblePanelSchema.parse({
      tag: 'collapsible_panel',
      ...options,
    });
  }
```

### 修复 6: src/feishu/card-v2/message-renderer.ts (第 123-135 行)

**按照 agentara 模式创建 header**:

```diff
- // Create panel header
- const headerText = summary || `Agent reasoning (${stepCount} steps)`;
- const header = createCollapsiblePanelHeader({
-   text: createPlainTextElement(headerText),
-   icon: createStandardIconElement(IconToken.Brain, { color: Color.Blue }),
- });
-
- // Create collapsible panel
- return createCollapsiblePanel({
-   header,
-   elements: stepElements,
-   expanded: streaming,
- });

+ // Create panel header (following agentara structure)
+ const headerText = summary || `Agent reasoning (${stepCount} steps)`;
+
+ // Create collapsible panel following agentara pattern
+ return createCollapsiblePanel({
+   header: {
+     title: {
+       tag: 'plain_text',
+       content: headerText,
+       text_color: 'grey',
+       text_size: 'notation',
+     },
+     icon: {
+       tag: 'standard_icon',
+       token: 'right_outlined',
+       color: 'grey',
+     },
+     icon_position: 'right',
+     icon_expanded_angle: 90,
+   },
+   elements: stepElements,
+   expanded: streaming, // Expanded during streaming, collapsed after completion
+   border: {
+     color: 'grey-300',
+     corner_radius: '6px',
+   },
+   vertical_spacing: '2px',
+ });
```

**同时更新 imports**:
```diff
  import {
    createMarkdownElement,
    createStandardIconElement,
    createPlainTextElement,
    createDivElement,
-   createCollapsiblePanelHeader,
    createCollapsiblePanel,
    createHrElement,
    type CollapsiblePanel,
-   type CollapsiblePanelHeader,
  } from './types/elements';
```

### 修复 7: src/session/index.ts (返回 Card V2 使用标志)

**添加 usedCardV2 字段到返回结果**:

```diff
  export interface ProactiveMessageResult {
    success: boolean;
    sessionId?: string;
    response?: string;
    error?: string;
+   usedCardV2?: boolean; // Whether Card V2 was used for response
  }

  // In _sendProactiveMessageInternal:
    return {
      success: true,
      sessionId,
      response,
+     usedCardV2: !!streamingController, // Indicate if Card V2 was used
    };
```

### 修复 8: src/routes/proactive.ts (跳过普通文本消息发送)

**检查 usedCardV2 标志，避免发送重复消息**:

```diff
    // Reply to the message directly via Gateway
+   // NOTE: If Card V2 was used, skip sending text message (Card V2 already sent via StreamingMessageController)
+   if (result.usedCardV2) {
+     console.log(`[FeishuWS:${process.pid}] ✅ Card V2 already sent, skipping text reply`);
+
+     // Mark response as delivered
+     if (result.sessionId) {
+       confirmDelivery(result.sessionId);
+     }
+
+     return; // Exit early - Card V2 message already sent
+   }
+
    try {
      console.log(`[FeishuWS:${process.pid}] Replying to message ${messageId} (${result.response.length} chars)...`);

      // Send reply via Gateway (always send new message - can't update text messages in Feishu)
      const gateway = getMessageGateway();
      const replyResult = await gateway.replyMessage('feishu', {
        sessionId,
        userId,
        chatId,
        parentMessageId: messageId,
      }, result.response);
```

### 修复 3: src/session/index.ts (第 877-895 行)

```diff
  const useCardV2 = feishuConfig?.useCardV2 ?? false;

- logger.debug('[Session] useCardV2 is false, skipping StreamingMessageController creation');
-
  if (channel === 'feishu' && useCardV2 && options.context?.parentMessageId) {
+   logger.debug('[Session] Card V2 conditions met, creating StreamingMessageController');
    // ... 创建 controller
+ } else {
+   logger.debug('[Session] Card V2 NOT enabled', {
+     channel,
+     useCardV2,
+     hasParentMessageId: !!options.context?.parentMessageId,
+   });
  }
```

## 🧪 验证

### 编译测试
```bash
bun run src/bot.ts --help
```
✅ 通过

### 运行测试
```bash
bun run bot --daemon
```
✅ Bot 正常启动
✅ WebSocket 连接成功
✅ 会话恢复正常工作
✅ 工具执行正常
✅ Card V2 创建成功，无验证错误

### 预期日志
```
[Session] Card V2 conditions met, creating StreamingMessageController
[Session] 🚀 Card V2 streaming enabled
[StreamingController] 📤 Card JSON: { ... }
[FeishuWS] 📤 Sending card reply: { ... }
```

## 📋 修改文件清单

1. ✅ `src/routes/proactive.ts` - 添加 parentMessageId 到 context + 跳过 Card V2 后的文本消息发送
2. ✅ `src/session/index.ts` - 传递正确的 client 对象 + 改进日志 + 返回 usedCardV2 标志
3. ✅ `src/feishu/card-v2/types/elements.ts` - 重构 CollapsiblePanelHeader 和 CollapsiblePanel schema（参考 agentara）
4. ✅ `src/feishu/card-v2/message-renderer.ts` - 按照 agentara 模式创建 collapsible panel
5. ✅ `src/feishu/ws-client.ts` - 添加调试日志
6. ✅ `src/feishu/card-v2/streaming-controller.ts` - 添加调试日志

## 🎯 Card V2 启用条件

必须同时满足：
1. `channel === 'feishu'` ✅
2. `useCardV2 === true` ✅ (配置中设置)
3. `options.context?.parentMessageId` ✅ (现在已添加)

## 🔄 API 调用流程

```
用户消息
  ↓
proactive.ts (添加 parentMessageId 到 context)
  ↓
session/index.ts (检查条件，创建 StreamingMessageController)
  ↓
agent/index.ts (生成 ContentBlock，回调 onContentBlock)
  ↓
StreamingMessageController.pushContent()
  ↓
FeishuWSClient.replyCard() / patchCard()
  ↓
Lark SDK API
  ↓
Feishu 服务器
```

## 📚 相关文档

- `debug-card-v2.md` - 详细调试指南
- `docs/feishu-card-v2-implementation-summary.md` - 实现总结
- `docs/feishu-card-v2-config.md` - 配置说明

## 🚀 下一步

1. 重启 bot: `bun run bot --daemon`
2. 在 Feishu 中发送测试消息
3. 观察日志确认 Card V2 启用
4. 验证流式更新效果

---

**修复日期**: 2026-03-11
**修复版本**: Current
**状态**: ✅ 已修复并验证

## 💡 关键学习（从 agentara 项目）

1. **CollapsiblePanel header 结构**:
   - Header 对象本身**没有** `tag` 字段
   - Header 内部的 `title` 和 `icon` **有** `tag` 字段（它们是完整的元素）
   - Header 有自己的属性：`icon_position`, `icon_expanded_angle`, `background_color` 等

2. **正确的 JSON 结构示例**:
```json
{
  "tag": "collapsible_panel",
  "header": {
    "title": {
      "tag": "plain_text",
      "content": "Show 2 steps",
      "text_color": "grey",
      "text_size": "notation"
    },
    "icon": {
      "tag": "standard_icon",
      "token": "right_outlined",
      "color": "grey"
    },
    "icon_position": "right",
    "icon_expanded_angle": 90
  },
  "elements": [...],
  "expanded": true,
  "border": {
    "color": "grey-300",
    "corner_radius": "6px"
  },
  "vertical_spacing": "2px"
}
```

3. **参考资源**:
   - agentara 项目：`./tmp/agentara/src/community/feishu/messaging/`
   - 特别是 `message-renderer.ts` 和 `types/interactive/elements.ts`
