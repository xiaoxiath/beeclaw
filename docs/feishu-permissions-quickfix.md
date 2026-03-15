# 飞书权限错误 99991672 - 快速修复卡片

## 🚨 错误识别

```
code: 99991672
msg: "Access denied. One of the following scopes is required: [xxx:xxx, ...]"
```

## ⚡ 3 步修复

### Step 1: 点击日志中的链接

在错误日志中找到类似这样的链接：
```
https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=wiki:wiki&op_from=openapi&token_type=tenant
```

**直接点击 → 申请权限 → 等待 1-5 分钟**

### Step 2: 如果没有链接

**一键配置所有权限**：
```
https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=calendar:calendar:readonly,calendar:calendar,calendar:calendar_event:readonly,calendar:calendar_event,docx:document:readonly,docx:document,bitable:app:readonly,bitable:app,bitable:app_table_record:readonly,bitable:app_table_record,drive:drive:readonly,drive:drive,drive:file:upload,drive:file:download,wiki:wiki:readonly,wiki:wiki&op_from=openapi&token_type=tenant
```

### Step 3: 验证修复

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

## 📊 权限速查表

| 工具类型 | 必需权限 | 快速申请链接 |
|---------|---------|------------|
| 📅 日历 | `calendar:calendar:readonly`<br>`calendar:calendar`<br>`calendar:calendar_event:readonly`<br>`calendar:calendar_event` | [一键申请](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=calendar:calendar:readonly,calendar:calendar,calendar:calendar_event:readonly,calendar:calendar_event&op_from=openapi&token_type=tenant) |
| 📝 文档 | `docx:document:readonly`<br>`docx:document` | [一键申请](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=docx:document:readonly,docx:document&op_from=openapi&token_type=tenant) |
| 📊 多维表格 | `bitable:app:readonly`<br>`bitable:app`<br>`bitable:app_table_record:readonly`<br>`bitable:app_table_record` | [一键申请](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=bitable:app:readonly,bitable:app,bitable:app_table_record:readonly,bitable:app_table_record&op_from=openapi&token_type=tenant) |
| 📁 云文档 | `drive:drive:readonly`<br>`drive:drive`<br>`drive:file:upload`<br>`drive:file:download` | [一键申请](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=drive:drive:readonly,drive:drive,drive:file:upload,drive:file:download&op_from=openapi&token_type=tenant) |
| 📚 知识库 | `wiki:wiki:readonly`<br>`wiki:wiki` | [一键申请](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=wiki:wiki:readonly,wiki:wiki&op_from=openapi&token_type=tenant) |

## 🔧 手动配置（如果自动链接失败）

1. **访问** [飞书开放平台](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6)
2. **进入** 应用 → 权限管理
3. **搜索** 对应权限（如 `wiki:wiki`）
4. **开启** 权限
5. **等待** 1-5 分钟生效

## 🧪 测试工具

### 测试所有权限
```bash
bun test scripts/test-feishu-permissions.ts
```

### 测试单个工具
```bash
bun test scripts/test-feishu-tools.ts
```

### 查看权限清单
```bash
bun scripts/check-feishu-permissions.ts
```

## 🐛 常见问题

### Q: 权限申请后还是报错？

**A**: 尝试以下步骤：
1. 等待 5 分钟（权限生效需要时间）
2. 重启 beeclaw bot: `bun run bot`
3. 清理缓存: `rm -rf node_modules/.cache`
4. 重新测试

### Q: 权限申请失败？

**A**: 可能原因：
- 权限需要管理员审核 → 联系企业管理员
- 企业未开通相关功能 → 检查企业订阅
- 应用未完成开发者认证 → 完成认证流程

### Q: 只需要部分工具的权限？

**A**: 查看上方的权限速查表，只申请需要的权限即可。

## 📚 相关文档

- 📖 [飞书权限错误详细排查](./troubleshooting/feishu-permissions-error.md)
- 📋 [飞书工具配置指南](./feishu-tools-setup.md)
- 🔧 [飞书开放平台文档](https://open.feishu.cn/document/)

## 💡 提示

**最佳实践**：一次性配置所有权限，避免反复申请。

**快速链接**：
- 🔗 [批量配置所有权限](https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=calendar:calendar:readonly,calendar:calendar,calendar:calendar_event:readonly,calendar:calendar_event,docx:document:readonly,docx:document,bitable:app:readonly,bitable:app,bitable:app_table_record:readonly,bitable:app_table_record,drive:drive:readonly,drive:drive,drive:file:upload,drive:file:download,wiki:wiki:readonly,wiki:wiki&op_from=openapi&token_type=tenant)
- 🧪 [测试权限配置](../scripts/test-feishu-permissions.ts)
- 📋 [权限检查清单](../scripts/check-feishu-permissions.ts)

---

**最后更新**: 2026-03-15
