# Beeclaw 架构升级使用指南

本文档介绍如何使用 Beeclaw 的新架构特性，包括 SQLite 持久化、统一消息网关和任务调度器。

## 目录

- [快速开始](#快速开始)
- [SQLite 会话存储](#sqlite-会话存储)
- [消息网关](#消息网关)
- [任务调度器](#任务调度器)
- [配置说明](#配置说明)
- [故障排查](#故障排查)

## 快速开始

### 启用 SQLite 会话存储

```bash
# 设置环境变量启用 SQLite
export USE_SQLITE_SESSIONS=true

# 启动 CLI 模式
bun run cli

# 启动 Bot 模式
bun run bot
```

### 验证 SQLite 已启用

启动时会看到以下日志：

```
🐝 Initializing Beeclaw...
   📁 Memory: ./data/memory
   🗄️  Database: ./data/memory/beeclaw.db
   📨 Gateway: cli, feishu channels
   ⚡ Dispatcher: Task processing started
   ✅ Beeclaw initialized
```

## SQLite 会话存储

### 概述

SQLite 会话存储提供了比 JSON 文件更可靠的持久化方案：
- 事务性保证（ACID）
- 索引查询（< 10ms）
- 支持复杂查询
- 为未来的 Web Dashboard 做准备

### 数据库结构

**会话表 (sessions)**
```sql
- id: TEXT (主键)
- channel: TEXT (渠道：cli/feishu/webhook)
- user_id: TEXT (用户 ID)
- messages: JSON (消息数组)
- metadata: JSON (元数据)
- needs_recovery: BOOLEAN (是否需要恢复)
- created_at: TIMESTAMP
- updated_at: TIMESTAMP

索引：
- sessions_channel_idx (按渠道查询)
- sessions_user_id_idx (按用户查询)
- sessions_updated_at_idx (按更新时间查询)
```

**任务表 (tasks)**
```sql
- id: TEXT (主键)
- session_id: TEXT (关联会话)
- type: TEXT (任务类型：message/cron/reminder)
- payload: JSON (任务数据)
- status: TEXT (状态：pending/running/completed/failed)
- scheduled_at: TIMESTAMP (计划执行时间)
- attempts: INTEGER (重试次数)
- locked_by: TEXT (锁定者)
- created_at: TIMESTAMP

索引：
- tasks_session_id_idx
- tasks_status_idx
- tasks_scheduled_at_idx
- tasks_type_idx
```

### 迁移现有会话

如果你有现有的 JSON 会话文件，可以迁移到 SQLite：

```bash
# 运行迁移脚本
bun scripts/migrate-sessions-to-sqlite.ts

# 输出示例：
# 🔄 Starting session migration to SQLite...
# Found 5 session files to migrate.
# ✅ Migrated session-1 (10 messages)
# ✅ Migrated session-2 (5 messages)
# ...
# ✨ Migration complete!
```

迁移特性：
- ✅ 保留原始 JSON 文件作为备份
- ✅ 自动跳过已迁移的会话
- ✅ 错误处理和详细报告

### 双模式运行

启用 SQLite 后，系统会同时写入 JSON 和 SQLite（双模式）：

**优势：**
- 向后兼容
- JSON 文件作为备份
- 可以随时回退到 JSON 模式

**切换模式：**
```bash
# 启用 SQLite（双模式：JSON + SQLite）
export USE_SQLITE_SESSIONS=true

# 禁用 SQLite（仅 JSON）
export USE_SQLITE_SESSIONS=false
# 或
unset USE_SQLITE_SESSIONS
```

### 查询会话数据

**使用 sqlite3 命令行工具：**

```bash
# 查看所有会话
sqlite3 data/memory/beeclaw.db "SELECT id, channel, user_id FROM sessions;"

# 查看会话消息数量
sqlite3 data/memory/beeclaw.db "SELECT id, json_array_length(messages) as msg_count FROM sessions;"

# 查看特定会话
sqlite3 data/memory/beeclaw.db "SELECT * FROM sessions WHERE id='session-123';"

# 查看最近更新的会话
sqlite3 data/memory/beeclaw.db "SELECT id, datetime(updated_at, 'unixepoch', 'localtime') FROM sessions ORDER BY updated_at DESC LIMIT 10;"
```

**使用 Bun 脚本：**

```typescript
import { getDataConnection } from './src/db';
import { sessions } from './src/db/schema';
import { eq } from 'drizzle-orm';

const db = getDataConnection();

// 查询所有会话
const allSessions = db.select().from(sessions).all();

// 查询特定会话
const session = db.select()
  .from(sessions)
  .where(eq(sessions.id, 'session-123'))
  .limit(1)
  .all();

// 按渠道查询
const feishuSessions = db.select()
  .from(sessions)
  .where(eq(sessions.channel, 'feishu'))
  .all();
```

### 性能优化

**WAL 模式：**
- 自动启用 Write-Ahead Logging
- 提高并发性能
- 减少文件锁冲突

**索引：**
- 所有常用查询字段已建立索引
- 查询时间 < 10ms

**基准测试结果：**
```
100 queries completed in 6.02ms
Average: 0.06ms per query
```

## 消息网关

### 概述

消息网关（MessageGateway）提供了统一的跨平台消息接口：
- CLI（命令行）
- Feishu（飞书）
- 未来可扩展：Slack、Telegram 等

### 架构

```
┌─────────────┐
│   业务逻辑   │
└──────┬──────┘
       │
┌──────▼──────────────────┐
│  MessageGateway         │
│  (统一消息接口)          │
└──────┬──────┬──────┬────┘
       │      │      │
   ┌───▼──┐ ┌─▼───┐ ┌▼────┐
   │ CLI  │ │Feishu│ │ ... │
   └──────┘ └─────┘ └─────┘
```

### 使用示例

**发送消息：**

```typescript
import { getMessageGateway } from './src/channel/gateway';

const gateway = getMessageGateway();

// 发送 CLI 消息
await gateway.postMessage('cli', 'Hello from CLI!');

// 发送 Feishu 消息
await gateway.postMessage('feishu', 'Hello from Feishu!', {
  metadata: { chatId: 'chat-123' }
});
```

**回复消息：**

```typescript
// 回复 CLI 消息
await gateway.replyMessage('cli', {
  sessionId: 'session-123',
  userId: 'user-456',
}, 'This is a reply');

// 回复 Feishu 消息
await gateway.replyMessage('feishu', {
  sessionId: 'session-123',
  userId: 'user-456',
  chatId: 'chat-789',
  parentMessageId: 'msg-001',
}, 'This is a reply');
```

**健康检查：**

```typescript
// 检查所有渠道状态
const health = await gateway.healthCheckAll();
// { cli: true, feishu: true }

// 获取已注册的渠道
const channels = gateway.getRegisteredChannels();
// ['cli', 'feishu']
```

### 添加新渠道

要添加新渠道（如 Slack）：

1. **实现 MessageChannel 接口：**

```typescript
// src/channel/slack.ts
import type { MessageChannel, ChannelType } from './types';

export class SlackChannel implements MessageChannel {
  readonly type: ChannelType = 'slack';

  async postMessage(content, options?) {
    // 实现发送消息逻辑
  }

  async replyMessage(options, content) {
    // 实现回复消息逻辑
  }

  supportsUpdates(): boolean {
    return false;
  }

  async healthCheck(): Promise<boolean> {
    // 实现健康检查
  }
}
```

2. **在 initApp() 中注册：**

```typescript
// src/app/index.ts
import { SlackChannel } from '../channel/slack';

const gateway = getMessageGateway();
gateway.registerChannel(new SlackChannel());
```

## 任务调度器

### 概述

任务调度器（TaskDispatcher）统一了三种调度系统：
- SessionMessageQueue（内存队列）
- Bunqueue（SQLite 作业队列）
- Proactive Scheduler（Cron 调度）

### 架构

```
┌─────────────────────────────────┐
│      TaskDispatcher             │
│  - 任务提交                      │
│  - 会话级锁                      │
│  - 轮询处理                      │
│  - 重试逻辑                      │
└──────────┬──────────────────────┘
           │
    ┌──────▼──────┬──────────┬─────────┐
    │             │          │         │
┌───▼───┐    ┌───▼───┐  ┌───▼───┐  ┌──▼──┐
│message│    │ cron  │  │reminder│  │ ... │
│handler│    │handler│  │handler │  │     │
└───────┘    └───────┘  └────────┘  └─────┘
```

### 提交任务

**消息任务：**

```typescript
import { getTaskDispatcher } from './src/dispatcher';

const dispatcher = getTaskDispatcher();

// 提交消息处理任务
const taskId = await dispatcher.submitTask(
  'session-123',           // 会话 ID
  'message',               // 任务类型
  {                        // 任务数据
    message: 'Hello',
    userId: 'user-456',
    channel: 'cli',
  },
  new Date()               // 立即执行
);

console.log('Task submitted:', taskId);
```

**Cron 任务：**

```typescript
// 提交定时任务（每小时执行）
await dispatcher.submitTask(
  'system',
  'cron',
  {
    handlerName: 'memory-compression',
    params: { days: 7 },
  },
  new Date(),
  '0 * * * *'  // Cron 表达式：每小时
);
```

**提醒任务：**

```typescript
// 提交提醒任务（5分钟后执行）
const scheduledTime = new Date(Date.now() + 5 * 60 * 1000);

await dispatcher.submitTask(
  'session-123',
  'reminder',
  {
    userId: 'user-456',
    channel: 'cli',
    message: 'Don\'t forget to take a break!',
  },
  scheduledTime
);
```

### 自定义任务处理器

**注册处理器：**

```typescript
import { getTaskDispatcher } from './src/dispatcher';
import type { Task } from './src/dispatcher/types';

const dispatcher = getTaskDispatcher();

// 注册自定义处理器
dispatcher.registerHandler('custom-task', async (task: Task) => {
  console.log('Processing custom task:', task.id);
  console.log('Payload:', task.payload);

  // 执行任务逻辑
  // ...

  // 如果抛出错误，任务会自动重试
  // throw new Error('Task failed');
});
```

**使用自定义处理器：**

```typescript
await dispatcher.submitTask(
  'session-123',
  'custom-task',
  { customData: 'value' },
  new Date()
);
```

### 任务生命周期

```
┌─────────┐
│ pending │ (等待执行)
└────┬────┘
     │ (轮询获取)
┌────▼────┐
│ running │ (执行中)
└────┬────┘
     │
  ┌──┴──┐
  │     │
┌─▼─┐ ┌─▼───────┐
│completed│ │ failed │
└─────┘ └─────────┘
         │
    (重试) ──────> pending
```

### 会话级锁

TaskDispatcher 确保同一会话的任务串行执行：

```
会话 A:
  Task 1 ━━━━━━┓
                ┃
  Task 2       ┗━━━━━━┓
                       ┃
  Task 3              ┗━━━━━━

会话 B: (并行执行)
  Task 1 ━━━━━━━━━━┓
                    ┃
  Task 2           ┗━━━━━━━━
```

### 重试机制

**自动重试：**

```typescript
// 默认配置
{
  maxAttempts: 3,           // 最多重试 3 次
  retryDelay: exponential,  // 指数退避
  maxDelay: 60000,          // 最大延迟 1 分钟
}
```

**重试延迟：**
```
第 1 次重试: 1 秒后
第 2 次重试: 2 秒后
第 3 次重试: 4 秒后
```

### 监控任务

**获取统计信息：**

```typescript
const stats = await dispatcher.getStats();

console.log('Total tasks:', stats.totalTasks);
console.log('Pending:', stats.pendingTasks);
console.log('Running:', stats.runningTasks);
console.log('Completed:', stats.completedTasks);
console.log('Failed:', stats.failedTasks);
console.log('Active locks:', stats.activeLocks);
```

**查询任务：**

```bash
# 使用 sqlite3 查询
sqlite3 data/memory/beeclaw.db "SELECT * FROM tasks WHERE status='pending' ORDER BY scheduled_at;"

# 查看失败的任务
sqlite3 data/memory/beeclaw.db "SELECT id, error FROM tasks WHERE status='failed';"

# 查看正在运行的任务
sqlite3 data/memory/beeclaw.db "SELECT id, session_id, locked_by FROM tasks WHERE status='running';"
```

## 配置说明

### 环境变量

```bash
# SQLite 配置
export USE_SQLITE_SESSIONS=true          # 启用 SQLite 会话存储

# TaskDispatcher 配置
export TASK_MAX_CONCURRENCY=10           # 最大并发任务数
export TASK_LOCK_TIMEOUT=300000          # 锁超时（毫秒）
export TASK_RETRY_ATTEMPTS=3             # 最大重试次数
export TASK_POLL_INTERVAL=1000           # 轮询间隔（毫秒）

# Recovery 配置
export ENABLE_RECOVERY=true              # 启用会话恢复
```

### 配置文件

**beeclaw.json:**

```json
{
  "memory": {
    "path": "./data/memory"
  },
  "sessionStorage": {
    "path": "./data/memory/sessions"
  },
  "recovery": {
    "enabled": true,
    "maxAge": 300000,
    "channels": ["feishu"],
    "batchSize": 5,
    "startupDelay": 10000
  }
}
```

## 故障排查

### SQLite 相关问题

**问题：数据库锁定**

```bash
# 症状
Error: database is locked

# 解决方案
# 1. 检查是否有多个进程同时访问
lsof data/memory/beeclaw.db

# 2. 检查 WAL 文件
ls -lh data/memory/beeclaw.db*

# 3. 重启应用（WAL 模式应该避免此问题）
```

**问题：会话未保存到 SQLite**

```bash
# 检查环境变量
echo $USE_SQLITE_SESSIONS

# 检查日志中是否有 "Database:" 行
bun run cli 2>&1 | grep -i database

# 验证数据库文件存在
ls -lh data/memory/beeclaw.db
```

**问题：查询性能慢**

```bash
# 检查索引是否创建
sqlite3 data/memory/beeclaw.db ".indices"

# 分析查询计划
sqlite3 data/memory/beeclaw.db "EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE channel='cli';"

# 重建索引（如果需要）
sqlite3 data/memory/beeclaw.db "REINDEX;"
```

### 迁移问题

**问题：迁移失败**

```bash
# 检查 JSON 文件格式
cat data/memory/sessions/session-123.json | jq '.'

# 手动验证单个会话
bun -e "
const fs = require('fs');
const session = JSON.parse(fs.readFileSync('data/memory/sessions/session-123.json', 'utf-8'));
console.log('Session ID:', session.id);
console.log('Messages:', session.messages.length);
"

# 跳过错误会话继续迁移
# (迁移脚本会自动跳过并报告错误)
```

### TaskDispatcher 问题

**问题：任务未执行**

```bash
# 检查 Dispatcher 是否启动
# 日志中应该有 "⚡ Dispatcher: Task processing started"

# 检查待处理任务
sqlite3 data/memory/beeclaw.db "SELECT id, type, scheduled_at FROM tasks WHERE status='pending';"

# 检查是否有处理器注册
# 日志中应该有 "Registered handler for task type: message"
```

**问题：任务卡在 running 状态**

```bash
# 检查锁定的任务
sqlite3 data/memory/beeclaw.db "SELECT id, locked_by, locked_at FROM tasks WHERE status='running';"

# 手动释放锁（谨慎操作）
sqlite3 data/memory/beeclaw.db "UPDATE tasks SET status='pending', locked_by=NULL, locked_at=NULL WHERE id='task-123';"
```

**问题：任务重复执行**

```bash
# 检查会话锁
sqlite3 data/memory/beeclaw.db "SELECT session_id, COUNT(*) FROM tasks WHERE status='running' GROUP BY session_id;"

# 应该每个会话只有一个 running 任务
```

### Gateway 问题

**问题：消息发送失败**

```bash
# 检查渠道是否注册
# 日志中应该有 "📨 Gateway: cli, feishu channels"

# 测试渠道健康
bun -e "
const { getMessageGateway } = require('./src/channel/gateway');
const gateway = getMessageGateway();
gateway.healthCheckAll().then(console.log);
"
```

**问题：Feishu 消息未送达**

```bash
# 检查 Feishu 客户端是否初始化
echo $LARK_BEECLAW_APPID
echo $LARK_BEECLAW_AS

# 检查日志中的错误信息
bun run bot 2>&1 | grep -i feishu

# 检查是否使用了 Gateway
# proactive.ts 应该使用 gateway.replyMessage()
```

## 最佳实践

### 1. 逐步启用 SQLite

```bash
# 第 1 周：开发环境测试
export USE_SQLITE_SESSIONS=true
bun run cli

# 第 2 周：迁移现有数据
bun scripts/migrate-sessions-to-sqlite.ts

# 第 3 周：生产环境启用
# (确保有备份)

# 第 4 周：弃用 JSON 模式
# (修改代码，默认启用 SQLite)
```

### 2. 监控任务队列

```bash
# 定期检查任务状态
watch -n 5 'sqlite3 data/memory/beeclaw.db "SELECT status, COUNT(*) FROM tasks GROUP BY status;"'

# 监控失败任务
sqlite3 data/memory/beeclaw.db "SELECT id, type, error, attempts FROM tasks WHERE status='failed' ORDER BY created_at DESC LIMIT 10;"
```

### 3. 定期清理

```bash
# 清理已完成的任务（7天前）
sqlite3 data/memory/beeclaw.db "DELETE FROM tasks WHERE status='completed' AND completed_at < strftime('%s', 'now', '-7 days');"

# 清理旧会话（30天前）
sqlite3 data/memory/beeclaw.db "DELETE FROM sessions WHERE updated_at < strftime('%s', 'now', '-30 days');"

# 优化数据库
sqlite3 data/memory/beeclaw.db "VACUUM;"
```

### 4. 备份策略

```bash
# 备份 SQLite 数据库
cp data/memory/beeclaw.db data/memory/beeclaw.db.backup-$(date +%Y%m%d)

# 导出会话到 JSON（兼容模式）
# (双模式会自动保存 JSON)

# 定期备份到云存储
# (使用你的备份工具)
```

## 参考资料

- [RFC-03: SQLite + Drizzle ORM](../docs/future/beeclaw-tech-design.md#rfc-03-sqlite--drizzle-orm)
- [RFC-01: MessageChannel/Gateway](../docs/future/beeclaw-tech-design.md#rfc-01-messagechannelgateway)
- [RFC-02: TaskDispatcher](../docs/future/beeclaw-tech-design.md#rfc-02-taskdispatcher)
- [架构升级验证报告](../docs/architecture-upgrade-verification.md)
- [SQLite 测试结果](../docs/sqlite-test-results.md)

## 常见问题 (FAQ)

**Q: SQLite 和 JSON 可以同时使用吗？**
A: 可以。启用 `USE_SQLITE_SESSIONS=true` 后，系统会同时写入两者（双模式），确保向后兼容。

**Q: 如何回退到 JSON 模式？**
A: 只需设置 `export USE_SQLITE_SESSIONS=false` 或删除该环境变量，系统会回退到 JSON 模式。

**Q: 迁移会丢失数据吗？**
A: 不会。迁移脚本会保留原始 JSON 文件，并跳过已迁移的会话。建议迁移前备份。

**Q: TaskDispatcher 会替代现有的队列吗？**
A: 是的。TaskDispatcher 统一了 SessionMessageQueue、Bunqueue 和 Proactive Scheduler。

**Q: 如何添加新的消息渠道？**
A: 实现 `MessageChannel` 接口，并在 `initApp()` 中注册到 Gateway。

**Q: SQLite 性能如何？**
A: 基准测试显示查询时间 < 10ms，远优于目录遍历（100ms+）。

**Q: 任务失败后会自动重试吗？**
A: 会。默认最多重试 3 次，使用指数退避策略。

**Q: 如何监控任务执行？**
A: 使用 `getStats()` API 或直接查询 SQLite 数据库。

## 更新日志

### v0.3.0 (2026-03-11)
- ✨ 新增 SQLite 持久化（RFC-03）
- ✨ 新增消息网关（RFC-01）
- ✨ 新增任务调度器（RFC-02）
- ✨ 新增迁移脚本
- 📝 新增使用文档

---

**需要帮助？**
- 查看 [故障排查](#故障排查) 章节
- 阅读 [架构升级验证报告](../docs/architecture-upgrade-verification.md)
- 运行测试脚本：`bun scripts/test-sqlite-enabled.ts`
