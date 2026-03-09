# 上下文管理

本文档描述 Beeclaw 的上下文窗口管理策略，包括动态提示词、Token 预算、智能压缩和上下文保鲜机制。

---

## 设计目标

- **防止上下文溢出**：严格控制 Token 消耗不超过模型限制
- **优先保留关键信息**：通过优先级机制保留最重要的上下文
- **用户无感压缩**：在对话质量不降低的前提下压缩历史
- **运行时自适应**：根据模型和对话状态动态调整策略

---

## 1. 动态系统提示词

### 时间感知

系统提示词中自动注入当前日期时间，每次对话前刷新：

```markdown
# Current Context

**Date**: 2026-03-09 (Sunday)
**Time**: 15:46 CST
**Timezone**: Asia/Shanghai

---
```

这确保 Agent 始终知道"现在是什么时候"，避免给出过时的时间信息。

### 记忆上下文

系统提示词自动加载用户核心记忆（偏好、事实、人物关系等），让 Agent 在每次对话中都能"记住"用户。

### 技能上下文

已安装技能的名称和描述会注入系统提示词，帮助 Agent 在合适的时机调用技能。

---

## 2. Prompt Budget 管理

### 分层优先级

系统提示词被分为多个层（Layer），每层有不同的优先级和可裁剪标志：

| 层 | 优先级 | 可裁剪 | 说明 |
|----|--------|--------|------|
| Core (base.md) | 100 | 否 | 核心指令，不可删除 |
| Runtime Context | 95 | 否 | 当前时间、模型信息 |
| Persona Traits | 90 | 是 | 人格特质 |
| User Facts | 80 | 是 | 用户核心记忆 |
| Skills Index | 70 | 是 | 技能列表 |
| Tool Hints | 60 | 是 | 工具使用提示 |
| Examples | 50 | 是 | 对话示例 |
| Extra Context | 40 | 是 | 附加上下文 |

### 裁剪策略

当系统提示词的总 Token 超过预算时：

1. **Phase 1**：按优先级从低到高，逐层丢弃可裁剪的层
2. **Phase 2**：如果仍超标，截断最大的可裁剪层
3. **日志记录**：每次裁剪都记录 dropped/truncated 的层名

### 预算计算

```
maxSystemPromptTokens = min(modelContextWindow × 25%, 6000)
```

即使是 200K 上下文的模型，系统提示词也不超过 6000 Token。

---

## 3. 对话 Token 预算

### Per-Turn 守卫

`Agent.chat()` 循环内置全局 Token 预算守卫：

```
maxTokensPerTurn = contextConfig.maxTokens × 60%
```

- **80% 阈值**：输出警告日志
- **100% 阈值**：强制退出工具循环，返回当前最佳回复
- 覆盖 `chat()` 和 `chatStream()` 双路径

### 上下文压缩

当对话历史占用超过上下文窗口 80% 时，自动触发压缩：

| 策略 | 触发条件 | 效果 |
|------|----------|------|
| **工具结果压缩** | Token > 阈值 | 压缩冗长的工具返回值 |
| **助手消息压缩** | Token > 阈值 | 摘要化早期助手回复 |
| **LLM 摘要压缩** | Token > 80% | 调用 LLM 生成对话摘要，替换旧消息 |
| **消息丢弃** | Token > 90% | 移除最早的非系统消息 |

### Token 估算

```
精确模式: tiktoken / gpt-tokenizer (可用时)
启发模式: 英文 ÷ 4 + 中文 × 1.5
校准因子: 滑动窗口 50 样本，自动校准启发值
```

---

## 4. 智能示例选择

系统根据用户意图动态选择最相关的对话示例注入提示词：

### 意图检测

从最近 3 条用户消息中提取意图标签：

| 标签 | 匹配关键词 |
|------|------------|
| `preference` | 记住、偏好、喜欢、prefer |
| `reminder` | 提醒、定时、schedule |
| `skill-creation` | 技能、skill、创建 |
| `error-recovery` | 报错、失败、error、fix |
| `search` | 搜索、查找、search |
| `technical` | 代码、函数、API |

### 选择算法

1. 对每个候选示例，计算与用户意图的重叠得分
2. 按得分降序排列，同分则优先选择较短的示例
3. 贪心填充，直到达到 Token 预算或最大示例数（默认 3）

---

## 5. 配置参考

### ContextConfig

```typescript
interface ContextConfig {
  maxTokens: number;             // 上下文窗口大小（自动按模型计算）
  compressionThreshold: number;  // 触发压缩的阈值比例（默认 0.8）
  keepRecent: number;            // 压缩时保留的最近消息数（默认 8）
}
```

### PromptBudgetConfig

```typescript
interface PromptBudgetConfig {
  maxSystemPromptTokens: number; // 系统提示词最大 Token（默认 4000）
  minCoreTokens: number;         // 核心层最小 Token（默认 1500）
  dynamicExamples: boolean;      // 是否启用动态示例选择（默认 true）
  maxExamples: number;           // 最大示例数（默认 3）
}
```

---

## 相关文档

- [系统架构](../architecture.md) — 整体架构
- [性能优化](../operations/performance.md) — 性能调优
- [弹性设计](./resilience.md) — 重试和熔断
