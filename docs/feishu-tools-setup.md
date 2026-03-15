# 飞书工具配置指南

## 概述

Beeclaw 已经完整实现了飞书工具集成，包括：

- **日历工具** (`feishu_calendar_*`): 获取、创建、更新、删除日历事件
- **文档工具** (`feishu_docx_*`): 读取、创建、编辑飞书文档
- **多维表格工具** (`feishu_bitable_*`): 操作飞书多维表格
- **云文档工具** (`feishu_drive_*`): 管理飞书云盘文件
- **知识库工具** (`feishu_wiki_*`): 管理飞书知识库

## 配置步骤

### 1. 获取飞书应用凭证

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 在应用详情页获取以下信息：
   - **App ID**: 应用唯一标识
   - **App Secret**: 应用密钥
   - **Encrypt Key**: 加密密钥（可选）
   - **Verification Token**: 验证令牌（可选）

### 2. 配置应用权限

在飞书开放平台，为应用开启以下权限：

#### ⚡ 快速配置（推荐）

**一键申请所有必需权限**：
```
https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=calendar:calendar:readonly,calendar:calendar,calendar:calendar_event:readonly,calendar:calendar_event,docx:document:readonly,docx:document,bitable:app:readonly,bitable:app,bitable:app_table_record:readonly,bitable:app_table_record,drive:drive:readonly,drive:drive,drive:file:upload,drive:file:download,wiki:wiki:readonly,wiki:wiki&op_from=openapi&token_type=tenant
```

> 💡 点击链接后会跳转到权限申请页面，一键批量申请所有必需权限。

#### 📋 手动配置

如果需要单独配置，请按以下分类开启权限：

#### 日历权限
- `calendar:calendar:readonly` - 获取日历
- `calendar:calendar` - 管理日历
- `calendar:calendar_event:readonly` - 获取日历事件
- `calendar:calendar_event` - 管理日历事件

#### 文档权限
- `docx:document:readonly` - 查看文档
- `docx:document` - 编辑文档
- `docs:doc:readonly` - 查看旧版文档（可选）
- `docs:doc` - 编辑旧版文档（可选）

#### 多维表格权限
- `bitable:app:readonly` - 查看多维表格
- `bitable:app` - 管理多维表格
- `bitable:app_table:readonly` - 查看数据表
- `bitable:app_table` - 管理数据表
- `bitable:app_table_record:readonly` - 查看记录
- `bitable:app_table_record` - 管理记录

#### 云文档权限
- `drive:drive:readonly` - 查看云空间文件
- `drive:drive` - 管理云空间文件
- `drive:file:upload` - 上传文件
- `drive:file:download` - 下载文件

#### 知识库权限
- `wiki:wiki:readonly` - 查看知识库
- `wiki:wiki` - 管理知识库
- `wiki:space:retrieve` - 获取知识空间（可选）

#### 🔍 检查权限配置

运行权限检查脚本，查看完整的权限清单：
```bash
bun scripts/check-feishu-permissions.ts
```

### 3. 配置 beeclaw.json

在 `beeclaw.json` 中添加飞书配置：

```json
{
  "feishu": {
    "enabled": true,
    "appId": "${LARK_BEECLAW_APPID}",
    "appSecret": "${LARK_BEECLAW_AS}",
    "encryptKey": "${LARK_BEECLAW_ENCRYPT_KEY}",
    "verificationToken": "${LARK_BEECLAW_VERIFICATION_TOKEN}",
    "logLevel": "error",
    "useCardV2": true
  }
}
```

### 4. 设置环境变量

创建 `.env` 文件或设置环境变量：

```bash
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="xxxxxxxxxxxxxxxxxxxx"
export LARK_BEECLAW_ENCRYPT_KEY="xxxxxxxx"  # 可选
export LARK_BEECLAW_VERIFICATION_TOKEN="xxxxxxxx"  # 可选
```

### 5. 启动 Bot 模式

```bash
# 启动飞书 Bot（WebSocket 长连接模式）
bun run bot

# 或使用 PM2 生产模式
bun run pm2:start
```

## 可用工具列表

### 日历工具

| 工具名称 | 功能 | 必需参数 |
|---------|------|---------|
| `feishu_calendar_list` | 列出所有日历 | - |
| `feishu_calendar_get` | 获取日历详情 | `calendarId` |
| `feishu_calendar_event_create` | 创建事件 | `calendarId`, `summary`, `startTime`, `endTime` |
| `feishu_calendar_event_list` | 列出事件 | `calendarId`, `startTime`, `endTime` |
| `feishu_calendar_event_get` | 获取事件详情 | `calendarId`, `eventId` |
| `feishu_calendar_event_update` | 更新事件 | `calendarId`, `eventId` |
| `feishu_calendar_event_delete` | 删除事件 | `calendarId`, `eventId` |
| `feishu_calendar_event_search` | 搜索事件 | `calendarId`, `query` |
| `feishu_calendar_today` | 获取今日事件 | `calendarId` |
| `feishu_calendar_quick_event` | 快速创建事件 | `calendarId`, `summary` |

### 文档工具

| 工具名称 | 功能 | 必需参数 |
|---------|------|---------|
| `feishu_docx_get` | 获取文档块 | `documentId`, `blockId` |
| `feishu_docx_list_children` | 列出子块 | `documentId`, `blockId` |
| `feishu_docx_search` | 搜索文档 | `documentId`, `query` |
| `feishu_docx_create_text` | 创建文本块 | `documentId`, `parentId`, `text` |
| `feishu_docx_append` | 追加块 | `documentId`, `parentId`, `blocks` |
| `feishu_docx_update` | 更新块 | `documentId`, `blockId`, `text` |
| `feishu_docx_delete` | 删除块 | `documentId`, `blockId` |
| `feishu_docx_create_table` | 创建表格 | `documentId`, `parentId`, `rows`, `columns` |

### 多维表格工具

| 工具名称 | 功能 | 必需参数 |
|---------|------|---------|
| `feishu_bitable_get_meta` | 获取多维表格信息 | `url` |
| `feishu_bitable_list_tables` | 列出数据表 | `appToken` |
| `feishu_bitable_list_fields` | 列出字段 | `appToken`, `tableId` |
| `feishu_bitable_create_field` | 创建字段 | `appToken`, `tableId`, `fieldName`, `type` |
| `feishu_bitable_list_records` | 列出记录 | `appToken`, `tableId` |
| `feishu_bitable_get_record` | 获取记录 | `appToken`, `tableId`, `recordId` |
| `feishu_bitable_create_record` | 创建记录 | `appToken`, `tableId`, `fields` |
| `feishu_bitable_update_record` | 更新记录 | `appToken`, `tableId`, `recordId`, `fields` |
| `feishu_bitable_delete_record` | 删除记录 | `appToken`, `tableId`, `recordId` |
| `feishu_bitable_create_app` | 创建多维表格 | `name` |

### 云文档工具

| 工具名称 | 功能 | 必需参数 |
|---------|------|---------|
| `feishu_drive_list` | 列出文件 | - |
| `feishu_drive_get` | 获取文件信息 | `token` |
| `feishu_drive_create_folder` | 创建文件夹 | `name` |
| `feishu_drive_upload` | 上传文件 | `fileName`, `fileData` |
| `feishu_drive_download` | 下载文件 | `token` |
| `feishu_drive_move` | 移动文件 | `token`, `folderToken` |
| `feishu_drive_copy` | 复制文件 | `token`, `name` |
| `feishu_drive_delete` | 删除文件 | `token` |
| `feishu_drive_rename` | 重命名文件 | `token`, `name` |
| `feishu_drive_search` | 搜索文件 | `query` |

### 知识库工具

| 工具名称 | 功能 | 必需参数 |
|---------|------|---------|
| `feishu_wiki_list_spaces` | 列出知识库 | - |
| `feishu_wiki_get_space` | 获取知识库信息 | `spaceId` |
| `feishu_wiki_list_nodes` | 列出节点 | `spaceId` |
| `feishu_wiki_get_node` | 获取节点信息 | `token` |
| `feishu_wiki_create_page` | 创建页面 | `spaceId`, `title`, `parentId` |
| `feishu_wiki_move_node` | 移动节点 | `token`, `parentToken` |
| `feishu_wiki_rename_node` | 重命名节点 | `token`, `title` |
| `feishu_wiki_delete_node` | 删除节点 | `token` |
| `feishu_wiki_copy_node` | 复制节点 | `token`, `targetSpaceId` |
| `feishu_wiki_search` | 搜索页面 | `query` |

## 使用示例

### 示例 1: 创建日历事件

```
用户: 明天下午2点帮我创建一个产品评审会议，持续1小时

Beeclaw 会自动:
1. 使用 feishu_calendar_list 获取默认日历
2. 使用 feishu_calendar_event_create 创建事件
   - summary: "产品评审会议"
   - startTime: "2026-03-16T14:00:00"
   - endTime: "2026-03-16T15:00:00"
```

### 示例 2: 写入多维表格

```
用户: 帮我在项目管理表中添加一条记录：任务名称是"完成设计稿"，负责人是我，优先级是高

Beeclaw 会自动:
1. 使用 feishu_bitable_get_meta 解析表格 URL
2. 使用 feishu_bitable_list_fields 查看字段结构
3. 使用 feishu_bitable_create_record 创建记录
   - fields: {"任务名称": "完成设计稿", "负责人": "@我", "优先级": "高"}
```

### 示例 3: 编辑飞书文档

```
用户: 在产品文档末尾添加一节"性能优化"，内容是...

Beeclaw 会自动:
1. 使用 feishu_docx_search 搜索文档
2. 使用 feishu_docx_list_children 查看结构
3. 使用 feishu_docx_create_text 创建标题和段落
```

## 故障排查

### 问题 1: 提示 "Access denied" 或错误码 99991672

**错误示例**：
```
code: 99991672
msg: "Access denied. One of the following scopes is required: [wiki:wiki, wiki:wiki:readonly]"
```

**原因**: 应用权限不足

**解决方案**:
1. **快速配置**：点击日志中的链接直接申请权限
   ```
   https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=wiki:wiki,wiki:wiki:readonly&op_from=openapi&token_type=tenant
   ```

2. **手动配置**：
   - 访问飞书开放平台
   - 进入应用 → 权限管理
   - 搜索并开启相应权限（如 `wiki:wiki`）
   - 等待 1-5 分钟权限生效

3. **验证权限**：
   ```bash
   bun test scripts/test-feishu-tools.ts
   ```

**常见权限错误对照表**：

| 错误信息 | 缺少的权限 | 用途 |
|---------|----------|------|
| `Access denied... [calendar:calendar]` | `calendar:calendar` | 日历管理 |
| `Access denied... [docx:document]` | `docx:document` | 文档编辑 |
| `Access denied... [bitable:app]` | `bitable:app` | 多维表格管理 |
| `Access denied... [drive:drive]` | `drive:drive` | 云文档管理 |
| `Access denied... [wiki:wiki]` | `wiki:wiki` | 知识库管理 |

### 问题 2: 提示 "Feishu client not initialized"

**原因**: 飞书客户端未初始化

**解决方案**:
1. 确认 `beeclaw.json` 中 `feishu.enabled` 为 `true`
2. 确认设置了 `LARK_BEECLAW_APPID` 和 `LARK_BEECLAW_AS` 环境变量
3. 使用 `bun run bot` 启动（不是 `bun run cli`）

### 问题 2: 提示 "Permission denied"

**原因**: 应用权限不足

**解决方案**:
1. 访问飞书开放平台
2. 为应用开启相应权限
3. 等待权限生效（可能需要几分钟）

### 问题 3: 工具调用失败

**原因**: 参数错误或 API 限制

**解决方案**:
1. 检查工具参数是否正确
2. 查看日志中的详细错误信息
3. 确认资源 ID（如 calendarId、documentId）是否正确

## 架构说明

### 工具执行流程

```
用户消息
  ↓
Agent.chat()
  ↓
AI 选择工具 (feishu_calendar_*)
  ↓
createDefaultToolExecutor()
  ↓
getFeishuWSClient() → 获取 API Client
  ↓
executeCalendarTool(client, name, params)
  ↓
飞书 API 调用
  ↓
返回结果给用户
```

### 关键文件

- `src/adapter/feishu/tools/calendar.ts` - 日历工具实现
- `src/adapter/feishu/tools/docx.ts` - 文档工具实现
- `src/adapter/feishu/tools/bitable.ts` - 多维表格工具实现
- `src/adapter/feishu/tools/drive.ts` - 云文档工具实现
- `src/adapter/feishu/tools/wiki.ts` - 知识库工具实现
- `src/domain/agent/index.ts` - 工具执行逻辑
- `src/app/routes/proactive.ts` - 飞书 WebSocket 初始化

## 相关文档

- [飞书开放平台文档](https://open.feishu.cn/document/)
- [飞书 Card V2 指南](./features/feishu-card-v2.md)
- [Beeclaw 飞书集成指南](./guide/feishu-integration.md)
