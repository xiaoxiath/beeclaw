# 飞书权限错误快速修复指南

## 🔥 错误 99991672: Access denied

### 识别错误

**日志特征**：
```
code: 99991672
msg: "Access denied. One of the following scopes is required: [wiki:wiki, ...]"
```

### 快速修复

#### 方法 1: 一键申请（推荐）⭐

**步骤**：
1. 复制日志中的权限申请链接
2. 在浏览器中打开
3. 点击"申请权限"
4. 等待 1-5 分钟生效

**示例链接**：
```
https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=wiki:wiki,wiki:wiki:readonly&op_from=openapi&token_type=tenant
```

#### 方法 2: 批量配置

**一次性配置所有权限**：
```
https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=calendar:calendar:readonly,calendar:calendar,calendar:calendar_event:readonly,calendar:calendar_event,docx:document:readonly,docx:document,bitable:app:readonly,bitable:app,bitable:app_table_record:readonly,bitable:app_table_record,drive:drive:readonly,drive:drive,drive:file:upload,drive:file:download,wiki:wiki:readonly,wiki:wiki&op_from=openapi&token_type=tenant
```

#### 方法 3: 手动配置

**步骤**：
1. 访问 [飞书开放平台](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6)
2. 进入应用 → 权限管理
3. 搜索需要的权限（见下表）
4. 开启权限
5. 等待 1-5 分钟生效

### 权限对照表

| 工具类型 | 必需权限 | 功能说明 |
|---------|---------|---------|
| **日历** | | |
| 查询日历 | `calendar:calendar:readonly` | 获取日历列表 |
| 管理日历 | `calendar:calendar` | 创建、更新日历 |
| 查询事件 | `calendar:calendar_event:readonly` | 获取事件详情 |
| 管理事件 | `calendar:calendar_event` | 创建、更新、删除事件 |
| **文档** | | |
| 查看文档 | `docx:document:readonly` | 读取文档内容 |
| 编辑文档 | `docx:document` | 创建、编辑文档 |
| **多维表格** | | |
| 查看表格 | `bitable:app:readonly` | 查询表格结构 |
| 管理表格 | `bitable:app` | 创建表格 |
| 查看记录 | `bitable:app_table_record:readonly` | 查询数据 |
| 管理记录 | `bitable:app_table_record` | 创建、更新、删除 |
| **云文档** | | |
| 查看文件 | `drive:drive:readonly` | 列出文件 |
| 管理文件 | `drive:drive` | 创建、移动、删除 |
| 上传文件 | `drive:file:upload` | 上传到云盘 |
| 下载文件 | `drive:file:download` | 从云盘下载 |
| **知识库** | | |
| 查看知识库 | `wiki:wiki:readonly` | 查询知识库 |
| 管理知识库 | `wiki:wiki` | 创建、编辑知识库 |

### 验证修复

**运行权限测试**：
```bash
bun test scripts/test-feishu-permissions.ts
```

**预期输出**：
```
✅ 日历工具... OK
✅ 文档工具... OK
✅ 多维表格工具... OK
✅ 云文档工具... OK
✅ 知识库工具... OK

🎉 All permissions configured correctly!
```

## 📝 常见问题

### Q1: 权限申请后多久生效？

**A**: 通常 1-5 分钟。如果超过 5 分钟仍未生效：
1. 检查应用是否已发布
2. 检查权限是否已审核通过
3. 重启 beeclaw bot

### Q2: 为什么有些权限申请失败？

**A**: 可能原因：
- 权限需要管理员审核
- 企业未开通相关功能
- 应用未完成开发者认证

**解决方案**：
1. 联系企业管理员
2. 完成开发者认证
3. 使用权限较低的替代方案

### Q3: 如何查看当前已配置的权限？

**A**: 两种方式：
1. 访问 [飞书开放平台](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6) → 权限管理
2. 运行 `bun scripts/check-feishu-permissions.ts`

### Q4: 权限配置正确但仍报错？

**A**: 排查步骤：
1. 确认使用 Bot 模式启动（`bun run bot`，不是 `bun run cli`）
2. 检查环境变量是否正确设置
3. 检查 app_id 和 app_secret 是否匹配
4. 重启 bot 服务
5. 查看完整错误日志

## 🔧 调试技巧

### 1. 查看详细错误信息

**启用调试日志**：
```bash
# 在 beeclaw.json 中设置
{
  "feishu": {
    "logLevel": "debug"
  }
}

# 重启 bot
bun run bot
```

### 2. 测试单个工具

**测试日历工具**：
```bash
bun test scripts/test-feishu-tools.ts
```

### 3. 检查 API 调用

**查看完整请求/响应**：
```typescript
// 在工具代码中添加日志
console.log('Request:', JSON.stringify(params, null, 2));
const response = await client.calendar.calendar.list(params);
console.log('Response:', JSON.stringify(response, null, 2));
```

## 📚 相关文档

- [飞书权限配置指南](./feishu-tools-setup.md)
- [飞书错误码文档](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-fix-the-99991672-error)
- [飞书开放平台](https://open.feishu.cn/)

## 💡 最佳实践

1. **一次性配置所有权限**：避免反复申请
2. **定期检查权限**：使用测试脚本验证
3. **记录权限配置**：在文档中记录所需权限
4. **及时更新权限**：添加新工具时同步更新权限

---

**快速链接**：
- 🔗 [批量配置权限](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=calendar:calendar:readonly,calendar:calendar,calendar:calendar_event:readonly,calendar:calendar_event,docx:document:readonly,docx:document,bitable:app:readonly,bitable:app,bitable:app_table_record:readonly,bitable:app_table_record,drive:drive:readonly,drive:drive,drive:file:upload,drive:file:download,wiki:wiki:readonly,wiki:wiki&op_from=openapi&token_type=tenant)
- 🧪 [测试权限配置](../scripts/test-feishu-permissions.ts)
- 📋 [检查权限清单](../scripts/check-feishu-permissions.ts)
