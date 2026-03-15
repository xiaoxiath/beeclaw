# 修复飞书日历创建日程的正确方式

## 问题描述

之前的实现错误地使用用户的 `open_id` 作为 `calendar_id` 来创建日程。这导致：
- Bot 创建的日程在 Bot 自己的日历中，用户看不到
- 日程没有创建在用户的个人日历中

## 错误的实现方式 ❌

```typescript
// 错误：使用用户的 open_id 作为 calendar_id
const calendarId = 'ou_84aad35d084aa403a838cf73ee18467';
await createEvent(client, calendarId, eventData);
```

## 正确的实现方式 ✅

### 方案 1: 自动获取用户主日历（推荐）

```typescript
// 1. 调用 primary API 获取用户主日历
const response = await client.calendar.calendar.primary({
  params: {
    user_id_type: 'open_id',
  },
});

// 2. 从响应中获取真实的 calendar_id
const calendarId = response.data?.calendars?.[0]?.calendar?.calendar_id;
// calendar_id 格式: "feishu.cn_xxxxxxxxxx@group.calendar.feishu.cn"

// 3. 使用真实的 calendar_id 创建日程
await client.calendar.calendarEvent.create({
  path: {
    calendar_id: calendarId,  // ✅ 正确的 calendar_id
  },
  data: eventData,
});
```

### 方案 2: 使用字面量 "primary"

```typescript
// 某些 API 支持直接使用 "primary" 作为 calendar_id
await client.calendar.calendarEvent.create({
  path: {
    calendar_id: 'primary',  // ✅ 使用 "primary" 字面量
  },
  data: eventData,
});
```

## 实现细节

### 1. 新增 `getUserPrimaryCalendarId` 函数

位置: `src/adapter/feishu/tools/calendar.ts`

```typescript
async function getUserPrimaryCalendarId(
  client: Client,
  userContext?: UserContext
): Promise<{ calendarId?: string; error?: string; requiresAuth?: boolean }> {
  const response = await client.calendar.calendar.primary({
    params: {
      user_id_type: 'open_id',
    },
  });

  if (response.code !== 0) {
    // 处理错误...
    return { error: '获取主日历失败', requiresAuth: true };
  }

  const calendarId = response.data?.calendars?.[0]?.calendar?.calendar_id;
  return { calendarId };
}
```

### 2. 自动解析主日历

在 `executeCalendarTool` 函数中，自动检测并解析主日历：

```typescript
// 如果没有提供 calendarId，或者提供的 calendarId 看起来像 open_id（以 "ou_" 开头）
// 则自动获取用户主日历
if (!providedCalendarId || providedCalendarId.startsWith('ou_')) {
  const calendarResult = await getUserPrimaryCalendarId(authorizedClient, userContext);

  if (calendarResult.error) {
    return { success: false, error: calendarResult.error };
  }

  // 使用解析出的主日历 ID
  params = { ...params, calendarId: calendarResult.calendarId };
}
```

### 3. 更新工具定义

- 移除了错误的使用 `open_id` 作为 `calendar_id` 的说明
- 将 `calendarId` 参数改为可选（optional）
- 工具会自动解析用户主日历

## 关键概念对比

| 概念 | 说明 | 格式示例 |
|------|------|---------|
| `open_id` | 用户身份标识 | `ou_84aad35d084aa403a838cf73ee18467` |
| `user_id` | 用户在租户内的 ID | `e33ggbyz` |
| `calendar_id` | 日历的唯一标识 | `feishu.cn_xxxxx@group.calendar.feishu.cn` |
| `primary` | 主日历的字面量标识 | `"primary"` |

## 授权流程

1. **首次使用**: 用户需要授权（自动弹出授权卡片）
2. **获取主日历**: 使用 `user_access_token` 调用 `calendar.primary` API
3. **创建日程**: 使用获取到的 `calendar_id` 创建日程

```
用户请求: "帮我创建明天的会议"
    ↓
获取 user_access_token (授权)
    ↓
调用 calendar.primary 获取主日历
    ↓
获取真实 calendar_id: "feishu.cn_xxx@group.calendar.feishu.cn"
    ↓
使用真实 calendar_id 创建日程
    ↓
用户在自己的日历中看到日程 ✅
```

## 测试验证

```bash
# 运行测试
bun test src/adapter/feishu/tools/__tests__/
```

## 相关文档

- [飞书日历 API - 查询主日历](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/calendar-v4/calendar/primary)
- [飞书日历 API - 创建日程](https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/create)
- [飞书开放平台 - Node SDK](https://github.com/larksuite/node-sdk)

## 总结

✅ **正确做法**:
1. 使用 `user_access_token` 授权
2. 调用 `calendar.primary` API 获取真实 `calendar_id`
3. 使用真实 `calendar_id` 创建日程

❌ **错误做法**:
1. ~~使用 `open_id` 作为 `calendar_id`~~
2. ~~直接硬编码 calendar_id~~
3. ~~使用 tenant_access_token 创建用户日程~~

## 影响的工具

所有涉及 `calendarId` 参数的工具都已更新：
- `feishu_calendar_event_create` - 创建日程
- `feishu_calendar_event_list` - 查询日程列表
- `feishu_calendar_event_search` - 搜索日程
- `feishu_calendar_today` - 今日日程
- `feishu_calendar_quick_event` - 快速创建日程
- `feishu_calendar_event_get` - 获取日程详情
- `feishu_calendar_event_update` - 更新日程
- `feishu_calendar_event_delete` - 删除日程

所有这些工具现在都会自动解析用户主日历，无需手动提供 `calendarId`。
