# Evolution 模块废弃说明

**日期**: 2026-03-13
**状态**: 部分废弃（保留核心功能）

---

## 📋 概述

Evolution 模块是 Beeclaw 的自我进化系统，用于：
1. 检测何时需要反思和改进
2. 记录技能失败以评估成熟度
3. 学习用户偏好
4. 检测重复查询模式

---

## ❌ 废弃的部分

### `checkReflectionTriggers()` 函数

**位置**: `src/domain/agent/evolution/reflection-trigger.ts:96-104`

**废弃原因**: 代码级别的触发检测被更智能的方案取代

**旧方案**（已废弃）:
```typescript
// 代码规则检测 - 硬编码的规则
export function checkReflectionTriggers(
  userMessage: string,
  context: { skillJustFailed?: string; recentSkillUsage?: Array<{ name: string; success: boolean }>}
): { shouldReflect: boolean; trigger: ReflectionTrigger | null; context: string } {
  // 检查用户消息中是否包含特定关键词
  if (userMessage.includes('不对') || userMessage.includes('错了')) {
    return {
      shouldReflect: true,
      trigger: { type: 'user_correction', severity: 'high', ... },
      context: 'User indicated error'
    };
  }

  // 检查技能是否刚失败
  if (context.skillJustFailed) {
    return {
      shouldReflect: true,
      trigger: { type: 'skill_failure', severity: 'medium', ... },
      context: `Skill ${context.skillJustFailed} just failed`
    };
  }

  // ... 更多硬编码规则
  return { shouldReflect: false, trigger: null, context: '' };
}
```

**问题**:
1. ❌ 规则硬编码，不够灵活
2. ❌ 需要手动维护规则
3. ❌ 无法理解复杂上下文
4. ❌ 误报率高（简单的关键词匹配）

---

## ✅ 新的方案

### LLM 驱动的触发检测

**位置**: System Prompt（`src/domain/agent/prompts/layer-evolution.md`）

**核心思想**: 让 LLM 自己判断何时需要反思，而不是用代码规则

**实现方式**:
```markdown
## 自我进化能力

我具有自我反思和进化的能力。当发现以下情况时，我会自动思考如何改进：

1. **技能失败记录**：当某个技能连续失败时，我会记录并分析原因
2. **用户偏好学习**：当你表达偏好时（"我喜欢..."、"我不喜欢..."），我会记住
3. **重复模式检测**：当你反复问相似的问题时，我会识别模式并可能创建新技能
```

**优势**:
1. ✅ LLM 理解上下文，更智能
2. ✅ 无需硬编码规则
3. ✅ 自动适应新场景
4. ✅ 更低的误报率

**工作原理**:

1. **System Prompt 指导**
   - 在 System Prompt 中明确告诉 LLM 何时反思
   - LLM 根据上下文自主判断

2. **工具支持**
   - `skill_record` - 记录技能成功/失败
   - `skill_maturity` - 查看技能成熟度
   - `skill_ensure` - 创建/改进技能

3. **数据收集**
   - `recordSkillFailure()` - 记录失败统计（仍然使用）
   - `checkConsecutiveFailures()` - 检查连续失败（仍然使用）
   - `recordQuery()` - 记录查询模式（仍然使用）

---

## 🔄 仍然保留的功能

### 1. 技能失败统计
```typescript
// 保留 ✅
export function recordSkillFailure(skillName: string, context: string): void
export function checkConsecutiveFailures(skillName: string): number
export function getReflectionStats(): { recentFailures: number; failureDetails: Array<{ skillName: string; count: number }> }
```

**用途**:
- 为 `skill_maturity` 工具提供数据
- 帮助 LLM 判断技能质量
- 支持技能成熟度评估

### 2. 查询模式检测
```typescript
// 保留 ✅
export function recordQuery(query: string, context?: { ... }): void
export function detectPatterns(): QueryPattern[]
export function getRecentQueries(limit?: number): QueryRecord[]
```

**用途**:
- 检测重复查询（如"每周一早上询问上周进展"）
- 建议创建新技能
- 个性化用户体验

### 3. 用户偏好学习
```typescript
// 保留 ✅
export function detectPreferenceExpressions(text: string): PreferenceExpression[]
export function hasPreferenceExpression(text: string): boolean
export function checkPreferenceTriggers(userMessage: string): { shouldLearn: boolean; expressions: PreferenceExpression[] }
```

**用途**:
- 检测用户偏好表达（"我喜欢简洁的回答"）
- 记录到 memory
- 改进个性化体验

---

## 📊 对比：旧方案 vs 新方案

| 特性 | 旧方案（代码规则） | 新方案（LLM 驱动） |
|------|-------------------|-------------------|
| **触发检测** | ❌ 硬编码规则 | ✅ LLM 自主判断 |
| **上下文理解** | ❌ 简单关键词匹配 | ✅ 深度理解 |
| **灵活性** | ❌ 需要修改代码 | ✅ 自动适应 |
| **维护成本** | ❌ 高（维护规则） | ✅ 低（只需 Prompt） |
| **误报率** | ❌ 高 | ✅ 低 |
| **可扩展性** | ❌ 差 | ✅ 好 |

---

## 🎯 实际案例

### 案例对比：用户纠正

**场景**: 用户说 "不对，我要的是另一个文档"

#### 旧方案（代码规则）
```typescript
checkReflectionTriggers("不对，我要的是另一个文档", {})
// ❌ 匹配到 "不对" → 触发反思
// 问题：可能只是用户改变主意，不是真正的错误
```

#### 新方案（LLM 驱动）
```typescript
// LLM 理解上下文：
// - 用户之前请求"帮我打开文档"
// - Agent 打开了文档 A
// - 用户说"不对，我要的是另一个"
//
// ✅ LLM 判断：
// - 这不是 Agent 的错误
// - 只是用户需求不明确
// - 不需要反思技能
// - 只需要打开另一个文档
```

### 案例对比：技能失败

**场景**: Web 搜索失败

#### 旧方案（代码规则）
```typescript
checkReflectionTriggers("", { skillJustFailed: "web_search" })
// ❌ 自动触发反思
// 问题：可能是网络临时故障，不一定是技能问题
```

#### 新方案（LLM 驱动）
```typescript
// LLM 理解上下文：
// - 查看失败统计（recordSkillFailure 数据）
// - 如果是首次失败 → 可能是临时问题，不反思
// - 如果连续失败 3 次 → 技能可能有问题，触发反思
//
// ✅ LLM 根据数据智能判断
```

---

## 🔧 当前使用情况

### 仍然调用的地方（需要清理）

**位置**: `src/app/routes/proactive.ts:358`

```typescript
// ❌ 这个调用现在是无意义的（函数返回 false）
const result = checkReflectionTriggers(messageText, {});
```

**影响**: 无实际影响（函数是空操作 stub）

**需要**: 移除此调用

---

## 🚀 迁移指南

### 如果你之前使用 `checkReflectionTriggers()`

**旧代码**:
```typescript
import { checkReflectionTriggers } from './evolution';

const result = checkReflectionTriggers(userMessage, context);
if (result.shouldReflect) {
  // 触发反思
}
```

**新方案**:
```typescript
// 方案 1: 让 LLM 自主判断（推荐）
// - 在 System Prompt 中明确指导 LLM 何时反思
// - LLM 会自动使用 skill_record, skill_maturity 等工具
// - 无需代码干预

// 方案 2: 使用统计数据辅助判断
import { checkConsecutiveFailures, getReflectionStats } from './evolution';

// 检查是否有技能连续失败
const failures = getReflectionStats();
for (const detail of failures.failureDetails) {
  if (detail.count >= 3) {
    // 这个技能可能有问题
    // 可以在返回给用户的消息中提示 LLM
  }
}
```

---

## 📝 清理计划

### 短期（本周）
1. ✅ 保留 `recordSkillFailure` 等统计函数
2. ⚠️ 保留 `checkReflectionTriggers`（向后兼容）
3. 📝 文档化新方案

### 中期（下月）
1. 🔧 移除 `proactive.ts` 中的调用
2. 🔧 移除 `agent/index.ts` 中的类型引用
3. 📝 更新所有文档

### 长期（v2.0）
1. ❌ 删除 `checkReflectionTriggers` 函数
2. ❌ 删除 `ReflectionTrigger` 类型
3. ✅ 完全依赖 LLM 驱动

---

## 💡 设计思想

### 为什么 LLM 驱动更好？

1. **上下文理解**
   - 代码规则：只能看表面（关键词）
   - LLM：理解深层含义和上下文

2. **自适应**
   - 代码规则：需要人工更新规则
   - LLM：自动适应新场景

3. **可维护性**
   - 代码规则：维护成本高
   - LLM：只需更新 Prompt

4. **准确性**
   - 代码规则：误报率高
   - LLM：误报率低（理解上下文）

### 为什么保留统计功能？

1. **数据驱动**: LLM 需要数据来做决策
2. **透明性**: 统计数据可用于展示给用户
3. **工具支持**: `skill_maturity` 工具需要这些数据
4. **质量保证**: 帮助评估技能质量

---

## 🎯 总结

**废弃的部分**:
- ❌ `checkReflectionTriggers()` - 代码级别的触发检测
- ❌ `ReflectionTrigger` 类型 - 不再需要

**保留的部分**:
- ✅ `recordSkillFailure()` - 失败统计
- ✅ `checkConsecutiveFailures()` - 连续失败检测
- ✅ `recordQuery()` - 查询模式检测
- ✅ `detectPreferenceExpressions()` - 偏好学习

**新的方案**:
- ✅ LLM 通过 System Prompt 自主判断何时反思
- ✅ 统计数据作为 LLM 决策的输入
- ✅ 更智能、更灵活、更准确

**关键改进**:
从"代码规则驱动" → "LLM + 数据驱动" 🚀
