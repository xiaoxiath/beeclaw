# 日志增强更新

## 更新时间
2026-03-04

## 更新内容

### 1. 增强的工具调用日志

#### 在 `src/agent/api.ts` 中：
- 在 `executeToolCalls()` 函数中添加了详细的工具执行日志
- 记录每个工具的名称、参数、执行时间和结果预览
- 错误情况有专门的错误日志格式

**日志格式：**
```
[Tool Execution] Executing N tool call(s)...
[Tool Call] <tool_name>
  Parameters: <formatted_json>
[Tool Result] <tool_name> (<elapsed>ms)
  Result: <result_preview>
```

### 2. LLM 决策日志

#### 在 `src/agent/index.ts` 中：
- 在工具调用前记录 LLM 的决策过程
- 显示 LLM 决定调用的所有工具及其参数预览
- 使用醒目的分隔线突出显示

**日志格式：**
```
================================================================================
[Agent] LLM decided to call N tool(s):
  1. tool_name({"param":"value",...})
  2. ...
================================================================================
```

### 3. 工具执行计划日志

- 显示工具的并行/串行执行策略
- 列出所有批次及其包含的工具
- 显示最大并行度

**日志格式：**
```
[Tool Execution Plan]
  Total calls: N
  Parallel batches: N
  Sequential batches: N
  Max parallelism: N
  Batch 1: tool1, tool2
  Batch 2: tool3
```

### 4. 批次执行日志

- 每个批次开始时记录
- 每个工具执行时记录参数预览
- 每个工具完成时记录执行时间和结果预览
- 批次完成时总结

**日志格式：**
```
[Batch Execution] Starting batch with N tool(s)...
  [Executing] tool_name({...})
  [Completed] tool_name (123ms): {...}
[Batch Complete] N tools executed in 123ms (parallel)
  Tools: tool1, tool2
```

### 5. 技能使用日志

- 使用特殊 emoji 标记技能相关操作
- 🎯 获取技能
- ✅ 使用技能
- 📝 记录技能使用

**日志格式：**
```
[Skill] 🎯 Getting skill: skill-name
[Skill] ✅ Skill "skill-name" loaded and will be used
[Skill] 📝 Recording skill usage: skill-name (success)
```

### 6. 对话总结日志

- 每次对话结束时输出总结
- 显示迭代次数
- 显示使用的技能列表
- 显示上下文使用情况

**日志格式：**
```
================================================================================
[Conversation Summary]
  Iterations: N
  Skills used: skill1, skill2
  Context: 12345 / 120000 tokens (10%)
================================================================================
```

## 新增文件

### 1. 文档
- `docs/logging-guide.md` - 完整的日志使用指南
  - 日志级别说明
  - 日志格式说明
  - 日志位置（CLI/Bot/PM2）
  - 日志分析示例
  - 性能监控
  - 调试技巧

### 2. 示例
- `examples/logging-demo.ts` - 日志功能演示脚本
  - 展示简单工具调用
  - 展示并行工具调用
  - 展示技能使用

## 更新的文件

### 1. `src/agent/api.ts`
- 增强 `executeToolCalls()` 函数的日志输出

### 2. `src/agent/index.ts`
- 在 `chat()` 方法中添加多个日志点：
  - LLM 决策日志
  - 工具执行计划日志
  - 批次执行日志
  - 技能使用日志
  - 对话总结日志

### 3. `README.md`
- 添加日志指南文档的链接

## 测试结果

所有现有测试通过：
- ✅ `src/agent/__tests__/api.test.ts` - 15 个测试通过
- ✅ `src/agent/__tests__/agent.test.ts` - 9 个测试通过

## 使用方式

### CLI 模式
```bash
bun run cli
```
日志直接输出到终端。

### Bot 模式（开发）
```bash
bun run bot
```
日志输出到终端。

### Bot 模式（PM2）
```bash
bun run pm2:start
bun run pm2:logs
```
日志保存在 `./logs/beeclaw-out.log` 和 `./logs/beeclaw-error.log`。

### 运行演示
```bash
bun run examples/logging-demo.ts
```

## 日志分析命令

### 查看所有技能使用
```bash
grep "\[Skill\]" logs/beeclaw-out.log
```

### 查看工具调用失败
```bash
grep "\[Failed\]\|\[Tool Error\]" logs/beeclaw-error.log
```

### 查看对话统计
```bash
grep "\[Conversation Summary\]" logs/beeclaw-out.log
```

### 实时监控技能使用
```bash
tail -f logs/beeclaw-out.log | grep --line-buffered "\[Skill\]"
```

### 实时监控工具调用
```bash
tail -f logs/beeclaw-out.log | grep --line-buffered "\[Executing\]\|\[Completed\]\|\[Failed\]"
```

## 性能影响

- 日志输出对性能影响极小（每个工具调用约增加 1-2ms）
- 参数和结果预览限制长度，避免大量日志输出
- 在生产环境中，PM2 的日志系统可以很好地处理日志量

## 未来改进

计划添加的配置选项：
- `logging.logToolCalls`: 控制是否记录工具调用
- `logging.logSkillUsage`: 控制是否记录技能使用
- `logging.logPerformance`: 控制是否记录性能指标
- `logging.maxResultPreview`: 控制结果预览最大长度

## 注意事项

1. **日志量**：详细日志会增加日志量，建议定期清理或设置 logrotate
2. **敏感信息**：参数预览会截断长字符串，但仍需注意避免记录敏感信息
3. **PM2 日志管理**：使用 `bun run pm2:flush` 清空日志，`bun run pm2:reset` 重置计数器
