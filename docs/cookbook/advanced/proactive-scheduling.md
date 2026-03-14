# 主动调度系统

> 30分钟学会定时任务和主动通知

## 场景

你希望 Beeclaw 能：
1. 每周五自动生成周报
2. 每天早上提醒今日待办
3. 检测到重要事件时主动通知

## 目标

- ✅ 理解主动系统架构
- ✅ 创建定时任务
- ✅ 实现主动通知
- ✅ 配置守护进程模式

## 前置条件

- [ ] 已完成 [快速开始](../../getting-started.md)
- [ ] 理解 [主动系统](../../guide/proactive-system.md)

---

## 步骤

### 步骤 1：启用守护进程

```bash
# CLI 模式 + 守护进程
bun run cli --daemon

# Bot 模式 + 守护进程
bun run bot --daemon
```

### 步骤 2：创建定时任务

#### 方式 1：配置文件

```json
{
  "proactive": {
    "enabled": true,
    "daemon": {
      "enabled": true,
      "schedules": [
        {
          "id": "weekly-report",
          "cron": "0 17 * * 5",
          "action": "skill_execute",
          "params": {
            "skillId": "productivity/weekly-report"
          }
        },
        {
          "id": "morning-reminder",
          "cron": "0 9 * * 1-5",
          "action": "goal_list",
          "params": {
            "status": "active"
          }
        }
      ]
    }
  }
}
```

#### 方式 2：CLI 命令

```bash
> /schedule create weekly-report "0 17 * * 5" skill_execute productivity/weekly-report
```

### 步骤 3：主动通知

```typescript
// 插件中实现
scheduler.notify({
  channel: 'feishu',
  userId: 'ou_xxx',
  message: '📅 今日待办：\n1. 完成文档\n2. 代码审查'
});
```

### 步骤 4：查看任务状态

```bash
> /schedule list
```

**输出**:
```
定时任务 (2):

1. weekly-report
   Cron: 0 17 * * 5 (每周五 17:00)
   下次执行: 2026-03-15 17:00
   状态: ✅ 活跃

2. morning-reminder
   Cron: 0 9 * * 1-5 (工作日 09:00)
   下次执行: 2026-03-15 09:00
   状态: ✅ 活跃
```

---

## 完整示例

### 场景：每日新闻推送

```json
{
  "id": "daily-news",
  "cron": "0 8 * * *",
  "action": "deep_research",
  "params": {
    "topic": "今日科技新闻",
    "depth": "quick"
  },
  "callback": {
    "type": "notify",
    "channel": "feishu",
    "template": "daily-news-card.json"
  }
}
```

---

## 验证

- [ ] 守护进程正常启动
- [ ] 定时任务按计划执行
- [ ] 通知成功发送
- [ ] 任务日志可查看

---

**预计完成时间**: 30分钟
**难度**: ⭐⭐
**标签**: 定时任务、主动通知、守护进程
