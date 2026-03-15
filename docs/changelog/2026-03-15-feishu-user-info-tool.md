# 新增飞书用户信息工具

## 概述

新增 `feishu_get_current_user` 工具，用于从飞书消息事件中提取当前用户的信息。

## 改动文件

### 1. 新增文件

#### `src/adapter/feishu/tools/user-info.ts`
- 实现用户信息提取功能
- 定义工具 schema
- 导出 `getCurrentUser`, `executeUserInfoTool`, `userInfoToolDefinitions`

#### `src/adapter/feishu/tools/__tests__/user-info.test.ts`
- 单元测试，覆盖以下场景：
  - 成功获取用户信息
  - 处理缺失的上下文
  - 处理未知工具名称

#### `docs/tools/feishu-user-info.md`
- 工具使用文档
- 包含使用场景、示例、注意事项

#### `examples/feishu-user-info-tool.ts`
- 使用示例代码
- 展示如何在对话中使用该工具

### 2. 修改文件

#### `src/adapter/feishu/index.ts`
```typescript
// 新增导出
export {
  getCurrentUser,
  executeUserInfoTool,
  userInfoToolDefinitions,
} from './tools/user-info';
```

#### `src/domain/agent/tools.ts`
```typescript
// 导入新工具定义
import {
  // ... existing imports
  userInfoToolDefinitions,
} from '../../adapter/feishu';

// 注册到工具列表
const feishuTools = [
  // ... existing tools
  ...Object.values(userInfoToolDefinitions),
];
```

#### `src/domain/agent/index.ts`
```typescript
// 导入执行函数
import {
  // ... existing imports
  executeUserInfoTool,
} from '../../adapter/feishu';

// 添加执行逻辑
else if (name.startsWith('feishu_get_')) {
  result = await executeUserInfoTool(client, name, params, userContext);
}
```

## 功能特性

### ✅ 自动提取用户信息
从飞书消息事件中自动提取：
- `open_id` - 用户的飞书 open ID
- `user_id` - 用户的飞书 user ID
- `chat_id` - 当前聊天的 ID
- `message_id` - 当前消息的 ID

### ✅ 无需授权
- 不需要用户授权即可使用
- 不调用飞书 API，仅提取消息事件中的信息
- 响应速度极快

### ✅ 完整测试覆盖
- 单元测试通过
- 集成到现有工具系统

## 使用方式

### 在飞书中对话

```
用户: 我的 open_id 是什么？
Bot: 你的飞书 open_id 是 `ou_84aad35d084aa403a838cf73ee18467`
```

### 程序化调用

```typescript
const result = await agent.chat('我的用户信息', {
  userContext: {
    openId: 'ou_xxx',
    chatId: 'oc_xxx',
  }
});
```

## 权限配置

无需配置权限，工具开箱即用。

## 测试

```bash
# 运行单元测试
bun test src/adapter/feishu/tools/__tests__/user-info.test.ts

# 运行示例
bun run examples/feishu-user-info-tool.ts

# 在飞书中测试
bun run bot
# 然后在飞书中发送: "我的 open_id 是什么？"
```

## 架构说明

```
┌─────────────────────────────────────────────────────────┐
│ Feishu Message Event                                    │
│ {                                                       │
│   event: {                                              │
│     sender: { sender_id: { open_id, user_id } },       │
│     message: { chat_id, message_id }                   │
│   }                                                     │
│ }                                                       │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ UserContext Extraction                                  │
│ (ws-client.ts / channel.ts)                            │
│                                                         │
│ Extract: openId, userId, chatId, messageId             │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Tool Execution (agent/index.ts)                         │
│                                                         │
│ if (name.startsWith('feishu_get_')) {                  │
│   result = await executeUserInfoTool(...);             │
│ }                                                       │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Return User Info                                        │
│ {                                                       │
│   success: true,                                        │
│   data: { openId, userId, chatId, messageId }          │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
```

## 下一步

1. ✅ 工具已实现并集成
2. ✅ 测试已通过
3. ✅ 文档已创建
4. 🔄 可以在飞书 bot 中测试使用

## 相关链接

- [飞书消息事件文档](https://open.feishu.cn/document/client-docs/bot-v3/events/message-receive)
- [用户 ID 说明](https://open.feishu.cn/document/home/user-identity-introduction/open-id)
