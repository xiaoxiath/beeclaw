# 系统提示词增强 - 实战经验

## 更新时间
2026-03-04

## 新增内容

### 1. 定时任务操作必须验证结果

**背景问题：**
AI 经常假设操作成功，没有验证实际结果。常见错误：
- 用 `disable` 代替 `cancel`，导致任务只是禁用，未真正删除
- 创建任务后不验证参数是否正确
- 删除任务后不确认是否真的删除了

**新增提示：**

```
### IMPORTANT: Verification & Action (MUST READ)

**1. 定时任务操作必须验证结果**
When managing scheduled tasks, ALWAYS verify the result:

✅ **Correct flow:**
1. proactive_list() → check current state
2. proactive_cancel(id, 'schedule') → delete old task
3. proactive_schedule(...) → create new task
4. proactive_list() → verify new task is created correctly

❌ **Common mistakes:**
- Using disable instead of cancel (task still exists, just disabled)
- Assuming operation succeeded without checking return value
- Not verifying the final state

**Always check:**
- Return value's `success` field
- Task actually appears in proactive_list()
- Task parameters are correct
```

**效果对比：**

| 修改前 | 修改后 |
|--------|--------|
| 用户：删除那个任务<br>Bot：好的，已删除<br>❌ 没有验证 | 用户：删除那个任务<br>Bot：好的，让我确认一下...<br>→ proactive_cancel(id)<br>→ proactive_list() 验证<br>✅ 确认已删除 |

---

### 2. 反思后必须立即转化为行动

**背景问题：**
AI 经常口头反思，但没有实际行动。结果：
- 同样的错误反复出现
- 反思内容没有持久化
- 用户需要重复纠正

**新增提示：**

```
**2. 反思后必须立即转化为行动**
When you make mistakes or receive corrections, take IMMEDIATE action:

✅ **Correct flow:**
User: "不对，应该是 Jest 测试"
You: [Analysis: Wrong test framework assumption]
     → Call memory_record() to save preference
     → Call skill_record() to log failure
     → Tell user: "已记录，以后都用 Jest"

❌ **Wrong:**
User: "不对，应该是 Jest 测试"
You: "抱歉，我记住了，下次会注意"
     [No action taken - reflection is LOST]

**Required actions after reflection:**
1. **Record it**: Use memory_record or memory_write to save learnings
2. **Log it**: Use skill_record to track failures for maturity
3. **Tell user**: Confirm what you've saved

**No recording = No learning.** Always close the loop!
```

**效果对比：**

| 修改前 | 修改后 |
|--------|--------|
| 用户：错了，是 Jest<br>Bot：抱歉，我记住了<br>❌ 没有记录 | 用户：错了，是 Jest<br>Bot：抱歉！<br>→ memory_record({key: "test_framework", value: "Jest"})<br>→ skill_record({success: false})<br>✅ 已记录，以后都用 Jest |

---

## 实际案例

### 案例 1：定时任务调整

**修改前：**
```
用户：把每天9点的任务改成10点
Bot：好的
→ proactive_disable(id)  // ❌ 错误：只是禁用
→ proactive_schedule({cron: "0 10 * * *"})
→ "已经修改好了"

[结果：有两个任务，一个禁用的9点任务，一个新的10点任务]
```

**修改后：**
```
用户：把每天9点的任务改成10点
Bot：好的，让我帮你调整
→ proactive_list()  // 先查看当前状态
→ proactive_cancel(id, 'schedule')  // ✅ 正确删除
→ proactive_schedule({cron: "0 10 * * *", ...})  // 创建新任务
→ proactive_list()  // 验证结果
→ "已确认：旧任务已删除，新任务已创建（每天10点）"

[结果：只有一个10点的任务]
```

---

### 案例 2：用户偏好学习

**修改前：**
```
用户：不要用 emoji，我不喜欢
Bot：好的，我记住了，以后不用 emoji

[下次对话]
Bot：🎉 太棒了！✨  // ❌ 又用了 emoji
```

**修改后：**
```
用户：不要用 emoji，我不喜欢
Bot：明白了！
→ memory_write({
     path: "facts/preferences.md",
     content: "style.emoji: false"
   })
→ "已记录到偏好文件，以后都不会用 emoji 了"

[下次对话]
Bot：好的，已完成  // ✅ 没有 emoji
```

---

## 技术细节

### 验证定时任务

**正确的验证流程：**

```typescript
// 1. 查看当前状态
const before = await proactive_list({ type: 'schedules' });

// 2. 执行操作
const result = await proactive_cancel('schedule-xxx', 'schedule');

// 3. 检查返回值
if (!result.success) {
  throw new Error(`删除失败: ${result.error}`);
}

// 4. 验证最终状态
const after = await proactive_list({ type: 'schedules' });
const deleted = !after.schedules.find(s => s.id === 'schedule-xxx');

if (!deleted) {
  throw new Error('任务仍然存在！');
}

// 5. 告知用户
console.log('✅ 任务已删除并验证');
```

### 反思闭环

**正确的反思流程：**

```typescript
// 1. 分析问题
const mistake = "使用了错误的测试框架";
const correction = "用户偏好 Jest";

// 2. 记录到记忆
await memory_record({
  key: 'test_framework',
  value: 'Jest',
  category: 'preferences'
});

// 3. 记录到技能失败日志
await skill_record({
  skillName: 'test-generator',
  success: false,
  error: 'Used wrong test framework'
});

// 4. 告知用户
console.log(`✅ 已记录：以后都用 ${correction}`);
```

---

## 预期效果

### 减少错误率

| 错误类型 | 修改前频率 | 预期修改后 |
|---------|-----------|-----------|
| 定时任务重复 | 高 | 低（强制验证） |
| 偏好未持久化 | 高 | 低（强制记录） |
| 反复犯同样错误 | 中 | 低（记录 + 反思） |

### 提升用户体验

**修改前：**
- 用户需要反复纠正同样的问题
- 定时任务管理混乱（禁用 vs 删除）
- AI 承诺改进但没有行动

**修改后：**
- AI 一次就记住用户偏好
- 定时任务管理清晰可验证
- AI 的反思会立即转化为行动

---

## 相关文档

1. **src/agent/tools.ts** - 系统提示词定义（已更新）
2. **docs/proactive-capabilities-guide.md** - 主动能力完整指南
3. **docs/memory-system-guide.md** - 记忆系统使用指南
4. **docs/skill-workflow-proposal.md** - 技能系统工作流

---

## 测试方法

### 测试定时任务验证

1. **创建任务**
   ```
   用户：帮我创建一个每天早上9点的问候任务
   Bot：好的...
   → proactive_schedule(...)
   → proactive_list() 验证
   → "已创建并验证成功"
   ```

2. **删除任务**
   ```
   用户：删除这个任务
   Bot：好的...
   → proactive_cancel(id, 'schedule')
   → proactive_list() 验证
   → "已删除并确认"
   ```

### 测试反思闭环

1. **纠正偏好**
   ```
   用户：不要用 emoji
   Bot：明白了！
   → memory_write(...)
   → "已记录偏好"

   [下次对话]
   Bot：好的，完成了  // ✅ 没有 emoji
   ```

2. **记录错误**
   ```
   用户：这个测试写错了
   Bot：抱歉！
   → skill_record({success: false, error: "..."})
   → "已记录失败，会改进"
   ```

---

## 总结

这两条经验教训来自于实际使用中的观察：

1. **验证是必要的** - AI 容易假设操作成功
2. **行动胜于语言** - 没有记录的反思等于没有反思

通过将这些规则加入到系统提示词中，可以：
- ✅ 减少 AI 的错误率
- ✅ 提升用户信任度
- ✅ 形成持续改进的闭环

**记住：假设是敌人，验证是朋友。行动胜于承诺！**
