# 定时任务推送问题修复

## 问题描述

用户报告了两个问题：

1. **收到2条相同的推送** - 定时任务执行时，收到重复的消息
2. **Markdown 文本显示** - 推送的消息是 Markdown 格式的纯文本，而不是富文本

## 问题1：重复推送

### 原因分析

可能的原因：
1. 定时任务被执行了两次
2. 推送逻辑中有重复推送

经过代码审查，发现在 `src/proactive/job-handlers.ts` 中：

```typescript
if (channel === 'feishu' && chatId && client) {
    await client.sendTextMessage(chatId, 'chat_id', result.response);
    console.log(`[Daemon] 📤 Skill result pushed to Feishu chat: ${chatId}`);
} else if (job.params?.push !== false) {
    // Fallback
    await pushNotification({ ... });
}
```

逻辑是 if-else，所以应该只会推送一次。

**可能的真正原因：**
- 定时任务配置问题，导致被执行了两次
- 或者日志中看到的是不同阶段的输出

### 解决方案

1. 在定时任务参数中明确设置 `push: false` 以避免意外推送
2. 检查定时任务配置，确保只有一个定时任务在运行

**推荐的定时任务参数：**
```json
{
  "name": "每日新闻推送",
  "cron": "0 9 * * *",
  "taskType": "run_skill",
  "taskParams": {
    "skillName": "daily-news",
    "channel": "feishu",
    "push": false
  }
}
```

## 问题2：Markdown 显示为纯文本

### 原因

`client.sendTextMessage()` 发送的是纯文本消息，不支持格式化：

```typescript
await client.sendTextMessage(chatId, 'chat_id', result.response);
```

飞书的文本消息类型 (`msg_type: 'text'`) 不支持 Markdown 格式。

### 解决方案

使用飞书的富文本消息类型 (`msg_type: 'post'`)，它支持：
- 标题
- 粗体、斜体
- 链接
- 列表
- @提及

**修复步骤：**

1. 在 `src/feishu/ws-client.ts` 中添加 `sendPostMessage` 方法：

```typescript
async sendPostMessage(
  receiveId: string,
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id',
  content: string,
  options?: {
    title?: string;
  }
): Promise<void> {
  if (!this.client) {
    throw new Error('[FeishuWS] Client not initialized');
  }

  const { sendPostMessage } = await import('./send');
  await sendPostMessage(this.client, receiveId, receiveIdType, content, options);
}
```

2. 在 `src/proactive/job-handlers.ts` 中使用富文本消息：

```typescript
if (channel === 'feishu' && chatId && client) {
  // Use rich text message for better formatting
  await client.sendPostMessage(chatId, 'chat_id', result.response);
  console.log(`[Daemon] 📤 Skill result pushed to Feishu chat: ${chatId}`);
}
```

### 飞书富文本格式

飞书的 `sendPostMessage` 会自动将 Markdown 转换为富文本：

**输入（Markdown）：**
```markdown
# 今日新闻摘要

## 科技
- **AI 突破**：GPT-5 发布
- **量子计算**：新算法提升效率

## 财经
- 股市上涨 2%
- 比特币突破 10 万美元
```

**输出（飞书富文本）：**
- 标题：今日新闻摘要
- 粗体文字
- 有序列表
- 层级结构

## 修改的文件

1. **src/feishu/ws-client.ts** - 添加 `sendPostMessage` 方法
2. **src/proactive/job-handlers.ts** - 使用富文本消息

## 测试

### 1. 测试富文本消息

```bash
# 重启 bot
killall bun
bun run bot --daemon

# 在飞书中测试
"发送一条测试富文本消息"
```

### 2. 测试定时任务

创建一个简单的测试任务：

```json
{
  "name": "测试富文本推送",
  "cron": "* * * * *",
  "taskType": "run_skill",
  "taskParams": {
    "skillName": "daily-news",
    "channel": "feishu",
    "push": false
  },
  "enabled": true
}
```

### 预期结果

1. ✅ 只收到1条推送
2. ✅ 消息以富文本格式显示（标题、粗体、列表等）

## 检查定时任务

查看现有的定时任务：

```bash
cat data/memory/proactive/schedules.json | jq '.schedules | to_entries[] | select(.value.name | contains("新闻"))'
```

如果发现有重复的任务，删除重复的：

```json
// 在飞书中说
"删除名为 'xxx' 的定时任务"
```

## 调试日志

查看详细日志：

```bash
tail -f logs/beeclaw-out.log | grep -E "Daemon|Skill|pushed"
```

应该看到：
```
[Daemon] Executing schedule: 每日新闻推送
[Daemon] Executing job: run_skill
[Daemon] Executing skill: daily-news
[Daemon] ✅ Skill daily-news executed successfully
[Daemon] Response: ...
[Daemon] 📤 Skill result pushed to Feishu chat: xxx
```

## 最佳实践

1. **明确设置 push 参数** - 避免意外推送
   ```json
   {
     "taskParams": {
       "skillName": "xxx",
       "channel": "feishu",
       "push": false
     }
   }
   ```

2. **使用富文本消息** - 更好的用户体验
   - 自动支持 Markdown 格式
   - 标题、列表、粗体等

3. **监控定时任务** - 定期检查
   ```bash
   # 列出所有定时任务
   cat data/memory/proactive/schedules.json | jq '.schedules | keys'
   ```

4. **避免重复任务** - 使用唯一的任务名称

## 相关文档

- [定时执行技能指南](./scheduled-skill-execution.md)
- [飞书消息类型文档](https://open.feishu.cn/document/client-docs/bot-v3/events/message-events)
