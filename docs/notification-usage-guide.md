# Notification_send 使用指南

## ✅ 功能状态

**notification_send 已经可以给 CLI 和 Bot (Feishu) 使用！**

---

## 📊 投递机制

### CLI 投递
- ✅ **已配置**: CLI 启动时自动注册 delivery handler
- ✅ **投递方式**: 直接打印到控制台（带优先级 emoji）
- ✅ **默认 channel**: `['cli']` 是默认值

### Feishu (Bot) 投递
- ✅ **已配置**: Bot 启动时自动注册 Feishu handler
- ⚠️ **需要参数**: 必须在 metadata 中提供 `feishuChatId`
- ✅ **投递方式**: 通过飞书消息 API 发送

---

## 🔧 使用方法

### 1. 发送通知到 CLI

```typescript
// LLM 调用
notification_send({
  message: '任务完成提醒',
  priority: 'normal',  // low, normal, high, urgent
  category: 'task'
})

// 代码调用
await executeProactiveTool('notification_send', {
  message: '服务器CPU使用率超过90%',
  priority: 'urgent',
  category: 'alert'
})
```

**效果**:
```
🟢 任务完成提醒

🔴 服务器CPU使用率超过90%
```

### 2. 发送通知到 Feishu

```typescript
// LLM 调用
notification_send({
  message: '重要会议提醒',
  priority: 'high',
  category: 'meeting',
  channels: ['feishu'],
  metadata: {
    feishuChatId: 'oc_xxxxxxxxxx'  // 必须提供
  }
})

// 代码调用
await executeProactiveTool('notification_send', {
  message: '部署完成通知',
  priority: 'normal',
  channels: ['feishu'],
  metadata: {
    feishuChatId: chatId
  }
})
```

### 3. 同时发送到多个渠道

```typescript
notification_send({
  message: '紧急系统告警',
  priority: 'urgent',
  channels: ['cli', 'feishu'],
  metadata: {
    feishuChatId: 'oc_xxxxxxxxxx'
  }
})
```

---

## 📋 参数说明

### 必需参数
- `message` (string): 通知内容

### 可选参数
- `priority` (string): 优先级
  - `'low'` - 低优先级 (⚪)
  - `'normal'` - 普通优先级 (🟢) [默认]
  - `'high'` - 高优先级 (🟠)
  - `'urgent'` - 紧急 (🔴)

- `category` (string): 分类标签
  - 示例: `'alert'`, `'reminder'`, `'meeting'`, `'task'`

- `channels` (array): 投递渠道
  - `['cli']` - 仅 CLI [默认]
  - `['feishu']` - 仅飞书
  - `['cli', 'feishu']` - 同时投递

- `scheduledFor` (string): 定时发送
  - ISO 格式时间戳: `'2026-03-04T09:00:00'`

- `expiresAt` (string): 过期时间
  - ISO 格式时间戳: `'2026-03-04T10:00:00'`

- `metadata` (object): 元数据
  - `feishuChatId` (string): 飞书群聊 ID [发送到 Feishu 时必需]
  - 其他自定义字段

---

## 🎯 使用场景示例

### 场景 1: CLI 简单提醒
```
用户: "10分钟后提醒我保存文件"
LLM: notification_send({
  message: '保存文件提醒',
  priority: 'normal',
  scheduledFor: '2026-03-03T15:30:00'
})
```

### 场景 2: Feishu 重要会议
```
用户: "明天9点开会，在飞书群里提醒大家"
LLM: notification_send({
  message: '明天上午9点重要会议',
  priority: 'high',
  category: 'meeting',
  channels: ['feishu'],
  scheduledFor: '2026-03-04T09:00:00',
  metadata: {
    feishuChatId: 'oc_xxxxxxxxxx'
  }
})
```

### 场景 3: 紧急告警（多渠道）
```
系统检测到异常:
LLM: notification_send({
  message: '⚠️ 数据库连接异常，请立即处理',
  priority: 'urgent',
  category: 'alert',
  channels: ['cli', 'feishu'],
  metadata: {
    feishuChatId: 'oc_xxxxxxxxxx',
    error: 'Database connection timeout'
  }
})
```

### 场景 4: 任务完成通知
```
LLM 完成后台任务:
notification_send({
  message: '✅ 深度分析报告已完成',
  priority: 'normal',
  category: 'task',
  channels: ['cli']
})
```

---

## 🔄 通知生命周期

### 1. 创建通知
```
notification_send() → 创建并存储
                    → 尝试立即投递
                    → 如果成功：标记为 delivered
                    → 如果失败：保留在 pending 队列
```

### 2. 待处理通知
```
CLI 启动时 → pushPendingNotifications()
           → 投递所有 pending 通知
           → 标记为 delivered
```

### 3. 管理通知
```
notification_list()        → 查看待处理通知
notification_mark_read()   → 标记为已读
notification_delete()      → 删除通知
notification_history()     → 查看历史
notification_stats()       → 查看统计
```

---

## ⚠️ 重要注意事项

### 1. Feishu 投递要求
```typescript
// ❌ 错误 - 缺少 feishuChatId
notification_send({
  message: '测试',
  channels: ['feishu']  // 会失败
})

// ✅ 正确 - 提供 feishuChatId
notification_send({
  message: '测试',
  channels: ['feishu'],
  metadata: {
    feishuChatId: 'oc_xxxxxxxxxx'  // 必需
  }
})
```

### 2. Channel 参数
```typescript
// 默认行为 - 只发送到 CLI
notification_send({ message: '测试' })

// 明确指定
notification_send({
  message: '测试',
  channels: ['cli']  // 只发送到 CLI
})

// 多渠道
notification_send({
  message: '测试',
  channels: ['cli', 'feishu'],  // 同时发送
  metadata: { feishuChatId: 'xxx' }
})
```

### 3. 定时投递
```typescript
// scheduledFor 不会立即投递
// 通知会保留在 pending 队列，直到到达指定时间
// 到达时间后，需要调用 pushPendingNotifications() 或等待下次 CLI 启动

notification_send({
  message: '定时提醒',
  scheduledFor: '2026-03-04T09:00:00'
})
```

---

## 🆚 notification_send vs schedule_once

| 特性 | notification_send | schedule_once |
|------|-------------------|---------------|
| **持久化** | ✅ 永久存储 | ❌ 执行后删除 |
| **追踪** | ✅ 完整历史 | ❌ 无 |
| **重试** | ✅ 最多3次 | ❌ 无 |
| **管理** | ✅ 可查询/删除/标记 | ❌ 无法管理 |
| **多渠道** | ✅ CLI + Feishu | ❌ 单一 |
| **优先级** | ✅ 4级 | ❌ 无 |
| **定时** | ✅ scheduledFor | ✅ delay_seconds |
| **过期** | ✅ expiresAt | ❌ 无 |
| **适用场景** | 重要提醒、需要追踪 | 一次性简单提醒 |

### 使用建议

**使用 notification_send 当**:
- ✅ 重要提醒，需要确保送达
- ✅ 需要追踪投递状态
- ✅ 需要多渠道投递
- ✅ 需要后续管理（取消/查询）
- ✅ 跨 session 持久化

**使用 schedule_once 当**:
- ✅ 一次性简单提醒
- ✅ 不需要追踪状态
- ✅ 执行后自动清理即可
- ✅ 轻量级延迟任务

---

## 🚀 快速开始

### CLI 中使用
```
用户: "创建一个通知提醒我明天开会"
LLM: 我来为你创建一个会议提醒通知。

[调用 notification_send]

notification_send({
  message: '明天上午10点会议',
  priority: 'high',
  category: 'meeting',
  scheduledFor: '2026-03-04T10:00:00'
})

✅ 已创建会议提醒通知，将在明天上午10点投递。
```

### Feishu 中使用
```
用户: "在群里提醒大家下周一是截止日期"
LLM: 我来在飞书群里创建一个截止日期提醒。

[调用 notification_send]

notification_send({
  message: '⚠️ 提醒：下周一（3月8日）是项目截止日期',
  priority: 'high',
  category: 'deadline',
  channels: ['feishu'],
  metadata: {
    feishuChatId: 'oc_xxxxxxxxxx'  // 当前群聊ID
  }
})

✅ 已在群里发送截止日期提醒！
```

---

## 📚 相关文档

- [Tools 简化和增强方案](./tools-simplification-plan.md)
- [实施完成报告](./tools-simplification-complete.md)
- [Proactive 系统文档](../src/proactive/README.md)

---

## ✅ 总结

**notification_send 已经完全可用于生产环境**:

- ✅ **CLI 投递**: 自动配置，开箱即用
- ✅ **Feishu 投递**: Bot 已注册 handler，只需提供 chatId
- ✅ **多渠道支持**: 可同时投递到多个渠道
- ✅ **完整管理**: 创建、查询、删除、历史、统计
- ✅ **持久化**: 跨 session 存储，可靠投递
- ✅ **优先级**: 4 级优先级，视觉区分

立即开始使用 notification_send，为用户提供可靠的通知服务！🎉
