# 技能使用流程问题报告

## 🐛 发现的问题

### 问题 1: skill_get 和其他工具一起调用时，其他工具被忽略 ⚠️

**位置**: `src/domain/agent/index.ts:1116-1188`

**问题描述**:
```typescript
if (skillGetCall && otherCalls.length > 0) {
  // 执行 skill_get
  const result = await this.toolExecutor(skillGetCall.function.name, params, ...);
  this.usedSkillsInTurn.add(skillName);

  // 保存到消息历史
  this.messages.push({ role: 'tool', content: ... });

  continue;  // ❌ 这里直接 continue，otherCalls 完全被忽略了！
}
```

**影响**:
- 当 LLM 同时调用 `skill_get` 和其他工具时，只有 skill_get 被执行
- 其他工具调用被完全丢弃
- 用户看不到其他工具的结果

**示例**:
```
LLM 决定调用: [skill_get("weekly-report"), memory_read("上周数据")]
实际执行: [skill_get("weekly-report")]  ❌ memory_read 被忽略！
```

### 问题 2: 技能使用信息没有通过 onContentBlock 发送 📋

**位置**: `src/domain/agent/index.ts:1574-1594`

**问题描述**:
```typescript
const metadata: string[] = [];
if (this.usedSkillsInTurn.size > 0) {
  metadata.push(`_📋 Used skill: ${skillNames}_`);
}

if (metadata.length > 0) {
  finalContent += '\n\n---\n' + metadata.join('\n\n');  // ❌ 只添加到字符串
}
```

**问题**:
- 技能使用信息被添加到 `finalContent` 字符串
- **但是没有通过 `onContentBlock` 回调发送**
- Card V2 只能看到通过 `onContentBlock` 发送的内容
- 因此用户在 Card V2 中看不到 "📋 Used skill: xxx"

**对比**:
```typescript
// ❌ 错误：只添加到字符串，Card V2 看不到
finalContent += '\n\n---\n_📋 Used skill: xxx_';

// ✅ 正确：通过 onContentBlock 发送，Card V2 能看到
options?.onContentBlock?.({
  type: 'text',
  text: '\n\n---\n_📋 Used skill: xxx_',
});
```

## 🔧 修复方案

### 修复问题 1: 正确执行 skill_get 和其他工具

**方案**: 不要在 skill_get 后 continue，而是继续执行其他工具

```typescript
if (skillGetCall && otherCalls.length > 0) {
  // 1. 先执行 skill_get
  const result = await this.toolExecutor(skillGetCall.function.name, params, ...);
  this.usedSkillsInTurn.add(skillName);

  // 2. 保存到消息历史
  this.messages.push({ role: 'tool', content: ... });

  // 3. 继续执行其他工具（不要 continue！）
  // 将 otherCalls 添加到下一轮迭代
}

// 继续处理其他工具调用
```

### 修复问题 2: 通过 onContentBlock 发送技能使用信息

**方案**: 在添加 metadata 时，同时通过 onContentBlock 发送

```typescript
if (this.usedSkillsInTurn.size > 0 && !finalContent.includes('📋 Used skill:')) {
  const skillNames = Array.from(this.usedSkillsInTurn).join(', ');
  const skillInfo = `\n\n---\n_📋 Used skill: ${skillNames}_`;

  // 添加到 finalContent（用于返回值）
  finalContent += skillInfo;

  // ✅ 同时通过 onContentBlock 发送（用于 Card V2）
  options?.onContentBlock?.({
    type: 'text',
    text: skillInfo,
  });
}
```

## 📊 影响评估

### 问题 1 的影响
- **严重程度**: 高 ⚠️
- **影响范围**: 所有使用技能的场景
- **用户体验**: 工具调用失败，结果不完整

### 问题 2 的影响
- **严重程度**: 中
- **影响范围**: Card V2 用户
- **用户体验**: 看不到技能使用信息

## ✅ 修复优先级

1. **立即修复**: 问题 1（工具被忽略）
2. **立即修复**: 问题 2（技能信息不显示）

两个问题都应该立即修复，因为它们直接影响核心功能。
