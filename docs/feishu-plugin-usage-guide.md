# 飞书官方插件使用指南

## 快速开始（5分钟）

### 1. 安装插件

插件已经创建在 `plugins/feishu-official/`，Beeclaw 会自动发现。

### 2. 配置飞书凭证

**文件**: `.env`

```bash
# 飞书应用凭证
LARK_BEECLAW_APPID=cli_xxxxxxxxxxxxx
LARK_BEECLAW_AS=your_app_secret_here
```

### 3. 启动 Beeclaw

```bash
# Bot 模式（生产环境）
bun run bot --daemon

# 或 CLI 模式（测试）
bun run cli
```

### 4. 验证插件加载

查看启动日志：

```bash
tail -f logs/bot-out.log | grep -i feishu

# 应该看到：
# 🔌 Plugins: 1 loaded (feishu-official)
# [FeishuOfficial] 🚀 Plugin activated
```

---

## 可用工具

### 1. feishu_send_message

发送文本或富文本消息到飞书聊天。

**参数**:
- `chatId` (string): 聊天 ID
- `message` (string): 消息内容
- `messageType` (string, optional): 消息类型 (`text` 或 `post`)

**示例**:

```bash
# CLI 中测试
bun run cli

> feishu_send_message({
    "chatId": "oc_xxxxxxxxx",
    "message": "Hello from Beeclaw plugin!",
    "messageType": "text"
  })

# 预期返回
{
  "success": true,
  "message": "Message sent successfully"
}
```

**富文本示例**:

```javascript
> feishu_send_message({
    "chatId": "oc_xxxxxxxxx",
    "message": "**Bold** and *italic* text",
    "messageType": "post"
  })
```

---

### 2. feishu_send_card

发送交互式卡片消息。

**参数**:
- `chatId` (string): 聊天 ID
- `card` (object): 卡片内容（JSON 格式）
- `title` (string, optional): 卡片标题

**示例**:

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

---

### 3. feishu_batch_send

批量发送消息到多个聊天。

**参数**:
- `chatIds` (array): 聊天 ID 数组
- `message` (string): 消息内容

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

# 返回
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

---

## 钩子功能

插件自动监听以下事件：

### 1. 消息追踪

```typescript
// 自动记录所有接收的消息
api.on('message_received', async (event) => {
  // 统计消息数量
  // 记录最后消息时间
});
```

**查看统计**:

```javascript
// 在插件内部可以访问
runtime.state.get('feishu_stats')
// { totalMessages: 100, lastMessageTime: "2026-03-06T..." }
```

### 2. 工具使用追踪

```typescript
// 自动追踪所有飞书工具的调用
api.on('before_tool_call', async (event) => {
  // 记录工具使用次数
});
```

**查看使用统计**:

```javascript
runtime.state.get('feishu_tool_usage')
// { feishu_send_message: 50, feishu_batch_send: 5 }
```

### 3. 错误追踪

```typescript
// 自动记录所有工具错误
api.on('after_tool_call', async (event) => {
  // 记录失败的工具调用
});
```

**查看错误日志**:

```javascript
runtime.state.get('feishu_errors')
// [{ tool: 'feishu_send_message', error: '...', timestamp: '...' }]
```

### 4. 会话追踪

```typescript
// 追踪每个飞书会话
api.on('session_start', async (event) => {
  // 初始化会话状态
});

api.on('session_end', async (event) => {
  // 计算会话持续时间
  // 清理会话状态
});
```

### 5. Agent 完成摘要

```typescript
// Agent 完成时生成摘要
api.on('agent_end', async (event) => {
  // 检查是否有错误
  // 生成工具使用报告
});
```

---

## 实际使用场景

### 场景 1: 发送每日报告

```javascript
// 在 Feishu 中对 Bot 说
"请给这三个群发送每日报告：群A、群B、群C"

// Beeclaw 会调用
feishu_batch_send({
  chatIds: ["oc_groupA", "oc_groupB", "oc_groupC"],
  message: "📊 每日报告\n\n系统运行正常\n用户活跃度：85%"
})
```

### 场景 2: 发送交互式通知

```javascript
// 对 Bot 说
"发送一个卡片消息给技术群，内容是系统告警"

// Beeclaw 会调用
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

### 场景 3: 多步骤工作流

```javascript
// 对 Bot 说
"先给产品群发一个需求确认消息，然后给技术群发一个技术评审邀请"

// Beeclaw 会依次调用
feishu_send_message({
  chatId: "oc_product",
  message: "需求确认：新功能 A\n请确认是否开始开发",
  messageType: "post"
})

feishu_send_message({
  chatId: "oc_tech",
  message: "技术评审邀请\n新功能 A 技术方案评审",
  messageType: "post"
})
```

---

## 监控和调试

### 1. 查看实时日志

```bash
# 监控所有飞书相关日志
tail -f logs/bot-out.log | grep -i feishu

# 只看错误
tail -f logs/bot-out.log | grep -i error | grep -i feishu

# 只看工具调用
tail -f logs/bot-out.log | grep "Tool called"
```

### 2. 检查插件状态

```bash
# 在 CLI 中
bun run cli

> // 查看插件是否加载
[FeishuOfficial] 🚀 Plugin activated

> // 测试工具
feishu_send_message({chatId: "test", message: "test"})
```

### 3. 诊断问题

**问题**: 工具未注册

**检查**:
```bash
# 1. 查看插件目录
ls -la plugins/feishu-official/

# 2. 检查配置
cat beeclaw.json | grep -A 5 plugins

# 3. 查看启动日志
head -100 logs/bot-out.log | grep -i plugin
```

**问题**: Feishu client not initialized

**检查**:
```bash
# 1. 验证环境变量
echo $LARK_BEECLAW_APPID
echo $LARK_BEECLAW_AS

# 2. 检查配置文件
cat beeclaw.json | grep -A 3 feishu

# 3. 测试 Feishu 连接
bun run cli
> // 发送测试消息
```

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

---

## 与现有功能的区别

### 现有 Feishu 集成（保留）

```
src/feishu/
├── WebSocket 客户端（底层连接）
├── API 客户端（HTTP 请求）
└── 工具定义（内置工具）
```

**用途**:
- Bot 启动时的 WebSocket 连接
- 接收和发送消息的核心逻辑
- 所有现有的 Feishu 功能

### 插件功能（新增）

```
plugins/feishu-official/
├── 工具扩展（新工具）
├── 钩子监听（监控）
└── 状态管理（统计）
```

**用途**:
- 提供额外的工具（批量发送、卡片消息）
- 监控和统计
- 扩展功能

**关系**: 插件调用现有的 `src/feishu/` 客户端，不重复实现。

---

## 性能建议

### 1. 批量操作

```javascript
// ❌ 不推荐：循环发送
for (const chatId of chatIds) {
  await feishu_send_message({chatId, message});
}

// ✅ 推荐：使用批量工具
await feishu_batch_send({chatIds, message});
```

### 2. 错误处理

```javascript
// 插件自动处理错误，无需额外代码
const result = await feishu_send_message({...});

if (!result.success) {
  // 错误已记录到 runtime.state.get('feishu_errors')
  console.error('发送失败:', result.error);
}
```

### 3. 监控统计

```javascript
// 定期查看统计
setInterval(() => {
  const stats = runtime.state.get('feishu_stats');
  const usage = runtime.state.get('feishu_tool_usage');

  console.log('📊 Stats:', stats);
  console.log('🔧 Usage:', usage);
}, 60000); // 每分钟
```

---

## 总结

**插件提供的功能**:

✅ **3 个工具**:
- `feishu_send_message` - 发送消息
- `feishu_send_card` - 发送卡片
- `feishu_batch_send` - 批量发送

✅ **5 个钩子监听**:
- 消息追踪
- 工具使用追踪
- 错误追踪
- 会话追踪
- Agent 完成摘要

✅ **自动功能**:
- 统计记录
- 错误日志
- 性能监控

**使用步骤**:

1. ✅ 插件已创建在 `plugins/feishu-official/`
2. ✅ 配置 `.env` 中的飞书凭证
3. ✅ 启动 `bun run bot --daemon`
4. ✅ 在 Feishu 中与 Bot 对话
5. ✅ 查看日志验证功能

**完整文档**:
- 集成指南: `docs/feishu-official-plugin-integration.md`
- 开发指南: `docs/feishu-plugin-integration-guide.md`

---

**开始使用**: `bun run bot --daemon` 🚀
