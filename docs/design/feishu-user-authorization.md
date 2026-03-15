# 飞书用户授权实现方案

## 问题分析

### 当前架构的局限性

**使用应用授权（app_access_token）**：
```typescript
// 当前实现
const client = new Client({
  appId: config.appId,
  appSecret: config.appSecret,
});

// 只能访问应用资源
client.calendar.calendar.list()  // ✅ 返回 "Beeclaw" 应用的日历
client.drive.file.listFiles()     // ❌ 无法访问用户云盘
client.wiki.space.list()          // ❌ 无法访问用户知识库
```

**权限范围**：
- ✅ **应用资源**: 应用创建的日历、文档
- ❌ **用户资源**: 用户的个人日历、云盘、知识库
- ❌ **团队资源**: 团队共享的文档、知识库

### 根本原因

**飞书 API 授权类型**：

| 授权类型 | Token | 访问范围 | 适用场景 |
|---------|-------|---------|---------|
| **应用授权** | `app_access_token` | 应用资源 | Bot 主动推送、应用管理 |
| **租户授权** | `tenant_access_token` | 租户共享资源 | 企业级应用（需要审核） |
| **用户授权** | `user_access_token` | 用户私有资源 | 访问用户日历、文档、云盘 |

**当前状态**: 使用应用授权 → 只能访问应用资源

**目标**: 实现用户授权 → 访问用户私有资源

## 解决方案

### 方案 1: OAuth 2.0 网页授权（推荐）⭐

#### 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                     用户授权流程                          │
└─────────────────────────────────────────────────────────┘

1. 用户触发授权
   用户: "查看我的日历"
   Bot: "需要授权，请点击链接"
        ↓
2. 跳转授权页面
   https://open.feishu.cn/open-apis/authen/v1/authorize
   ?app_id=cli_xxx
   &redirect_uri=https://your-domain.com/callback
   &state=feishu-oc_xxx-ou_xxx
   &scope=calendar:calendar:readonly,drive:drive:readonly
        ↓
3. 用户同意授权
   [用户点击"允许"]
        ↓
4. 回调获取 code
   GET /callback?code=abc123&state=feishu-oc_xxx-ou_xxx
        ↓
5. 用 code 换 token
   POST /authen/v1/accessible_token
   { code: "abc123", grant_type: "authorization_code" }
        ↓
6. 存储 user_access_token
   cache.set("user:ou_xxx:token", user_access_token, 7200s)
        ↓
7. 使用 token 调用 API
   client.calendar.calendar.list({
     headers: { Authorization: `Bearer ${user_access_token}` }
   })
```

#### 实现步骤

**步骤 1: 配置飞书应用**

访问 [飞书开放平台](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6):

1. **安全设置** → **重定向 URL**:
   ```
   https://your-domain.com/api/feishu/oauth/callback
   http://localhost:3000/api/feishu/oauth/callback  (开发环境)
   ```

2. **权限管理** → 开启用户授权相关权限:
   ```
   contact:user.base:readonly  - 获取用户基本信息
   calendar:calendar:readonly  - 访问用户日历
   drive:drive:readonly        - 访问用户云盘
   wiki:wiki:readonly          - 访问用户知识库
   ```

**步骤 2: 实现授权服务**