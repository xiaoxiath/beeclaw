# 主动式能力快速参考

> 给 LLM 的快速参考卡片

## 🎯 三种触发方式

### 1. Cron 定时 - `proactive_schedule`
```
用户说："每天早上 9 点提醒我..."
→ 使用 proactive_schedule(cron="0 9 * * *", ...)
```

### 2. 延迟执行 - `schedule_once`
```
用户说："10 分钟后提醒我..."
→ 使用 schedule_once(delay_seconds=600, ...)
```

### 3. 条件触发 - `proactive_pattern`（未来）
```
用户说："如果一周没更新就提醒我..."
→ 使用 proactive_pattern(condition="...", ...)
```

## 📋 六种任务类型

| 任务类型 | 用途 | 推荐场景 |
|---------|------|---------|
| `llm_proactive_chat` | LLM 生成内容并发送 | 个性化问候、智能提醒 |
| `send_reminder` | 发送预定义消息 | 简单提醒、固定内容 |
| `check_goal_progress` | 检查目标进度 | 目标监控、进度追踪 |
| `run_skill` | 执行技能 | 定期任务、自动化 |
| `self_evolution` | 自我进化 | （自动，每日 4AM） |
| `memory_compress` | 记忆压缩 | （自动，每日 3AM） |

## ⚡ 快速决策树

```
用户要求定时/延迟任务
    ↓
需要 LLM 生成内容？
    ├─ 是 → llm_proactive_chat
    │       └─ prompt: "生成个性化内容..."
    │
    └─ 否 → send_reminder
            └─ message: "固定内容"
```

## 🚨 重要注意事项

### ✅ 必须做的

1. **确认 daemon 模式**
   ```bash
   bun run bot --daemon
   ```

2. **在 prompt 中说明这是主动推送**
   ```
   prompt: "早上好！这是早间提醒..."
   ```

3. **设置合理的优先级**
   - 🔴 urgent - 会议前、紧急截止
   - 🟠 high - 重要任务
   - 🟢 normal - 常规提醒
   - ⚪ low - 不重要

4. **考虑用户作息时间**
   ```
   ✅ "0 9-18 * * 1-5"  // 工作时间
   ❌ "0 */2 * * *"     // 包括深夜
   ```

### ❌ 绝对不要做的

1. **不要在 llm_proactive_chat 中再次调度**
   ```typescript
   // ❌ 错误
   prompt: "提醒用户后，再创建一个1小时后的提醒"

   // ✅ 正确
   prompt: "提醒用户会议即将开始"
   ```

2. **不要滥用 urgent 优先级**
   ```typescript
   // ❌ 错误
   priority: "urgent"  // 每日问候

   // ✅ 正确
   priority: "normal"  // 每日问候
   ```

3. **不要过于频繁**
   ```typescript
   // ❌ 错误
   cron: "*/10 * * * *"  // 每 10 分钟

   // ✅ 正确
   cron: "0 */2 9-18 * * 1-5"  // 工作时间每 2 小时
   ```

## 📚 详细文档位置

需要更多信息时，读取：
- **完整指南**：`docs/proactive-capabilities-guide.md`
- **快速索引**：`data/memory/facts/proactive-index.md`

## 🎓 常见场景示例

### 场景 1：每日问候
```typescript
proactive_schedule({
  name: "早间问候",
  cron: "0 9 * * *",
  taskType: "llm_proactive_chat",
  taskParams: {
    prompt: "早上好！根据用户目标和日程，提供简短建议（<100字）"
  }
})
```

### 场景 2：会议提醒
```typescript
schedule_once({
  delay_seconds: 600,  // 10 分钟
  taskType: "send_reminder",
  taskParams: {
    message: "🔴 会议将在 10 分钟后开始",
    priority: "urgent"
  }
})
```

### 场景 3：习惯养成
```typescript
proactive_schedule({
  name: "喝水提醒",
  cron: "0 10,12,14,16,18 * * *",
  taskType: "send_reminder",
  taskParams: {
    message: "💧 该喝水了！",
    priority: "low"
  }
})
```

---

**记住**：
- ✅ 先查阅 `docs/proactive-capabilities-guide.md`
- ✅ 确认 Bot 是 daemon 模式
- ✅ 直接生成内容，不要再调度
- ✅ 考虑用户作息时间
