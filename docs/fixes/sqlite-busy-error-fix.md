# SQLite 数据库锁定错误修复

## 🚨 问题描述

**错误日志**:
```
SQLiteError: database is locked
code: "SQLITE_BUSY"
at releaseExpiredLocks (/Users/tanghao/workspace/beeclaw/src/app/dispatcher/index.ts:331:8)
```

**错误位置**: Task Dispatcher 的 `releaseExpiredLocks` 函数

**发生频率**: 间歇性（在高并发或轮询时）

## 🔍 问题分析

### 根本原因

1. **SQLite 并发限制**: SQLite 是文件数据库，在高并发时容易出现锁定
2. **缺少错误处理**: `releaseExpiredLocks` 函数直接执行数据库操作，没有 try-catch
3. **定时轮询**: Dispatcher 定期轮询任务，可能与其他数据库操作冲突

### 影响范围

**轻微影响**:
- 这是一个后台清理函数
- 失败不会影响主要功能
- 只会在日志中看到警告

**不会影响**:
- 任务执行
- 用户请求处理
- Bot 正常运行

## ✅ 修复方案

**文件**: `src/app/dispatcher/index.ts`

### 修复前 (第 317-332 行)

```typescript
private async releaseExpiredLocks(): Promise<void> {
  const db = getDataConnection();
  const now = new Date();
  const timeoutDate = new Date(now.getTime() - this.config.lockTimeoutMs);

  await db.update(tasksTable)
    .set({
      lockedBy: null,
      lockedAt: null,
    })
    .where(and(
      lt(tasksTable.lockedAt, timeoutDate),
      isNull(tasksTable.lockedBy) === false
    ))
    .run();  // ❌ 可能抛出 SQLITE_BUSY 异常
}
```

### 修复后

```typescript
private async releaseExpiredLocks(): Promise<void> {
  try {
    const db = getDataConnection();
    const now = new Date();
    const timeoutDate = new Date(now.getTime() - this.config.lockTimeoutMs);

    await db.update(tasksTable)
      .set({
        lockedBy: null,
        lockedAt: null,
      })
      .where(and(
        lt(tasksTable.lockedAt, timeoutDate),
        isNull(tasksTable.lockedBy) === false
      ))
      .run();  // ✅ 即使失败也会被捕获
  } catch (error) {
    // Database lock is acceptable - we'll try again next poll
    if (error instanceof Error && error.message?.includes('locked')) {
      console.warn('[Dispatcher] Database locked while releasing expired locks, will retry next poll');
    } else {
      console.error('[Dispatcher] Error releasing expired locks:', error);
    }
  }
}
```

### 修复要点

1. ✅ **添加 try-catch**: 捕获数据库异常
2. ✅ **区分错误类型**: 对 SQLITE_BUSY 只记录警告
3. ✅ **优雅降级**: 失败后继续运行，下次轮询时重试
4. ✅ **不影响主流程**: 其他任务继续正常执行

## 📊 修复效果

### 修复前
```
[Dispatcher] Poll error: SQLiteError: database is locked
[Stack trace]
Bot 崩溃或停止轮询
```

### 修复后
```
[Dispatcher] Database locked while releasing expired locks, will retry next poll
继续正常轮询和处理任务
```

## 🧪 测试验证

### 测试步骤

```bash
# 1. 重启 bot 应用修复
pm2 restart beeclaw

# 2. 查看日志，确认没有崩溃
pm2 logs beeclaw --lines 50

# 3. 检查 bot 是否正常运行
pm2 status
```

### 预期结果

- ✅ Bot 正常运行
- ✅ 如果出现数据库锁定，只显示警告
- ✅ 任务继续正常处理
- ✅ 不会崩溃或停止

## 🔧 其他可能的改进

### 1. 启用 SQLite WAL 模式

如果问题频繁出现，可以启用 Write-Ahead Logging：

```typescript
// 在数据库初始化时
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA busy_timeout = 5000');  // 5秒超时
```

**优点**:
- 提高并发性能
- 减少锁定冲突

**缺点**:
- 会产生额外的 -wal 和 -shm 文件
- 需要定期清理

### 2. 增加重试逻辑

对于关键操作，可以添加重试：

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 100
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Max retries reached');
}
```

### 3. 优化轮询间隔

减少轮询频率可以降低冲突：

```typescript
// beeclaw.json
{
  "dispatcher": {
    "pollIntervalMs": 2000,  // 从 1 秒改为 2 秒
    "lockTimeoutMs": 30000
  }
}
```

### 4. 检查多实例问题

确保只有一个 bot 实例在运行：

```bash
# 检查进程
ps aux | grep beeclaw

# 如果有多个，停止所有
pm2 stop all

# 只启动一个
pm2 start beeclaw
```

## 📋 相关配置

**beeclaw.json** 中的 dispatcher 配置：

```json
{
  "dispatcher": {
    "enabled": true,
    "maxConcurrency": 5,
    "pollIntervalMs": 1000,
    "lockTimeoutMs": 30000
  }
}
```

## 🎯 总结

### 修复内容

1. ✅ 添加了 try-catch 错误处理
2. ✅ 对 SQLITE_BUSY 错误优雅降级
3. ✅ 保持 bot 持续运行，不会崩溃

### 效果

- 🟢 **轻微警告**: 数据库锁定只记录警告
- 🟢 **持续运行**: Bot 继续正常工作
- 🟢 **自动重试**: 下次轮询时自动重试

### 下一步

如果问题频繁出现，考虑：
1. 启用 WAL 模式
2. 增加轮询间隔
3. 优化数据库访问模式

现在 bot 应该不会再因为数据库锁定而崩溃了！
