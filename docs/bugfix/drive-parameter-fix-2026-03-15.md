# Bug 修复：Drive 工具参数传递错误

## 问题描述

**错误日志**：
```
[Executing] feishu_drive_list({"folderToken":"root"})
[Completed] feishu_drive_list (1ms): {"success":false,"error":"folder_token is not defined"}
```

**症状**：
- AI 调用 `feishu_drive_list` 工具时失败
- 错误提示 `folder_token is not defined`
- 即使传递了 `folderToken` 参数也报错

## 根本原因

**文件**: `src/adapter/feishu/tools/drive.ts`
**位置**: 第 59 行

**错误代码**：
```typescript
export async function listFiles(
  client: Client,
  folderToken: string,  // 函数参数：驼峰命名
  options?: { /* ... */ }
) {
  const response = await client.drive.file.listFiles({
    params: {
      folder_token,  // ❌ 错误：简写语法，等价于 folder_token: folder_token
      // 但 folder_token 变量不存在！
    },
  });
}
```

**问题分析**：
1. 函数参数名：`folderToken`（驼峰命名）
2. API 参数名：`folder_token`（下划线命名）
3. 代码使用了简写 `{ folder_token }`，等价于 `{ folder_token: folder_token }`
4. 但 `folder_token` 变量未定义，导致运行时错误

## 修复方案

**修改**：
```typescript
const response = await client.drive.file.listFiles({
  params: {
    folder_token: folderToken,  // ✅ 正确：显式传递参数
  },
});
```

## 参数传递流程

```
AI 调用
  ↓
feishu_drive_list({ folderToken: "root" })
  ↓
executeDriveTool("feishu_drive_list", { folderToken: "root" })
  ↓
listFiles(client, "root", options)
  ↓
client.drive.file.listFiles({
  params: {
    folder_token: "root"  // ✅ 修复后：正确传递
  }
})
```

## 验证修复

### 1. 单元测试
```bash
bun scripts/test-drive-param-fix.ts
```

**预期输出**：
```
✅ Bug 修复验证:

修复前 (第 59 行):
  params: {
    folder_token,  // ❌ 错误：变量未定义
  }

修复后 (第 59 行):
  params: {
    folder_token: folderToken,  // ✅ 正确：参数正确传递
  }

🎉 测试通过！参数传递修复已生效。
```

### 2. 集成测试
```bash
# 重启 bot
bun run bot

# 在飞书中发送消息
"列出我的云盘文件"

# 预期结果
应该正常返回文件列表，不再报错 "folder_token is not defined"
```

## 影响范围

**受影响功能**：
- ✅ `feishu_drive_list` - 列出文件夹内容

**不受影响功能**：
- ✅ `feishu_drive_get` - 获取文件信息
- ✅ `feishu_drive_create_folder` - 创建文件夹
- ✅ `feishu_drive_move` - 移动文件
- ✅ `feishu_drive_copy` - 复制文件
- ✅ `feishu_drive_delete` - 删除文件
- ✅ `feishu_drive_upload` - 上传文件
- ✅ `feishu_drive_download` - 下载文件
- ✅ `feishu_drive_search` - 搜索文件

## 其他飞书工具检查

已检查所有飞书工具文件的参数传递：

| 工具文件 | 检查结果 | 备注 |
|---------|---------|------|
| `calendar.ts` | ✅ 正常 | 无参数简写错误 |
| `docx.ts` | ✅ 正常 | 无参数简写错误 |
| `bitable.ts` | ✅ 正常 | 无参数简写错误 |
| `drive.ts` | ✅ 已修复 | 修复了 folder_token 参数 |
| `wiki.ts` | ✅ 正常 | 无参数简写错误 |

## 经验教训

### 1. 避免使用对象属性简写

**不推荐**：
```typescript
const folder_token = 'xxx';
params: { folder_token }  // 危险：如果 folder_token 未定义会报错
```

**推荐**：
```typescript
const folderToken = 'xxx';
params: { folder_token: folderToken }  // 安全：显式传递
```

### 2. 参数命名一致性

**问题**：
- 函数参数：驼峰命名（`folderToken`）
- API 参数：下划线命名（`folder_token`）
- 容易混淆，导致错误

**解决方案**：
- 统一使用驼峰命名作为函数参数
- 在 API 调用时显式转换
- 添加 TypeScript 类型检查

### 3. 单元测试覆盖

**改进**：
- 为每个工具添加参数验证测试
- 测试参数传递是否正确
- 测试边界情况（如 `folderToken: "root"`）

## 相关文档

- [飞书工具配置指南](../feishu-tools-setup.md)
- [飞书权限错误修复](../troubleshooting/feishu-permissions-error.md)
- [飞书 API 文档](https://open.feishu.cn/document/)

## 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-03-15 | v1.0.1 | 修复 drive 工具参数传递错误 |

---

**修复提交**：
```bash
git add src/adapter/feishu/tools/drive.ts
git commit -m "fix: correct parameter passing in drive listFiles function

- Fix 'folder_token is not defined' error
- Change from shorthand { folder_token } to explicit { folder_token: folderToken }
- Ensures proper parameter mapping from camelCase to snake_case"
```
