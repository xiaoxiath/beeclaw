# Proactive System Guide (主动系统指南)

> Beeclaw 主动式 AI 系统完整参考 - 让 AI 主动发起对话、发送提醒、监控目标

## 目录

- [Overview (概述)](#overview-概述)
- [Core Features (核心功能)](#core-features-核心功能)
- [Usage Scenarios (使用场景)](#usage-scenarios-使用场景)
- [Configuration (配置参考)](#configuration-配置参考)
- [Quick Reference (快速参考)](#quick-reference-快速参考)
- [Best Practices (最佳实践)](#best-practices-最佳实践)
- [Troubleshooting (故障排查)](#troubleshooting-故障排查)

---

## Overview (概述)

### 什么是主动系统

Beeclaw 具备**主动式 AI** 能力，可以在无需用户触发的情况下主动发起对话、发送提醒、监控目标等。这是通过以下系统协同实现的：

- **Scheduler** - Cron 定时调度
- **Daemon** - 后台守护进程
- **Queue** - 任务队列系统
- **Pusher** - 消息推送机制

### 核心能力

1. **主动式聊天 (llm_proactive_chat)** - LLM 根据上下文主动生成并发送消息
2. **目标监控 (check_goal_progress)** - 定期检查目标进度，在需要时提醒用户
3. **主动提醒 (send_reminder)** - 发送预定义的提醒消息
4. **自我进化 (self_evolution)** - 自动分析经验教训，更新核心原则
5. **记忆压缩 (memory_compress)** - 压缩旧对话，归档历史记录
6. **技能执行 (run_skill)** - 按计划运行特定技能

### 使用场景

- 每日早间问候与日程提醒
- 会议前准备提醒
- 目标进度追踪
- 事件提醒与上下文关联
- 天气预警与智能建议
- 个性化建议推送

### 启动要求

⚠️ **重要**：主动式能力需要 Bot 以 daemon 模式启动：

```bash
bun run bot --daemon
```

---

## Core Features (核心功能)

### 1. 定时任务 (Scheduled Tasks)

#### schedule_once 工具

创建一次性延迟任务，在指定时间后执行。

**参数：**
```typescript
{
  delay_seconds: number,    // 延迟秒数
  taskType: string,         // 任务类型
  taskParams: object,       // 任务参数
  name?: string             // 任务名称（可选）
}
```

**使用示例：**
```json
{
  "delay_seconds": 600,
  "taskType": "llm_proactive_chat",
  "taskParams": {
    "prompt": "提醒用户：产品评审会将在10分钟后开始。"
  }
}
```

#### proactive_schedule 工具

创建基于 Cron 表达式的定时任务。

**参数：**
```typescript
{
  name: string,             // 任务名称
  description?: string,     // 任务描述
  cron: string,             // Cron 表达式
  taskType: string,         // 任务类型
  taskParams: object,       // 任务参数
  enabled?: boolean         // 是否启用（默认 true）
}
```

**使用示例：**
```json
{
  "name": "每日早间问候",
  "cron": "0 9 * * *",
  "taskType": "llm_proactive_chat",
  "taskParams": {
    "prompt": "早上好！根据用户今天的目标和日程，发送一个简短、友好的问候。"
  }
}
```

### 2. 主动聊天 (Proactive Chat)

#### llm_proactive_chat 任务

**最强大的主动能力** - LLM 根据上下文主动生成并发送消息。

**工作流程：**
```
触发时间到达
    ↓
获取用户上下文 (facts/*.md, SOUL.md, 最近会话)
    ↓
LLM 生成个性化内容
    ↓
推送到飞书/CLI
```

**关键参数：**
```typescript
{
  prompt: string,              // LLM 提示词
  chatId?: string,             // 目标聊天ID（可选，默认使用最近活跃）
  userId?: string,             // 用户ID（可选）
  channel?: 'feishu' | 'cli'   // 推送渠道（可选）
}
```

**触发方式：**
1. **Cron 定时** - `proactive_schedule` 工具
2. **延迟执行** - `schedule_once` 工具
3. **条件触发** - `proactive_pattern` 工具（未来功能）

**最佳实践：**

✅ **应该做的：**
- 结合用户上下文生成个性化内容
- 保持消息简洁、有价值
- 在 prompt 中明确说明这是主动推送
- 使用友好的语气

❌ **不应该做的：**
- 在 prompt 中再次调用 `schedule_once` 或 `notification_send`
- 发送过长或过于复杂的消息
- 在深夜或休息时间打扰用户
- 发送无意义的重复内容

### 3. 通知推送 (Notifications)

#### notification_push 工具

发送预定义的提醒消息。

**优先级系统：**

| 优先级 | 图标 | 使用场景 | 示例 |
|--------|------|---------|------|
| `urgent` | 🔴 | 紧急、重要 | 会议开始前、截止日期 |
| `high` | 🟠 | 重要但不紧急 | 任务截止前 1 小时 |
| `normal` | 🟢 | 常规提醒 | 喝水、休息、习惯 |
| `low` | ⚪ | 不重要 | 新闻推送、可选阅读 |

**使用示例：**
```json
{
  "delay_seconds": 1800,
  "taskType": "send_reminder",
  "taskParams": {
    "message": "🔴 会议提醒：产品评审会将在 30 分钟后开始",
    "priority": "urgent"
  }
}
```

### 4. 目标监控 (Goal Tracking)

#### check_goal_progress 任务

**智能目标追踪** - 定期检查目标进度，在需要时提醒用户。

**监控逻辑：**
- 进度低于 50% 且超过 3 天未更新
- 目标停滞超过 N 天
- 临近截止日期

**使用示例：**
```json
{
  "name": "每日目标检查",
  "cron": "0 20 * * *",
  "taskType": "check_goal_progress",
  "enabled": true
}
```

**推送消息示例：**
```
🟠 目标进度提醒

目标："学习 TypeScript"
进度：35%（停滞 5 天）

建议：考虑分解为更小的任务，或调整计划。
```

### 5. 自我进化 (Self Evolution)

#### self_evolution 任务

**LLM 自我学习** - 自动分析经验教训，更新核心原则。

**工作机制：**
```
每日 4:00 AM
    ↓
读取 facts/lessons.md（经验教训）
    ↓
分析是否有新原则值得加入
    ↓
如果需要，更新 SOUL.md
```

**自动触发：**
无需手动配置，Bot 启动时自动创建：
```typescript
{
  name: "Daily Self-Evolution",
  cron: "0 4 * * *",
  taskType: "self_evolution",
  enabled: true
}
```

### 6. 记忆压缩 (Memory Compression)

#### memory_compress 任务

**自动记忆管理** - 压缩旧对话，归档历史记录。

**工作机制：**
```
每日 3:00 AM
    ↓
扫描所有会话
    ↓
压缩超过 N 条消息的会话
    ↓
生成摘要 + 保留最近消息
    ↓
归档到 history/
```

**自动触发：**
无需手动配置，Bot 启动时自动创建：
```typescript
{
  name: "Daily Memory Compression",
  cron: "0 3 * * *",
  taskType: "memory_compress",
  enabled: true
}
```

**效果：**
- ✅ 保持会话窗口在上下文限制内
- ✅ 生成历史摘要，便于回顾
- ✅ 自动归档，不丢失信息
- ✅ 提升响应速度

### 7. 技能执行 (Skill Execution)

#### run_skill 任务

**定时执行技能** - 按计划运行特定技能。

📖 **详细指南**：查看 [定时执行技能指南](./scheduled-skill-execution.md) 获取完整文档。

**参数说明：**
```typescript
{
  skillName: string,            // 技能名称（注意使用驼峰命名）
  skillParams?: object,         // 传递给技能的参数
  channel?: 'feishu' | 'cli',   // 推送渠道
  push?: boolean                // 是否推送结果（默认 true）
}
```

**使用示例：**
```json
{
  "name": "每日新闻摘要",
  "description": "每天早上8点推送新闻摘要",
  "cron": "0 8 * * *",
  "taskType": "run_skill",
  "taskParams": {
    "skillName": "daily-news",
    "skillParams": {
      "topics": ["tech", "ai", "finance"],
      "summary_length": "short"
    },
    "channel": "feishu"
  }
}
```

---

## Usage Scenarios (使用场景)

### Scenario 1: Daily Greeting (每日问候)

**用户请求：**
```
"每天早上 8:30 提醒我查看今日日程"
```

**配置示例：**
```json
{
  "name": "早间日程提醒",
  "description": "每日早间日程查看提醒",
  "cron": "30 8 * * *",
  "taskType": "llm_proactive_chat",
  "taskParams": {
    "prompt": "早上好！现在是北京时间早上8:30。

根据用户的日程和目标：
1. 发送一个简短、友好的问候
2. 提醒今天的重要事项
3. 提供1-2条实用建议

保持简洁，不要超过100字。"
  },
  "enabled": true
}
```

**用户收到：**

> 早上好！☀️
>
> 今天有 2 个重要事项：
> 1. **14:00 产品评审会** - 记得准备 Q1 数据
> 2. **18:00 健身** - 今天是腿部训练日
>
> 💡 建议：上午完成代码审查，下午开会前喝杯咖啡提神！

**配置步骤：**
1. 在飞书中对 Bot 说："帮我创建一个每天早上8:30的问候任务"
2. Bot 自动调用 `proactive_schedule` 工具创建任务
3. 确认 Bot 以 daemon 模式运行：`bun run bot --daemon`
4. 每天早上 8:30 自动收到个性化问候

---

### Scenario 2: Meeting Reminders (会议提醒)

**用户请求：**
```
"10 分钟后提醒我准备下午 2 点的会议"
```

**配置示例：**
```json
{
  "delay_seconds": 600,
  "taskType": "llm_proactive_chat",
  "taskParams": {
    "prompt": "会议提醒：下午 2 点的会议将在 10 分钟后开始。

请提醒用户：
1. 准备会议材料
2. 检查设备（麦克风、摄像头）
3. 提前进入会议室",
    "priority": "urgent"
  },
  "name": "会议准备提醒"
}
```

**用户收到：**

> 🔴 会议提醒
>
> 产品评审会将在 10 分钟后开始
>
> **准备事项：**
> - 📄 准备 Q1 进展数据
> - 🎤 检查麦克风和摄像头
> - 🚪 提前进入会议室
>
> 会议主题：Q1 目标回顾

**提前准备建议：**
- 会议前 30 分钟：发送准备提醒
- 会议前 10 分钟：发送紧急提醒
- 会议开始时：发送会议室链接

---

### Scenario 3: Goal Tracking (目标追踪)

**用户请求：**
```
"我的目标是学习 Rust，如果一周没进展就提醒我"
```

**配置示例：**
```json
{
  "name": "每周目标回顾",
  "description": "每周五下午5点回顾本周目标",
  "cron": "0 17 * * 5",
  "taskType": "llm_proactive_chat",
  "taskParams": {
    "prompt": "周五下午5点，回顾本周目标。

1. 检查用户的活跃目标
2. 对比进度和预期
3. 鼓励完成的，提醒未完成的
4. 给出下周建议

语气：鼓励、建设性。"
  }
}
```

**用户收到：**

> 📊 本周目标回顾
>
> **完成情况：3/5**
>
> ✅ 完成产品文档
> ✅ 代码审查 10 个 PR
> ✅ 健身 3 次
> ⚠️ 学习 TypeScript（进度 60%）
> ❌ 阅读技术博客（未开始）
>
> 💪 做得不错！下周建议：
> - 继续学习 TypeScript
> - 每天阅读 1 篇技术博客

**进度检查机制：**
1. 创建目标：`goal_create({title: "学习 Rust", target: 100, state: "active"})`
2. 创建监控任务：每晚 8 点检查进度
3. 记录偏好：`memory_record({category: "user", fact: "用户希望一周没学习 Rust 时收到提醒"})`

---

### Scenario 4: Event Reminders (事件提醒)

**用户请求：**
```
"如果连续工作超过 2 小时，提醒我休息"
```

**配置示例：**
```json
{
  "name": "休息提醒",
  "description": "每小时提醒用户休息",
  "cron": "0 10-18 * * 1-5",
  "taskType": "send_reminder",
  "taskParams": {
    "message": "🟢 该休息一下眼睛了！\n\n远眺 20 秒，活动一下身体，喝杯水。",
    "priority": "normal"
  },
  "enabled": true
}
```

**用户收到：**

> 🍽️ 午饭时间到！
>
> 忙了一上午，该休息一下了。
>
> 📍 今日天气：晴，15°C
> 💡 建议：出去走走，晒晒太阳，充电30分钟！
>
> 下午继续加油 💪

**上下文关联：**
- 结合天气数据提供个性化建议
- 根据工作时间调整提醒频率
- 考虑用户偏好（简洁/详细）

---

### Scenario 5: Weather Alerts (天气预警)

**用户请求：**
```
"如果明天下雨，早上提醒我带伞"
```

**配置示例：**
```json
{
  "name": "恶劣天气提醒",
  "description": "下雨天早上提醒带伞",
  "cron": "0 7 * * *",
  "taskType": "llm_proactive_chat",
  "taskParams": {
    "prompt": "检查今天的天气。

如果下雨/下雪/恶劣天气：
1. 提醒用户带伞/注意安全
2. 建议出行方式
3. 关心语气

如果天气好：
- 简单问候即可"
  }
}
```

**用户收到（下雨天）：**

> 🌧️ 天气提醒
>
> 今天北京有中雨，气温 12°C
>
> 💡 提醒：
> - ☂️ 记得带伞
> - 👕 穿外套，注意保暖
> - 🚗 开车注意安全
>
> 祝你今天顺利！

**自动触发机制：**
1. 每天早上 7 点执行天气检查
2. 如果检测到恶劣天气，生成个性化提醒
3. 如果天气良好，发送简单问候或不发送

---

### Scenario 6: Personalized Suggestions (个性化建议)

**用户请求：**
```
"帮我养成喝水的习惯，每 2 小时提醒我一次"
```

**配置示例：**
```json
{
  "name": "喝水提醒",
  "description": "每 2 小时提醒喝水",
  "cron": "0 10,12,14,16,18 * * *",
  "taskType": "send_reminder",
  "taskParams": {
    "message": "💧 该喝水了！\n\n保持水分摄入有助于保持专注力和健康。",
    "priority": "low"
  },
  "enabled": true
}
```

**用户收到：**

> 💧 该喝水了！
>
> 保持水分摄入有助于保持专注力和健康。
>
> 💡 你今天已经喝了 5 杯水，目标 8 杯！

**智能推荐特点：**
- 根据用户习惯调整提醒频率
- 结合目标进度提供鼓励
- 支持用户偏好定制

---

## Configuration (配置参考)

### 工具清单

#### 调度工具

| 工具名称 | 用途 | 触发方式 |
|---------|------|---------|
| `proactive_schedule` | 创建定时任务 | Cron 表达式 |
| `schedule_once` | 创建一次性任务 | 延迟秒数 |
| `proactive_pattern` | 创建条件触发器 | 条件表达式 |

#### 任务管理工具

| 工具名称 | 用途 |
|---------|------|
| `proactive_list` | 列出所有任务 |
| `proactive_cancel` | 取消任务 |
| `proactive_enable` | 启用任务 |
| `proactive_disable` | 禁用任务 |

#### 通知工具

| 工具名称 | 用途 |
|---------|------|
| `notification_send` | 发送通知 |
| `notification_list` | 列出待发送通知 |
| `notification_mark_read` | 标记已读 |
| `notification_delete` | 删除通知 |
| `notification_history` | 查看历史 |
| `notification_stats` | 统计信息 |

### Cron 表达式参考

```
┌───────────── 分钟 (0 - 59)
│ ┌───────────── 小时 (0 - 23)
│ │ ┌───────────── 日期 (1 - 31)
│ │ │ ┌───────────── 月份 (1 - 12)
│ │ │ │ ┌───────────── 星期几 (0 - 6) (0 = 周日)
│ │ │ │ │
* * * * *
```

**常用示例：**

| 表达式 | 含义 |
|--------|------|
| `0 9 * * *` | 每天早上 9:00 |
| `0 */2 * * *` | 每 2 小时 |
| `0 9-17 * * 1-5` | 工作时间每小时 |
| `0 20 * * 5` | 每周五晚上 8:00 |
| `*/30 * * * *` | 每 30 分钟 |
| `0 0 1 * *` | 每月 1 日午夜 |

### 时间设置

⚠️ **时区注意**：Beeclaw 使用配置的时区（默认 `Asia/Shanghai`）解析 Cron 表达式。

在 `data/memory/facts/config.md` 中配置：
```markdown
## 用户配置
- timezone: Asia/Shanghai
```

### 内容模板

#### 每日问候模板
```json
{
  "prompt": "早上好！根据用户当前目标、日历事件、工作习惯，生成个性化建议。

用户目标：${goals}
今日日程：${calendar}
工作时间：${workHours}

发送一个简短、友好的问候，提供 1-2 条实用建议。"
}
```

#### 会议提醒模板
```json
{
  "prompt": "会议提醒：${meeting.title} 将在 ${time} 分钟后开始。

会议主题：${meeting.agenda}
参会人员：${meeting.attendees}

提醒用户：
1. 准备会议材料
2. 检查设备
3. 提前进入会议室"
}
```

---

## Quick Reference (快速参考)

### 三种触发方式

#### 1. Cron 定时 - `proactive_schedule`
```
用户说："每天早上 9 点提醒我..."
→ 使用 proactive_schedule(cron="0 9 * * *", ...)
```

#### 2. 延迟执行 - `schedule_once`
```
用户说："10 分钟后提醒我..."
→ 使用 schedule_once(delay_seconds=600, ...)
```

#### 3. 条件触发 - `proactive_pattern`（未来）
```
用户说："如果一周没更新就提醒我..."
→ 使用 proactive_pattern(condition="...", ...)
```

### 六种任务类型

| 任务类型 | 用途 | 推荐场景 |
|---------|------|---------|
| `llm_proactive_chat` | LLM 生成内容并发送 | 个性化问候、智能提醒 |
| `send_reminder` | 发送预定义消息 | 简单提醒、固定内容 |
| `check_goal_progress` | 检查目标进度 | 目标监控、进度追踪 |
| `run_skill` | 执行技能 | 定期任务、自动化 |
| `self_evolution` | 自我进化 | （自动，每日 4AM） |
| `memory_compress` | 记忆压缩 | （自动，每日 3AM） |

### 快速决策树

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

### 优先级选择

| 优先级 | 图标 | 使用场景 |
|--------|------|---------|
| `urgent` | 🔴 | 会议前、紧急截止 |
| `high` | 🟠 | 重要任务 |
| `normal` | 🟢 | 常规提醒 |
| `low` | ⚪ | 不重要 |

### 常用命令

#### Bot 命令
```bash
# 启动 daemon 模式
bun run bot --daemon

# 停止 daemon
bun run bot --daemon-stop

# PM2 生产模式
bun run pm2:start
bun run pm2:logs
bun run pm2:monit
```

#### 飞书命令
```
/proactive              # 列出所有调度任务
/notifications          # 查看待发送通知
/reminder add 10s 喝水  # 快速创建提醒
/auto                   # 启用自动模式
```

### 数据存储位置

| 数据类型 | 存储路径 |
|----------|----------|
| 调度任务 | `data/proactive/schedules.json` |
| 待发送通知 | `data/proactive/pending.json` |
| 通知历史 | `data/proactive/history.json` |
| Daemon 状态 | `data/daemon/state.json` |
| 队列数据 | `data/queue/beeclaw.db` |

---

## Best Practices (最佳实践)

### 1. 合理设置优先级

```typescript
// ✅ 好：根据重要性设置优先级
"会议开始前 5 分钟" → priority: "urgent"
"任务截止前 1 小时" → priority: "high"
"喝水提醒" → priority: "normal"
"新闻推送" → priority: "low"

// ❌ 坏：滥用 urgent
"每日问候" → priority: "urgent"  // 不合适
```

### 2. 避免过度打扰

```typescript
// ✅ 好：工作时间每 2 小时
cron: "0 */2 9-18 * * 1-5"

// ❌ 坏：每 10 分钟
cron: "*/10 * * * *"  // 太频繁
```

### 3. 结合用户上下文

```typescript
// ✅ 好：使用上下文生成个性化内容
{
  taskType: "llm_proactive_chat",
  taskParams: {
    prompt: `根据用户当前目标、日历事件、工作习惯，生成个性化建议。
             用户目标：${goals}
             今日日程：${calendar}
             工作时间：${workHours}

             发送一个简短、友好的问候，提供 1-2 条实用建议。`
  }
}

// ❌ 坏：固定的通用内容
{
  taskParams: {
    prompt: "早上好！"  // 太简单，不个性化
  }
}
```

### 4. 明确系统指令

在 `llm_proactive_chat` 中，系统会自动添加指令防止递归：

```
[系统指令] 这是一个定时任务的执行。请直接生成要推送的内容，
不要调用任何工具（如 schedule_once、notification_send 等）。
```

⚠️ **不要**在 prompt 中要求 LLM 再次调度任务！

### 5. 考虑用户作息

```typescript
// ✅ 好：尊重用户时间
"工作时间（9-18点）每 2 小时提醒休息"
cron: "0 */2 9-18 * * 1-5"

// ❌ 坏：不分时间
"每 2 小时提醒休息"
cron: "0 */2 * * *"  // 会包括深夜
```

### 6. 消息内容设计

```typescript
// ✅ 好：简洁、明确、有价值
message: "🔴 会议提醒：产品评审会将在 30 分钟后开始\n\n准备材料：本周进展数据"

// ❌ 坏：过长、模糊、无价值
message: "你有一个会议即将开始，请做好准备，记得带笔记本，穿正装，提前10分钟到达..."
```

### 7. 验证任务创建

```typescript
// ✅ 正确：创建后验证
const result = await proactive_schedule({...});
if (!result.success) {
  return `创建失败: ${result.error}`;
}
const tasks = await proactive_list();
if (!tasks.schedules.find(s => s.name === "任务名称")) {
  return "验证失败：任务未创建";
}
console.log("✅ 任务已创建并验证");

// ❌ 错误：假设成功
await proactive_schedule({...});
console.log("已创建");  // 未验证
```

---

## Troubleshooting (故障排查)

### 问题 1：任务创建但没有执行

**可能原因：**
1. Bot 未以 daemon 模式启动
2. 任务未启用 (`enabled: false`)
3. Cron 表达式错误

**解决方案：**
```bash
# 1. 确认 daemon 模式
bun run bot --daemon

# 2. 检查任务状态
# 在飞书中发送："/proactive"

# 3. 验证 Cron 表达式
# 使用在线工具：https://crontab.guru/
```

### 问题 2：消息未推送到飞书

**可能原因：**
1. 没有 `chatId`（且 `lastActiveChatId` 为空）
2. Feishu WebSocket 未连接
3. 用户权限问题

**解决方案：**
```bash
# 1. 检查飞书连接
# 查看日志是否有 "[FeishuWS] Connected successfully"

# 2. 先发送一条消息建立连接
# 在飞书中发送任意消息

# 3. 检查 pending.json
cat data/proactive/pending.json
```

### 问题 3：LLM 生成内容后又创建了新任务

**原因：** LLM 在执行任务时又调用了调度工具

**解决方案：**
- 系统已自动添加防递归指令
- 如果仍有问题，在 prompt 中明确说明：
  ```
  [注意] 这是定时任务执行，直接返回要推送的内容，不要再创建新任务。
  ```

### 问题 4：重复收到相同提醒

**可能原因：**
1. 创建了多个相同的任务
2. Cron 表达式重复触发

**解决方案：**
```bash
# 1. 列出所有任务
# 在飞书中发送："/proactive"

# 2. 取消重复任务
proactive_cancel({ id: "schedule-xxx", type: "schedule" })
```

### 问题 5：run_skill 任务报错 "Unknown task type"

**可能原因：**
1. 参数名不正确（使用了下划线而非驼峰）
2. Daemon 代码未更新

**解决方案：**
```json
// ✅ 正确的参数名
{
  "taskParams": {
    "skillName": "daily-news",  // 使用驼峰命名
    "skillParams": {...}
  }
}

// ❌ 错误的参数名
{
  "taskParams": {
    "skill_name": "daily-news",  // 不要使用下划线
    "params": {...}
  }
}
```

**检查日志：**
```bash
# 查看是否有更详细的错误信息
tail -f logs/beeclaw-out.log | grep "Daemon"
```

### 问题 6：技能执行失败

**可能原因：**
1. 技能不存在
2. 技能参数格式错误
3. 技能执行超时

**解决方案：**
```bash
# 1. 检查技能是否存在
# 在飞书中发送："列出所有技能"

# 2. 查看详细日志
tail -f logs/beeclaw-out.log | grep -A5 "Skill"

# 3. 测试技能
# 手动执行技能，查看是否正常工作
```

### 问题 7：任务执行时间不准确

**可能原因：**
1. 时区配置错误
2. 系统时间不准
3. Cron 解析错误

**解决方案：**
```bash
# 1. 检查时区配置
cat data/memory/facts/config.md | grep timezone

# 2. 检查系统时间
date

# 3. 使用简化的 Cron 表达式
# 避免： "0 9 * * * Asia/Shanghai"
# 使用： "0 9 * * *"  (在配置中指定时区)
```

---

## 附录

### 相关文档

- [Queue 系统文档](./queue-system.md)
- [Scheduler 文档](./scheduler.md)
- [Daemon 文档](./daemon.md)
- [自我进化系统](./future/self-evolution-system.md)
- [定时执行技能指南](./scheduled-skill-execution.md)

---

## 更新日志

- **2026-03-06** - 合并三个文档为统一的主动系统指南
- **2026-03-04** - 初始版本，包含所有主动式能力说明
- **2026-03-04** - 添加防止递归调用的系统指令
- **2026-03-04** - 修复 Worker chatId 传递问题

---

## 反馈与改进

如果你发现文档有误或需要补充，请：
1. 在 `data/memory/facts/lessons.md` 中记录
2. 或直接修改此文档

---

**最后更新**：2026-03-06
**文档版本**：2.0
**维护者**：Beeclaw Team
