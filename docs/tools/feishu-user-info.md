# 飞书用户信息获取工具

## 功能说明

`feishu_get_current_user` 工具用于从飞书消息事件中提取当前用户的信息，包括：

- **open_id**: 用户的飞书 open ID
- **user_id**: 用户的飞书 user ID
- **chat_id**: 当前聊天的 ID
- **message_id**: 当前消息的 ID

## 使用场景

1. **获取用户身份**: 当需要知道当前与 bot 交互的用户是谁时
2. **权限验证**: 在执行需要用户授权的操作前，先获取用户 ID
3. **日志记录**: 记录哪个用户执行了什么操作
4. **个性化服务**: 根据用户 ID 提供个性化的回复

## 工具定义

```typescript
{
  name: 'feishu_get_current_user',
  description: 'Get current user information from the Feishu message event, including open_id, user_id, chat_id, and message_id',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  }
}
```

## 返回示例

```json
{
  "success": true,
  "data": {
    "openId": "ou_84aad35d084aa403a838cf73ee18467",
    "userId": "e33ggbyz",
    "chatId": "oc_5ce6d572455d361153b7xx51da133945",
    "messageId": "om_5ce6d572455d361153b7cb51da133945"
  }
}
```

## 使用示例

### 在对话中

用户: "我是谁？"
Beeclaw: [调用 feishu_get_current_user 工具]
Beeclaw: "你的飞书 open_id 是 `ou_84aad35d084aa403a838cf73ee18467`"

### 与其他工具配合

```typescript
// 1. 获取用户信息
const userInfo = await executeUserInfoTool(client, 'feishu_get_current_user', {}, userContext);

// 2. 使用 open_id 查询用户日历
const calendars = await executeCalendarTool(client, 'feishu_calendar_list', {}, userInfo.data.openId);
```

## 权限要求

✅ **无需授权** - 此工具不需要用户授权，因为它只返回消息事件中已经包含的信息。

## 实现细节

### 数据来源

用户信息从消息事件的以下路径提取：

```json
{
  "event": {
    "sender": {
      "sender_id": {
        "open_id": "ou_...",
        "user_id": "...",
        "union_id": "on_..."
      }
    },
    "message": {
      "chat_id": "oc_...",
      "message_id": "om_..."
    }
  }
}
```

### 代码位置

- 工具实现: `src/adapter/feishu/tools/user-info.ts`
- 工具注册: `src/domain/agent/tools.ts`
- 执行逻辑: `src/domain/agent/index.ts`

## 注意事项

1. **仅在飞书环境可用**: 此工具只在飞书 bot 模式下可用，CLI 模式下调用会返回错误
2. **依赖消息上下文**: 必须在消息处理流程中调用，否则无法获取用户信息
3. **不需要 API 调用**: 此工具不调用飞书 API，只是提取已有信息，响应非常快

## 相关工具

- `feishu_calendar_*` - 日历工具（需要用户授权）
- `feishu_drive_*` - 云盘工具（需要用户授权）
- `feishu_wiki_*` - 知识库工具（需要用户授权）
