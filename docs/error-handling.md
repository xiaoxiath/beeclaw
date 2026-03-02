# 错误处理和重试机制

> **状态**: Phase 1 已完成
> **最后更新**: 2026-03-01

## 概览

Beeclaw 具备强大的错误处理和自动重试能力，能够长时间稳定运行。

### 已实现功能

- **智能错误分类** - 自动识别错误类型和重试能力
- **自动重试机制** - Agent 和 Subagent 失败后自动重试
- **指数退避** - 避免重试风暴，智能延迟
- **错误追踪** - 统计错误类型和频率
- **友好提示** - 中文错误消息

---

## 错误分类

### 可重试错误 (自动重试)

| 错误类型 | 说明 | 用户提示 |
|---------|------|---------|
| **NETWORK_ERROR** | 网络连接失败 | 网络连接失败，请检查网络后重试 |
| **TIMEOUT_ERROR** | 请求超时 | 请求超时，正在重试... |
| **RATE_LIMIT** | API 限流 | 请求过于频繁，稍后自动重试 |
| **SERVER_ERROR** | 服务器错误 (5xx) | 服务器暂时不可用，正在重试... |

### 不可重试错误 (立即失败)

| 错误类型 | 说明 | 用户提示 |
|---------|------|---------|
| **INSUFFICIENT_BALANCE** | API 余额不足 | API 余额不足，请充值后继续使用 |
| **AUTH_ERROR** | 认证失败 | 认证失败，请检查 API Key |
| **VALIDATION_ERROR** | 参数错误 | 参数错误: [详细信息] |
| **BUSINESS_ERROR** | 业务逻辑错误 | [具体错误信息] |

---

## 重试策略

### Agent (主代理)

- **最大重试次数**: 3次
- **初始延迟**: 2秒
- **最大延迟**: 30秒
- **退避策略**: 指数退避 (2x)
- **抖动**: ±20%

**重试时间线**:
```
尝试 1: 失败 → 等待 2秒
尝试 2: 失败 → 等待 4秒
尝试 3: 失败 → 等待 8秒
尝试 4: 失败 → 最终失败 (共4次尝试)
```

### Subagent (子代理)

- **最大重试次数**: 2次
- **初始延迟**: 1秒
- **最大延迟**: 10秒
- **退避策略**: 指数退避 (2x)
- **抖动**: ±15%

---

## 配置

### 环境变量

```bash
# Agent 超时时间 (毫秒)
export AGENT_TIMEOUT_MS=300000  # 5分钟 (默认)

# Agent 最大重试次数
export AGENT_MAX_RETRIES=3  # 默认: 3

# Subagent 超时时间 (毫秒)
export SUBAGENT_TIMEOUT_MS=180000  # 3分钟 (默认)

# Subagent 最大重试次数
export SUBAGENT_MAX_RETRIES=2  # 默认: 2
```

### 配置文件 (beeclaw.json)

```json
{
  "errorHandling": {
    "retry": {
      "agent": {
        "maxRetries": 3,
        "initialDelay": 2000,
        "maxDelay": 30000
      },
      "subagent": {
        "maxRetries": 2,
        "initialDelay": 1000,
        "maxDelay": 10000
      }
    }
  }
}
```

---

## 日志示例

### 成功重试

```
[Session] Attempt 1/4 failed: Agent response timeout
  Type: TIMEOUT_ERROR (retryable)
  Retrying in 2s...

[Session] Attempt 2/4 failed: Rate limit exceeded
  Type: RATE_LIMIT (retryable)
  Retrying in 4s...

[Session] Agent response succeeded after 3 attempts
```

### 最终失败

```
[Session] Attempt 1/4 failed: Network error
  Retrying in 2s...

[Session] Attempt 4/4 failed: Network error

❌ Error: AI 响应失败，已重试 3 次: Network error
```

---

## 开发者使用

### 在代码中使用错误分类

```typescript
import { classifyError } from './utils/error-handler';

try {
  await someOperation();
} catch (error) {
  const classified = classifyError(error as Error);

  console.log('Error type:', classified.type);
  console.log('Is retryable:', classified.retryable);
  console.log('User message:', classified.userMessage);

  if (classified.retryable) {
    // 自动重试逻辑
  } else {
    // 立即失败
  }
}
```

### 记录错误到追踪器

```typescript
import { errorTracker } from './utils/error-tracker';

// 记录错误
errorTracker.record(classifiedError);

// 获取健康状态
const health = errorTracker.getHealthStatus();
console.log('System healthy:', health.healthy);

// 获取错误统计
const stats = errorTracker.getStats();
console.log('Total errors:', errorTracker.getTotalErrors());
```

---

## 监控和健康检查

### 查看错误统计

```typescript
const tracker = ErrorTracker.getInstance();

// 格式化的健康报告
const report = tracker.formatHealthStatus();
console.log(report);

// 示例输出:
// ## 系统健康状态
//
// ✅ 系统运行正常
//
// **运行时间**: 2h 30m
// **总错误数**: 15
//
// ### 错误统计
// | 错误类型 | 次数 | 最近发生 |
// |---------|------|---------|
// | TIMEOUT_ERROR | 8 | 5分钟前 |
// | RATE_LIMIT | 5 | 15分钟前 |
// | NETWORK_ERROR | 2 | 1小时前 |
```

---

## 最佳实践

### 1. 调整超时和重试

**场景**: 大模型响应慢，经常超时

```bash
# 增加超时到 10 分钟
export AGENT_TIMEOUT_MS=600000

# 增加重试到 5 次
export AGENT_MAX_RETRIES=5
```

### 2. 监控错误频率

定期检查错误统计，识别问题模式：

```typescript
const stats = errorTracker.getStats();

// 如果某个错误频繁出现
if (stats[0].count > 50) {
  console.warn(`高频错误: ${stats[0].type} (${stats[0].count} 次)`);
}
```

### 3. 区分临时和永久错误

- **临时错误**: 网络、超时、限流 → 自动重试即可
- **永久错误**: 认证、余额、参数 → 需要人工干预

---

## 故障排查

### 问题: 重试仍然失败

**可能原因**:
- 网络持续不稳定
- API 服务长时间不可用
- 余额不足

**解决方法**:
```bash
# 1. 检查网络连接
ping api.example.com

# 2. 检查 API 余额
# 登录服务商控制台查看

# 3. 增加超时和重试
export AGENT_TIMEOUT_MS=600000
export AGENT_MAX_RETRIES=5
```

### 问题: 想禁用某些重试

**解决方法**:
```bash
# 禁用 Agent 重试
export AGENT_MAX_RETRIES=0

# 禁用 Subagent 重试
export SUBAGENT_MAX_RETRIES=0
```

---

## 未来计划

### Phase 2 - 熔断保护

- Circuit Breaker 模式
- 连续失败自动熔断
- 自动恢复机制

### Phase 3 - 检查点恢复

- 任务状态保存
- 失败后恢复执行
- 断点续传

### Phase 4 - 优雅降级

- 工具失败降级
- Memory 加载失败降级
- Skill 执行失败降级

---

**系统可靠性大幅提升！**

现在 Beeclaw 能够:
- 自动处理临时故障
- 智能重试避免雪崩
- 提供清晰的错误信息
- 长时间稳定运行
