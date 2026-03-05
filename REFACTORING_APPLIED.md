# Agent Tools Refactoring - Applied

## 应用日期
2026-03-05

## 重构概述

成功将 `tmp/agent-tools-update` 中的重构方案应用到项目中。

## 主要变化

### 1. 提示词从代码中解耦
- **之前**: 提示词作为 TypeScript 字符串内嵌在代码中
- **之后**: 提示词存储在独立的 `.md` 文件中
  - `src/agent/prompts/base.md` - 核心提示词（所有模式共享）
  - `src/agent/prompts/examples-verbose.md` - 详细示例（仅 verbose 模式）

### 2. 分层架构替代三套独立提示词
- **之前**: `default` / `concise` / `verbose` 三套完全独立的文本
- **之后**: 
  - `concise`: base.md (~9453 chars)
  - `default`: base.md (~9453 chars)
  - `verbose`: base.md + examples-verbose.md (~13510 chars)

### 3. Token 消耗优化
- **default**: ~5000 tokens → ~1800 tokens (-64%)
- **verbose**: ~2000 tokens → ~2800 tokens (+40%)

### 4. 组装顺序优化
新的 `buildSystemPrompt()` 函数采用分层组装策略：

```
Layer 1: Immutable core (base.md)
Layer 2: Trait personality
Layer 3: Slow-changing context (SOUL/USER/facts/skills)
Layer 4: Volatile runtime (time/holiday/weather/goals/stats)
```

**优势**:
- 最大化 Prompt Caching 命中率
- 利用 LLM 的 U 型注意力模式（开头和结尾注意力最强）
- 易变层在末尾，不会破坏缓存

### 5. 新增功能

#### 优先级体系 (P0-P5)
```
P0: Safety & Privacy
P1: User's Current Instruction
P2: Recorded Preferences
P3: Verification Protocol
P4: Active Learning
P5: Proactive Outreach
```

#### 安全约束层
- Prompt injection 防护
- 敏感数据存储禁令
- 工具重试硬限制（3次）
- 破坏性操作确认机制

#### 学习式主动触达时间策略
- 从硬编码 "22:00后不打扰" 改为基于用户行为学习
- 新增 `facts/activity_pattern.md` 数据结构
- 三级置信度策略：冷启动、学习期、成熟期

#### 工具规则表格化
- "触发条件速查表" 替代冗长的决策流程
- "验证映射表" 明确工具调用后的验证方法
- 信息密度提升约 3 倍

## 文件变化

### 新增文件
```
src/agent/prompts/
├── base.md                 (9805 bytes)
└── examples-verbose.md     (4788 bytes)
```

### 修改文件
```
src/agent/tools.ts          (完全重构)
```

### 备份文件
```
src/agent/tools.ts.backup   (原始版本备份)
```

## 测试验证

### 1. 提示词加载测试
```bash
✅ BASE_PROMPT (default) length: 9453
✅ VERBOSE_PROMPT length: 13510
✅ CONCISE_PROMPT length: 9453
✅ verbose has examples: true
✅ verbose is longer: true
```

### 2. 工具检索测试
```bash
✅ Total tools: 134
```

### 3. 提示词组装顺序测试
```bash
✅ Order verification:
  - Beeclaw (base): position 0
  - Soul: position after base
  - User: position after soul
  - Facts: position after user
  - Skills: position after facts
  - Runtime Context: position at end
✅ Order is correct: true
```

## 向后兼容性

### 保持兼容的 API
- `getAllTools()` - 获取所有工具
- `getAllToolsForAI()` - getAllTools 的别名
- `getMemoryTools()` - 获取内存工具
- `getSkillTools()` - 获取技能工具
- `getToolsByCategory()` - 按类别过滤工具
- `buildSystemPrompt()` - 构建系统提示词
- `formatSkillsForPrompt()` - 格式化技能列表
- `SYSTEM_PROMPTS` - 系统提示词对象
- `TOOL_CATEGORIES` - 工具分类定义

### 变化的内部实现
- `loadPromptLayer()` - 新增：从文件加载提示词
- `buildSystemPrompt()` - 重构：采用分层组装策略
- `SYSTEM_PROMPTS` - 结构变化：concise/default 共享 base.md

## 迁移指南

### 无需修改的代码
使用公共 API 的代码无需修改：
```typescript
import { getAllTools, buildSystemPrompt, SYSTEM_PROMPTS } from './agent/tools';

// 这些调用仍然有效
const tools = getAllTools();
const prompt = buildSystemPrompt(SYSTEM_PROMPTS.default, context);
```

### 需要注意的变化
如果代码直接依赖 `SYSTEM_PROMPTS` 的内容结构：
- `SYSTEM_PROMPTS.default` 现在更简洁（~1800 tokens vs ~5000 tokens）
- `SYSTEM_PROMPTS.concise` 现在包含完整核心规则（之前过于空洞）
- `SYSTEM_PROMPTS.verbose` 现在真正包含详细示例

## 下一步建议

1. **测试运行**: 在开发和生产环境中测试新的提示词
   ```bash
   bun run cli   # CLI 模式测试
   bun run bot   # Bot 模式测试
   ```

2. **监控效果**: 观察 AI 行为是否符合预期
   - 优先级执行是否正确
   - 安全约束是否生效
   - 主动触达时间是否合理

3. **A/B 测试**: 可以创建不同版本的 base.md 进行对比
   - 复制 base.md 到 base-v2.md
   - 修改 loadPromptLayer() 加载不同版本
   - 比较效果

4. **性能监控**: 观察 Token 消耗变化
   - Default 模式应该减少 ~64% token
   - 响应质量应该保持或提升

## 回滚方案

如果需要回滚到原始版本：
```bash
cp src/agent/tools.ts.backup src/agent/tools.ts
rm -rf src/agent/prompts/
```

## 参考资料

- 原始重构方案: `tmp/agent-tools-update/`
- 变更说明: `tmp/agent-tools-update/CHANGELOG.md`
- 项目文档: `CLAUDE.md`
