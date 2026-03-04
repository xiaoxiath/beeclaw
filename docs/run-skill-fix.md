# run_skill 任务类型修复

## 问题描述

当创建 `run_skill` 类型的定时任务时，daemon 报错：
```
[Daemon] Unknown task type: run_skill
```

## 根本原因

参数命名不一致：
- `src/queue/handlers/proactive-handler.ts` 使用 `skillName`（驼峰命名）
- `src/proactive/daemon.ts` 使用 `skill_name`（下划线命名）

当用户使用 LLM 创建定时任务时，LLM 使用驼峰命名 `skillName`，但 daemon 期望下划线命名 `skill_name`，导致无法识别任务类型。

## 修复内容

### 1. daemon.ts 支持两种参数名格式

修改 `src/proactive/daemon.ts` 中的 `run_skill` 处理逻辑：

```typescript
// 支持两种命名格式
const skillName = job.params?.skillName as string || job.params?.skill_name as string;
const skillParams = job.params?.skillParams as Record<string, unknown>
                  || job.params?.params as Record<string, unknown>
                  || {};
```

### 2. 增强日志输出

添加更详细的日志，方便调试：

```typescript
console.log(`[Daemon] Executing skill: ${skillName}`);
console.log(`[Daemon] Skill params:`, JSON.stringify(skillParams).substring(0, 100));
console.log(`[Daemon] ✅ Skill ${skillName} executed successfully`);
console.log(`[Daemon] Response: ${result.response.substring(0, 200)}...`);
console.log(`[Daemon] 📤 Result pushed to notification`);
```

### 3. 更新工具文档

更新 `src/proactive/tools.ts` 中的参数说明：

```typescript
description: 'Parameters for the task. For run_skill: { skillName: string, skillParams?: object }. ...'
```

### 4. 创建使用指南

新增文档 `docs/scheduled-skill-execution.md`，详细说明如何使用定时执行技能功能。

## 测试结果

✅ 所有测试通过（20 个测试）
✅ 向后兼容：同时支持 `skillName` 和 `skill_name`
✅ 推荐使用 `skillName`（驼峰命名）

## 使用示例

### 创建每日新闻推送

```json
{
  "name": "每日新闻推送",
  "description": "每天15:12推送新闻摘要",
  "cron": "12 15 * * *",
  "taskType": "run_skill",
  "taskParams": {
    "skillName": "daily-news",
    "channel": "feishu"
  }
}
```

### 执行日志

```
[Daemon] Executing schedule: 每日新闻推送
[Daemon] Executing job: run_skill
[Daemon] Executing skill: daily-news
[Daemon] Skill params: {"channel":"feishu"}
[Daemon] ✅ Skill daily-news executed successfully
[Daemon] Response: 今日新闻摘要：...
[Daemon] 📤 Result pushed to notification
```

## 相关文件

- `src/proactive/daemon.ts` - Daemon 任务执行逻辑
- `src/proactive/tools.ts` - Proactive 工具定义
- `src/queue/handlers/proactive-handler.ts` - Queue 任务处理器
- `docs/scheduled-skill-execution.md` - 使用指南
- `docs/logging-guide.md` - 日志指南

## 后续改进

1. 统一所有参数使用驼峰命名（breaking change，需要版本升级）
2. 添加参数验证和类型检查
3. 支持技能执行超时配置
4. 添加技能执行失败重试机制
