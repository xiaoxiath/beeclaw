# 飞书日历问题修复总结

## 问题发现

用户反馈："现在的流程是不是有问题，bot创建的是bot自己的日程，用户好像看不到呀"

## 根本原因

**错误理解**: 以为用户的 `open_id` 就是其主日历的 `calendar_id`

**实际情况**:
- `open_id` 是用户的身份标识 (格式: `ou_xxxxxx`)
- `calendar_id` 是日历的唯一标识 (格式: `feishu.cn_xxxxx@group.calendar.feishu.cn`)
- 两者完全不同！

## 修复内容

### 1. 新增主日历获取函数

**文件**: `src/adapter/feishu/tools/calendar.ts`

```typescript
async function getUserPrimaryCalendarId(
  client: Client,
  userContext?: UserContext
): Promise<{ calendarId?: string; error?: string; requiresAuth?: boolean }> {
  // 调用官方 API 获取用户主日历
  const response = await client.calendar.calendar.primary({
    params: { user_id_type: 'open_id' }
  });

  // 返回真实的 calendar_id
  const calendarId = response.data?.calendars?.[0]?.calendar?.calendar_id;
  return { calendarId };
}
```

### 2. 自动解析主日历

在工具执行时自动获取用户主日历：

```typescript
// 如果没有提供 calendarId，或者提供的看起来像 open_id
if (!providedCalendarId || providedCalendarId.startsWith('ou_')) {
  const calendarResult = await getUserPrimaryCalendarId(authorizedClient, userContext);
  params = { ...params, calendarId: calendarResult.calendarId };
}
```

### 3. 更新工具定义

- 将 `calendarId` 参数改为**可选**
- 移除错误的 "使用 open_id 作为 calendar_id" 说明
- 工具会自动使用用户主日历

### 4. 更新文档

- ✅ 创建了修复说明文档: `docs/fixes/feishu-calendar-fix.md`
- ✅ 创建了正确用法示例: `examples/feishu-calendar-correct-usage.ts`
- ⚠️ 需要更新之前的文档:
  - `docs/guides/feishu-calendar-management.md`
  - `docs/guides/feishu-calendar-flow-diagram.md`
  - `examples/feishu-calendar-complete-example.ts`

## 修复后的工作流程

```
用户: "帮我创建明天的会议"
    ↓
1. 获取用户信息 (open_id)
    ↓
2. 检查用户授权 (需要 calendar:calendar 权限)
    ↓
3. 使用 user_access_token 调用 calendar.primary API
    ↓
4. 获取真实 calendar_id: "feishu.cn_xxx@group.calendar.feishu.cn"
    ↓
5. 使用真实 calendar_id 创建日程
    ↓
✅ 用户在自己的日历中看到日程！
```

## 受影响的工具 (8个)

所有以下工具现在都自动使用用户主日历：

1. `feishu_calendar_event_create` - 创建日程
2. `feishu_calendar_event_list` - 查询日程列表
3. `feishu_calendar_event_search` - 搜索日程
4. `feishu_calendar_today` - 今日日程
5. `feishu_calendar_quick_event` - 快速创建日程
6. `feishu_calendar_event_get` - 获取日程详情
7. `feishu_calendar_event_update` - 更新日程
8. `feishu_calendar_event_delete` - 删除日程

## 验证测试

```bash
# 运行单元测试
bun test src/adapter/feishu/tools/__tests__/user-info.test.ts

# 运行示例
bun run examples/feishu-calendar-correct-usage.ts

# 启动 bot 测试
bun run bot
```

## API 参考

### 查询主日历 API

**接口**: `POST /open-apis/calendar/v4/calendars/primary`

**SDK 调用**:
```typescript
const response = await client.calendar.calendar.primary({
  params: {
    user_id_type: 'open_id'
  }
});
```

**响应示例**:
```json
{
  "code": 0,
  "data": {
    "calendars": [{
      "calendar": {
        "calendar_id": "feishu.cn_xxxxxxxxxx@group.calendar.feishu.cn",
        "summary": "主日历",
        "role": "owner",
        "permissions": "private"
      }
    }]
  }
}
```

## 关键要点

| 概念 | 旧理解 (错误) | 新理解 (正确) |
|------|-------------|-------------|
| calendar_id | `open_id` (ou_xxx) | `feishu.cn_xxx@group.calendar.feishu.cn` |
| 获取方式 | 直接使用 open_id | 调用 `calendar.primary` API |
| 是否必需 | 必需参数 | 可选参数（自动解析） |

## 下一步

1. ✅ 修复已完成
2. ✅ 测试已通过
3. ⚠️ 需要更新旧文档中的错误说明
4. ⚠️ 建议实际测试 bot 创建日程功能

## 相关链接

- [官方文档 - 查询主日历](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/calendar-v4/calendar/primary)
- [官方文档 - 创建日程](https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/create)
- [Node SDK GitHub](https://github.com/larksuite/node-sdk)
