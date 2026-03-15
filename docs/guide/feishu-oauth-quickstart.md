# 飞书用户授权快速实现指南

## 🎯 目标

**问题**: 当前使用 `app_access_token`，只能访问应用资源，无法访问用户私有资源（个人日历、云盘、知识库）

**目标**: 实现 OAuth 2.0 用户授权，使用 `user_access_token` 访问用户私有资源

## 📊 架构对比

### 修复前（应用授权）

```
用户: "查看我的日历"
  ↓
Bot (使用 app_access_token)
  ↓
飞书 API: client.calendar.calendar.list()
  ↓
❌ 只返回 "Beeclaw" 应用的日历
   无法访问用户个人日历
```

### 修复后（用户授权）

```
用户: "查看我的日历"
  ↓
Bot 检查用户授权状态
  ↓
[未授权] → 生成授权链接 → 用户授权 → 获取 user_access_token
  ↓
[已授权] 使用 user_access_token
  ↓
飞书 API: client.calendar.calendar.list()
  ↓
✅ 返回用户个人日历
```

## 🚀 快速开始（5 步配置）

### 步骤 1: 配置飞书应用（2 分钟）

访问: https://open.feishu.cn/app/cli_a9390dcb98ba9cc6

**1.1 添加重定向 URL**

安全设置 → 重定向 URL → 添加:
```
开发环境: http://localhost:3000/api/feishu/oauth/callback
生产环境: https://your-domain.com/api/feishu/oauth/callback
```

**1.2 开启权限**

权限管理 → 搜索并开启:
- ✅ `contact:user.base:readonly` - 获取用户信息
- ✅ `calendar:calendar:readonly` - 查看日历
- ✅ `drive:drive:readonly` - 查看云盘
- ✅ `wiki:wiki:readonly` - 查看知识库

**一键申请**:
```
https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=contact:user.base:readonly,calendar:calendar:readonly,drive:drive:readonly,wiki:wiki:readonly&op_from=openapi&token_type=tenant
```

### 步骤 2: 更新配置文件（1 分钟）

在 `beeclaw.json` 中添加:
```json
{
  "feishu": {
    "enabled": true,
    "appId": "${LARK_BEECLAW_APPID}",
    "appSecret": "${LARK_BEECLAW_AS}",
    "encryptKey": "${LARK_BEECLAW_ENCRYPT_KEY}",
    "verificationToken": "${LARK_BEECLAW_VERIFICATION_TOKEN}",
    "logLevel": "error",
    "useCardV2": true,
    "oauthEnabled": true,
    "oauthRedirectUri": "http://localhost:3000/api/feishu/oauth/callback"
  }
}
```

### 步骤 3: 集成代码（已完成）✅

已创建以下文件:
- ✅ `src/adapter/feishu/oauth.ts` - OAuth 核心逻辑
- ✅ `src/adapter/api/routes/feishu-oauth.ts` - OAuth 回调处理
- ✅ `src/adapter/api/middleware/feishu-auth.ts` - 授权检查中间件

### 步骤 4: 注册 API 路由（1 分钟）

在 `src/adapter/api/index.ts` 中添加:
```typescript
import feishuOAuthRoutes from './routes/feishu-oauth';

// 注册 OAuth 路由
app.route('/api/feishu/oauth', feishuOAuthRoutes);
```

### 步骤 5: 重启服务（1 分钟）

```bash
bun run bot
```

## 🎨 使用示例

### 场景 1: 访问用户日历

**用户**: "查看我的日历"

**Bot 处理流程**:
```
1. [检查授权] getUserToken(openId)
   → 未授权 → 生成授权链接
   → 返回: "需要授权才能访问你的日历，请点击: [授权链接]"

2. [用户授权] 用户点击链接 → 同意授权
   → 回调: /api/feishu/oauth/callback
   → 获取 user_access_token
   → 存储 token

3. [重新请求] 用户: "查看我的日历"
   → [检查授权] getUserToken(openId) → 已授权 ✅
   → [调用 API] client.calendar.calendar.list({
       headers: { Authorization: `Bearer ${user_access_token}` }
     })
   → [返回结果] 显示用户个人日历
```

### 场景 2: 访问用户云盘

**用户**: "列出我的云盘文件"

**Bot 响应**:
```
[未授权]
需要授权才能访问你的云盘
🔗 点击授权: https://open.feishu.cn/...

[用户授权后]
📁 我的云盘
  ├── 文档
  ├── 图片
  └── 项目文件
```

### 场景 3: 访问用户知识库

**用户**: "查看我的知识库"

**Bot 响应**:
```
[已授权]
📚 我的知识库
  ├── 产品文档
  ├── 技术文档
  └── 团队协作
```

## 🔧 技术细节

### 1. OAuth 2.0 授权流程

```typescript
// 1. 生成授权 URL
const authUrl = generateAuthUrl({
  appId: 'cli_xxx',
  redirectUri: 'http://localhost:3000/callback',
  scopes: ['calendar:calendar:readonly'],
  state: 'user_open_id',
});

// 2. 用户授权后，用 code 换 token
const token = await exchangeCodeForToken(client, code);

// 3. 存储 token
await saveUserToken(openId, token);

// 4. 使用 token 调用 API
const calendar = await client.calendar.calendar.list({
  headers: {
    Authorization: `Bearer ${token.accessToken}`,
  },
});
```

### 2. Token 管理

```typescript
// 自动刷新过期 token
const token = await getUserToken(client, openId);

if (token.expiresAt < Date.now() + 300000) {
  // 提前 5 分钟刷新
  const newToken = await refreshUserToken(client, token.refreshToken);
  await saveUserToken(openId, newToken);
}
```

### 3. 中间件集成

```typescript
// 在工具执行前检查授权
app.use('/api/tools/execute', feishuUserAuthMiddleware);

// 中间件自动处理:
// - 检查工具是否需要用户授权
// - 验证用户授权状态
// - 生成授权链接（如未授权）
// - 注入 user_access_token（如已授权）
```

## 📊 权限范围对照表

| 资源类型 | 需要的权限 | 应用授权 | 用户授权 |
|---------|-----------|---------|---------|
| **应用日历** | `calendar:app:readonly` | ✅ 可访问 | ✅ 可访问 |
| **用户日历** | `calendar:calendar:readonly` | ❌ 无法访问 | ✅ 可访问 |
| **应用云盘** | `drive:app:readonly` | ✅ 可访问 | ✅ 可访问 |
| **用户云盘** | `drive:drive:readonly` | ❌ 无法访问 | ✅ 可访问 |
| **应用知识库** | `wiki:app:readonly` | ✅ 可访问 | ✅ 可访问 |
| **用户知识库** | `wiki:wiki:readonly` | ❌ 无法访问 | ✅ 可访问 |

## 🐛 故障排查

### 问题 1: 提示"重定向 URI 不匹配"

**原因**: 回调地址未配置或配置错误

**解决**:
1. 检查飞书开放平台 → 安全设置 → 重定向 URL
2. 确保与 `beeclaw.json` 中的 `oauthRedirectUri` 一致

### 问题 2: 提示"权限不足"

**原因**: 未开启相应的权限范围

**解决**:
1. 访问飞书开放平台 → 权限管理
2. 开启所需权限（如 `calendar:calendar:readonly`）
3. 等待 1-5 分钟权限生效

### 问题 3: Token 过期

**原因**: `user_access_token` 有效期 2 小时

**解决**:
- 系统自动刷新（提前 5 分钟）
- 如刷新失败，用户需重新授权

### 问题 4: 重启后需要重新授权

**原因**: Token 存储在内存缓存中

**解决**:
- 实现 token 持久化（数据库存储）
- TODO: 添加 `src/adapter/feishu/oauth-store.ts`

## 📚 相关文档

- 📖 [用户授权设计](./feishu-user-authorization.md)
- 🔧 [OAuth 配置助手](../scripts/setup-feishu-oauth.ts)
- 📋 [权限配置清单](../docs/feishu-tools-setup.md)
- 🚨 [权限错误排查](../docs/troubleshooting/feishu-permissions-error.md)

## 🎯 下一步

1. **配置飞书应用**: 添加重定向 URL 和权限
2. **更新配置文件**: 在 `beeclaw.json` 中启用 OAuth
3. **重启服务**: `bun run bot`
4. **测试授权**: 在飞书中发送"查看我的日历"
5. **验证成功**: 应该能看到你的个人日历

---

**配置完成后，你的 beeclaw 就能访问用户的私有资源了！** 🎉
