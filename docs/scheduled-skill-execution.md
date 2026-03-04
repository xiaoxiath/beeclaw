# 定时执行技能指南

## 概述

使用 `proactive_schedule` 工具可以创建定时任务来自动执行技能。

## 参数说明

### taskType: "run_skill"

执行技能任务需要提供以下参数：

```json
{
  "name": "任务名称",
  "cron": "0 9 * * *",
  "taskType": "run_skill",
  "taskParams": {
    "skillName": "skill-name",
    "skillParams": {
      "param1": "value1",
      "param2": "value2"
    }
  }
}
```

### taskParams 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `skillName` | string | ✅ | 要执行的技能名称（注意是驼峰命名） |
| `skillParams` | object | ❌ | 传递给技能的参数 |
| `userId` | string | ❌ | 用户 ID（默认: 'cli-user'） |
| `channel` | string | ❌ | 推送渠道：'cli' | 'feishu' | 'webhook'（默认: 'cli'） |
| `push` | boolean | ❌ | 是否推送结果（默认: true） |

## 示例

### 1. 每日新闻推送

```json
{
  "name": "每日新闻推送",
  "description": "每天早上9点推送新闻摘要",
  "cron": "0 9 * * *",
  "taskType": "run_skill",
  "taskParams": {
    "skillName": "daily-news",
    "channel": "feishu"
  }
}
```

### 2. 定期数据分析

```json
{
  "name": "每周数据报告",
  "description": "每周一早上8点生成数据报告",
  "cron": "0 8 * * 1",
  "taskType": "run_skill",
  "taskParams": {
    "skillName": "data-analyzer",
    "skillParams": {
      "reportType": "weekly",
      "metrics": ["users", "revenue", "engagement"]
    },
    "channel": "feishu"
  }
}
```

### 3. 定时提醒

```json
{
  "name": "喝水提醒",
  "description": "每2小时提醒喝水",
  "cron": "0 */2 * * *",
  "taskType": "run_skill",
  "taskParams": {
    "skillName": "health-reminder",
    "skillParams": {
      "type": "water",
      "message": "记得喝水哦！💧"
    }
  }
}
```

## Cron 表达式说明

Cron 表达式格式：`分 时 日 月 周`

示例：
- `0 9 * * *` - 每天早上 9:00
- `*/30 * * * *` - 每 30 分钟
- `0 18 * * 1-5` - 周一到周五下午 6:00
- `0 12 1 * *` - 每月1号中午 12:00

## 调试日志

当定时任务执行时，你会看到以下日志：

```
[Daemon] Executing schedule: 每日新闻推送
[Daemon] Executing job: run_skill
[Daemon] Executing skill: daily-news
[Daemon] Skill params: {"channel":"feishu"}
[Daemon] ✅ Skill daily-news executed successfully
[Daemon] Response: 今日新闻摘要：...
[Daemon] 📤 Result pushed to notification
```

## 常见问题

### Q: 为什么看到 "Unknown task type: run_skill"？

A: 这是因为 daemon 不认识 `run_skill` 任务类型。已在最新版本中修复，确保使用更新后的代码。

### Q: 应该使用 skillName 还是 skill_name？

A: 推荐使用 `skillName`（驼峰命名）。为了向后兼容，系统同时支持 `skill_name`（下划线），但推荐使用驼峰命名。

### Q: 如何查看定时任务列表？

A: 使用 `proactive_list` 工具：

```json
{
  "type": "schedules"
}
```

### Q: 如何取消定时任务？

A: 使用 `proactive_cancel` 工具：

```json
{
  "id": "schedule-xxx",
  "type": "schedule"
}
```

### Q: 技能执行失败怎么办？

A: 检查以下几点：
1. 技能是否存在：使用 `skill_list` 查看所有技能
2. 参数是否正确：检查 `skillParams` 格式
3. 查看日志：`[Daemon] ❌ Skill xxx execution failed: ...`

## 测试定时任务

创建一个简单的测试任务，5分钟后执行：

```json
{
  "name": "测试技能执行",
  "cron": "* * * * *",
  "taskType": "run_skill",
  "taskParams": {
    "skillName": "test-skill",
    "push": false
  },
  "enabled": true
}
```

## 相关文档

- [Proactive Capabilities Guide](./proactive-capabilities-guide.md) - 完整的主动能力指南
- [Proactive Quick Reference](./proactive-quick-reference.md) - 快速参考
- [Skills Documentation](../skills/) - 技能系统文档
