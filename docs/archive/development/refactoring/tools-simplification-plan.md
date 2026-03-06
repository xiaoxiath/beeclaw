# Beeclaw Tools 简化和增强方案

## 📋 变更概述

### Skill Tools 简化
- ✅ 保留 `skill_ensure`（推荐使用）
- ⚠️ 标记 `skill_create` 和 `skill_update` 为 deprecated
- 📝 更新 AI 提示词，明确推荐使用 `skill_ensure`

### Notification Tools 增强
- ✅ `notification_send` - 发送通知（已有）
- ✅ `notification_list` - 列出待处理通知（已有）
- ➕ `notification_mark_read` - 标记通知为已读
- ➕ `notification_delete` - 删除通知
- ➕ `notification_history` - 查看历史通知
- ➕ `notification_stats` - 获取通知统计

---

## 🔧 实施细节

### 1. Skill Tools 简化

#### 变更 A: 更新 skill_create 描述

```typescript
skill_create: {
  name: 'skill_create',
  description: `[DEPRECATED] Use skill_ensure instead.

  This tool is kept for backward compatibility only. For new code, always use skill_ensure which handles both creating and updating automatically.

  Create a new skill. NOTE: For creating skills with proper testing and optimization, use the skill-creator skill (path: skills/skill-creator) which provides a complete workflow including test cases, benchmarking, and iteration.`,
  // ... parameters unchanged
}
```

#### 变更 B: 更新 skill_update 描述

```typescript
skill_update: {
  name: 'skill_update',
  description: `[DEPRECATED] Use skill_ensure instead.

  This tool is kept for backward compatibility only. For new code, always use skill_ensure which handles both creating and updating automatically.

  Update an existing skill. NOTE: For substantial improvements, testing, or optimization, use the skill-creator skill instead (path: skills/skill-creator) which provides a complete workflow with evals, benchmarking, and iteration.`,
  // ... parameters unchanged
}
```

#### 变更 C: 强化 skill_ensure 描述

```typescript
skill_ensure: {
  name: 'skill_ensure',
  description: `[RECOMMENDED] Create or update a skill automatically.

  This is the preferred tool for saving skills. It intelligently:
  - Creates the skill if it doesn't exist
  - Updates the skill if it already exists
  - Handles all edge cases automatically

  NOTE: For substantial skill work (testing, optimization, iteration), use the skill-creator skill (path: skills/skill-creator) instead. Use skill_ensure for quick create-or-update operations when you don't need the full workflow.

  Examples:
  - First time saving a pattern → creates new skill
  - Improving an existing skill → updates it
  - Unsure if skill exists → handles both cases`,
  // ... parameters unchanged
}
```

### 2. Notification Tools 增强

#### 新增工具 A: notification_mark_read

```typescript
notification_mark_read: {
  name: 'notification_mark_read',
  description: 'Mark a notification as read/delivered. Use this after showing or handling a notification to prevent it from appearing again.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Notification ID to mark as read',
      },
    },
    required: ['id'],
  },
}
```

**使用场景**：
- LLM 在对话中显示了通知内容后
- 用户确认已看到通知后
- 自动处理完通知后

#### 新增工具 B: notification_delete

```typescript
notification_delete: {
  name: 'notification_delete',
  description: 'Delete a pending notification before it is delivered. Use this to cancel unnecessary or outdated notifications.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Notification ID to delete',
      },
    },
    required: ['id'],
  },
}
```

**使用场景**：
- 取消不再需要的提醒
- 删除过时的通知
- 清理误创建的通知

#### 新增工具 C: notification_history

```typescript
notification_history: {
  name: 'notification_history',
  description: 'Get notification delivery history. Shows past notifications that were delivered or expired.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of history entries to return (default: 20, max: 100)',
      },
    },
    required: [],
  },
}
```

**使用场景**：
- 查看历史通知记录
- 检查通知是否成功投递
- 分析通知模式

#### 新增工具 D: notification_stats

```typescript
notification_stats: {
  name: 'notification_stats',
  description: 'Get notification statistics (pending count, history count, by priority). Use this to understand the current notification queue status.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
}
```

**使用场景**：
- 检查有多少待处理通知
- 按优先级分析通知分布
- 监控通知队列健康状态

---

## 📊 Notification 使用场景对比

### schedule_once vs notification_send

| 特性 | schedule_once | notification_send |
|------|---------------|-------------------|
| 持久化 | ❌ 执行后删除 | ✅ 持久化存储 |
| 投递追踪 | ❌ 无 | ✅ 完整历史 |
| 重试机制 | ❌ 无 | ✅ 最多 3 次 |
| 过期管理 | ❌ 无 | ✅ 自动过期 |
| 多渠道 | ❌ 单一 | ✅ CLI/Feishu/Webhook |
| 优先级 | ❌ 无 | ✅ 4 级优先级 |
| 管理 | ❌ 无法管理 | ✅ 可查询/删除/标记 |

### 使用建议

**使用 schedule_once 当**：
- ✅ 一次性简单提醒（如"5分钟后提醒我休息"）
- ✅ 不需要追踪状态
- ✅ 不需要重试机制
- ✅ 执行后自动清理

**使用 notification_send 当**：
- ✅ 重要提醒需要持久化
- ✅ 需要投递追踪和历史记录
- ✅ 需要多渠道投递
- ✅ 需要优先级管理
- ✅ 需要过期管理
- ✅ 可能需要取消或修改

### 典型场景示例

```typescript
// 场景 1: 简单延迟提醒 → schedule_once
"10分钟后提醒我去拿快递"
→ schedule_once({ delay_seconds: 600, taskType: 'send_reminder', params: { message: '去拿快递' }})

// 场景 2: 重要会议提醒 → notification_send
"明天上午9点提醒我参加重要会议"
→ notification_send({
    message: '重要会议提醒：上午9点的会议',
    priority: 'high',
    scheduledFor: '2026-03-04T09:00:00',
    category: 'meeting'
  })

// 场景 3: 目标进度检查（定期） → proactive_schedule
"每天晚上检查我的目标进度"
→ proactive_schedule({
    name: 'Daily Goal Check',
    cron: '0 21 * * *',
    taskType: 'check_goal_progress'
  })

// 场景 4: 紧急通知 → notification_send + 立即投递
"发送一个紧急通知给用户"
→ notification_send({
    message: '紧急：服务器响应异常',
    priority: 'urgent',
    category: 'alert'
  })
```

---

## 🎯 迁移指南

### 对于 Skill Tools

**旧代码**：
```typescript
// 先检查是否存在
const existing = executeSkillTool('skill_get', { name: 'my-skill' });
if (existing.success) {
  // 更新
  executeSkillTool('skill_update', { name: 'my-skill', content: '...' });
} else {
  // 创建
  executeSkillTool('skill_create', { name: 'my-skill', content: '...' });
}
```

**新代码（推荐）**：
```typescript
// 一行搞定
executeSkillTool('skill_ensure', { name: 'my-skill', content: '...' });
```

### 对于 Notification Tools

**新增能力**：
```typescript
// 查看待处理通知
const pending = executeProactiveTool('notification_list', {});

// 标记为已读
executeProactiveTool('notification_mark_read', { id: 'notif-xxx' });

// 取消通知
executeProactiveTool('notification_delete', { id: 'notif-xxx' });

// 查看历史
const history = executeProactiveTool('notification_history', { limit: 20 });

// 查看统计
const stats = executeProactiveTool('notification_stats', {});
```

---

## ✅ 实施检查清单

### Phase 1: Skill Tools 简化
- [ ] 更新 skill_create 描述（添加 DEPRECATED 标记）
- [ ] 更新 skill_update 描述（添加 DEPRECATED 标记）
- [ ] 更新 skill_ensure 描述（强化推荐）
- [ ] 更新 system prompt，明确推荐 skill_ensure
- [ ] 更新测试用例，优先使用 skill_ensure
- [ ] 更新文档和示例

### Phase 2: Notification Tools 增强
- [ ] 添加 notification_mark_read 工具
- [ ] 添加 notification_delete 工具
- [ ] 添加 notification_history 工具
- [ ] 添加 notification_stats 工具
- [ ] 添加对应 executor 实现
- [ ] 添加测试用例
- [ ] 更新 TOOL_CATEGORIES

### Phase 3: 文档和清理
- [ ] 更新 agent/tools.ts 中的 TOOL_CATEGORIES
- [ ] 更新 system prompt，说明 notification 使用场景
- [ ] 添加 migration guide
- [ ] 清理代码中直接使用 skill_create/update 的地方

---

## 📝 代码影响评估

### 需要修改的文件

1. **src/skills/tools.ts**
   - 更新 skill_create/update/ensure 描述

2. **src/proactive/tools.ts**
   - 添加 4 个新 notification 工具定义
   - 添加对应的 executor 实现

3. **src/agent/tools.ts**
   - 更新 TOOL_CATEGORIES.notification 列表
   - 更新 system prompt 中的 skill 和 notification 说明

4. **测试文件**
   - 更新 skills/__tests__/tools.test.ts
   - 更新 proactive/__tests__/tools.test.ts
   - 更新 agent/__tests__/tools.test.ts

### 向后兼容性

- ✅ **完全兼容**：所有现有工具保留
- ✅ **渐进式迁移**：旧工具标记 deprecated 但仍可用
- ✅ **无破坏性变更**：不影响现有功能

---

## 🚀 预期收益

### Skill Tools 简化
- ✅ 减少 AI 困惑（3个工具 → 1个推荐工具）
- ✅ 简化代码（无需检查存在性）
- ✅ 提高效率（一次调用完成创建/更新）

### Notification Tools 增强
- ✅ 完整的生命周期管理
- ✅ 更好的通知追踪
- ✅ 更清晰的使用场景区分
- ✅ 与 schedule_once 形成互补

### 整体收益
- ✅ 工具职责更清晰
- ✅ API 更一致
- ✅ 用户体验更好
- ✅ 代码更简洁
