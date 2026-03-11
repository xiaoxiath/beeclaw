# Beeclaw Web UI - Authentication & Setup

## ✅ 已完成功能

### Phase 1 & 2: 基础设施 + Dashboard
- ✅ Hono web server (port 3000)
- ✅ React 19 SPA with TanStack Router
- ✅ Tailwind CSS (via CDN)
- ✅ Health & Stats API
- ✅ Type-safe Hono RPC client

### Phase 7: 认证系统 (提前完成) ✅
- ✅ Token-based authentication
- ✅ Basic Auth (username/password)
- ✅ Login page with beautiful UI
- ✅ Cookie-based session management
- ✅ Protected API routes
- ✅ Auto-redirect to login

---

## 🔐 认证配置

### 方式 1: Token 认证（推荐）

在 `beeclaw.json` 中配置：

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

设置环境变量：
```bash
export WEB_AUTH_TOKEN="your-secret-token-here"
```

启动 bot：
```bash
bun run bot
```

访问 `http://localhost:3000`，输入 token 登录。

---

### 方式 2: Basic Auth (用户名/密码)

在 `beeclaw.json` 中配置：

```json
{
  "web": {
    "enabled": true,
    "port": 3000,
    "host": "0.0.0.0",
    "auth": {
      "level": "basic",
      "basicUsers": [
        {
          "username": "admin",
          "password": "${WEB_ADMIN_PASSWORD}"
        },
        {
          "username": "user",
          "password": "${WEB_USER_PASSWORD}"
        }
      ]
    }
  }
}
```

设置环境变量：
```bash
export WEB_ADMIN_PASSWORD="admin-password"
export WEB_USER_PASSWORD="user-password"
```

---

### 方式 3: 无认证（仅限本地开发）

```json
{
  "web": {
    "enabled": true,
    "port": 3000,
    "host": "0.0.0.0",
    "auth": {
      "level": "none"
    }
  }
}
```

⚠️ **警告**: 仅用于本地开发，不要在生产环境使用！

---

## 🚀 快速开始

### 1. 构建 Web UI

```bash
bun run scripts/build-web.ts
```

输出：
```
🔨 Building Beeclaw Web UI...
✅ React app built successfully!
Outputs:
  - main.js (349.88 KB)
  - main.css (0.84 KB)
✅ Copied index.html to dist/
🎉 Web UI build complete!
```

### 2. 配置认证

编辑 `beeclaw.json`:
```json
{
  "web": {
    "enabled": true,
    "port": 3000,
    "host": "0.0.0.0",
    "auth": {
      "level": "token",
      "token": "my-secret-token"
    }
  }
}
```

### 3. 启动 Bot

```bash
bun run bot
```

输出：
```
🐝 Initializing Beeclaw...
   ✅ Beeclaw initialized
   🌐 Web UI: http://localhost:3000
```

### 4. 访问 Web UI

1. 打开浏览器访问 `http://localhost:3000`
2. 自动跳转到登录页面
3. 输入 token: `my-secret-token`
4. 点击 "Sign In with Token"
5. 登录成功后跳转到 Dashboard

---

## 📊 Dashboard 功能

登录后可以看到：

- **Active Sessions**: 当前活跃的会话数
- **Skills Loaded**: 已加载的技能数
- **Uptime**: 运行时间（秒）
- **Status**: 系统状态

数据每 5 秒自动刷新。

---

## 🧪 API 测试

### 检查认证状态

```bash
curl -s http://localhost:3000/api/auth/me \
  -H "Cookie: auth_token=my-secret-token" | jq .
```

响应：
```json
{
  "authenticated": true,
  "level": "token"
}
```

### 登录

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"token":"my-secret-token"}'
```

响应：
```json
{
  "success": true,
  "message": "Login successful"
}
```

### 登出

```bash
curl -X POST http://localhost:3000/api/auth/logout
```

### 访问受保护的 API

```bash
curl -s http://localhost:3000/api/stats \
  -H "Cookie: auth_token=my-secret-token" | jq .
```

响应：
```json
{
  "sessions": 7,
  "skills": 24,
  "uptime": 120,
  "tokenUsage": 0,
  "status": "ok"
}
```

---

## 🔒 安全最佳实践

### ✅ 推荐

1. **使用环境变量存储 token**
   ```bash
   export WEB_AUTH_TOKEN="$(openssl rand -hex 32)"
   ```

2. **使用强密码**
   ```bash
   export WEB_ADMIN_PASSWORD="$(openssl rand -base64 24)"
   ```

3. **生产环境使用 HTTPS**
   - 配置反向代理（Nginx, Caddy）
   - 启用 SSL/TLS

4. **限制访问IP**（如果可能）
   ```json
   {
     "web": {
       "host": "127.0.0.1"  // 仅本地访问
     }
   }
   ```

5. **定期更换 token**

### ❌ 避免

1. ❌ 在代码中硬编码 token
2. ❌ 在公共网络使用 `auth.level: "none"`
3. ❌ 使用弱密码（如 "123456", "password"）
4. ❌ 在生产环境使用 HTTP

---

## 🎨 UI 功能

### 当前页面

- ✅ **Dashboard**: 实时统计信息
- ⏳ **Chat**: 聊天界面（Phase 4）
- ⏳ **Memory**: 记忆浏览（Phase 5）
- ⏳ **Sessions**: 会话历史（Phase 6）
- ⏳ **Settings**: 设置页面（Phase 7）

### 导航栏

左侧 Sidebar 包含：
- 🏠 Dashboard
- 💬 Chat
- 🧠 Memory
- 📜 Sessions
- ⚙️ Settings

---

## 🐛 故障排查

### 问题 1: UI 显示乱码

**原因**: Tailwind CSS 未加载

**解决**:
1. 检查 index.html 是否包含 Tailwind CDN
2. 清除浏览器缓存
3. 重新构建: `bun run scripts/build-web.ts`

### 问题 2: 无法登录

**原因**: Token 不匹配

**解决**:
1. 检查环境变量: `echo $WEB_AUTH_TOKEN`
2. 检查配置文件: `cat beeclaw.json | jq .web.auth`
3. 确保 token 完全一致（区分大小写）

### 问题 3: API 返回 401

**原因**: Cookie 未设置或过期

**解决**:
1. 重新登录
2. 检查浏览器开发者工具 → Application → Cookies
3. 确认 `auth_token` cookie 存在

### 问题 4: 端口被占用

**原因**: 3000 端口已被其他程序使用

**解决**:
1. 检查占用: `lsof -i :3000`
2. 杀掉进程: `kill -9 <PID>`
3. 或更改端口: `"port": 3001`

---

## 📝 下一步开发

**Phase 3: Skills Management UI** (即将开始)
- Skills CRUD API
- Skills List Page
- Skill Editor with Monaco

**Phase 4: Real-time Chat**
- Chat interface
- SSE streaming
- Tool call visualization

**Phase 5: Memory Browser**
- Memory tree view
- Search functionality
- File viewer

---

## 📄 文件结构

```
src/web/
├── server/
│   ├── index.ts                 # Hono app + middleware
│   ├── middleware/
│   │   └── auth.ts              # 认证中间件
│   └── routes/
│       ├── auth.ts              # 登录/登出 API
│       ├── health.ts            # 健康检查
│       └── stats.ts             # 统计数据
└── client/
    ├── index.html               # SPA 入口 (Tailwind CDN)
    ├── main.tsx                 # React root
    ├── App.tsx                  # Router
    ├── lib/
    │   ├── api.ts               # Hono RPC client
    │   └── utils.ts             # Utilities
    ├── components/
    │   └── layout/
    │       ├── RootLayout.tsx
    │       ├── Sidebar.tsx
    │       └── Header.tsx
    ├── pages/
    │   └── Dashboard.tsx        # Dashboard
    └── dist/                    # 构建输出
        ├── index.html
        ├── main.js
        └── main.css
```

---

## 🎉 完成状态

- ✅ Phase 1: Server + Health/Stats API
- ✅ Phase 2: React SPA + Dashboard
- ⏳ Phase 3: Skills Management UI (下一步)
- ⏳ Phase 4: Real-time Chat
- ⏳ Phase 5: Memory Browser
- ⏳ Phase 6: Session History + DAG
- ✅ Phase 7: Authentication (提前完成)

---

**生成时间**: 2026-03-10
**状态**: Phase 1, 2, 7 完成 ✅
