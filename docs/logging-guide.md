# 日志增强指南

Beeclaw 现在包含增强的日志系统，可以详细记录 LLM 的工具调用和技能使用情况。

## 日志级别

### 1. 工具调用决策日志

当 LLM 决定调用工具时，会输出：

```
================================================================================
[Agent] LLM decided to call 3 tool(s):
  1. web_search({"query":"人工智能最新进展","num_results":10})
  2. memory_read({"path":"facts/preferences.md"})
  3. skill_get({"name":"news-aggregator"})
================================================================================
```

### 2. 工具执行计划

显示工具的并行/串行执行计划：

```
[Tool Execution Plan]
  Total calls: 3
  Parallel batches: 2
  Sequential batches: 1
  Max parallelism: 2
  Batch 1: web_search, memory_read
  Batch 2: skill_get
```

### 3. 批次执行日志

#### 批次开始
```
[Batch Execution] Starting batch with 2 tool(s)...
```

#### 单个工具执行
```
  [Executing] web_search({"query":"人工智能最新进展","num_results":10})
  [Completed] web_search (1523ms): {"success":true,"results":[...]}
```

#### 批次完成
```
[Batch Complete] 2 tools executed in 1523ms (parallel)
  Tools: web_search, memory_read
```

### 4. 技能使用日志

技能调用有特殊的标记：

```
[Skill] 🎯 Getting skill: news-aggregator
[Skill] ✅ Skill "news-aggregator" loaded and will be used
[Skill] 📝 Recording skill usage: news-aggregator (success)
```

### 5. 会话总结

每次对话结束后输出总结：

```
================================================================================
[Conversation Summary]
  Iterations: 2
  Skills used: news-aggregator, web-scraper
  Context: 15234 / 120000 tokens (13%)
================================================================================
```

## 日志格式说明

### 工具调用格式

```
[Tool Call] <tool_name>
  Parameters: <formatted_json>

[Tool Result] <tool_name> (<elapsed_ms>ms)
  Result: <result_preview>
```

### 错误格式

```
[Tool Error] <tool_name>: <error_message>
```

或

```
  [Failed] <tool_name>: <error_message>
```

## 日志位置

### CLI 模式

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

查看实时日志：
```bash
bun run pm2:logs
```

查看错误日志：
```bash
bun run pm2:logs:err
```

## 日志分析示例

### 查找所有技能使用

```bash
grep "\[Skill\]" logs/beeclaw-out.log
```

### 查找工具调用失败

```bash
grep "\[Failed\]\|\[Tool Error\]" logs/beeclaw-error.log
```

### 查看对话统计

```bash
grep "\[Conversation Summary\]" logs/beeclaw-out.log
```

### 查找特定工具的调用

```bash
grep "web_search" logs/beeclaw-out.log
```

## 性能监控

日志包含执行时间，可以用来监控性能：

```
[Tool Complete] web_search in 1523ms
[Batch Complete] 3 tools executed in 2341ms (parallel)
```

## 调试技巧

### 1. 追踪技能使用

```bash
tail -f logs/beeclaw-out.log | grep --line-buffered "\[Skill\]"
```

### 2. 监控工具调用

```bash
tail -f logs/beeclaw-out.log | grep --line-buffered "\[Executing\]\|\[Completed\]\|\[Failed\]"
```

### 3. 查看对话流程

```bash
tail -f logs/beeclaw-out.log | grep --line-buffered "LLM decided\|Batch\|Skill\|Conversation Summary"
```

## 日志文件管理

### 清空日志

```bash
bun run pm2:flush
```

### 重置日志计数器

```bash
bun run pm2:reset
```

### 日志轮转

PM2 配置中已启用日志时间戳，建议设置 logrotate 进行日志轮转。

## 注意事项

1. **日志量**：详细日志会增加日志量，生产环境可以考虑调整日志级别
2. **敏感信息**：参数预览会截断长字符串，但要注意避免记录敏感信息
3. **性能影响**：日志输出对性能影响很小，但在高负载场景下可以考虑优化

## 配置选项

目前日志是默认启用的。未来版本可能会添加配置选项来控制日志详细程度。

计划中的配置选项：
- `logging.logToolCalls`: 是否记录工具调用（默认 true）
- `logging.logSkillUsage`: 是否记录技能使用（默认 true）
- `logging.logPerformance`: 是否记录性能指标（默认 true）
- `logging.maxResultPreview`: 结果预览最大长度（默认 150）
