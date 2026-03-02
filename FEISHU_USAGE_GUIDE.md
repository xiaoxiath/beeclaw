# Beeclaw 飞书功能使用指南

## 📦 安装依赖

```bash
bun add @larksuiteoapi/node-sdk
```

## 🚀 快速开始

### 1. 初始化客户端

```typescript
import { initFeishuWSClient, getFeishuWSClient } from './feishu';

// 初始化 WebSocket 客户端
initFeishuWSClient({
  appId: process.env.LARK_APP_ID!,
  appSecret: process.env.LARK_APP_SECRET!,
  enabled: true,
});

const client = getFeishuWSClient();
```

### 2. 发送消息

#### 文本消息
```typescript
import { sendTextMessage } from './feishu';

await sendTextMessage(
  client,
  'ou_xxx', // open_id
  'open_id',
  '你好，这是一条测试消息'
);
```

#### 富文本消息（带 @提及）
```typescript
import { sendPostMessage } from './feishu';

await sendPostMessage(
  client,
  'ou_xxx',
  'open_id',
  '**重要通知**\n\n请查看以下内容：\n- 项目A已完成\n- 项目B进行中',
  {
    title: '📊 周报',
    mentionTargets: [
      { openId: 'ou_yyy', name: '张三' },
      { openId: 'ou_zzz', name: '李四' },
    ],
  }
);
```

#### Markdown 卡片
```typescript
import { sendMarkdownCard } from './feishu';

await sendMarkdownCard(
  client,
  'ou_xxx',
  'open_id',
  `## ✅ 任务完成

- 耗时：2小时
- 状态：成功
- 输出：[查看报告](https://example.com)

\`\`\`bash
npm run build
\`\`\``,
  { title: '构建报告' }
);
```

### 3. 使用卡片构建器

#### 基础卡片
```typescript
import { createCard } from './feishu';

const card = createCard()
  .setHeader('通知标题', '副标题')
  .addMarkdown('**重要**：请查看')
  .addDivider()
  .addText('这是普通文本')
  .addButton('确认', { action: 'confirm' }, { type: 'primary' })
  .build();

await card.send(client, 'ou_xxx', 'open_id');
```

#### 表单卡片
```typescript
import { buildFormCard } from './feishu';

const formCard = buildFormCard(
  '信息收集',
  [
    { name: 'name', required: true, placeholder: '请输入姓名' },
    { name: 'department', type: 'select', options: [
      { text: '技术部', value: 'tech' },
      { text: '产品部', value: 'product' },
    ]},
    { name: 'feedback', type: 'textarea', placeholder: '请输入反馈' },
  ],
  '提交'
);

await sendCardMessage(client, 'ou_xxx', 'open_id', formCard);
```

#### 列表卡片
```typescript
import { buildListCard } from './feishu';

const listCard = buildListCard(
  '待办事项',
  [
    { title: '完成报告', description: '截止日期：明天', icon: '📝' },
    { title: '团队会议', description: '下午3点', icon: '📅' },
    { title: '代码审查', description: 'PR #123', icon: '💻' },
  ]
);

await sendCardMessage(client, 'ou_xxx', 'open_id', listCard);
```

### 4. 媒体上传

#### 上传图片
```typescript
import { uploadImage, sendImageMessage } from './feishu';

// 从本地上传
const { imageKey } = await uploadImage(client, '/path/to/image.png');

// 从 URL 上传
const { imageKey } = await uploadImage(client, 'https://example.com/image.jpg');

// 发送图片消息
await sendImageMessage(client, 'ou_xxx', 'open_id', imageKey);
```

#### 上传文件
```typescript
import { uploadFile, sendFileMessage } from './feishu';

const { fileKey } = await uploadFile(
  client,
  '/path/to/document.pdf',
  { maxMb: 30 }
);

await sendFileMessage(client, 'ou_xxx', 'open_id', fileKey);
```

#### 自动发送媒体
```typescript
import { sendMedia } from './feishu';

// 自动检测类型并发送
await sendMedia(
  client,
  'ou_xxx',
  'open_id',
  '/path/to/file.jpg' // 或 URL 或 Buffer
);
```

### 5. @提及系统

#### 提取提及目标
```typescript
import { extractMentionTargets, isMentionForwardRequest } from './feishu';

// 从消息事件中提取
const targets = extractMentionTargets(event);
// [{ openId: 'ou_xxx', name: '张三' }]

// 检查是否是 mention-forward
const isForward = isMentionForwardRequest(event, botOpenId);
```

#### 构建带 @提及的消息
```typescript
import {
  buildMentionedMessage,
  formatMentionForText
} from './feishu';

// 方式1：使用辅助函数
const message = buildMentionedMessage(
  '请查看这份报告',
  [
    { openId: 'ou_xxx', name: '张三' },
    { openId: 'ou_yyy', name: '李四' },
  ],
  { prefix: '🔔 ' }
);
// 结果: "🔔 @张三 @李四 请查看这份报告"

// 方式2：手动格式化
const mention = formatMentionForText('ou_xxx', '张三');
// 结果: '<at user_id="ou_xxx">张三</at>'
```

#### @所有人
```typescript
import { formatMentionAllForText } from './feishu';

const mentionAll = formatMentionAllForText();
// 结果: '<at user_id="all">所有人</at>'
```

### 6. 日历功能

#### 列出日历
```typescript
import { getCalendarList } from './feishu';

const { calendars } = await getCalendarList(client);
// [{ calendar_id: 'xxx', summary: '工作日历', ... }]
```

#### 创建事件
```typescript
import { createEvent } from './feishu';

const event = await createEvent(client, calendarId, {
  summary: '团队会议',
  description: '讨论项目进度',
  startTime: '2026-03-04T10:00:00',
  endTime: '2026-03-04T11:00:00',
  timezone: 'Asia/Shanghai',
  location: '会议室A',
  attendees: [
    { type: 'user', id: 'ou_xxx' },
  ],
  reminders: [
    { minutes: 15 }, // 提前15分钟提醒
  ],
});
```

#### 查询事件
```typescript
import { listEvents, getTodayEvents } from './feishu';

// 查询时间范围内的事件
const { events } = await listEvents(client, calendarId, {
  startTime: '1709515200', // Unix timestamp
  endTime: '1709601600',
});

// 获取今日事件
const todayEvents = await getTodayEvents(client, calendarId);
```

#### 搜索事件
```typescript
import { searchEvents } from './feishu';

const { events } = await searchEvents(
  client,
  calendarId,
  '会议', // 关键词
  {
    startTime: '1709515200',
    endTime: '1709601600',
  }
);
```

#### 快速创建事件
```typescript
import { createQuickEvent } from './feishu';

// 30分钟后开始，持续1小时
const event = await createQuickEvent(
  client,
  calendarId,
  '临时会议',
  60, // 持续时间（分钟）
  {
    offsetMinutes: 30, // 30分钟后开始
    location: '线上',
  }
);
```

#### 更新事件
```typescript
import { updateEvent } from './feishu';

const updated = await updateEvent(
  client,
  calendarId,
  eventId,
  {
    summary: '更新后的标题',
    location: '新地点',
  }
);
```

#### 删除事件
```typescript
import { deleteEvent } from './feishu';

await deleteEvent(client, calendarId, eventId);
```

## 🔧 高级用法

### 1. 消息回复
```typescript
import { replyMessage } from './feishu';

// 回复文本消息
await replyMessage(client, messageId, '这是回复内容', 'text');

// 回复卡片消息
await replyMessage(
  client,
  messageId,
  '',
  'interactive',
  {
    card: buildMarkdownCard('回复内容'),
  }
);
```

### 2. 编辑消息
```typescript
import { editMessage } from './feishu';

// 编辑文本消息（24小时内）
await editMessage(client, messageId, '更新后的内容', 'text');
```

### 3. 下载媒体
```typescript
import { downloadImage, downloadMessageResource } from './feishu';

// 下载图片
const imageBuffer = await downloadImage(client, imageKey);

// 下载消息附件
const fileBuffer = await downloadMessageResource(
  client,
  messageId,
  fileKey,
  'file'
);
```

## 📚 完整示例

### 创建会议并发送通知
```typescript
import {
  createEvent,
  createCard,
  sendTextMessage,
} from './feishu';

async function createMeetingAndNotify(
  client: any,
  calendarId: string,
  chatId: string,
  meeting: {
    title: string;
    time: string;
    duration: number;
    attendees: Array<{ id: string; name: string }>;
  }
) {
  // 1. 创建日历事件
  const startTime = new Date(meeting.time);
  const endTime = new Date(startTime.getTime() + meeting.duration * 60 * 1000);

  const event = await createEvent(client, calendarId, {
    summary: meeting.title,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    attendees: meeting.attendees.map(a => ({
      type: 'user',
      id: a.id,
    })),
    reminders: [{ minutes: 15 }],
  });

  // 2. 发送通知卡片
  const card = createCard()
    .setHeader('📅 会议邀请', meeting.title)
    .addMarkdown(`
**时间**：${startTime.toLocaleString('zh-CN')}
**时长**：${meeting.duration} 分钟
**参会人**：${meeting.attendees.map(a => a.name).join('、 ')}

请准时参加！
    `)
    .addDivider()
    .addButton('查看日历', { action: 'view_calendar', eventId: event.event_id })
    .build();

  await card.send(client, chatId, 'chat_id');

  return event;
}
```

## 🎯 最佳实践

1. **使用 CardBuilder**：链式调用更清晰，类型安全
2. **错误处理**：所有函数都会抛出异常，记得 try-catch
3. **类型检查**：使用 TypeScript 类型推断避免错误
4. **性能优化**：复用 imageKey/fileKey，避免重复上传
5. **时区注意**：日历事件使用 ISO 8601 格式，注意时区转换

## 🐛 常见问题

### Q: 如何获取用户的 open_id？
A: 从消息事件的 `event.sender.sender_id.open_id` 获取。

### Q: 卡片按钮点击后如何处理？
A: 需要注册 card.action 事件处理器。

### Q: 图片上传失败怎么办？
A: 检查图片格式和大小（最大 20MB），确保是支持的格式。

### Q: 日历事件时间不对？
A: 确保 ISO 8601 格式，并正确设置 timezone 参数。

## 📖 更多资源

- [Feishu 开发文档](https://open.feishu.cn/document/)
- [API 参考](https://open.feishu.cn/document/server-docs/)
- [卡片搭建工具](https://open.feishu.cn/tool/cardbuilder)
- [实施计划](./FEISHU_IMPLEMENTATION_PLAN.md)
