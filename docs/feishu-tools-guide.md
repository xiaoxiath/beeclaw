# Feishu 工具使用指南

**版本**: 1.0.0
**更新日期**: 2026-03-13

---

## 📚 概述

Beeclaw 提供了一套完整的 Feishu (飞书) API 工具集，支持文件管理、知识库、日历、多维表格和文档操作。

---

## 🚀 快速开始

### 1. 配置 Feishu

在 `beeclaw.json` 中配置：

```json
{
  "feishu": {
    "enabled": true,
    "appId": "${LARK_BEECLAW_APPID}",
    "appSecret": "${LARK_BEECLAW_AS}",
    "useCardV2": true
  }
}
```

### 2. 环境变量

```bash
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="your-app-secret"
```

---

## 📂 Drive 工具（云文档管理）

### 1. 列出文件夹内容

**工具**: `feishu_drive_list`

**描述**: 列出指定文件夹中的所有文件和子文件夹

**参数**:
- `folderToken` (string, 必需): 文件夹 token，使用 `"root"` 表示根目录
- `pageSize` (number, 可选): 每页数量，默认 50
- `orderBy` (string, 可选): 排序字段，可选 `name`, `created_time`, `modified_time`

**示例**:
```json
{
  "folderToken": "root",
  "pageSize": 20,
  "orderBy": "modified_time"
}
```

**返回**:
```json
{
  "success": true,
  "data": {
    "files": [
      {
        "token": "fldcnxxxxxx",
        "name": "项目文档",
        "type": "folder",
        "parent_token": "0",
        "create_time": "2024-01-01T00:00:00Z",
        "modify_time": "2024-01-15T10:30:00Z"
      }
    ],
    "hasMore": false
  }
}
```

**最佳实践**:
- ✅ 使用 `"root"` 而不是手动获取根目录 token
- ✅ 大量文件时使用分页（`pageSize: 50`）
- ✅ 按修改时间排序以获取最新文件

---

### 2. 搜索文件

**工具**: `feishu_drive_search`

**描述**: 根据关键词搜索文件

**参数**:
- `query` (string, 必需): 搜索关键词
- `pageSize` (number, 可选): 每页数量，默认 50

**示例**:
```json
{
  "query": "季度报告",
  "pageSize": 10
}
```

**最佳实践**:
- ✅ 使用具体的关键词提高搜索准确性
- ✅ 支持文件名和内容搜索
- ✅ 可以使用文件扩展名过滤（如 "报告 pdf"）

---

### 3. 创建文件夹

**工具**: `feishu_drive_create_folder`

**描述**: 在指定位置创建新文件夹

**参数**:
- `parentToken` (string, 必需): 父文件夹 token，使用 `"root"` 表示根目录
- `name` (string, 必需): 文件夹名称

**示例**:
```json
{
  "parentToken": "root",
  "name": "2024年项目"
}
```

**最佳实践**:
- ✅ 先检查文件夹是否已存在
- ✅ 使用清晰的命名规范
- ✅ 按日期或项目组织文件夹结构

---

### 4. 上传文件

**工具**: `feishu_drive_upload`

**描述**: 上传本地文件到云盘

**参数**:
- `parentToken` (string, 必需): 目标文件夹 token
- `fileName` (string, 必需): 文件名（包含扩展名）
- `filePath` (string, 必需): 本地文件路径

**示例**:
```json
{
  "parentToken": "fldcnxxxxxx",
  "fileName": "report.pdf",
  "filePath": "/local/path/to/report.pdf"
}
```

**最佳实践**:
- ✅ 大文件建议使用流式上传（当前支持最大 20MB）
- ✅ 检查文件格式是否符合要求
- ✅ 上传后验证文件完整性

---

### 5. 下载文件

**工具**: `feishu_drive_download`

**描述**: 下载云盘文件

**参数**:
- `token` (string, 必需): 文件 token

**示例**:
```json
{
  "token": "filecnxxxxxx"
}
```

**返回**:
```json
{
  "success": true,
  "data": {
    "size": 102400,
    "content": "base64-encoded-content"
  }
}
```

**最佳实践**:
- ✅ 大文件下载可能需要时间，注意超时设置
- ✅ 返回 Base64 编码，需要解码后保存
- ✅ 验证文件大小和哈希值

---

### 6. 创建分享链接

**工具**: `feishu_drive_share`

**描述**: 创建文件分享链接

**参数**:
- `token` (string, 必需): 文件 token
- `password` (string, 可选): 分享密码

**示例**:
```json
{
  "token": "filecnxxxxxx",
  "password": "abc123"
}
```

**返回**:
```json
{
  "success": true,
  "data": {
    "link": "https://.feishu.cn/drive/folder/fldcnxxxxxx",
    "shortLink": "https://.feishu.cn/s/abc123"
  }
}
```

**最佳实践**:
- ✅ 敏感文件设置密码保护
- ✅ 定期检查和清理分享链接
- ✅ 设置合适的有效期（如有）

---

### 7. 移动/复制/重命名/删除

#### 移动文件
**工具**: `feishu_drive_move`
```json
{
  "token": "filecnxxxxxx",
  "toFolderToken": "fldcnyyyyyy"
}
```

#### 复制文件
**工具**: `feishu_drive_copy`
```json
{
  "token": "filecnxxxxxx",
  "toFolderToken": "fldcnyyyyyy",
  "newName": "副本.pdf"
}
```

#### 重命名
**工具**: `feishu_drive_rename`
```json
{
  "token": "filecnxxxxxx",
  "newName": "新文件名.pdf"
}
```

#### 删除
**工具**: `feishu_drive_delete`
```json
{
  "token": "filecnxxxxxx",
  "type2": "file"
}
```

**最佳实践**:
- ✅ 删除前确认文件不再需要
- ✅ 重要文件先备份再操作
- ✅ 批量操作时注意限流

---

## 📝 Wiki 工具（知识库）

### 工具列表

1. **feishu_wiki_list** - 列出知识库空间
2. **feishu_wiki_get** - 获取节点信息
3. **feishu_wiki_create** - 创建文档
4. **feishu_wiki_search** - 搜索知识库

### 示例：创建知识库文档

```json
{
  "spaceId": "728923918",
  "parentNodeId": "nodecnxxxxxx",
  "title": "项目规范",
  "content": "# 项目规范\n\n## 编码规范\n..."
}
```

**最佳实践**:
- ✅ 使用 Markdown 格式编写文档
- ✅ 合理组织文档结构
- ✅ 定期更新过时内容

---

## 📅 Calendar 工具（日历）

### 工具列表

1. **feishu_calendar_list** - 列出日历
2. **feishu_calendar_get** - 获取日历事件
3. **feishu_calendar_create** - 创建事件
4. **feishu_calendar_search** - 搜索事件

### 示例：创建日历事件

```json
{
  "calendarId": "calcnxxxxxx",
  "summary": "项目评审会议",
  "startTime": "2024-01-20T14:00:00+08:00",
  "endTime": "2024-01-20T16:00:00+08:00",
  "attendees": ["ou_xxxxxx", "ou_yyyyyy"]
}
```

**最佳实践**:
- ✅ 使用 ISO 8601 时间格式
- ✅ 提前创建重要事件
- ✅ 添加事件描述和提醒

---

## 📊 Bitable 工具（多维表格）

### 工具列表

1. **feishu_bitable_list** - 列出多维表格
2. **feishu_bitable_get** - 获取表格信息
3. **feishu_bitable_create_record** - 创建记录
4. **feishu_bitable_update_record** - 更新记录
5. **feishu_bitable_search** - 搜索记录

### 示例：创建记录

```json
{
  "appToken": "appcnxxxxxx",
  "tableId": "tblxxxxxx",
  "fields": {
    "标题": "新任务",
    "状态": "进行中",
    "负责人": "ou_xxxxxx",
    "截止日期": 1705660800000
  }
}
```

**最佳实践**:
- ✅ 使用字段 ID 而不是名称提高性能
- ✅ 批量操作使用批量 API
- ✅ 注意字段类型匹配

---

## 📄 Docx 工具（文档）

### 工具列表

1. **feishu_docx_create** - 创建文档
2. **feishu_docx_get** - 获取文档内容
3. **feishu_docx_update** - 更新文档

### 示例：创建文档

```json
{
  "title": "会议纪要",
  "content": "# 会议纪要\n\n## 参会人员\n- 张三\n- 李四\n\n## 议题\n1. 项目进度\n2. 下一步计划"
}
```

**最佳实践**:
- ✅ 使用标准 Markdown 格式
- ✅ 添加目录和章节标题
- ✅ 定期保存和备份

---

## 🔧 高级用法

### 1. 批量操作

```javascript
// 批量上传文件
const files = ['file1.pdf', 'file2.pdf', 'file3.pdf'];

for (const file of files) {
  await executeDriveTool(client, 'feishu_drive_upload', {
    parentToken: 'root',
    fileName: file,
    filePath: `/path/to/${file}`
  });

  // 添加延迟避免限流
  await new Promise(resolve => setTimeout(resolve, 1000));
}
```

### 2. 错误处理

```javascript
const result = await executeDriveTool(client, 'feishu_drive_list', {
  folderToken: 'root'
});

if (!result.success) {
  console.error('操作失败:', result.error);
  // 根据错误类型处理
  if (result.error.includes('permission')) {
    // 权限问题
  } else if (result.error.includes('not found')) {
    // 资源不存在
  }
}
```

### 3. 分页处理

```javascript
let hasMore = true;
let pageToken;
let allFiles = [];

while (hasMore) {
  const result = await executeDriveTool(client, 'feishu_drive_list', {
    folderToken: 'root',
    pageSize: 50,
    pageToken
  });

  if (result.success) {
    allFiles.push(...result.data.files);
    hasMore = result.data.hasMore;
    pageToken = result.data.pageToken;
  } else {
    break;
  }
}

console.log(`总共 ${allFiles.length} 个文件`);
```

---

## ⚠️ 注意事项

### 1. API 限流

Feishu API 有调用频率限制：
- 每分钟最多 100 次请求
- 每天最多 10,000 次请求

**建议**:
- ✅ 使用批量 API 减少调用次数
- ✅ 添加请求间隔（推荐 100ms）
- ✅ 实现重试机制

### 2. 权限管理

确保应用有足够的权限：
- `drive:drive:readonly` - 读取云盘
- `drive:drive` - 读写云盘
- `wiki:wiki:readonly` - 读取知识库
- `wiki:wiki` - 读写知识库
- `calendar:calendar` - 日历权限
- `bitable:bitable` - 多维表格权限

### 3. 文件大小限制

- 上传文件: 最大 20MB
- 下载文件: 无限制
- 文档内容: 最大 2MB

### 4. Token 管理

- 文件 token 是永久有效的
- 文件夹 token 不会改变
- 使用 `"root"` 而不是硬编码根目录 token

---

## 🎯 最佳实践总结

### 1. 文件管理
- ✅ 使用清晰的命名规范
- ✅ 按日期或项目组织文件夹
- ✅ 定期清理无用文件
- ✅ 重要文件设置分享权限

### 2. 性能优化
- ✅ 使用批量 API
- ✅ 实现缓存机制
- ✅ 避免重复请求
- ✅ 使用分页加载

### 3. 错误处理
- ✅ 实现重试机制
- ✅ 记录详细日志
- ✅ 优雅降级
- ✅ 通知用户错误

### 4. 安全考虑
- ✅ 敏感文件加密
- ✅ 定期检查分享链接
- ✅ 限制访问权限
- ✅ 审计操作日志

---

## 📚 参考资料

- [Feishu 开放平台文档](https://open.feishu.cn/document/)
- [Beeclaw API 文档](./api-reference.md)
- [工具开发指南](./plugin-development.md)

---

## 💡 常见问题

### Q1: 如何获取文件的 token？
**A**: 使用 `feishu_drive_list` 或 `feishu_drive_search` 工具，返回的文件对象中包含 `token` 字段。

### Q2: 文件上传失败怎么办？
**A**:
1. 检查文件大小（< 20MB）
2. 检查文件格式是否支持
3. 检查网络连接
4. 检查应用权限

### Q3: 如何处理分页？
**A**: 使用 `pageToken` 和 `hasMore` 字段实现循环加载，参考上面的分页处理示例。

### Q4: 搜索结果不准确怎么办？
**A**:
1. 使用更具体的关键词
2. 添加文件扩展名过滤
3. 使用高级搜索语法
4. 检查文件权限

---

**需要帮助？**

如果遇到问题，请：
1. 查看错误日志
2. 参考 [故障排除指南](./troubleshooting.md)
3. 提交 Issue 到 GitHub

---

**Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>**
