# Session Recovery 功能使用指南

## 概述

Session Recovery 是一个轻量级的会话恢复功能，用于在 Beeclaw 重启后自动检测并继续之前未回复的对话。

## 功能特性

- ✅ 自动检测未回复的会话
- ✅ 智能过滤（时间窗口、通道过滤）
- ✅ 批量处理，避免过载
- ✅ 可配置、可回滚
- ✅ 不影响正常消息处理流程

## 工作原理

### 检测逻辑

当 Beeclaw 启动时（延迟10秒后），会扫描所有会话，检查：

1. **最后一条消息是否来自用户**（`role === 'user'`）
2. **消息时间是否在合理范围内**（默认：10秒 ~ 5分钟）
   - **例外**：如果 `pendingRecovery === true`，则忽略 `minAge` 限制（立即恢复）
3. **会话通道是否在配置列表中**（默认：`['feishu']`）

如果满足以上条件，则视为"未回复"会话，需要恢复。

### pendingRecovery 标记（重要）

**问题场景**：
- Bot 收到消息并添加表情反应后
- 在生成文本回复之前重启
- 重启后，recovery 系统找不到未回复消息（因为消息还没保存到 session）

**解决方案**：
- 在调用 AI 之前，立即保存用户消息到 session
- 设置 `pendingRecovery = true` 标记
- AI 生成响应后，清除标记

**效果**：
- 即使 Bot 在处理过程中重启，recovery 系统也能检测到未回复的消息
- 对于标记了 `pendingRecovery` 的会话，即使消息时间 < `minAge`，也会立即恢复

### 恢复流程

1. 检测到未回复会话后，按年龄排序（最老的优先）
2. 批量处理（默认：5个一批）
3. 对每个会话调用 `sendProactiveMessage()` 重新处理
4. 如果是 Feishu 通道，发送友好通知："检测到之前的消息未回复，已重新处理 🔄"
5. 批次间延迟（默认：2秒）

## 配置

### 在 `beeclaw.json` 中配置

```json
{
  "recovery": {
    "enabled": true,
    "maxAge": 300000,      // 5分钟（毫秒）
    "minAge": 10000,       // 10秒（毫秒）
    "channels": ["feishu"],
    "batchSize": 5,
    "delayMs": 2000,
    "startupDelay": 10000
  }
}
```

### 配置参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用恢复功能 |
| `maxAge` | number | `300000` | 最大未回复时间（毫秒），超过此时间不恢复 |
| `minAge` | number | `10000` | 最小未回复时间（毫秒），低于此时间不恢复（避免处理正在进行的消息） |
| `channels` | string[] | `['feishu']` | 需要恢复的通道列表 |
| `batchSize` | number | `5` | 批量处理数量 |
| `delayMs` | number | `2000` | 消息间延迟（毫秒） |
| `startupDelay` | number | `10000` | 启动后延迟执行（毫秒），等待 Feishu 连接建立 |

## 使用场景

### 1. PM2 定时重启（每天4点）

**场景**：每天凌晨4点 PM2 自动重启服务

**恢复范围**：只恢复 3:55-4:00 之间发送的消息（5分钟内）

**配置优化**：
```json
{
  "recovery": {
    "maxAge": 300000,  // 5分钟
    "startupDelay": 5000  // 缩短启动延迟到5秒
  }
}
```

### 2. 进程崩溃自动重启

**场景**：Beeclaw 崩溃后 PM2 自动重启

**恢复范围**：崩溃前 10秒 ~ 5分钟 内的消息

**配置优化**：
```json
{
  "recovery": {
    "minAge": 5000,  // 缩短到5秒（更快恢复）
    "startupDelay": 3000  // 缩短启动延迟
  }
}
```

### 3. 手动重启

**场景**：手动执行 `bun run pm2:restart`

**恢复范围**：重启前 10秒 ~ 5分钟 内的消息

**建议**：保持默认配置即可

## 禁用恢复功能

### 方式1: 配置文件

```json
{
  "recovery": {
    "enabled": false
  }
}
```

### 方式2: 环境变量

```bash
export ENABLE_RECOVERY=false
bun run bot
```

### 方式3: 代码禁用（高级）

修改 `src/bot.ts`：

```typescript
const { config, provider, model } = await initApp({
  daemon: enableDaemon,
  enableRecovery: false,  // 禁用恢复
});
```

## 日志输出

启用恢复功能后，会在启动时看到类似日志：

```
   ⏰ Session recovery enabled (delay: 10s)
...
[Recovery] 🔍 Scanning for unanswered sessions...
[Recovery] 📨 Found 2 unanswered session(s)
[Recovery] 🔄 Recovering session feishu-xxx-xxx
[Recovery]    Last message: "测试消息..."
[Recovery]    Age: 45s
[Recovery] ✅ Session recovered
[Recovery] 🔄 Recovering session feishu-yyy-yyy
[Recovery]    Last message: "另一条消息..."
[Recovery]    Age: 120s
[Recovery] ✅ Session recovered
[Recovery] 📊 Done: 2 recovered, 0 failed, 0 skipped
```

## 边界情况处理

### 1. 正在处理的消息

**问题**：用户发消息时，Beeclaw 正在重启

**处理**：`minAge: 10秒` - 跳过10秒内的消息

**理由**：可能刚发送，原进程可能还在处理

### 2. 历史对话误判

**问题**：用户发送消息后主动结束对话

**处理**：`maxAge: 5分钟` - 超过5分钟不恢复

**可配置**：可根据实际使用调整时间窗口

### 3. Feishu 连接未就绪

**问题**：恢复时 WebSocket 还未建立

**处理**：
- `startupDelay: 10秒` - 延迟执行
- 错误处理 - 失败的消息记录但不影响其他

### 4. 多实例部署

**问题**：可能重复回复

**解决**：推荐单实例部署；如需多实例可增加文件锁

## 监控指标

建议监控以下指标：

- 检测到的未回复会话数
- 成功恢复数
- 恢复失败数
- 恢复耗时

可通过日志分析获取这些指标。

## 技术实现

### 核心文件

1. **`src/session/recovery.ts`** - 核心恢复逻辑
   - `detectUnansweredSessions()` - 检测未回复会话
   - `recoverUnansweredSessions()` - 恢复未回复会话

2. **`src/app/index.ts`** - 启动集成点
   - 在 `initApp()` 末尾添加延迟恢复调用

3. **`src/config/schema.ts`** - 配置定义
   - `RecoveryConfigSchema` - 配置 Schema

4. **`src/session/__tests__/recovery.test.ts`** - 单元测试
   - 测试检测逻辑
   - 测试边界情况

### 数据结构

```typescript
interface RecoveryConfig {
  enabled: boolean;
  maxAge: number;
  minAge: number;
  channels: string[];
  batchSize: number;
  delayMs: number;
  startupDelay: number;
}

interface UnansweredSession {
  session: Session;
  lastMessageAge: number;
  lastMessageContent: string;
}

interface RecoveryResult {
  recovered: number;
  failed: number;
  skipped: number;
  details: Array<{
    sessionId: string;
    status: 'recovered' | 'failed' | 'skipped';
    error?: string;
  }>;
}
```

## 测试

### 运行单元测试

```bash
bun test src/session/__tests__/recovery.test.ts
```

### 运行验证脚本

```bash
bun run verify-recovery.ts
```

## 故障排查

### 问题：恢复功能没有执行

**检查项**：
1. 配置是否启用：`recovery.enabled === true`
2. 环境变量：`ENABLE_RECOVERY !== 'false'`
3. 启动日志：是否看到 "Session recovery enabled"
4. 延迟时间：是否等待了 `startupDelay` 时间

### 问题：恢复失败

**检查项**：
1. Feishu 连接：是否成功建立 WebSocket 连接
2. 会话数据：会话文件是否损坏
3. 日志输出：查看错误详情

### 问题：恢复重复执行

**可能原因**：
1. 多实例部署
2. 配置的 `minAge` 太小

**解决方案**：
1. 使用单实例部署
2. 增加 `minAge` 到 15秒或更多

## 最佳实践

1. **生产环境**：保持默认配置，稳定优先
2. **开发环境**：可缩短 `startupDelay` 到 3-5秒，加快测试
3. **高可用场景**：配合 PM2 的 graceful shutdown
4. **监控告警**：定期检查恢复失败数

## 更新日志

### v1.1.0 (2026-03-05)

**新特性**：
- ✅ 添加 `pendingRecovery` 标记，确保 Bot 在处理过程中重启也能恢复
- ✅ 用户消息在调用 AI 之前立即保存到 session
- ✅ Recovery 系统优先处理 `pendingRecovery` 标记的会话

**修复问题**：
- 🐛 修复 Bot 添加表情反应后重启，recovery 系统无法检测到未回复消息的问题
- 🐛 修复用户消息在 AI 生成响应后才保存导致重启丢失的问题

**技术细节**：
- 修改 `sendProactiveMessage()` 在调用 AI 前保存用户消息
- 修改 replay conversation history 逻辑，避免重复添加用户消息
- 更新 recovery 检测逻辑，支持 `pendingRecovery` 标记
- 添加测试用例验证新功能

### v1.0.0 (2026-03-05)

- ✅ 初始实现
- ✅ 支持检测和恢复未回复会话
- ✅ 可配置时间窗口和通道
- ✅ 批量处理和延迟机制
- ✅ 完整单元测试
- ✅ 禁用功能支持

## 相关文档

- [ARCHITECTURE.md](../architecture.md) - 系统架构
- [CLAUDE.md](../../CLAUDE.md) - 开发指南
- [docs/proactive-capabilities-guide.md](./proactive-system.md) - 主动能力指南
