# Self-Evolution 功能分析

## 🎯 核心功能

**Self-Evolution = 自我进化**

通过**定期反思和学习**，将经验教训提炼为核心原则，实现 AI 的自主成长。

---

## 📋 三个定时任务对比

| 任务 | 时间 | 功能 | 处理对象 |
|------|------|------|---------|
| **Daily Reflection** | 3:00 AM | 分析对话模式 | 最近 50 条对话 |
| **Memory Compression** | 3:30 AM | 压缩旧记忆 | 7 天前的文件 |
| **Daily Self-Evolution** | 4:00 AM | 更新核心原则 | lessons.md |

---

## 🔄 Self-Evolution 工作流程

### 1. **读取当前状态** (Step 1)

```
读取文件：
1. SOUL.md - 核心身份和原则
2. facts/lessons.md - 最近的错误和教训
3. facts/preferences.md - 用户偏好
```

### 2. **分析经验** (Step 2)

从 `lessons.md` 中识别模式：

```markdown
### 2026-02-26: 黄金价格数据错误
问题: 说黄金 2800，实际 5100+
教训: 投资建议前必须核实实时价格数据

### 2026-03-01: 股票价格过时
问题: 引用了昨天的股价
教训: 股价必须实时查询
```

**分析问题**：
- ❓ 是否有重复类型的错误？
- ❓ 能否提取为通用原则？
- ❓ 新原则是否与现有原则重复？
- ❓ 是否符合 SOUL.md 的身份定位？

### 3. **更新 SOUL.md** (Step 3)

**当满足条件时更新**：
- ✅ 同类错误出现 2 次以上
- ✅ 现有原则需要细化
- ✅ 原则已过时或不准确

**更新示例**：

```markdown
# SOUL.md

## Lessons Learned

- **Verify before advising**: Financial data, prices, rates — always check current values first.
- **Spot patterns**: Repetitive tasks should become skills.
```

**约束**：
- 最多 6 条原则（质量 > 数量）
- 简洁、可操作（一行一条）
- 使用强动词：verify, check, spot, question

### 4. **归档已处理** (Step 4)

```
lessons.md → 归档到带日期的文件
保持循环：教训 → 原则 → 归档
```

---

## 🆚 与 Daily Reflection 的区别

### Daily Reflection (3:00 AM)

**目标**: **分析行为模式**

```typescript
输入: 最近 50 条对话
处理:
  - 统计工具使用频率
  - 识别失败模式
  - 分析用户行为
输出:
  - 发现的模式 (patterns)
  - 经验教训 (lessons)
  - 策略更新 (strategyUpdates)
```

**作用**: **发现问题** → 记录到 `facts/lessons.md`

---

### Daily Self-Evolution (4:00 AM)

**目标**: **提炼核心原则**

```typescript
输入: facts/lessons.md
处理:
  - 分析重复错误
  - 提取通用原则
  - 验证与现有原则的兼容性
输出:
  - 更新的 SOUL.md
  - 归档的 lessons.md
```

**作用**: **固化经验** → 更新 `SOUL.md`

---

## 📊 完整执行链

```
凌晨 3:00 - Daily Reflection
   ↓
   分析最近对话
   ↓
   发现失败模式（如：3 次股票价格错误）
   ↓
   记录到 facts/lessons.md:
   "2026-03-01: 股票价格过时 - 应实时查询"

凌晨 3:30 - Memory Compression
   ↓
   压缩旧对话文件
   ↓
   节省存储空间

凌晨 4:00 - Daily Self-Evolution
   ↓
   读取 facts/lessons.md
   ↓
   发现重复错误（2+ 次金融数据错误）
   ↓
   提取原则:
   "Verify before advising: Financial data, prices, rates — always check current values first."
   ↓
   更新 SOUL.md
   ↓
   归档已处理的 lessons.md
```

---

## 🎯 核心价值

### 1. **自主成长** ✅
```
错误 → 教训 → 原则 → 行为改进
循环迭代，持续进化
```

### 2. **知识固化** ✅
```
具体错误 → 通用原则
临时经验 → 持久认知
```

### 3. **可追溯性** ✅
```
每个原则都有来源：
- 哪些错误触发的
- 什么时候添加的
- 为什么要添加
```

---

## 🔍 与其他功能的关系

| 功能 | 层次 | 作用 | 输出 |
|------|------|------|------|
| **Memory Compression** | 存储 | 节省空间 | 压缩文件 |
| **Daily Reflection** | 分析 | 发现模式 | lessons.md |
| **Self-Evolution** | 认知 | 提炼原则 | SOUL.md |

**协同关系**：
```
Reflection (发现) → Self-Evolution (固化) → Compression (清理)
```

---

## ⚙️ 配置

```typescript
// src/domain/agent/evolution/self-evolution.ts
DEFAULT_EVOLUTION_CONFIG = {
  cron: '0 4 * * *',        // 每天凌晨 4 点
  autoApprove: false,       // 不自动批准（需确认）
  minConfidence: 0.8,       // 最低置信度 80%
  maxNewPrinciples: 3,      // 每次最多添加 3 条原则
}
```

---

## 📝 示例场景

### 场景 1: 金融数据错误

```
Reflection (3:00 AM):
  发现 3 次股票/黄金价格错误
  → 记录到 lessons.md

Self-Evolution (4:00 AM):
  分析 lessons.md
  → 发现模式: "金融数据多次错误"
  → 提取原则: "Verify before advising"
  → 更新 SOUL.md
  → 归档 lessons.md

效果:
  未来遇到金融数据查询 → 自动实时查询
```

### 场景 2: 重复性任务

```
Reflection (3:00 AM):
  发现用户多次要求 "生成周报"
  → 记录到 lessons.md: "重复任务应自动化"

Self-Evolution (4:00 AM):
  分析 lessons.md
  → 提取原则: "Spot patterns: Repetitive tasks should become skills"
  → 更新 SOUL.md

效果:
  Agent 主动建议创建 "weekly-report" skill
```

---

## 🚀 总结

### Self-Evolution 是什么？

**将经验转化为智慧的自动化系统**

```
经验 (lessons.md)
  ↓ Self-Evolution
智慧 (SOUL.md)
```

### 三个任务协同工作

```
3:00 AM - Reflection  (发现模式)
3:30 AM - Compression (节省空间)
4:00 AM - Evolution   (固化原则)

共同实现 AI 的持续进化 🎯
```

### 核心优势

- ✅ **自主成长** - 不需要人工干预
- ✅ **知识固化** - 经验转化为原则
- ✅ **持续改进** - 每天迭代优化
- ✅ **可追溯** - 每个原则有来源

这就是 Beeclaw 能够"自我进化"的秘密！🧬
