# Context Compression - 上下文压缩系统

## 概述

本模块实现了三层压缩架构（Three-Tier Compression），用于智能压缩 LLM 上下文，最大化信息密度同时保留关键信息。

### 三层压缩架构

| 层级 | 名称 | 压缩率 | 信息保留度 | 延迟 | 适用场景 |
|------|------|--------|-----------|------|---------|
| **L1** | 格式压缩 | 10-30% | ~99% | <1ms | 去除格式冗余（空行、空格、注释） |
| **L2** | 提取压缩 | 30-60% | ~85% | ~10ms | 提取关键句子（TextRank 算法） |
| **L3** | 抽象压缩 | 60-90% | ~70% | ~1s | LLM 语义摘要 |

### 渐进式压实（Progressive Compaction）

基于 LSM-Tree 思想的渐进式压实策略：
- **Hot 区（0-5 轮）**：无压缩
- **Warm 区（6-20 轮）**：L1 压缩
- **Cool 区（21-50 轮）**：L1+L2 压缩
- **Cold 区（51+ 轮）**：L1+L2+L3 压缩

## 快速开始

### 基础使用

```typescript
import { getTieredCompressor } from './domain/agent/compression';

// 获取压缩器实例
const compressor = getTieredCompressor();

// 根据上下文使用率自动压缩
const text = 'Long conversation history...';
const result = await compressor.compress(text, currentTokens, budgetTokens);

console.log(`压缩率: ${(result.ratio * 100).toFixed(1)}%`);
console.log(`耗时: ${result.latencyMs}ms`);
console.log(`压缩后: ${result.compressed}`);
```

### 配置 LLM 客户端（启用 L3 压缩）

```typescript
import { getTieredCompressor } from './domain/agent/compression';
import { callAI } from './domain/agent/api';

// 配置 LLM 客户端
const compressor = getTieredCompressor();
compressor.setLLMClient({
  async complete(prompt: string, maxTokens: number) {
    const response = await callAI({
      provider: yourProvider,
      model: 'glm-4-flash', // 使用快速模型
      messages: [{ role: 'user', content: prompt }],
      maxTokens,
    });
    return response.choices[0]?.message?.content || '';
  },
});
```

### 渐进式压实

```typescript
import { getProgressiveCompactor } from './domain/agent/compression';

const compactor = getProgressiveCompactor();

// 压实对话历史
const messages = [
  { turn: 1, role: 'user', content: 'First message' },
  { turn: 50, role: 'user', content: 'Middle message' },
  { turn: 100, role: 'user', content: 'Recent message' },
];

const result = await compactor.compact(messages, 100);

console.log(`总压缩率: ${(result.ratio * 100).toFixed(1)}%`);
console.log(`Hot 区消息: ${result.byZone['hot'].count}`);
console.log(`Cold 区消息: ${result.byZone['cold'].count}`);
```

## API 文档

### TieredCompressor

#### `compress(text, currentTokens?, budgetTokens?)`

自动规划并执行压缩。

```typescript
const result = await compressor.compress(
  text,           // 要压缩的文本
  currentTokens,  // 当前 token 数（可选，自动估算）
  budgetTokens    // token 预算（可选，默认为 currentTokens * 1.5）
);
```

**返回值：**
```typescript
interface CompressionResult {
  compressed: string;        // 压缩后的文本
  originalTokens: number;    // 原始 token 数
  compressedTokens: number;  // 压缩后 token 数
  ratio: number;             // 压缩率 (0-1)
  infoRetention: number;     // 信息保留度 (0-1)
  method: string;            // 使用的压缩方法
  latencyMs: number;         // 耗时（毫秒）
}
```

#### `plan(currentTokens, budgetTokens)`

仅生成压缩计划（不执行）。

```typescript
const plan = compressor.plan(90000, 100000);

console.log(plan.level);              // 'L1+L2+L3'
console.log(plan.estimatedRatio);     // 0.75
console.log(plan.estimatedLatency);   // '~1s'
console.log(plan.reason);             // 原因说明
```

#### `execute(text, plan, targetTokens?)`

执行指定的压缩计划。

```typescript
const plan = compressor.plan(90000, 100000);
const result = await compressor.execute(text, plan, 5000);
```

#### `getStats()`

获取压缩统计信息。

```typescript
const stats = compressor.getStats();

console.log(`总压缩次数: ${stats.totalCompressions}`);
console.log(`平均压缩率: ${(stats.avgRatio * 100).toFixed(1)}%`);
console.log(`节省 tokens: ${stats.totalTokensSaved}`);
```

### ProgressiveCompactor

#### `compact(messages, currentTurn)`

渐进式压实消息列表。

```typescript
const messages = [
  { turn: 1, role: 'user', content: 'Message 1' },
  { turn: 2, role: 'assistant', content: 'Response 1' },
  // ...
];

const result = await compactor.compact(messages, 100);
```

**返回值：**
```typescript
interface CompactResult {
  messages: string[];         // 压实后的消息列表
  originalTokens: number;     // 原始总 tokens
  compactedTokens: number;    // 压实后总 tokens
  ratio: number;              // 总压缩率
  byZone: {                   // 各区域统计
    [zoneName: string]: {
      count: number;
      originalTokens: number;
      compactedTokens: number;
      compressionLevel: string;
    };
  };
}
```

#### `getZoneStats(messages, currentTurn)`

获取消息在各个区域的分布统计。

```typescript
const stats = compactor.getZoneStats(messages, 100);

console.log(`Hot 区: ${stats['hot'].count} 条消息`);
console.log(`Cold 区: ${stats['cold'].count} 条消息`);
```

#### `setZones(zones)`

自定义年龄区域配置。

```typescript
compactor.setZones([
  { name: 'recent', maxAge: 10, compressionLevel: 'none' },
  { name: 'medium', maxAge: 30, compressionLevel: 'L1' },
  { name: 'old', maxAge: Infinity, compressionLevel: 'L1+L2+L3' },
]);
```

### L1FormatCompressor

格式压缩器（无损）。

```typescript
import { getL1Compressor } from './domain/agent/compression';

const l1 = getL1Compressor();
const result = l1.compress(text);

// 查看应用的规则
console.log(result.method); // 'L1-Format[collapse_newlines,trim_trailing_whitespace,...]'

// 添加自定义规则
l1.addRule({
  name: 'remove_timestamps',
  pattern: /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g,
  replacement: '[TIMESTAMP]',
  description: 'Remove timestamp',
});
```

### L2ExtractiveCompressor

提取压缩器（TextRank）。

```typescript
import { getL2Compressor } from './domain/agent/compression';

const l2 = getL2Compressor();

// 提取 50% 的关键句子
const result = l2.compress(text, 0.5);

console.log(`保留 ${result.method}`); // 'L2-Extractive[kept 5/10 sentences]'
```

### L3AbstractiveCompressor

抽象压缩器（LLM 摘要）。

```typescript
import { getL3Compressor } from './domain/agent/compression';

const l3 = getL3Compressor();

// 配置 LLM 客户端
l3.setLLMClient({
  async complete(prompt: string, maxTokens: number) {
    // 调用 LLM API
    return summary;
  },
});

// 压缩到目标 token 数
const result = await l3.compress(text, 500);
```

## 集成指南

### 集成到 Agent Chat 流程

```typescript
import { getTieredCompressor } from './domain/agent/compression';
import { estimateTotalTokens } from './domain/agent/context';

async function chat(messages: Message[], config: AgentConfig) {
  const compressor = getTieredCompressor();

  // 1. 估算当前上下文 tokens
  const currentTokens = estimateTotalTokens(messages);

  // 2. 如果超过阈值，压缩历史消息
  if (currentTokens > config.contextConfig.compressionThreshold * config.contextConfig.maxTokens) {
    // 找到需要压缩的消息（保留最近的 N 条）
    const keepRecent = config.contextConfig.keepRecent;
    const toCompress = messages.slice(0, -keepRecent);
    const recent = messages.slice(-keepRecent);

    // 批量压缩历史消息
    const compressedMessages = await Promise.all(
      toCompress.map(async msg => {
        if (msg.role === 'tool') {
          // 工具结果通常很长，适合压缩
          const result = await compressor.compress(
            msg.content,
            estimateTokens(msg.content),
            config.contextConfig.maxTokens * 0.1 // 每条消息预算
          );
          return { ...msg, content: result.compressed };
        }
        return msg;
      })
    );

    messages = [...compressedMessages, ...recent];
  }

  // 3. 调用 LLM
  return await callAI({ messages, ...config });
}
```

### 集成到 Memory 系统

```typescript
import { getProgressiveCompactor } from './domain/agent/compression';

async function loadMemory(sessionId: string, maxTokens: number) {
  const compactor = getProgressiveCompactor();

  // 1. 从存储加载历史消息
  const messages = await loadMessagesFromStore(sessionId);
  const currentTurn = messages.length;

  // 2. 渐进式压实
  const result = await compactor.compact(messages, currentTurn);

  // 3. 检查是否在预算内
  if (result.compactedTokens > maxTokens) {
    // 进一步裁剪
    const excess = result.compactedTokens - maxTokens;
    console.warn(`Memory exceeds budget by ${excess} tokens`);
  }

  return result.messages;
}
```

### 集成到 Proactive Scheduler

```typescript
import { getProgressiveCompactor } from './domain/agent/compression';

// 在 proactive scheduler 中添加压缩任务
scheduler.createSchedule({
  id: 'memory-compaction',
  cron: '0 */6 * * *', // 每 6 小时
  handler: async () => {
    const compactor = getProgressiveCompactor();

    // 获取所有活跃会话
    const sessions = await getActiveSessions();

    for (const session of sessions) {
      const messages = await loadMessages(session.id);
      const result = await compactor.compact(messages, messages.length);

      // 保存压实后的消息
      await saveCompactedMessages(session.id, result.messages);

      console.log(`Session ${session.id}: saved ${result.originalTokens - result.compactedTokens} tokens`);
    }
  },
});
```

## 最佳实践

### 1. 压缩策略选择

**根据上下文使用率选择压缩级别：**

```typescript
// ✅ 好的做法：动态选择压缩级别
const utilization = currentTokens / budgetTokens;

if (utilization < 0.7) {
  // 使用 L1 即可
  const result = l1.compress(text);
} else if (utilization < 0.85) {
  // 使用 L1+L2
  const result = tiered.compress(text, currentTokens, budgetTokens);
} else {
  // 使用 L1+L2+L3（需要配置 LLM）
  tiered.setLLMClient(llmClient);
  const result = await tiered.compress(text, currentTokens, budgetTokens);
}

// ❌ 坏的做法：总是使用最高压缩级别
const result = await l3.compress(text); // 太慢且可能过度压缩
```

### 2. 保留关键信息

**避免压缩系统消息和最近对话：**

```typescript
// ✅ 好的做法
const systemMessages = messages.filter(m => m.role === 'system');
const recentMessages = messages.slice(-6);
const oldMessages = messages.slice(0, -6).filter(m => m.role !== 'system');

// 只压缩旧消息
const compressed = await Promise.all(
  oldMessages.map(m => compressor.compress(m.content))
);

const finalMessages = [
  ...systemMessages,
  ...compressed.map((c, i) => ({ ...oldMessages[i], content: c })),
  ...recentMessages,
];

// ❌ 坏的做法
const compressed = await compressor.compress(
  messages.map(m => m.content).join('\n') // 丢失了消息结构
);
```

### 3. 性能优化

**使用 L1 压缩进行快速预处理：**

```typescript
// ✅ 好的做法：先用 L1 快速压缩
const l1Result = l1.compress(text);

if (estimateTokens(l1Result.compressed) < budget) {
  // L1 就够了，不需要更重的压缩
  return l1Result.compressed;
}

// L1 不够，继续 L2/L3
const result = await tiered.compress(l1Result.compressed);
```

### 4. 错误处理

**L3 压缩可能失败，需要 fallback：**

```typescript
// ✅ 好的做法：提供 fallback
try {
  const result = await l3.compress(text, targetTokens);
  return result.compressed;
} catch (error) {
  console.warn('L3 compression failed, using L2', error);
  const result = l2.compress(text, 0.5);
  return result.compressed;
}
```

### 5. 监控和调优

**定期检查压缩统计：**

```typescript
// 定期打印统计信息
setInterval(() => {
  const stats = compressor.getStats();

  console.log('Compression Stats:');
  console.log(`  Total: ${stats.totalCompressions} compressions`);
  console.log(`  Avg Ratio: ${(stats.avgRatio * 100).toFixed(1)}%`);
  console.log(`  Tokens Saved: ${stats.totalTokensSaved}`);

  // 如果 L3 使用率低，可能需要调整阈值
  if (stats.byLevel['L1+L2+L3'].count < stats.totalCompressions * 0.1) {
    console.log('  Warning: L3 compression rarely used, consider lowering threshold');
  }
}, 60000); // 每分钟
```

## 性能基准

### L1 格式压缩

- **压缩率**：10-30%
- **信息保留**：99%
- **延迟**：<1ms（100KB 文本）
- **内存**：O(n)

**示例：**
```
输入：10,000 tokens (带大量空行和注释)
输出：7,500 tokens
耗时：0.5ms
```

### L2 提取压缩

- **压缩率**：30-60%
- **信息保留**：85%
- **延迟**：~10ms（100 句话）
- **内存**：O(n²) （相似度矩阵）

**示例：**
```
输入：10,000 tokens (50 句话)
输出：5,000 tokens (25 句关键句)
耗时：12ms
```

### L3 抽象压缩

- **压缩率**：60-90%
- **信息保留**：70%
- **延迟**：~1s（取决于 LLM）
- **内存**：O(n)

**示例：**
```
输入：10,000 tokens
输出：1,500 tokens (语义摘要)
耗时：980ms (使用 glm-4-flash)
```

### 渐进式压实

**100 轮对话示例：**
```
原始：50,000 tokens

Hot 区（5 条）：5,000 tokens (无压缩)
Warm 区（15 条）：12,000 tokens → 10,800 tokens (L1, 10%)
Cool 区（30 条）：18,000 tokens → 9,000 tokens (L1+L2, 50%)
Cold 区（50 条）：15,000 tokens → 2,250 tokens (L1+L2+L3, 85%)

压实后：27,050 tokens
总压缩率：45.9%
```

## 故障排查

### L3 压缩失败

**问题**：`Error: L3 compression requires LLM client`

**解决**：
```typescript
import { configureTieredCompressor } from './domain/agent/compression';

// 在应用启动时配置
configureTieredCompressor({
  async complete(prompt, maxTokens) {
    // 实现 LLM 调用
  },
});
```

### 压缩率过低

**问题**：压缩率只有 5-10%

**原因**：
1. 文本已经很简洁
2. 使用的是 L1 压缩（无损）
3. 目标 ratio 设置过高

**解决**：
```typescript
// 使用 L2 或 L3
const result = l2.compress(text, 0.3); // 保留 30% 句子
// 或
const result = await l3.compress(text, targetTokens);
```

### 压缩过度

**问题**：关键信息丢失

**原因**：L3 压缩过度或 L2 提取比例过低

**解决**：
```typescript
// 调整提取比例
const result = l2.compress(text, 0.7); // 保留 70% 句子

// 或调整 L3 目标
const result = await l3.compress(text, originalTokens * 0.5); // 压缩到 50%
```

### 性能问题

**问题**：压缩耗时过长

**原因**：
1. L2 在处理大量句子时 O(n²) 复杂度
2. L3 LLM 响应慢

**解决**：
```typescript
// 1. 限制 L2 输入大小
if (estimateTokens(text) > 50000) {
  // 先用 L3 压缩，再用 L2
  text = (await l3.compress(text, 10000)).compressed;
}

const result = l2.compress(text, 0.5);

// 2. 使用更快的 LLM 模型
l3.setLLMClient({
  async complete(prompt, maxTokens) {
    return await callAI({
      model: 'glm-4-flash', // 快速模型
      // ...
    });
  },
});
```

## 迁移指南

### 从旧版 compressToolResult 迁移

```typescript
// ❌ 旧代码
import { compressToolResult } from './domain/agent/context';

const compressed = compressToolResult(toolResult);

// ✅ 新代码
import { getTieredCompressor } from './domain/agent/compression';

const compressor = getTieredCompressor();
const result = await compressor.compress(toolResult);
const compressed = result.compressed;
```

### 从旧版 compressAssistantMessage 迁移

```typescript
// ❌ 旧代码
import { compressAssistantMessage } from './domain/agent/context';

const compressed = compressAssistantMessage(content, toolCalls);

// ✅ 新代码
import { getL1Compressor } from './domain/agent/compression';

const l1 = getL1Compressor();
const result = l1.compress(content);
const compressed = result.compressed;
```

## 更多资源

- [Context Engineering 章节](../../../ch05-context-engineering.md) - 理论背景
- [测试用例](./__tests__/) - 完整测试覆盖
- [API 类型定义](./types.ts) - TypeScript 类型

## 贡献

欢迎贡献代码！请确保：
1. 添加测试覆盖
2. 更新文档
3. 遵循代码规范

## 许可证

MIT
