# 如何通过机器人给用户创建和维护日程

## 📋 概述

Beeclaw 可以通过飞书日历 API 为用户创建、查询、更新和删除日程。整个流程已经实现了**自动授权**，用户只需在首次使用时授权即可。

## 🔑 核心概念

### 1. 日历 ID (calendar_id)

在飞书日历系统中：

- **用户主日历**: calendar_id = 用户的 `open_id`
- **其他日历**: 用户可能有多个日历（工作日历、个人日历等），每个都有唯一的 calendar_id

```typescript
// 用户的 open_id 就是其主日历的 calendar_id
const openId = 'ou_84aad35d084aa403a838cf73ee18467';
const primaryCalendarId = openId; // ✅ 这就是用户的主日历 ID
```

### 2. 权限要求

| 操作 | 所需权限 | 说明 |
|------|---------|------|
| 查询日历列表 | `calendar:calendar:readonly` | 只读权限 |
| 查询日程 | `calendar:calendar:readonly` | 只读权限 |
| **创建日程** | `calendar:calendar` | **读写权限** |
| **更新日程** | `calendar:calendar` | **读写权限** |
| **删除日程** | `calendar:calendar` | **读写权限** |

## 🚀 完整工作流程

### 流程图

```
用户请求创建日程
      ↓
获取用户 open_id (feishu_get_current_user)
      ↓
首次使用？ → 弹出授权卡片 → 用户点击授权
      ↓
使用 user_access_token 调用日历 API
      ↓
创建/更新/删除日程
      ↓
返回结果给用户
```

## 💡 使用示例

### 场景 1: 创建日程

**用户对话：**
```
用户: 帮我创建一个明天下午3点的会议，讨论产品方案
```

**Beeclaw 执行流程：**

1. **解析时间**：明天下午3点 → `2026-03-16T15:00:00`
2. **获取用户信息**：调用 `feishu_get_current_user` 获取 open_id
3. **检查授权**：首次使用会弹出授权卡片
4. **创建日程**：调用 `feishu_calendar_event_create`

**AI 自动调用工具：**

```typescript
// 步骤 1: 获取用户信息（无需授权）
{
  tool: 'feishu_get_current_user',
  params: {}
}
// 返回: { openId: 'ou_xxx', chatId: 'oc_xxx' }

// 步骤 2: 创建日程（需要授权）
{
  tool: 'feishu_calendar_event_create',
  params: {
    calendarId: 'ou_xxx',  // 使用用户的 open_id 作为 calendar_id
    summary: '讨论产品方案',
    startTime: '2026-03-16T15:00:00',
    endTime: '2026-03-16T16:00:00',
    description: '产品方案讨论会议',
    timezone: 'Asia/Shanghai'
  }
}
```

**返回结果：**
```
✅ 已为你创建日程！

📅 标题: 讨论产品方案
🕐 时间: 2026-03-16 15:00-16:00
📍 时区: Asia/Shanghai
```

### 场景 2: 查询今日日程

**用户对话：**
```
用户: 我今天有什么安排？
```

**AI 自动调用工具：**

```typescript
{
  tool: 'feishu_calendar_today',
  params: {
    calendarId: 'ou_xxx'  // 用户的 open_id
  }
}
```

**返回结果：**
```
📅 今日日程 (2026-03-15)

10:00-11:00  团队晨会
14:00-15:30  产品评审
16:00-17:00  客户电话会议
```

### 场景 3: 快速创建日程

**用户对话：**
```
用户: 快速创建一个30分钟的站会
```

**AI 自动调用工具：**

```typescript
{
  tool: 'feishu_calendar_quick_event',
  params: {
    calendarId: 'ou_xxx',
    summary: '站会',
    duration: 30,  // 30分钟
    offsetMinutes: 0  // 立即开始
  }
}
```

### 场景 4: 更新日程

**用户对话：**
```
用户: 把明天的产品方案会议改到下午4点
```

**AI 执行流程：**

1. 先查询日程：`feishu_calendar_event_search`
2. 找到匹配的日程 ID
3. 更新日程：`feishu_calendar_event_update`

```typescript
{
  tool: 'feishu_calendar_event_update',
  params: {
    calendarId: 'ou_xxx',
    eventId: 'evt_xxx',
    startTime: '2026-03-16T16:00:00',
    endTime: '2026-03-16T17:00:00'
  }
}
```

### 场景 5: 删除日程

**用户对话：**
```
用户: 取消明天的产品方案会议
```

**AI 自动调用工具：**

```typescript
{
  tool: 'feishu_calendar_event_delete',
  params: {
    calendarId: 'ou_xxx',
    eventId: 'evt_xxx'
  }
}
```

## 🔐 授权流程详解

### 首次使用

当用户首次请求创建日程时：

1. **Beeclaw 检测到需要授权**
   ```typescript
   requiresUserAuth('feishu_calendar_event_create') // true
   ```

2. **尝试静默授权**（如果用户之前授权过）
   ```typescript
   silentAuth(openId) // 尝试自动授权
   ```

3. **静默授权失败 → 弹出授权卡片**

   用户会在飞书中看到一张授权卡片：

   ```
   ┌────────────────────────────────┐
   │  📅 日历访问授权               │
   │                                │
   │  Beeclaw 需要访问你的日历      │
   │  以便为你创建和管理日程        │
   │                                │
   │  [点击授权]                    │
   └────────────────────────────────┘
   ```

4. **用户点击授权**
   - 跳转到飞书授权页面
   - 用户确认授权
   - 返回 beeclaw

5. **保存授权令牌**
   ```typescript
   // 保存 user_access_token
   saveUserToken(openId, {
     accessToken: 'u-xxx',
     refreshToken: 'r-xxx',
     scope: 'calendar:calendar',
     expiresAt: Date.now() + 7200000
   });
   ```

6. **创建日程**
   ```typescript
   // 使用 user_access_token 创建日程
   await client.calendar.calendarEvent.create({
     headers: {
       Authorization: `Bearer ${userAccessToken}`
     },
     // ...
   });
   ```

### 后续使用

用户授权后，后续操作**自动使用缓存的 token**：

```typescript
// 1. 从缓存获取 token
const token = await getOrRefreshUserToken(openId);

// 2. 自动执行（无需再次授权）
await createEvent(client, calendarId, event);
```

## 📊 可用工具列表

| 工具名称 | 功能 | 权限 |
|---------|------|------|
| `feishu_calendar_list` | 获取用户所有日历 | 只读 |
| `feishu_calendar_get` | 获取日历详情 | 只读 |
| `feishu_calendar_event_create` | **创建日程** | 读写 |
| `feishu_calendar_event_list` | 查询日程列表 | 只读 |
| `feishu_calendar_event_get` | 获取日程详情 | 只读 |
| `feishu_calendar_event_update` | **更新日程** | 读写 |
| `feishu_calendar_event_delete` | **删除日程** | 读写 |
| `feishu_calendar_event_search` | 搜索日程 | 只读 |
| `feishu_calendar_today` | 获取今日日程 | 只读 |
| `feishu_calendar_quick_event` | **快速创建日程** | 读写 |

## 🛠️ 技术实现细节

### 1. 日历 ID 的确定

```typescript
// 方法 1: 使用用户主日历（推荐）
const calendarId = openId; // ✅ 简单直接

// 方法 2: 查询用户所有日历
const calendars = await getCalendarList(client);
const primaryCalendar = calendars.find(c => c.role === 'owner');
const calendarId = primaryCalendar.calendar_id;
```

### 2. 时间格式

```typescript
// ISO 8601 格式（带时分秒）
startTime: '2026-03-16T15:00:00'
endTime: '2026-03-16T16:00:00'

// 或者纯日期（全天事件）
startTime: '2026-03-16'
endTime: '2026-03-16'
```

### 3. 添加参会者

```typescript
{
  tool: 'feishu_calendar_event_create',
  params: {
    calendarId: 'ou_xxx',
    summary: '团队会议',
    startTime: '2026-03-16T15:00:00',
    endTime: '2026-03-16T16:00:00',
    attendees: [
      { type: 'user', id: 'ou_attendee1' },
      { type: 'user', id: 'ou_attendee2' }
    ]
  }
}
```

### 4. 设置提醒

```typescript
{
  tool: 'feishu_calendar_event_create',
  params: {
    // ...
    reminders: [
      { minutes: 15 },  // 提前15分钟提醒
      { minutes: 60 }   // 提前1小时提醒
    ]
  }
}
```

## 🎯 最佳实践

### 1. 智能时间解析

让 AI 自动解析自然语言时间：

```
用户: "下周一上午10点开会"
AI 自动解析: startTime = '2026-03-17T10:00:00'
```

### 2. 默认时长

如果用户没有指定结束时间，默认 1 小时：

```typescript
const startTime = '2026-03-16T15:00:00';
const endTime = '2026-03-16T16:00:00'; // 默认1小时后
```

### 3. 错误处理

```typescript
try {
  const event = await createEvent(client, calendarId, eventData);
  return { success: true, data: event };
} catch (error) {
  if (error.code === 99991663) {
    return {
      success: false,
      error: '授权已过期，请重新授权',
      requiresAuth: true
    };
  }
  throw error;
}
```

### 4. 日程冲突检测

创建前先查询是否有冲突：

```typescript
// 1. 查询时间段内的日程
const existingEvents = await listEvents(client, calendarId, {
  startTime: newStartTime,
  endTime: newEndTime
});

// 2. 检查冲突
if (existingEvents.length > 0) {
  return {
    success: false,
    error: '该时间段已有日程安排',
    conflicts: existingEvents
  };
}

// 3. 创建日程
await createEvent(client, calendarId, newEvent);
```

## 📝 完整示例

### 示例 1: 智能日程助手

```typescript
// 用户: "帮我安排明天下午2点到4点的产品评审会议，
//       参会人员是小王和小李，地点在3号会议室"

// AI 自动执行:
// 1. 解析时间、参会者
// 2. 获取用户信息
// 3. 查找参会者 ID
// 4. 创建日程

const result = await createEvent(client, openId, {
  summary: '产品评审会议',
  description: '产品评审会议',
  startTime: '2026-03-16T14:00:00',
  endTime: '2026-03-16T16:00:00',
  location: '3号会议室',
  attendees: [
    { type: 'user', id: 'ou_xiaowang' },
    { type: 'user', id: 'ou_xiaoli' }
  ],
  reminders: [
    { minutes: 15 },
    { minutes: 60 }
  ]
});
```

### 示例 2: 日程查询助手

```typescript
// 用户: "这周我有哪些会议？"

const now = new Date();
const weekStart = startOfWeek(now);
const weekEnd = endOfWeek(now);

const events = await listEvents(client, openId, {
  startTime: weekStart.toISOString(),
  endTime: weekEnd.toISOString()
});

// 返回格式化的日程列表
return formatWeeklyEvents(events);
```

## 🔧 配置要求

### 1. 飞书开放平台配置

在飞书开放平台启用以下权限：

```
✅ calendar:calendar:readonly  - 获取日历、日程（只读）
✅ calendar:calendar           - 创建、更新、删除日程（读写）
```

### 2. Beeclaw 配置

在 `beeclaw.json` 中配置：

```json
{
  "feishu": {
    "enabled": true,
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "redirectUri": "https://your-domain.com/api/feishu/oauth/callback"
  }
}
```

### 3. OAuth 回调接口

确保已配置 OAuth 回调接口（`src/app/routes/feishu-oauth.ts`）：

```typescript
// GET /api/feishu/oauth/callback
// 处理授权回调，保存 user_access_token
```

## 🚨 注意事项

### 1. 日历 ID 必须正确

```typescript
// ❌ 错误：使用错误的 calendar_id
calendarId: 'primary'  // ❌ 飞书不支持这个

// ✅ 正确：使用用户的 open_id
calendarId: 'ou_xxx'  // ✅ 正确
```

### 2. 授权作用域

```typescript
// ❌ 错误：只读权限无法创建日程
scope: 'calendar:calendar:readonly'  // ❌ 无法写操作

// ✅ 正确：读写权限
scope: 'calendar:calendar'  // ✅ 可以创建、更新、删除
```

### 3. Token 过期处理

```typescript
// user_access_token 有效期 2 小时
// 系统会自动刷新，但如果刷新失败需要重新授权

if (isTokenExpired(userToken)) {
  const refreshed = await refreshToken(userToken.refreshToken);
  if (!refreshed) {
    // 需要重新授权
    return { requiresAuth: true };
  }
}
```

### 4. 并发限制

```typescript
// 飞书 API 有频率限制
// 建议使用 circuit breaker 保护

const cbRegistry = getCircuitBreakerRegistry();
cbRegistry.registerToolConfig('feishu_calendar_event_create', {
  failureThreshold: 5,
  cooldownMs: 60000
});
```

## 📚 相关文档

- [飞书日历 API 文档](https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/create)
- [用户授权流程](https://open.feishu.cn/document/common-capabilities/sso/api/get-user-info)
- [Beeclaw 授权实现](./src/adapter/feishu/smart-auth.ts)

## 🎉 总结

通过 Beeclaw 给用户创建和维护日程的核心要点：

1. ✅ **获取用户 open_id** → 使用 `feishu_get_current_user` 工具
2. ✅ **用户授权** → 首次使用自动弹出授权卡片
3. ✅ **使用 open_id 作为 calendar_id** → 在用户主日历中操作
4. ✅ **调用日历工具** → 创建、查询、更新、删除日程
5. ✅ **自动 token 管理** → 无需手动处理授权令牌

所有流程已经自动化，用户只需在首次使用时点击授权，之后就可以自然语言创建和管理日程！
