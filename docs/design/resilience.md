# BeeClaw Resilience 集成指南

## 概述

本文档提供 BeeClaw 音性模块的集成指南，帮助开发者快速上手。

## 快速开始

### 1. 选择配置预设

根据任务复杂度选择合适的预设：

```typescript
import { createResilienceContext } from './agent/resilience-integration';
import { ResilienceConfig } from './config/resilience-config';

// 快速任务
const quickCtx = createResilienceContext({ preset: 'quick_task' });

// 标准任务
const standardCtx = createResilienceContext({ preset: 'standard' });

// 复杂研究
const researchCtx = createResilienceContext({ preset: 'complex_research' });

// 长时运行
const longRunningCtx = createResilienceContext({ preset: 'long_running' });
```

### 2. 壽性检查点示例

```typescript
// 检查预算
const budgetStatus = ctx.budget.check();

if (budgetStatus.recommendation === 'abort') {
  console.log('预算耗尽，停止执行');
  return 'exit';
}

if (budgetStatus.recommendation === 'wrap_up') {
  // 注入警告消息
  const warning = ctx.budget.generateBudgetWarning(budgetStatus);
  if (warning) {
    // 添加到消息历史
    messages.push({ role: 'system', content: warning });
  }
}

// 检查 Turn 超时
ctx.timeout.checkTurn({ iteration: 5 });
```

### 3. 工具调用示例

```typescript
// 执行单个工具
const result = await ctx.timeout.wrapToolCall('search', async () => {
  return await executeTool('search', { query: 'AI' });
});

// 并行执行多个工具
const toolRequests = [
  { id: '1', name: 'search', arguments: { query: 'AI' } },
  { id: '2', name: 'browse', arguments: { url: 'https://example.com' } },
  { id: '3', name: 'analyze', arguments: { text: 'some text' } }
];

const batchSummary = await ctx.executor.executeBatch(
  toolRequests,
  async (name, args, signal) => {
    return await executeTool(name, args, signal);
  }
);
```

### 4. 错误处理

```typescript
// 捶循检测
for (const toolCall of llmResponse.toolCalls) {
  const loopResult = ctx.loopDetector.check(toolCall.name, toolCall.arguments);

  if (loopResult.action === 'warn') {
    // 添加警告到消息历史
    messages.push({ role: 'system', content: loopResult.warningMessage });
    ctx.loopDetector.acknowledgeWarning();
  } else if (loopResult.action === 'break') {
    console.log('检测到严重循环，终止执行');
    break;
  }
}

// 熔断器
try {
  const result = await ctx.circuitBreakers.execute('failing_tool', async () => {
    throw new Error('Tool failed');
  });
} catch (error) {
  if (error instanceof CircuitOpenError) {
    console.log(`工具 ${error.toolName} 被熔断`);
  }
}
```

### 5. 集成到现有 Agent

```typescript
import { Agent } from './index';

export class MyAgent extends Agent {
  private resilience: ResilienceContext;

  constructor(options: AgentOptions) {
    super(options);
    this.resilience = createResilienceContext({
      preset: 'standard',
      overrides: {
        budget: { maxToolCalls: 50 }
      }
    });
  }

  async chat(message: string): Promise<string> {
    // 启动监控
    this.resilience.timeout.start();
    this.resilience.monitor.startPeriodicCheck();

    try {
      const messages = [{ role: 'user', content: message }];
      let iterations = 0;

      while (true) {
        // 检查超时和预算
        this.resilience.timeout.checkTurn({ iteration: iterations });
        const budgetStatus = this.resilience.budget.check();
        if (budgetStatus.recommendation === 'abort') {
          return '预算耗尽，请简化您的请求。';
        }

        // LLM 调用
        const response = await this.resilience.timeout.wrapLLMCall(
          async (signal) => {
            return await this.callLLM(messages, signal);
          },
          { streaming: false }
        );

        this.resilience.budget.recordLLMCall({
          inputTokens: this.estimateTokens(messages),
          outputTokens: this.estimateTokens([response]),
          model: this.model,
          iteration: iterations,
        });

        if (!response.toolCalls || response.toolCalls.length === 00 {
          return response.content;
        }

        // 工具调用
        const toolResults = await this.resilience.executor.executeBatch(
          response.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          })),
          async (name, args, signal) => {
            return await this.executeTool(name, args, signal);
          }
        );

        // 更新消息历史
        // ...
        iterations++;
      }
    } finally {
      this.resilience.timeout.stop();
      this.resilience.monitor.stopPeriodicCheck();
      console.log(this.resilience.monitor.generateReport());
    }
  }
}
```

## 配置说明

### 预设对比

| 騡块 | quick_task | standard | complex_research | long_running |
|------|-----------|----------|------------------|-------------|
| Turn 超时 | 2 min | 10 min | 30 min | 60 min |
| 最大工具调用 | 5 | 30 | 100 | 300 |
| 最大 Token | 20K | 100K | 500K | 1M |
| 最大成本 | $0.5 | $5 | $25 | $50 |
| 并行度 | 3 | 5 | 8 | 10 |
| 熔断阈值 | 3 | 5 | 8 | 10 |
| 检查点间隔 | 禁用 | 5 步 | 3 步 | 2 步 |

### 环境变量覆写

所有配置都可以通过环境变量覆写：

```bash
# 设置 Turn 超时为 15 分钟
export BEECLAW_RESILIENCE_TIMEOUT_TURN_TIMEOUT_MS=900000

# 设置最大工具调用
export BEECLAW_RESILIENCE_BUDGET_MAX_TOOL_CALLS=50

# 设置熔断阈值
export BEECLAW_RESILIENCE_CIRCUIT_BREAKER_FAILURE_THRESHOLD=8
```

环境变量命名规则：
```
BEECLAW_RESILIENCE_{SECTION}_{KEY}
```

示例:
- `BEECLAW_RESILIENCE_TIMEOUT_REQUEST_TIMEOUT_MS`
- `BEECLAW_RESILIENCE_BUDGET_MAX_TOKENS`
- `BEECLAW_RESILIENCE_CIRCUIT_BREAKER_FAILURE_THRESHOLD`

## API 参考

### ResilienceContext

```typescript
interface ResilienceContext {
  config: ResilienceConfig;
  timeout: TimeoutOrchestrator;
  loopDetector: LoopDetector;
  circuitBreakers: CircuitBreakerRegistry;
  budget: BudgetManager;
  checkpoint: CheckpointManager;
  retry: UnifiedRetryEngine;
  executor: ParallelToolExecutor;
  monitor: ProgressAwareMonitor;
}
```

### createResilienceContext

```typescript
function createResilienceContext(options?: {
  preset?: PresetName;
  overrides?: Partial<ResilienceConfig>;
}): ResilienceContext
```

### 示例用法

```typescript
// 壤创建并使用
const ctx = createResilienceContext({ preset: 'standard' });

// 使用超时保护
const result = await ctx.timeout.wrapLLMCall(async () => {
  return await callLLM(params);
});

// 使用熔断器
const result = await ctx.circuitBreakers.execute('search', async () => {
  return await search(params);
});

// 检查预算
const status = ctx.budget.check();
if (status.recommendation === 'abort') {
  throw new Error('Budget exceeded');
}
```

## 娡块详解

### 1. 超时体系

**四层架构**
- L1: 请求级 - 单次 HTTP 请求
- L2: 步骤级 - 单次 LLM/工具调用
- L3: 轮次级 - 整个对话轮次
- L4: 不活跃级 - 长时间无活动

**关键方法**
- `ctx.timeout.start()` - 启动监控
- `ctx.timeout.checkTurn()` - 检查轮次超时
- `ctx.timeout.wrapLLMCall()` - 包装 LLM 调用
- `ctx.timeout.wrapToolCall()` - 包装工具调用
- `ctx.timeout.stop()` - 停止监控

### 2. 循环检测

**三级检测**
- Level 1: 精确重复 - 完全相同的参数
- Level 2: 语义重复 - 高度相似的参数
- Level 3: 进度停滞 - 无新信息产生

**关键方法**
- `ctx.loopDetector.check()` - 检测循环
- `ctx.loopDetector.recordToolCall()` - 记录调用
- `ctx.loopDetector.recordToolResult()` - 记录结果
- `ctx.loopDetector.acknowledgeWarning()` - 确认警告

### 3. 熔断器

**三态机**
- CLOSED: 正常状态
- OPEN: 熔断状态
- HALF_OPEN: 探测状态

**关键方法**
- `ctx.circuitBreakers.execute()` - 执行带保护
- `ctx.circuitBreakers.getBreaker()` - 获取断路器
- `ctx.circuitBreakers.getAllStats()` - 获取所有状态

- `ctx.circuitBreakers.getOpenCircuits()` - 获取熔断的工具

### 4. 预算管理

**四维预算**
- Token 预算
- 工具调用次数
- 墙钟时间
- 估算成本

**关键方法**
- `ctx.budget.check()` - 检查预算状态
- `ctx.budget.recordLLMCall()` - 记录 LLM 调用
- `ctx.budget.recordToolCall()` - 记录工具调用
- `ctx.budget.generateBudgetWarning()` - 生成警告

- `ctx.budget.generateReport()` - 生成报告

### 5. 并行执行

**关键方法**
- `ctx.executor.executeBatch()` - 并行执行多个工具
- `ParallelToolExecutor.formatForLLM()` - 格式化结果给 LLM

### 6. 进度监控

**关键方法**
- `ctx.monitor.recordLLMResponse()` - 记录 LLM 响应
- `ctx.monitor.recordToolResult()` - 记录工具结果
- `ctx.monitor.recordError()` - 讯录错误
- `ctx.monitor.checkStall()` - 检查进度停滞
- `ctx.monitor.generateReport()` - 生成报告

## 最佳实践

### 1. 选择合适的预设
- **快速任务** - 简单查询、小修改， 适合 `quick_task`
- **标准任务** - 一般性工作， 适合 `standard`
- **复杂研究** - 深度分析, 研究， 适合 `complex_research`
- **长时运行** - 批量处理, 后台任务， 适合 `long_running`

### 2. 监控和日志

```typescript
// 盝始化时添加监听器
ctx.timeout.onTimeout((event) => {
  console.log(`[Timeout] ${event.layerName}: ${event.reason}`);
});

ctx.circuitBreakers.onEvent((event) => {
  if (event.type === 'state_change') {
    console.log(`[Circuit Breaker] ${event.circuitName}: ${event.previousState} -> ${event.currentState}`);
  }
});

// 定期输出报告
setInterval(() => {
  console.log(ctx.monitor.generateReport());
  console.log(ctx.budget.generateReport());
}, 60000);
```

### 3. 错误处理

```typescript
try {
  // 使用熔断器
  const result = await ctx.circuitBreakers.execute('tool_name', async () => {
    return await riskyOperation();
  });
} catch (error) {
  if (error instanceof CircuitOpenError) {
    // 工具被熔断， 使用替代方案
    return fallbackResult();
  }
  throw error;
}
```

### 4. 资源清理

```typescript
// 在 finally 块中确保清理资源
try {
  // ... 使用韧性模块 ...
} finally {
  ctx.timeout.stop();
  ctx.monitor.stopPeriodicCheck();
  ctx.monitor.dispose();
}
```

## 故障排查

### 常见问题

**Q: 徣什么工具一直被熔断？**
A: 检查熔断器状态
```typescript
const openCircuits = ctx.circuitBreakers.getOpenCircuits();
console.log('Open circuits:', openCircuits);

// 查看具体工具的统计
const stats = ctx.circuitBreakers.getBreaker('tool_name').getStats();
console.log('Stats:', stats);
```

**Q: 如何调整超时设置?**
A: 使用环境变量或 或配置覆写
```typescript
// 方法 1: 环境变量
// export BEECLAW_RESILIENCE_TIMEOUT_TURN_TIMEOUT_MS=900000

// 方法 2: 配置覆写
const ctx = createResilienceContext({
  preset: 'standard',
  overrides: {
    timeout: { turnTimeoutMs: 900_000 }
  }
});
```

**Q: 如何处理预算超限?**
A: 检查预算状态并提前处理
```typescript
const status = ctx.budget.check();

if (status.recommendation === 'wrap_up') {
  // 注入警告消息
  const warning = ctx.budget.generateBudgetWarning(status);
  if (warning) {
    messages.push({ role: 'system', content: warning });
  }
}

if (status.recommendation === 'abort') {
  // 保存检查点并退出
  await ctx.checkpoint.save({
    turnId: sessionId,
    iteration: iterations,
    messages,
    // ...
  });
  return '预算耗尽, 请简化您的请求。';
}
```

## 进阶话题

### 1. 检查点恢复

当 Agent 因错误中断时，可以从检查点恢复

```typescript
// 恢复检查点
const restored = await ctx.checkpoint.restore(sessionId, 'resume');

if (restored.success) {
  // 使用恢复的消息历史
  messages = restored.checkpoint.messages;
  const startIteration = restored.checkpoint.iteration;

  // 继续执行...
}
```

### 2. 动态调整

根据运行时情况动态调整参数

```typescript
// 根据进度调整超时
const stallResult = ctx.monitor.checkStall();
if (stallResult.trend === 'decelerating') {
  // 可能需要增加超时
  const newTimeout = stallResult.adaptiveTimeoutMs;
  // 应用新超时...
}
```

### 3. 性能优化

- 使用内存存储加速检查点
- 调整监控窗口大小
- 优化循环检测参数

## 总结

BeeClaw 的韧性模块提供了一套完整的工具来构建健壮的 AI Agent。 通过合理配置和使用这些模块，可以显著提升 Agent 的稳定性和可靠性.

**关键要点**
1. 根据任务选择合适的预设
2. 添加监控和日志
3. 正确处理错误和异常
4. 及时清理资源
5. 使用检查点支持长时间运行的任务

**下一步**
- 阅读各模块的详细文档
- 查看测试用例了解更多用法
- 在测试环境验证集成
- 根据实际情况调优参数
