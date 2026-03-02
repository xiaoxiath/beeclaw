# 飞书 Bot 接入指南

Beeclaw 支持接入飞书机器人，让用户可以通过飞书与 AI 助手对话。

## 快速开始

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 点击「开发者后台」→「创建企业自建应用」
3. 进入「应用功能」→「机器人」→ 启用机器人能力

### 2. 配置权限

在「权限管理」添加以下权限：

| 权限名称 | 权限标识 |
|---------|---------|
| 获取与发送单聊、群组消息 | `im:message` |
| 以应用身份发送消息 | `im:message:send_as_bot` |
| 获取用户基本信息 | `contact:user.base:readonly` |

### 3. 获取凭证

在「凭证与基础信息」页面获取：
- **App ID**
- **App Secret**

### 4. 配置环境变量

```bash
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 5. 配置 AI Provider

创建 `beeclaw.json`：

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "your-zhipu-api-key",
      "models": ["glm-4"],
      "default": true
    }
  ]
}
```

### 6. 启动 Bot

```bash
bun run bot
```

看到 `[FeishuWS] Connected successfully` 表示连接成功。

### 7. 测试

在飞书中搜索你的应用，发送消息，机器人会自动回复。

---

## 记忆系统

Bot 会自动加载 `data/memory/` 目录下的记忆文件：

| 文件 | 用途 |
|------|------|
| `USER.md` | 用户信息 |
| `SOUL.md` | AI 人格设定 |
| `facts/*.md` | 事实记忆 |

同一聊天窗口的对话会保持上下文，Bot 会记住之前的对话内容。

---

## 使用方式

Beeclaw 提供两种使用方式：

### CLI 模式（命令行）

```bash
bun run cli
```

交互式命令行界面，支持所有功能：
- 记忆管理 (`/memory`)
- 技能管理 (`/skill`)
- 目标追踪 (`/goal`)
- 提醒功能 (`/reminder`)

### Bot 模式（飞书机器人）

```bash
bun run bot
```

后台运行的飞书机器人，自动响应消息。

---

## 常见问题

### Q: 连接失败？

1. 检查 appId 和 appSecret 是否正确
2. 确保应用已发布并可用
3. 检查网络是否能访问 `open.feishu.cn`

### Q: 收不到消息？

1. 确认机器人能力已启用
2. 确认权限已配置
3. 查看控制台日志中的 `[FeishuWS]` 输出

### Q: 如何支持群聊？

1. 添加群聊相关权限
2. 将机器人添加到群聊
3. 使用 `@机器人` 触发回复

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/bot.ts` | Bot 入口 |
| `src/cli.ts` | CLI 入口 |
| `src/feishu/ws-client.ts` | WebSocket 客户端 |
| `src/routes/proactive.ts` | 集成逻辑 |
