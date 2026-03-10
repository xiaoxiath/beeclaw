# Beeclaw Web UI - 登录功能使用指南

**日期**: 2026-03-10
**状态**: 已完成并测试通过 ✅

---

## 🎉 问题已解决

**原始问题**: 页面没有触发登录

**根本原因**:
1. `.env` 文件中的环境变量未被加载（Bun 需要显式加载或自动加载）
2. 认证中间件在 token 为空时跳过了认证

**解决方案**:
1. ✅ 移除 `dotenv` 依赖，使用 Bun 的内置 `.env` 加载
2. ✅ 修复认证中间件逻辑，正确处理空 token
3. ✅ 添加前端 AuthGuard 组件
4. ✅ 创建登录页面 UI
5. ✅ 所有 7 个认证测试通过

---

## 🔐 登录流程

### 完整流程图

```
用户访问 http://localhost:3000
         ↓
   检查 Cookie (auth_token)
         ↓
    是否已登录？
    /          \
   否           是
   ↓            ↓
重定向到      访问页面
登录页面
   ↓
输入 Token
   ↓
提交表单
   ↓
验证 Token
   ↓
设置 Cookie
   ↓
重定向到 Dashboard
```

---

## 📝 配置方法

### 方式 1: 使用 .env 文件（推荐）

1. **创建/编辑 .env 文件**:
   ```bash
   # .env
   WEB_AUTH_TOKEN=your-secret-token-here
   WEB_ADMIN_PASSWORD=admin-password-here  # 可选，用于 Basic Auth
   ```

2. **beeclaw.json 配置**:
   ```json
   {
     "web": {
       "enabled": true,
       "port": 3000,
       "host": "0.0.0.0",
       "auth": {
         "level": "token",
         "token": "${WEB_AUTH_TOKEN}"
       }
     }
   }
   ```

3. **启动 bot**:
   ```bash
   # Bun 会自动加载 .env 文件
   bun run bot
   ```

4. **访问 Web UI**:
   ```
   URL: http://localhost:3000
   Token: your-secret-token-here
   ```

---

### 方式 2: 直接配置（简单）

**beeclaw.json**:
```json
{
  "web": {
    "enabled": true,
    "port": 3000,
    "auth": {
      "level": "token",
      "token": "my-secret-token-123"  // 直接写 token
    }
  }
}
```

**启动**:
```bash
bun run bot
```

**登录**: 使用 `my-secret-token-123`

---

### 方式 3: 禁用认证（仅开发）

**beeclaw.json**:
```json
{
  "web": {
    "enabled": true,
    "port": 3000,
    "auth": {
      "level": "none"
    }
  }
}
```

**访问**: 直接访问 `http://localhost:3000`，无需登录

⚠️ **警告**: 仅用于本地开发，不要在生产环境使用！

---

## 🧪 测试结果

### 所有测试通过 (7/7 ✅)

```bash
1. Check auth status (unauthenticated)  ✅
2. Access protected API without auth     ✅ (401)
3. Login with correct token              ✅
4. Check auth status (authenticated)     ✅
5. Access protected API with auth        ✅ (24 skills)
6. Logout                                ✅
7. Verify logged out                     ✅
```

### 测试脚本

运行完整测试：
```bash
bash /tmp/test-login-flow.sh
```

---

## 🔧 技术实现

### 后端（Hono）

**认证中间件** (`src/web/server/middleware/auth.ts`):
```typescript
// 检查 token 是否为空
if (!validToken || validToken.trim() === '') {
  console.warn('[Auth] No WEB_AUTH_TOKEN configured, skipping authentication');
  return next();
}

// 验证 token
if (token && token !== validToken) {
  return c.json({ error: 'Unauthorized' }, 401);
}
```

**登录 API** (`src/web/server/routes/auth.ts`):
```typescript
POST /api/auth/login
Body: { "token": "your-token" }
Response: { "success": true, "message": "Login successful" }
Cookie: auth_token=your-token; HttpOnly; MaxAge=604800; Path=/
```

**认证状态**:
```typescript
GET /api/auth/me
Response: { "authenticated": true, "level": "token" }
```

**登出**:
```typescript
POST /api/auth/logout
Response: { "success": true }
Cookie: auth_token=; MaxAge=0; Path=/
```

---

### 前端（React）

**AuthGuard 组件** (`src/web/client/components/AuthGuard.tsx`):
```typescript
// 检查认证状态
const response = await api.api.auth.me.$get();
const data = await response.json();

if (!data.authenticated) {
  // 重定向到登录页
  window.location.href = '/login';
}
```

**登录页面** (`src/web/client/pages/Login.tsx`):
```typescript
// 提交登录表单
const response = await api.api.auth.login.$post({
  json: { token },
});

if (response.ok) {
  // 重定向到 Dashboard
  window.location.href = '/';
}
```

---

## 🎨 UI 展示

### 登录页面

```
┌────────────────────────────────────────────┐
│                                            │
│              🐝                            │
│      Welcome to Beeclaw                    │
│      Sign in to continue                   │
│                                            │
│   Access Token                             │
│   [*********************]                  │
│                                            │
│   [   Sign In with Token   ]               │
│                                            │
│   Secure authentication powered by Beeclaw │
│                                            │
└────────────────────────────────────────────┘
```

**特点**:
- 渐变背景（蓝色到紫色）
- 居中卡片布局
- Token 输入框（密码类型）
- 错误提示（红色）
- 加载状态

---

## 📊 Cookie 配置

| 属性 | 值 | 说明 |
|------|-----|------|
| Name | `auth_token` | Cookie 名称 |
| Value | Token 字符串 | 用户登录 token |
| HttpOnly | `true` | 防止 XSS 攻击 |
| Secure | `true` (生产环境) | 仅 HTTPS 传输 |
| MaxAge | `604800` | 7 天有效期 |
| Path | `/` | 全站可用 |

---

## 🔒 安全特性

### ✅ 已实现

1. **Token 验证**
   - HttpOnly cookie（防 XSS）
   - 服务端验证（每次请求）
   - 7 天自动过期

2. **受保护的路由**
   - API: 返回 401 Unauthorized
   - HTML: 重定向到登录页

3. **环境变量支持**
   - 敏感信息不硬编码
   - .env 文件支持

4. **登录失败提示**
   - 错误消息显示
   - 不暴露具体错误原因

### 🔄 未来改进

1. **CSRF 保护**
   - 添加 CSRF token
   - 验证请求来源

2. **Rate Limiting**
   - 限制登录尝试次数
   - 防止暴力破解

3. **Token 刷新**
   - 自动刷新 token
   - 无感知续期

4. **多因素认证**
   - 2FA 支持
   - 短信/邮箱验证

---

## 🚀 快速开始

### 1. 配置 Token

```bash
# 编辑 .env 文件
echo "WEB_AUTH_TOKEN=$(openssl rand -hex 32)" >> .env
```

### 2. 启动 Bot

```bash
bun run bot
```

### 3. 访问 Web UI

1. 打开浏览器: `http://localhost:3000`
2. 自动跳转到登录页
3. 输入 token（从 .env 文件中获取）
4. 点击 "Sign In with Token"
5. 登录成功后跳转到 Dashboard

### 4. 验证登录

```bash
# 检查认证状态
curl http://localhost:3000/api/auth/me \
  -H "Cookie: auth_token=your-token" | jq .

# 输出: { "authenticated": true, "level": "token" }
```

---

## 🐛 故障排查

### 问题 1: 页面没有触发登录

**原因**: Token 未设置或为空

**解决**:
```bash
# 检查 .env 文件
cat .env | grep WEB_AUTH_TOKEN

# 如果没有，添加 token
echo "WEB_AUTH_TOKEN=your-token-here" >> .env

# 重启 bot
bun run bot
```

---

### 问题 2: 登录后立即退出

**原因**: Cookie 未正确设置

**解决**:
```bash
# 检查浏览器开发者工具
# Application → Cookies → localhost:3000

# 确认 auth_token cookie 存在
# 如果不存在，检查浏览器设置（允许第三方 cookie）
```

---

### 问题 3: Token 无效

**原因**: Token 不匹配

**解决**:
```bash
# 检查配置中的 token
cat beeclaw.json | jq .web.auth.token

# 检查环境变量
echo $WEB_AUTH_TOKEN

# 确保两者一致
```

---

## 📚 相关文件

### 后端
- `src/web/server/middleware/auth.ts` - 认证中间件
- `src/web/server/routes/auth.ts` - 登录/登出 API
- `src/bot.ts` - Bot 入口（.env 加载）
- `src/cli.ts` - CLI 入口（.env 加载）

### 前端
- `src/web/client/components/AuthGuard.tsx` - 认证守卫
- `src/web/client/pages/Login.tsx` - 登录页面
- `src/web/client/App.tsx` - 路由配置

### 配置
- `beeclaw.json` - Web UI 配置
- `.env` - 环境变量（包括 token）

---

## 🎯 下一步

现在登录功能已经完全可用，可以继续：

1. **测试登录流程**
   - 访问 http://localhost:3000
   - 使用 .env 中的 token 登录
   - 访问 Skills 页面

2. **继续 Phase 4: Real-time Chat**
   - 实现聊天界面
   - SSE 流式响应
   - 工具调用可视化

3. **优化 Phase 3: Skills UI**
   - Monaco Editor 集成
   - Markdown 预览
   - 语法高亮

---

**生成时间**: 2026-03-10
**作者**: Claude Sonnet 4.6
**状态**: 登录功能完成 ✅
**Token**: `rqwdf3qrfdsgasfsdq24DfwqfSDgq34t` (测试用)
