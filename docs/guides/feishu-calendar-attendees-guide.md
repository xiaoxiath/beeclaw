# 飞书日历参会者功能完整指南

## 🎯 问题解决

之前的问题是：**创建日程时无法添加参会者**

现在已经完全修复，支持**三种方式**添加参会者：

1. ✅ **创建时直接添加**（推荐）
2. ✅ **创建后添加参会者**
3. ✅ **列出已有参会者**

## 📋 方式对比

| 方式 | 工具 | 优点 | 适用场景 |
|------|------|------|----------|
| 创建时添加 | `feishu_calendar_event_create` | 一次完成 | 创建新会议时 |
| 创建后添加 | `feishu_calendar_attendee_add` | 灵活追加 | 会议已存在，需要加人 |
| 列出参会者 | `feishu_calendar_attendee_list` | 查看当前状态 | 确认参会者列表 |

## 1️⃣ 创建日程时直接添加参会者（推荐）

### 使用方式

```
用户: "帮我创建明天下午3点的产品方案讨论会议，邀请小王和小李参加"
```

### AI 自动执行

```typescript
// AI 会调用 feishu_calendar_event_create
{
  tool: 'feishu_calendar_event_create',
  params: {
    calendarId: 'feishu.cn_xxx@group.calendar.feishu.cn',  // 自动获取
    summary: '产品方案讨论',
    startTime: '2026-03-16T15:00:00',
    endTime: '2026-03-16T16:00:00',
    attendees: [
      { type: 'user', id: 'ou_xiaowang' },  // 小王的 open_id
      { type: 'user', id: 'ou_xiaoli' }     // 小李的 open_id
    ]
  }
}
```

### 参数说明

```typescript
{
  calendarId: string,        // 日历 ID（自动获取）
  summary: string,           // 会议标题
  description?: string,      // 会议描述
  startTime: string,         // 开始时间（ISO 8601）
  endTime: string,           // 结束时间（ISO 8601）
  location?: string,         // 会议地点
  attendees?: Array<{        // 参会者列表
    type: 'user' | 'group' | 'resource',
    id: string               // open_id (如 "ou_xxx")
  }>
}
```

## 2️⃣ 创建后添加参会者

### 使用方式

```
用户: "把小张也加到明天的产品方案讨论会议里"
```

### AI 自动执行

```typescript
// AI 会调用 feishu_calendar_attendee_add
{
  tool: 'feishu_calendar_attendee_add',
  params: {
    calendarId: 'feishu.cn_xxx@group.calendar.feishu.cn',
    eventId: 'evt_xxx',       // 已有会议的 ID
    attendees: [
      { type: 'user', id: 'ou_xiaozhang' }  // 小张的 open_id
    ]
  }
}
```

### 参数说明

```typescript
{
  calendarId: string,        // 日历 ID
  eventId: string,           // 日程 ID
  attendees: Array<{         // 要添加的参会者
    type: 'user' | 'group' | 'resource',
    id: string               // open_id
  }>
}
```

### 返回结果

```json
{
  "success": true,
  "data": {
    "added": true,
    "count": 1
  }
}
```

## 3️⃣ 列出已有参会者

### 使用方式

```
用户: "明天的会议都有谁参加？"
```

### AI 自动执行

```typescript
// AI 会调用 feishu_calendar_attendee_list
{
  tool: 'feishu_calendar_attendee_list',
  params: {
    calendarId: 'feishu.cn_xxx@group.calendar.feishu.cn',
    eventId: 'evt_xxx'
  }
}
```

### 返回结果

```json
{
  "success": true,
  "data": {
    "attendees": [
      {
        "type": "user",
        "member_id": "ou_xiaowang",
        "display_name": "小王",
        "status": "accepted"
      },
      {
        "type": "user",
        "member_id": "ou_xiaoli",
        "display_name": "小李",
        "status": "needsAction"
      }
    ]
  }
}
```

## 🎨 完整示例场景

### 场景 1: 创建并邀请多人

```
用户: "帮我创建明天下午2点到4点的产品评审会议，地点在3号会议室，
      参会人员是小王、小李和小张"

Bot: ✅ 已为你创建日程！

📅 标题: 产品评审会议
🕐 时间: 2026-03-16 14:00-16:00
📍 地点: 3号会议室
👥 参会者: 小王、小李、小张
```

**AI 执行流程**:

1. 解析时间、地点、参会者
2. 获取用户主日历 ID
3. 查找小王、小李、小张的 open_id
4. 调用 `feishu_calendar_event_create` 一次性创建并邀请

### 场景 2: 追加参会者

```
用户: "把产品经理也加到明天的评审会议里"

Bot: ✅ 已添加参会者！

📅 产品评审会议
👥 新增参会者: 产品经理
👥 总参会人数: 4人
```

**AI 执行流程**:

1. 查找"明天"、"评审会议" → 获取 eventId
2. 查找"产品经理"的 open_id
3. 调用 `feishu_calendar_attendee_add`

### 场景 3: 查看参会者

```
用户: "明天的评审会议都有谁参加？"

Bot: 📅 产品评审会议参会者列表：

1. 小王 ✅ 已接受
2. 小李 ⏳ 待确认
3. 小张 ✅ 已接受
4. 产品经理 ⏳ 待确认

共 4 位参会者
```

## 📝 API 参考

### feishu_calendar_event_create

创建日程（支持参会者）

**参数**:
- `calendarId` (string, 必需) - 日历 ID
- `summary` (string, 必需) - 日程标题
- `startTime` (string, 必需) - 开始时间（ISO 8601）
- `endTime` (string, 必需) - 结束时间（ISO 8601）
- `description` (string, 可选) - 描述
- `location` (string, 可选) - 地点
- `timezone` (string, 可选) - 时区（默认 Asia/Shanghai）
- `attendees` (array, 可选) - 参会者列表

### feishu_calendar_attendee_add

添加参会者到已有日程

**参数**:
- `calendarId` (string, 必需) - 日历 ID
- `eventId` (string, 必需) - 日程 ID
- `attendees` (array, 必需) - 参会者列表

**返回**:
- `added` (boolean) - 是否成功添加
- `count` (number) - 添加的数量

### feishu_calendar_attendee_list

列出日程的参会者

**参数**:
- `calendarId` (string, 必需) - 日历 ID
- `eventId` (string, 必需) - 日程 ID

**返回**:
- `attendees` (array) - 参会者列表，包含：
  - `type` - 类型（user/group/resource）
  - `member_id` - 成员 ID
  - `display_name` - 显示名称
  - `status` - 状态（accepted/declined/needsAction）

## 🔧 技术细节

### 参会者类型

| 类型 | 说明 | ID 格式 |
|------|------|---------|
| `user` | 用户 | `ou_xxx` (open_id) |
| `group` | 群组 | `oc_xxx` (chat_id) |
| `resource` | 会议室 | 会议室 ID |

### 飞书 API 端点

1. **创建日程**: `POST /open-apis/calendar/v4/calendars/:calendar_id/events`
2. **添加参会者**: `POST /open-apis/calendar/v4/calendars/:calendar_id/events/:event_id/attendees`
3. **获取参会者**: `GET /open-apis/calendar/v4/calendars/:calendar_id/events/:event_id`

### 权限要求

- ✅ `calendar:calendar:readonly` - 查询日历和日程
- ✅ `calendar:calendar` - 创建、更新、删除日程，添加参会者

### 限制

- 每个日程最多 **3000 名参会者**
- 添加会议室后会进入**异步预约流程**
- 参会者必须与组织者在**同一企业**内

## 🚀 快速测试

### 测试步骤

```bash
# 1. Bot 已重启
pm2 restart beeclaw

# 2. 在飞书中测试
用户: "帮我创建明天的测试会议，邀请小王参加"

# 3. 预期结果
✅ 日程创建成功
✅ 小王收到邀请
✅ 日程出现在两人的日历中
```

### 验证参会者

```bash
# 查看参会者列表
用户: "明天的测试会议都有谁？"

# 预期结果
👥 参会者：
1. 你 (组织者)
2. 小王 ⏳ 待确认
```

## 📚 相关文档

- [飞书日历 API - 创建日程](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/calendar-v4/calendar-event/create)
- [飞书日历 API - 添加参会者](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/calendar-v4/calendar-event-attendee/create)
- [飞书 CLI 工具箱](https://github.com/riba2534/feishu-cli)

## 🎉 总结

### ✅ 已修复

1. **创建时支持参会者** - `feishu_calendar_event_create` 新增 `attendees` 参数
2. **新增添加参会者工具** - `feishu_calendar_attendee_add`
3. **新增列出参会者工具** - `feishu_calendar_attendee_list`

### 🎯 最佳实践

1. ✅ **创建时直接添加** - 一步到位，推荐使用
2. ✅ **追加使用专用工具** - 会议已存在时用 `attendee_add`
3. ✅ **自然语言交互** - AI 自动解析和调用

现在你可以通过自然语言轻松管理飞书日历和参会者了！🚀
