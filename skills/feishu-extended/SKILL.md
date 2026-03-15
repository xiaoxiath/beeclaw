---
name: feishu-extended
description: 飞书扩展工具集（知识库、权限、审批等低频功能）
maturity: growing
version: 1.0.0
tags: [feishu, lark, enterprise, extended]
---

# 飞书扩展工具集

提供飞书低频/企业级功能的 skill 封装。

## 🎯 适用场景

**使用此 skill 的场景**：
- ✅ 知识库管理（创建/移动/删除节点）
- ✅ 权限管理（设置文档权限）
- ✅ 审批流程（创建/查询审批）
- ✅ 自定义飞书扩展

**不使用此 skill 的场景**（使用内置工具）：
- ❌ 日历管理 → 使用内置 `feishu_calendar_*` 工具
- ❌ 文档编辑 → 使用内置 `feishu_docx_*` 工具
- ❌ 多维表格 → 使用内置 `feishu_bitable_*` 工具
- ❌ 文件上传 → 使用内置 `feishu_drive_*` 工具

## 📦 依赖

需要安装飞书 CLI 工具：

```bash
# 方式 1: 使用官方 lark CLI
npm install -g @larksuiteoapi/cli

# 方式 2: 使用项目内封装
bun install
```

## 🔧 配置

在 `beeclaw.json` 中启用此 skill：

```json
{
  "skills": {
    "enabled": ["feishu-extended"]
  }
}
```

## 📚 可用工具

### 知识库管理

#### feishu_wiki_create_space
创建新的知识库空间。

**示例**：
```
用户: 创建一个名为"产品文档"的知识库
AI: [调用 feishu-extended skill]
   → 执行脚本: bun scripts/wiki/create-space.ts "产品文档"
   → 返回: 知识库 ID 和访问链接
```

#### feishu_wiki_set_permission
设置知识库节点权限。

**示例**：
```
用户: 把"技术文档"节点设置为仅团队可见
AI: [调用 feishu-extended skill]
   → 执行脚本: bun scripts/wiki/set-permission.ts "nodeToken" "team"
```

### 权限管理

#### feishu_permission_grant
授予文档/文件夹权限。

**示例**：
```
用户: 给张三开放"设计稿"文件夹的编辑权限
AI: [调用 feishu-extended skill]
   → 执行脚本: bun scripts/permission/grant.ts "folderToken" "张三" "edit"
```

### 审批流程

#### feishu_approval_create
创建审批实例。

**示例**：
```
用户: 帮我提交一个请假审批，从3月20日到3月22日
AI: [调用 feishu-extended skill]
   → 执行脚本: bun scripts/approval/create.ts "leave" "2026-03-20" "2026-03-22"
```

## ⚡ 性能对比

| 操作 | 内置工具 | Skill (CLI) | 性能差异 |
|------|---------|-------------|----------|
| 日历查询 | ~200ms | ~500ms | **慢 2.5x** |
| 文档读取 | ~300ms | ~700ms | **慢 2.3x** |
| 知识库创建 | N/A | ~600ms | 仅 skill 支持 |
| 权限设置 | N/A | ~400ms | 仅 skill 支持 |

**建议**：
- 高频操作 → 使用内置工具
- 低频/小众操作 → 使用此 skill

## 🛠️ 自定义扩展

你可以在此 skill 中添加自定义飞书工具：

1. **创建脚本**：
```bash
# skills/feishu-extended/scripts/custom/my-tool.ts
import { FeishuClient } from '@larksuiteoapi/node-sdk';

const client = new FeishuClient({
  appId: process.env.LARK_BEECLAW_APPID!,
  appSecret: process.env.LARK_BEECLAW_AS!,
});

// 你的自定义逻辑
const result = await client.xxx.yyy.zzz();
console.log(JSON.stringify(result));
```

2. **在 SKILL.md 中描述**：
```markdown
## 自定义工具

### my_custom_tool
描述你的自定义工具功能...

**示例**：
\`\`\`
用户: [你的指令]
AI: [调用脚本] → [返回结果]
\`\`\`
```

## 🔍 调试

启用详细日志：

```bash
export FEISHU_EXTENDED_DEBUG=true
bun run bot
```

查看脚本执行日志：
```bash
tail -f logs/feishu-extended.log
```

## 📖 相关文档

- [飞书开放平台](https://open.feishu.cn/)
- [飞书工具配置指南](../../docs/feishu-tools-setup.md)
- [内置飞书工具列表](../../docs/feishu-tools-setup.md#可用工具列表)

## 🤝 贡献

欢迎贡献新的飞书工具到这个 skill！

1. Fork 项目
2. 在 `scripts/` 中添加新工具
3. 更新 SKILL.md 文档
4. 提交 PR

## 📝 更新日志

### v1.0.0 (2026-03-15)
- ✨ 初始版本
- ✨ 支持知识库管理
- ✨ 支持权限管理
- ✨ 支持审批流程
