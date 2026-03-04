# run_skill 修复 - 最终版本

## 问题现象

定时任务执行时报错：
```
[Daemon] Executing schedule: 每日新闻推送
[Daemon] Executing job: run_skill
[Daemon] Unknown task type: run_skill
```

## 根本原因

**有两个地方处理定时任务：**

1. `src/proactive/daemon.ts` - `executeDefaultJobHandler()` 方法
2. `src/bot.ts` - `daemon.start({ onJob: ... })` 回调

当 `daemon.start()` 传入 `onJob` 回调时，会**覆盖** daemon 自己的 `executeDefaultJobHandler`。

我一开始只修改了 `daemon.ts`，但实际执行的是 `bot.ts` 中的回调，所以修改无效。

## 正确的修复位置

**需要在 `src/bot.ts` 中添加 `run_skill` 的处理逻辑**

### 修改内容

在 `src/bot.ts` 的 `daemon.start({ onJob: ... })` 回调中，添加 `run_skill` case：

```typescript
case 'run_skill': {
  // Support both skillName (camelCase) and skill_name (snake_case)
  const skillName = job.params?.skillName as string || job.params?.skill_name as string;
  const skillParams = job.params?.skillParams as Record<string, unknown>
                    || job.params?.params as Record<string, unknown>
                    || {};

  if (!skillName) {
    console.error('[Daemon] run_skill task missing skillName parameter');
    break;
  }

  console.log(`[Daemon] Executing skill: ${skillName}`);
  console.log(`[Daemon] Skill params:`, JSON.stringify(skillParams).substring(0, 100));

  try {
    const { sendProactiveMessage } = await import('./session');
    const { getSkillStore } = await import('./skills/store');

    // Get the skill content
    const skillStore = getSkillStore();
    const skill = skillStore.get(skillName);

    if (!skill) {
      console.error(`[Daemon] Skill not found: ${skillName}`);
      break;
    }

    // Build prompt to execute the skill
    const skillPrompt = `请执行技能 "${skillName}"。

技能说明：
${skill.description}

技能内容：
${skill.content || '(无详细内容)'}

参数：
${JSON.stringify(skillParams, null, 2)}

请根据技能说明和参数执行相应操作。`;

    // Get Feishu client for channel info
    const client = getFeishuWSClient();
    const channel = (job.params?.channel as 'cli' | 'feishu' | 'webhook') || 'feishu';
    const chatId = (job.params?.chatId as string) || client?.lastActiveChatId;
    const userId = (job.params?.userId as string) || client?.lastActiveUserId || 'feishu-user';

    // Execute through the agent
    const result = await sendProactiveMessage({
      message: skillPrompt,
      userId,
      channel,
      sessionId: chatId ? `feishu-${chatId}-${userId}` : undefined,
    });

    if (result.success && result.response) {
      console.log(`[Daemon] ✅ Skill ${skillName} executed successfully`);
      console.log(`[Daemon] Response: ${result.response.substring(0, 200)}...`);

      // Push to Feishu if channel is feishu and we have chatId
      if (channel === 'feishu' && chatId && client) {
        await client.sendTextMessage(chatId, 'chat_id', result.response);
        console.log(`[Daemon] 📤 Skill result pushed to Feishu chat: ${chatId}`);
      } else if (job.params?.push !== false) {
        // Fallback: push as notification
        const { pushNotification } = await import('./proactive/pusher');
        await pushNotification({
          message: result.response,
          priority: 'normal',
          category: 'skill-execution',
        });
        console.log(`[Daemon] 📤 Skill result pushed as notification`);
      }
    } else {
      console.error(`[Daemon] ❌ Skill ${skillName} execution failed:`, result.error);
    }
  } catch (error) {
    console.error('[Daemon] Failed to execute skill:', error instanceof Error ? error.message : 'Unknown error');
  }
  break;
}
```

## 修改的文件

1. ✅ **src/bot.ts** - 主要修复（添加 run_skill case）
2. ✅ **src/proactive/daemon.ts** - 添加 run_skill case（作为备用）
3. ✅ **src/proactive/tools.ts** - 更新参数文档

## 现在应该可以看到的日志

```
[Daemon] Executing schedule: 每日新闻推送
[Daemon] Executing job: run_skill
[Daemon] Executing skill: daily-news
[Daemon] Skill params: {}
[Daemon] ✅ Skill daily-news executed successfully
[Daemon] Response: 今日新闻摘要：...
[Daemon] 📤 Skill result pushed to Feishu chat: xxx
```

## 测试方法

1. 重启 bot：`bun run bot --daemon`
2. 查看日志：`tail -f logs/beeclaw-out.log`
3. 等待定时任务触发，或手动创建一个测试任务

## 创建测试任务

```json
{
  "name": "测试技能执行",
  "description": "立即执行一次技能测试",
  "cron": "* * * * *",
  "taskType": "run_skill",
  "taskParams": {
    "skillName": "daily-news",
    "channel": "feishu"
  },
  "enabled": true
}
```

## 经验教训

1. **仔细查看日志来源** - 使用 `grep -rn "Executing job:" src/` 找到真正的代码位置
2. **理解回调覆盖机制** - `onJob` 回调会覆盖默认的 handler
3. **验证修改位置** - 确保修改在真正执行的代码路径上
4. **重启进程** - 代码修改后必须重启进程才能生效

## 相关文档

- [定时执行技能指南](./scheduled-skill-execution.md)
- [主动式能力指南](./proactive-capabilities-guide.md)
- [日志指南](./logging-guide.md)
