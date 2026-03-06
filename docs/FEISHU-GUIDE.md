# 飞书集成完整指南

本指南帮助你快速配置和使用 Beeclaw 的飞书集成，包括基础配置和高级插件功能。

---

## 快速开始 (5分钟)

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

创建或编辑 `.env` 文件：

```bash
# 飞书应用凭证
LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
LARK_BEECLAW_AS="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# AI Provider（示例）
ZHIPU_API_KEY="your-zhipu-api-key"
```

创建 `beeclaw.json` 配置 AI Provider：

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

### 5. 启动 Bot

```bash
# Bot 模式（飞书机器人）
bun run bot

# Bot 模式 + 守护进程（启用主动任务）
bun run bot --daemon

# 生产环境（PM2）
bun run pm2:start
```

### 6. 验证连接

启动后查看日志：

```bash
# 实时查看日志
tail -f logs/bot-out.log

# 应该看到：
# [FeishuWS] Connected successfully
# 🔌 Plugins: 1 loaded (feishu-official)
# [FeishuOfficial] 🚀 Plugin activated
```

### 7. 测试

在飞书中搜索你的应用，发送消息，机器人会自动回复。

---

## 插件系统 (新功能)

### 概述

Beeclaw 内置了飞书官方插件包装器，提供扩展功能和监控能力。

**核心特性**:
- 3 个核心工具（消息、卡片、批量发送）
- 5 个钩子监听（消息、工具、错误、会话、Agent）
- 自动统计和监控
- 无需额外配置，开箱即用

**架构**:

```
现有集成（保留）          插件功能（新增）
src/feishu/              plugins/feishu-official/
├── WebSocket 客户端      ├── 工具扩展
├── API 客户端            ├── 钩子监听
└── 内置工具              └── 状态管理
```

**关系**: 插件调用现有的 `src/feishu/` 客户端，不重复实现底层连接。

---

## 可用工具

### feishu_send_message

发送文本或富文本消息到飞书聊天。

**参数**:
- `chatId` (string): 聊天 ID
- `message` (string): 消息内容
- `messageType` (string, optional): 消息类型
  - `text`: 纯文本（默认）
  - `post`: 富文本（支持 Markdown）

**返回**:
```javascript
{
  "success": true,
  "message": "Message sent successfully"
}
```

**示例 1: 发送文本消息**

```bash
# CLI 中测试
bun run cli

> feishu_send_message({
    "chatId": "oc_xxxxxxxxx",
    "message": "Hello from Beeclaw plugin!",
    "messageType": "text"
  })
```

**示例 2: 发送富文本**

```javascript
> feishu_send_message({
    "chatId": "oc_xxxxxxxxx",
    "message": "**Bold** and *italic* text\n\n- Item 1\n- Item 2",
    "messageType": "post"
  })
```

---

### feishu_send_card

发送交互式卡片消息。

**参数**:
- `chatId` (string): 聊天 ID
- `card` (object): 卡片内容（JSON 格式）
- `title` (string, optional): 卡片标题

**返回**:
```javascript
{
  "success": true,
  "message": "Card sent successfully"
}
```

**示例 1: 使用模板**

```javascript
> feishu_send_card({
    "chatId": "oc_xxxxxxxxx",
    "title": "📊 Daily Report",
    "card": {
      "type": "template",
      "data": {
        "template_id": "your_template_id",
        "template_variable": {
          "title": "Daily Report",
          "content": "All systems operational"
        }
      }
    }
  })
```

**示例 2: 自定义卡片**

```javascript
> feishu_send_card({
    "chatId": "oc_xxxxxxxxx",
    "title": "⚠️ 系统告警",
    "card": {
      "config": {
        "wide_screen_mode": true
      },
      "elements": [
        {
          "tag": "div",
          "text": {
            "content": "CPU 使用率超过 80%",
            "tag": "lark_md"
          }
        },
        {
          "tag": "action",
          "actions": [
            {
              "tag": "button",
              "text": { "content": "查看详情", "type": "plain_text" },
              "url": "https://monitor.example.com"
            }
          ]
        }
      ]
    }
  })
```

---

### feishu_batch_send

批量发送消息到多个聊天。

**参数**:
- `chatIds` (array): 聊天 ID 数组
- `message` (string): 消息内容

**返回**:
```javascript
{
  "success": true,
  "sent": 3,
  "failed": 0,
  "results": [
    { "chatId": "oc_xxxxx1", "success": true },
    { "chatId": "oc_xxxxx2", "success": true },
    { "chatId": "oc_xxxxx3", "success": true }
  ]
}
```

**示例**:

```javascript
> feishu_batch_send({
    "chatIds": [
      "oc_xxxxx1",
      "oc_xxxxx2",
      "oc_xxxxx3"
    ],
    "message": "Broadcast message to all teams"
  })
```

---

## 钩子功能

插件自动监听以下事件，提供监控和统计能力。

### 1. 消息追踪

自动记录所有接收的消息。

**功能**:
- 统计消息数量
- 记录最后消息时间

**查看统计**:

```javascript
// 在插件内部可以访问
runtime.state.get('feishu_stats')
// { totalMessages: 100, lastMessageTime: "2026-03-06T..." }
```

---

### 2. 工具使用追踪

自动追踪所有飞书工具的调用。

**功能**:
- 记录每个工具的使用次数
- 统计成功率

**查看使用统计**:

```javascript
runtime.state.get('feishu_tool_usage')
// { feishu_send_message: 50, feishu_send_card: 10, feishu_batch_send: 5 }
```

---

### 3. 错误追踪

自动记录所有工具错误。

**功能**:
- 记录失败的工具调用
- 保存错误详情和时间戳

**查看错误日志**:

```javascript
runtime.state.get('feishu_errors')
// [
//   { tool: 'feishu_send_message', error: '...', timestamp: '...' },
//   { tool: 'feishu_batch_send', error: '...', timestamp: '...' }
// ]
```

---

### 4. 会话追踪

追踪每个飞书会话的生命周期。

**功能**:
- 初始化会话状态
- 计算会话持续时间
- 清理会话状态

---

### 5. Agent 完成摘要

Agent 完成时生成摘要。

**功能**:
- 检查是否有错误
- 生成工具使用报告
- 计算总耗时

---

## 使用场景

### 场景 1: 发送每日报告

**用户**: "请给这三个群发送每日报告：群A、群B、群C"

**Beeclaw 调用**:

```javascript
feishu_batch_send({
  chatIds: ["oc_groupA", "oc_groupB", "oc_groupC"],
  message: "📊 每日报告\n\n系统运行正常\n用户活跃度：85%"
})
```

---

### 场景 2: 发送交互式通知

**用户**: "发送一个卡片消息给技术群，内容是系统告警"

**Beeclaw 调用**:

```javascript
feishu_send_card({
  chatId: "oc_tech_group",
  title: "⚠️ 系统告警",
  card: {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: "div",
        text: { content: "CPU 使用率超过 80%", tag: "lark_md" }
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { content: "查看详情", type: "plain_text" },
            url: "https://monitor.example.com"
          }
        ]
      }
    ]
  }
})
```

---

### 场景 3: 多步骤工作流

**用户**: "先给产品群发一个需求确认消息，然后给技术群发一个技术评审邀请"

**Beeclaw 依次调用**:

```javascript
// 步骤 1
feishu_send_message({
  chatId: "oc_product",
  message: "需求确认：新功能 A\n请确认是否开始开发",
  messageType: "post"
})

// 步骤 2
feishu_send_message({
  chatId: "oc_tech",
  message: "技术评审邀请\n新功能 A 技术方案评审",
  messageType: "post"
})
```

---

## 监控和调试

### 查看实时日志

```bash
# 监控所有飞书相关日志
tail -f logs/bot-out.log | grep -i feishu

# 只看错误
tail -f logs/bot-out.log | grep -i error | grep -i feishu

# 只看工具调用
tail -f logs/bot-out.log | grep "Tool called"

# 只看消息统计
tail -f logs/bot-out.log | grep "feishu_stats"
```

**日志标记**:
- `[FeishuWS]` - WebSocket 连接状态
- `[FeishuOfficial]` - 插件活动
- `Tool called: feishu_*` - 工具调用
- `feishu_stats` - 消息统计
- `feishu_errors` - 错误日志

---

### 检查插件状态

**方法 1: 查看启动日志**

```bash
head -100 logs/bot-out.log | grep -i plugin

# 应该看到：
# 🔌 Plugins: 1 loaded (feishu-official)
# [FeishuOfficial] 🚀 Plugin activated
```

**方法 2: CLI 测试**

```bash
bun run cli

> // 测试工具
feishu_send_message({
  chatId: "test_chat_id",
  message: "Plugin test",
  messageType: "text"
})

// 如果工具已注册，会返回结果
// 如果工具未注册，会提示 "Unknown tool"
```

---

### 诊断问题

#### 问题 1: 插件工具未注册

**症状**:
```
Unknown tool: feishu_send_message
```

**检查步骤**:

```bash
# 1. 验证插件目录
ls -la plugins/feishu-official/
# 应该看到: plugin.js, package.json

# 2. 检查配置
cat beeclaw.json | grep -A 5 plugins
# 确保没有 "disabledPlugins": ["feishu-official"]

# 3. 查看启动日志
head -100 logs/bot-out.log | grep -i plugin
# 应该看到插件加载信息
```

**解决方案**:
- 确保 `plugins.enabled` 为 `true`
- 确保插件未在 `disabledPlugins` 列表中
- 重启 Bot: `bun run pm2:restart`

---

#### 问题 2: Feishu client not initialized

**症状**:
```
Error: Feishu client not initialized
```

**检查步骤**:

```bash
# 1. 验证环境变量
echo $LARK_BEECLAW_APPID
echo $LARK_BEECLAW_AS
# 应该输出配置的值

# 2. 检查 .env 文件
cat .env | grep LARK
# 确保格式正确，无多余空格

# 3. 测试 Feishu 连接
bun run cli
> // 尝试发送测试消息
```

**解决方案**:
- 确保 `.env` 文件存在且格式正确
- 确保环境变量已加载（重启终端或使用 `source .env`）
- 验证 App ID 和 Secret 是否正确

---

#### 问题 3: 连接失败

**症状**:
```
[FeishuWS] Connection failed
```

**检查步骤**:

```bash
# 1. 检查网络
curl -I https://open.feishu.cn

# 2. 验证应用状态
# 访问飞书开放平台，确认应用已发布

# 3. 检查权限
# 确认已添加 im:message, im:message:send_as_bot 权限
```

**解决方案**:
- 检查网络是否能访问 `open.feishu.cn`
- 确保应用已发布并可用
- 验证 appId 和 appSecret 是否正确
- 检查权限配置

---

#### 问题 4: 收不到消息

**症状**:
Bot 启动成功，但飞书发送消息无响应

**检查步骤**:

```bash
# 1. 确认机器人能力已启用
# 飞书开放平台 → 应用功能 → 机器人 → 已启用

# 2. 确认权限已配置
# 权限管理 → im:message 已添加

# 3. 查看接收日志
tail -f logs/bot-out.log | grep "Message received"
```

**解决方案**:
- 确保机器人能力已启用
- 确保权限已配置并生效
- 确保在飞书中与 Bot 建立了会话（首次需要主动发起）

---

## 记忆系统

Bot 会自动加载 `data/memory/` 目录下的记忆文件：

| 文件 | 用途 | 更新频率 |
|------|------|---------|
| `USER.md` | 用户信息 | 手动更新 |
| `SOUL.md` | AI 人格设定 | 很少变化 |
| `facts/*.md` | 事实记忆 | 每日/每周 |
| `knowledge/*.md` | 知识记忆 | 每月/每年 |

**上下文保持**:
- 同一聊天窗口的对话会保持上下文
- Bot 会记住之前的对话内容
- 支持跨 CLI 和 Bot 的记忆共享

---

## 高级配置

### 禁用插件

**文件**: `beeclaw.json`

```json
{
  "plugins": {
    "enabled": true,
    "disabledPlugins": ["feishu-official"]
  }
}
```

**效果**:
- 插件不会加载
- 插件工具不可用
- 钩子监听停止

---

### 自定义配置

**文件**: `beeclaw.json`

```json
{
  "plugins": {
    "pluginConfigs": {
      "feishu-official": {
        "enabled": true,
        "batchSize": 50,
        "timeout": 30000,
        "retryAttempts": 3
      }
    }
  }
}
```

**参数说明**:
- `batchSize`: 批量发送时的批次大小（默认: 50）
- `timeout`: 请求超时时间（毫秒，默认: 30000）
- `retryAttempts`: 失败重试次数（默认: 3）

---

### 性能建议

#### 1. 使用批量操作

```javascript
// ❌ 不推荐：循环发送
for (const chatId of chatIds) {
  await feishu_send_message({chatId, message});
}

// ✅ 推荐：使用批量工具
await feishu_batch_send({chatIds, message});
```

**原因**:
- 批量工具减少网络请求
- 插件自动处理并发和错误
- 性能提升约 5-10 倍

---

#### 2. 错误处理

```javascript
// 插件自动处理错误，无需额外代码
const result = await feishu_send_message({...});

if (!result.success) {
  // 错误已记录到 runtime.state.get('feishu_errors')
  console.error('发送失败:', result.error);
}
```

**最佳实践**:
- 始终检查 `result.success`
- 记录或报告错误
- 查看错误日志分析原因

---

#### 3. 监控统计

```javascript
// 定期查看统计
setInterval(() => {
  const stats = runtime.state.get('feishu_stats');
  const usage = runtime.state.get('feishu_tool_usage');
  const errors = runtime.state.get('feishu_errors');

  console.log('📊 Stats:', stats);
  console.log('🔧 Usage:', usage);
  console.log('❌ Errors:', errors);
}, 60000); // 每分钟
```

**用途**:
- 监控消息量
- 分析工具使用情况
- 发现异常和错误

---

## 常见问题

### Q: 连接失败？

**检查清单**:
1. App ID 和 App Secret 是否正确
2. 应用是否已发布并可用
3. 网络是否能访问 `open.feishu.cn`
4. 防火墙是否阻止了 WebSocket 连接

**调试命令**:

```bash
# 测试网络连接
curl -I https://open.feishu.cn

# 查看连接日志
tail -f logs/bot-out.log | grep -i feishuws
```

---

### Q: 收不到消息？

**检查清单**:
1. 机器人能力是否已启用
2. 权限 `im:message` 是否已配置
3. 是否与 Bot 建立了会话
4. 日志中是否有 "Message received"

**调试命令**:

```bash
# 查看消息接收日志
tail -f logs/bot-out.log | grep "Message received"

# 查看所有飞书相关日志
tail -f logs/bot-out.log | grep -i feishu
```

---

### Q: 如何支持群聊？

**步骤**:
1. 添加群聊相关权限（`im:message`, `im:chat:readonly`）
2. 将机器人添加到群聊
3. 使用 `@机器人` 触发回复

**注意**:
- 群聊需要 `@机器人` 才会触发回复
- 群聊消息的 `chatId` 格式为 `oc_xxxxx`

---

### Q: 插件工具未注册？

**症状**: `Unknown tool: feishu_send_message`

**检查步骤**:

```bash
# 1. 验证插件加载
head -100 logs/bot-out.log | grep -i plugin

# 2. 检查配置
cat beeclaw.json | grep -A 5 plugins

# 3. 测试工具
bun run cli
> feishu_send_message({chatId: "test", message: "test"})
```

**解决方案**:
- 确保 `plugins.enabled` 为 `true`
- 确保插件未在 `disabledPlugins` 中
- 重启 Bot

---

### Q: 如何查看插件统计？

**方法 1: 日志**

```bash
# 查看统计日志
tail -f logs/bot-out.log | grep "feishu_stats"
```

**方法 2: 代码**

```javascript
// 在插件内部
const stats = runtime.state.get('feishu_stats');
const usage = runtime.state.get('feishu_tool_usage');
const errors = runtime.state.get('feishu_errors');
```

---

### Q: 如何调试插件问题？

**步骤**:

```bash
# 1. 查看插件加载日志
head -100 logs/bot-out.log | grep -i plugin

# 2. 查看工具调用日志
tail -f logs/bot-out.log | grep "Tool called: feishu"

# 3. 查看错误日志
tail -f logs/bot-out.log | grep -i error | grep -i feishu

# 4. 测试单个工具
bun run cli
> feishu_send_message({chatId: "test", message: "test"})
```

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/bot.ts` | Bot 入口 |
| `src/cli.ts` | CLI 入口 |
| `src/feishu/ws-client.ts` | WebSocket 客户端 |
| `src/feishu/client.ts` | API 客户端 |
| `plugins/feishu-official/` | 飞书官方插件 |
| `docs/feishu-official-plugin-integration.md` | 插件集成文档 |
| `docs/feishu-plugin-integration-guide.md` | 插件开发指南 |

---

## 总结

**基础功能**:
- WebSocket 连接到飞书
- 接收和发送消息
- 记忆系统支持

**插件功能（新增）**:
- 3 个工具: `feishu_send_message`, `feishu_send_card`, `feishu_batch_send`
- 5 个钩子: 消息追踪、工具使用、错误追踪、会话追踪、Agent 摘要
- 自动统计和监控

**使用步骤**:
1. ✅ 创建飞书应用并配置权限
2. ✅ 配置环境变量（`.env`）
3. ✅ 启动 Bot: `bun run bot --daemon`
4. ✅ 在飞书中与 Bot 对话
5. ✅ 查看日志验证功能

**开始使用**: `bun run bot --daemon` 🚀
