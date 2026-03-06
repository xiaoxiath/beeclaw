# 任务处理重构 - 统一抽象

## 重构动机

之前 `run_skill` 等任务处理逻辑在两个地方重复实现：
- `src/bot.ts` - Feishu Bot 模式的 `onJob` 回调
- `src/proactive/daemon.ts` - CLI 模式的默认处理器

这违反了 DRY (Don't Repeat Yourself) 原则，导致：
1. **代码重复** - 相同逻辑写两遍
2. **维护成本高** - 修改需要同时改两个地方
3. **容易出错** - 两处实现可能不一致

## 重构方案

### 1. 创建统一的任务处理器

新建 `src/proactive/job-handlers.ts`，包含所有任务类型的处理函数：

```typescript
// 导出的处理函数
export async function handleRunSkillJob(job, options?) { ... }
export async function handleLlmProactiveChatJob(job, options?) { ... }
export async function handleSelfEvolutionJob(job) { ... }
export async function handleMemoryCompressJob() { ... }
export async function handleGoalProgressCheckJob() { ... }
export async function handleCustomJob(job) { ... }
export async function handleSendReminderJob(job, options?) { ... }
```

### 2. 更新调用方

#### src/bot.ts
```typescript
// 之前：~180 行的 switch 语句
switch (job.taskType) {
  case 'run_skill': {
    // 80+ 行的实现代码
  }
  case 'llm_proactive_chat': {
    // 60+ 行的实现代码
  }
  // ...
}

// 之后：简洁的调用
const {
  handleRunSkillJob,
  handleLlmProactiveChatJob,
  // ...
} = await import('./proactive/job-handlers');

switch (job.taskType) {
  case 'run_skill':
    await handleRunSkillJob(job, { getFeishuClient: getFeishuWSClient });
    break;
  case 'llm_proactive_chat':
    await handleLlmProactiveChatJob(job, { getFeishuClient: getFeishuWSClient });
    break;
  // ...
}
```

#### src/proactive/daemon.ts
```typescript
// 同样的模式
const {
  handleRunSkillJob,
  handleLlmProactiveChatJob,
  // ...
} = await import('./job-handlers');

switch (job.taskType) {
  case 'run_skill':
    await handleRunSkillJob(job);
    break;
  // ...
}
```

## 代码量对比

| 文件 | 重构前 | 重构后 | 减少 |
|------|--------|--------|------|
| `src/bot.ts` | ~350 行 | 246 行 | -104 行 |
| `src/proactive/daemon.ts` | ~500 行 | 381 行 | -119 行 |
| `src/proactive/job-handlers.ts` | 0 行 | 273 行 | +273 行 |
| **总计** | ~850 行 | 900 行 | +50 行 |

虽然总行数略有增加，但：
- **消除重复代码** 223 行
- **提高可维护性** - 只需在一个地方修改
- **增强可测试性** - 可以单独测试每个处理函数
- **更好的关注点分离** - 业务逻辑与执行上下文分离

## 设计特点

### 1. 依赖注入

处理函数通过 `options` 参数接收依赖，而不是直接导入：

```typescript
export async function handleRunSkillJob(
  job: ProactiveJobData,
  options?: {
    getFeishuClient?: () => any;
  }
): Promise<void> {
  const client = options?.getFeishuClient?.();
  // ...
}
```

**好处：**
- Bot 模式可以传入 `getFeishuWSClient`
- CLI 模式可以不传（使用默认行为）
- 测试时可以 mock

### 2. 向后兼容

保持参数的向后兼容性：

```typescript
// 同时支持驼峰和下划线命名
const skillName = job.params?.skillName as string
               || job.params?.skill_name as string;
```

### 3. 统一的错误处理

所有处理函数都有统一的错误处理模式：

```typescript
try {
  // 执行逻辑
  console.log('[Daemon] ✅ Task succeeded');
} catch (error) {
  console.error('[Daemon] ❌ Task failed:', error);
}
```

## 架构图

```
┌─────────────────────────────────────────────────────┐
│                   任务触发                           │
│  (Cron / Manual / Queue)                            │
└──────────────────┬──────────────────────────────────┘
                   │
       ┌───────────┴───────────┐
       │                       │
   ┌───▼────┐            ┌────▼───┐
   │Bot Mode│            │CLI Mode│
   └───┬────┘            └────┬───┘
       │                      │
       │ onJob callback       │ executeDefaultJobHandler
       │                      │
       └──────────┬───────────┘
                  │
         ┌────────▼─────────┐
         │  Job Handlers    │
         │  (统一处理逻辑)   │
         └──────────────────┘
                  │
       ┌──────────┴───────────┐
       │                      │
   ┌───▼────┐            ┌────▼───┐
   │Session │            │ Skills │
   │Manager │            │ Store  │
   └────────┘            └────────┘
```

## 测试

所有测试通过：
- ✅ `src/proactive/__tests__/daemon.test.ts` - 20 个测试

## 扩展性

添加新的任务类型只需要：

1. 在 `job-handlers.ts` 中添加处理函数：
```typescript
export async function handleNewTaskJob(job: ProactiveJobData): Promise<void> {
  // 实现逻辑
}
```

2. 在 `bot.ts` 和 `daemon.ts` 的 switch 中添加：
```typescript
case 'new_task':
  await handleNewTaskJob(job);
  break;
```

## 未来改进

1. **配置化** - 通过配置文件定义任务类型和处理函数的映射
2. **插件化** - 支持动态加载任务处理器
3. **中间件** - 添加任务执行前后的中间件钩子
4. **类型安全** - 使用更严格的类型定义每个任务类型的参数

## 相关文档

- [定时执行技能指南](./scheduled-skill-execution.md)
- [主动式能力指南](./proactive-capabilities-guide.md)
- [run_skill 最终修复](./run-skill-final-fix.md)
