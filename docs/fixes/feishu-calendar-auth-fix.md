# 飞书日历授权问题解决方案

## 问题描述

用户首次使用日历功能时，出现以下错误：

```
❌ Silent auth failed: invalid request, grant_type should be authorization_code or refresh_token (code: 20001)
❌ User authorization required for feishu_calendar_event_create
```

问题：系统没有弹出授权卡片，用户无法完成授权。

## 根本原因

1. **错误的静默授权实现**: 之前使用 `grant_type: 'silent_auth'`，这不是飞书支持的授权类型
2. **缺少授权卡片发送**: 工具返回 `requiresAuth: true`，但没有实际发送授权卡片给用户

## 解决方案

### 1. 修改授权流程 (calendar.ts)

**修改前**:
```typescript
// 错误：使用不存在的 silent_auth grant_type
const response = await client.authen.v1.accessToken.create({
  data: {
    grant_type: 'silent_auth',  // ❌ 不存在
    silent_auth: { open_id: openId },
  },
});
```

**修改后**:
```typescript
// 使用 SmartAuthManager 正确处理授权
const authManager = createSmartAuthManager(client, {
  appId: config.feishu.appId,
  redirectUri: config.feishu.redirectUri,
});

const authResult = await authManager.authorize(
  userContext.openId,
  toolName,
  userContext.chatId
);

if (!authResult.authorized) {
  // 返回授权卡片
  return {
    success: false,
    error: authResult.error,
    requiresAuth: true,
    authCard: authResult.authCard,  // ✅ 授权卡片
  };
}
```

### 2. 发送授权卡片 (agent/index.ts)

**修改前**:
```typescript
// 只是返回错误，不发送卡片
result = await executeCalendarTool(client, name, params, userContext);
// 没有 authCard 处理
```

**修改后**:
```typescript
result = await executeCalendarTool(client, name, params, userContext);

// 检查是否需要发送授权卡片
if (result?.requiresAuth && result?.authCard && userContext?.chatId) {
  const wsClient = getFeishuWSClient();
  await wsClient.sendCard(userContext.chatId, 'chat_id', result.authCard);
  logger.info(`✅ Sent auth card to user`);
}
```

## 完整授权流程

```
用户: "帮我创建明天的会议"
    ↓
1. Agent 调用 feishu_calendar_event_create
    ↓
2. executeCalendarTool 检测需要授权
    ↓
3. 调用 SmartAuthManager.authorize()
    ↓
4. 尝试获取缓存的 token
    ├─ 有缓存 → 直接使用
    └─ 无缓存 → 尝试刷新 refresh_token
         ├─ 刷新成功 → 使用新 token
         └─ 刷新失败 → 生成授权卡片
    ↓
5. 返回 { requiresAuth: true, authCard: {...} }
    ↓
6. Agent 检测到 authCard
    ↓
7. 发送授权卡片到飞书聊天
    ↓
用户看到授权卡片:
┌────────────────────────────────┐
│  🔐 需要授权                   │
│                                │
│  为了访问你的个人日历，         │
│  需要你的授权。                │
│                                │
│  [点击授权]                    │
└────────────────────────────────┘
    ↓
8. 用户点击"点击授权"
    ↓
9. 跳转飞书授权页面
    ↓
10. 用户确认授权
    ↓
11. OAuth 回调 → 保存 token
    ↓
12. 用户可以继续使用日历功能 ✅
```

## 飞书正确的授权方式

### OAuth 2.0 授权码模式

飞书只支持两种 `grant_type`:

1. **authorization_code** - 首次授权
2. **refresh_token** - 刷新令牌

**不支持**: `silent_auth`, `client_credentials` 等

### 授权 URL 生成

```typescript
const authUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`;

// params 包含:
{
  app_id: 'cli_xxx',
  redirect_uri: 'https://your-domain.com/api/feishu/oauth/callback',
  state: base64({ openId, chatId, timestamp }),
  scope: 'calendar:calendar'
}
```

### 获取 user_access_token

```typescript
// 用授权码换取 token
const response = await client.authen.v1.accessToken.create({
  data: {
    grant_type: 'authorization_code',  // ✅ 正确
    code: 'auth_code_from_callback',
  },
});

// 返回
{
  access_token: 'u-xxx',
  refresh_token: 'r-xxx',
  expires_in: 7200,
  scope: 'calendar:calendar'
}
```

### 刷新 token

```typescript
const response = await client.authen.v1.accessToken.create({
  data: {
    grant_type: 'refresh_token',  // ✅ 正确
    refresh_token: 'r-xxx',
  },
});
```

## 配置要求

### 1. 飞书开放平台

确保已启用权限:
- ✅ `calendar:calendar` - 日历读写权限
- ✅ `calendar:calendar:readonly` - 日历只读权限

### 2. OAuth 回调接口

确保已配置回调路由 (`src/app/routes/feishu-oauth.ts`):

```typescript
// GET /api/feishu/oauth/callback
router.get('/callback', async (ctx) => {
  const { code, state } = ctx.query;

  // 用 code 换取 token
  const token = await exchangeCodeForToken(code);

  // 保存 token
  await saveUserToken(openId, token);

  // 返回成功页面
  ctx.body = '授权成功！请返回飞书继续使用。';
});
```

### 3. beeclaw.json 配置

```json
{
  "feishu": {
    "enabled": true,
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "redirectUri": "https://your-domain.com/api/feishu/oauth/callback"
  }
}
```

## 测试步骤

### 1. 首次授权测试

```bash
# 启动 bot
bun run bot

# 在飞书中发送消息
用户: "帮我创建明天的会议"

# 预期结果
1. Bot 回复需要授权
2. 收到授权卡片
3. 点击授权 → 跳转授权页面
4. 确认授权 → 返回成功
5. 日程创建成功
```

### 2. 后续使用测试

```bash
# 授权后再次使用
用户: "我今天有什么安排？"

# 预期结果
1. 使用缓存的 token
2. 直接返回日程列表
3. 无需再次授权
```

### 3. Token 过期测试

```bash
# 等待 2 小时后（token 过期）
用户: "创建一个会议"

# 预期结果
1. 自动使用 refresh_token 刷新
2. 刷新成功 → 继续操作
3. 或刷新失败 → 重新弹出授权卡片
```

## 相关文档

- [飞书 OAuth 2.0 文档](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token)
- [飞书日历权限说明](https://open.feishu.cn/document/server-docs/calendar-v4/calendar/introduction)
- [SmartAuthManager 实现](src/adapter/feishu/smart-auth.ts)

## 常见问题

### Q1: 为什么不使用静默授权？

A: 飞书不支持 `grant_type: silent_auth`。正确的"静默授权"是：
- 使用 refresh_token 自动刷新
- 无需用户再次点击授权

### Q2: 授权卡片没有显示？

A: 检查以下几点：
1. `executeCalendarTool` 是否返回 `authCard`
2. Agent 是否调用 `sendCard()`
3. `chatId` 是否正确
4. 查看日志是否有错误

### Q3: 用户授权后仍然失败？

A: 可能原因：
1. OAuth 回调接口未配置
2. redirectUri 不匹配
3. 权限范围未启用
4. Token 保存失败

### Q4: 如何调试授权流程？

A: 查看日志：
```bash
# 查看授权相关日志
pm2 logs beeclaw | grep -E "auth|授权"

# 关键日志
- 🔐 Attempting silent auth
- ❌ Silent auth failed
- ✅ Sent auth card to user
- Authorization required
```

## 总结

✅ **正确做法**:
1. 使用 `SmartAuthManager` 管理授权
2. 返回授权卡片并自动发送
3. 支持 OAuth 2.0 授权码模式
4. 自动刷新 token

❌ **错误做法**:
1. ~~使用不存在的 `silent_auth` grant_type~~
2. ~~只返回错误不发送卡片~~
3. ~~手动管理 token~~

现在用户首次使用日历功能时，会自动收到授权卡片，点击授权后即可正常使用！
