# 错误处理和恢复机制设计

> 状态: 设计阶段
> 优先级: 高
> 目标: 让 beeclaw 能长时间稳定运行

## 📊 现状分析

### 当前问题

1. **无重试机制**
   - Agent 超时直接失败，不重试
   - Subagent 失败不重试
   - 工具执行失败不重试

2. **错误处理不完善**
   - 所有错误同等对待
   - 没有错误分类
   - 缺少详细的错误日志

3. **无恢复能力**
   - 失败后无法恢复
   - 会话状态可能丢失
   - 没有检查点机制

4. **缺少监控**
   - 没有健康检查
   - 没有错误统计
   - 缺少告警机制

### 已有的好东西

1. **Retry 工具已存在** (`src/utils/retry.ts`)
   - 指数退避
   - Jitter 随机化
   - 可配置重试策略
   - 支持自定义错误判断

2. **会话持久化**
   - JSONL 存储
   - SQLite 支持

3. **超时机制**
   - Agent 5分钟
   - Subagent 3分钟

---

## 🎯 设计目标

### 1. 可靠性 (Reliability)

- **99.9% 可用性** - 能长时间运行不崩溃
- **自动恢复** - 错误后自动恢复继续运行
- **数据不丢失** - 会话和状态持久化

### 2. 弹性 (Resilience)

- **重试机制** - 临时故障自动重试
- **优雅降级** - 部分功能失败不影响整体
- **熔断保护** - 连续失败时熔断，避免雪崩

### 3. 可观测性 (Observability)

- **详细日志** - 记录所有关键操作和错误
- **错误统计** - 分类统计错误类型和频率
- **健康检查** - 定期检查系统健康状态

---

## 🏗️ 架构设计

### Layer 1: 错误分类和处理

```typescript
// src/utils/error-handler.ts

export enum ErrorType {
  // 可重试错误
  NETWORK_ERROR = 'NETWORK_ERROR',        // 网络错误
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',        // 超时错误
  RATE_LIMIT = 'RATE_LIMIT',              // 限流
  SERVER_ERROR = 'SERVER_ERROR',          // 服务器错误 (5xx)

  // 不可重试错误
  AUTH_ERROR = 'AUTH_ERROR',              // 认证错误
  VALIDATION_ERROR = 'VALIDATION_ERROR',  // 参数错误
  BUSINESS_ERROR = 'BUSINESS_ERROR',      // 业务逻辑错误
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE', // 余额不足
}

export interface ClassifiedError {
  type: ErrorType;
  retryable: boolean;
  message: string;
  originalError: Error;
  context?: Record<string, any>;
}

export function classifyError(error: Error): ClassifiedError {
  // 网络错误
  if (isNetworkError(error)) {
    return {
      type: ErrorType.NETWORK_ERROR,
      retryable: true,
      message: '网络连接失败',
      originalError: error,
    };
  }

  // 超时错误
  if (isTimeoutError(error)) {
    return {
      type: ErrorType.TIMEOUT_ERROR,
      retryable: true,
      message: '请求超时',
      originalError: error,
    };
  }

  // ... 其他错误类型

  // 默认: 未知错误，不重试
  return {
    type: ErrorType.BUSINESS_ERROR,
    retryable: false,
    message: error.message,
    originalError: error,
  };
}
```

### Layer 2: 重试策略

```typescript
// src/utils/retry-strategy.ts

export interface RetryStrategy {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  shouldRetry: (error: ClassifiedError, attempt: number) => boolean;
  onRetry?: (error: ClassifiedError, attempt: number, delay: number) => void;
  onFailure?: (error: ClassifiedError) => void;
}

// Agent 专用重试策略
export const AGENT_RETRY_STRATEGY: RetryStrategy = {
  maxRetries: 3,
  initialDelay: 2000,      // 2秒
  maxDelay: 30000,         // 30秒
  backoffMultiplier: 2,
  shouldRetry: (error, attempt) => {
    // 最多重试 3 次
    if (attempt >= 3) return false;

    // 只重试可重试的错误
    return error.retryable;
  },
  onRetry: (error, attempt, delay) => {
    console.warn(
      `[Agent Retry] 第 ${attempt} 次失败: ${error.message}. ` +
      `${delay/1000}秒后重试...`
    );
  },
  onFailure: (error) => {
    console.error(`[Agent] 最终失败: ${error.message}`);
    // 记录到错误统计
    ErrorTracker.record(error);
  },
};

// Subagent 专用重试策略
export const SUBAGENT_RETRY_STRATEGY: RetryStrategy = {
  maxRetries: 2,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  shouldRetry: (error, attempt) => {
    if (attempt >= 2) return false;
    return error.retryable;
  },
  onRetry: (error, attempt, delay) => {
    console.warn(`[Subagent Retry] 第 ${attempt} 次失败，${delay}ms后重试`);
  },
};
```

### Layer 3: 熔断器

```typescript
// src/utils/circuit-breaker.ts

export enum CircuitState {
  CLOSED,      // 正常状态
  OPEN,        // 熔断状态（快速失败）
  HALF_OPEN,   // 半开状态（尝试恢复）
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private successCount: number = 0;

  constructor(
    private readonly threshold: number = 5,      // 失败阈值
    private readonly timeout: number = 60000,    // 熔断超时
    private readonly successThreshold: number = 3 // 恢复阈值
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // OPEN 状态：快速失败
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastFailureTime;

      // 超时后进入 HALF_OPEN
      if (elapsed > this.timeout) {
        this.state = CircuitState.HALF_OPEN;
        console.log('[CircuitBreaker] 进入半开状态，尝试恢复');
      } else {
        throw new Error('服务暂时不可用（熔断保护中）');
      }
    }

    try {
      const result = await fn();

      // 成功处理
      this.onSuccess();

      return result;
    } catch (error) {
      // 失败处理
      this.onFailure();

      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      // 连续成功达到阈值，恢复为 CLOSED
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        console.log('[CircuitBreaker] 服务已恢复正常');
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.successCount = 0;

    // 失败次数达到阈值，熔断
    if (this.failureCount >= this.threshold) {
      this.state = CircuitState.OPEN;
      console.error(
        `[CircuitBreaker] 熔断保护启动（连续失败 ${this.failureCount} 次）`
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
```

### Layer 4: 错误追踪和统计

```typescript
// src/utils/error-tracker.ts

export interface ErrorStats {
  type: ErrorType;
  count: number;
  lastOccurrence: Date;
  sample: ClassifiedError;
}

export class ErrorTracker {
  private static stats: Map<ErrorType, ErrorStats> = new Map();
  private static readonly MAX_SAMPLES = 100;

  static record(error: ClassifiedError): void {
    const existing = this.stats.get(error.type);

    if (existing) {
      existing.count++;
      existing.lastOccurrence = new Date();
    } else {
      this.stats.set(error.type, {
        type: error.type,
        count: 1,
        lastOccurrence: new Date(),
        sample: error,
      });
    }

    // 持久化到文件（定期）
    this.persistIfNeeded();
  }

  static getStats(): ErrorStats[] {
    return Array.from(this.stats.values())
      .sort((a, b) => b.count - a.count);
  }

  static getHealthStatus(): {
    healthy: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    const now = Date.now();
    const oneHour = 3600000;

    // 检查最近 1 小时的错误
    for (const stat of this.stats.values()) {
      const timeSinceLast = now - stat.lastOccurrence.getTime();

      if (timeSinceLast < oneHour) {
        if (stat.type === ErrorType.INSUFFICIENT_BALANCE) {
          issues.push(`余额不足（最近 1 小时出现 ${stat.count} 次）`);
        } else if (stat.count > 10) {
          issues.push(`${stat.type}: ${stat.count} 次错误`);
        }
      }
    }

    return {
      healthy: issues.length === 0,
      issues,
    };
  }

  private static persistIfNeeded(): void {
    // TODO: 定期持久化到 data/error-stats.json
  }
}
```

### Layer 5: 检查点机制

```typescript
// src/utils/checkpoint.ts

export interface Checkpoint {
  id: string;
  timestamp: Date;
  type: 'agent' | 'subagent' | 'session';
  status: 'pending' | 'completed' | 'failed';
  data: {
    sessionId?: string;
    messages?: Message[];
    subagentId?: string;
    task?: string;
  };
  error?: ClassifiedError;
}

export class CheckpointManager {
  private readonly checkpointsDir: string;

  constructor(dataDir: string) {
    this.checkpointsDir = path.join(dataDir, 'checkpoints');
    fs.ensureDirSync(this.checkpointsDir);
  }

  create(checkpoint: Checkpoint): void {
    const file = path.join(
      this.checkpointsDir,
      `${checkpoint.id}.json`
    );

    fs.writeJSONSync(file, checkpoint, { spaces: 2 });
  }

  load(id: string): Checkpoint | null {
    const file = path.join(this.checkpointsDir, `${id}.json`);

    if (!fs.existsSync(file)) {
      return null;
    }

    return fs.readJSONSync(file);
  }

  // 恢复未完成的检查点
  recoverPending(): Checkpoint[] {
    const files = fs.readdirSync(this.checkpointsDir);

    return files
      .map(f => fs.readJSONSync(path.join(this.checkpointsDir, f)))
      .filter(c => c.status === 'pending');
  }

  // 清理旧的检查点（7天前）
  cleanup(): number {
    const files = fs.readdirSync(this.checkpointsDir);
    const now = Date.now();
    const sevenDays = 7 * 24 * 3600000;
    let cleaned = 0;

    for (const file of files) {
      const checkpoint = fs.readJSONSync(
        path.join(this.checkpointsDir, file)
      );

      if (now - checkpoint.timestamp.getTime() > sevenDays) {
        fs.removeSync(path.join(this.checkpointsDir, file));
        cleaned++;
      }
    }

    return cleaned;
  }
}
```

---

## 🔧 实现计划

### Phase 1: 错误处理基础（1-2天）

**目标**: 建立错误分类和处理基础设施

1. ✅ 创建 `src/utils/error-handler.ts`
   - 错误分类函数
   - 错误类型枚举
   - 辅助函数

2. ✅ 创建 `src/utils/retry-strategy.ts`
   - Agent/Subagent 重试策略
   - 工具重试策略

3. ✅ 集成到 Session
   - `continueConversation` 使用重试
   - 保留对话上下文

4. ✅ 集成到 Subagent
   - `spawnSubagent` 使用重试
   - 记录重试日志

### Phase 2: 熔断和保护（1天）

**目标**: 防止错误雪崩

1. ✅ 创建 `src/utils/circuit-breaker.ts`
2. ✅ Agent 级别熔断
3. ✅ Subagent 级别熔断
4. ✅ 工具执行熔断

### Phase 3: 监控和统计（1天）

**目标**: 可观测性

1. ✅ 创建 `src/utils/error-tracker.ts`
2. ✅ 错误统计 API
3. ✅ 健康检查端点
4. ✅ CLI 命令 `/health`

### Phase 4: 检查点和恢复（1-2天）

**目标**: 数据不丢失

1. ✅ 创建 `src/utils/checkpoint.ts`
2. ✅ Agent 执行前保存检查点
3. ✅ 失败后恢复检查点
4. ✅ 定期清理旧检查点

### Phase 5: 优雅降级（1天）

**目标**: 部分失败不影响整体

1. ✅ 工具执行失败降级
2. ✅ Subagent 失败降级
3. ✅ Memory 加载失败降级
4. ✅ Skill 执行失败降级

---

## 📝 配置选项

```typescript
// beeclaw.json

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
    },
    "circuitBreaker": {
      "enabled": true,
      "threshold": 5,
      "timeout": 60000
    },
    "checkpoint": {
      "enabled": true,
      "cleanupDays": 7
    }
  }
}
```

---

## 🎯 成功指标

### 可靠性指标

- **MTBF (平均故障间隔)**: > 72小时
- **MTTR (平均恢复时间)**: < 30秒
- **成功率**: > 99.5%

### 错误处理指标

- **重试成功率**: > 80%（临时故障通过重试恢复）
- **熔断触发次数**: < 1次/天
- **检查点恢复成功率**: > 95%

### 性能指标

- **重试开销**: < 10%（平均增加时间）
- **熔断响应时间**: < 10ms
- **错误追踪开销**: < 5%

---

## 🚀 下一步

1. **立即实施**: Phase 1（错误处理基础）
2. **本周完成**: Phase 2-3（熔断和监控）
3. **下周完成**: Phase 4-5（检查点和降级）

---

## 📚 参考资料

- [Netflix Hystrix](https://github.com/Netflix/Hystrix) - 熔断器模式
- [Resilience4j](https://github.com/resilience4j/resilience4j) - 容错库
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html) - Martin Fowler
