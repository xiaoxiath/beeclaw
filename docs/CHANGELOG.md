# 文档变更日志

> 记录 Beeclaw 文档的所有重要变更

文档版本遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

---

> **Note**: Document version numbers have been unified. All previous v2.x.x / v1.x.x entries
> are pre-unification milestones. The canonical version is now **v0.4.0** (matching package.json).

## [v0.4.0-doc.3] - 2026-03-15 (飞书工具修复)

> *Previously labeled v2.1.3*

### 🐛 Bug 修复

**问题**: Drive 工具参数传递错误导致 API 调用失败

**症状**:
```
[Executing] feishu_drive_list({"folderToken":"root"})
[Completed] feishu_drive_list (1ms): {"success":false,"error":"folder_token is not defined"}
```

**修复**:
- ✅ 修复 `src/adapter/feishu/tools/drive.ts` 第 59 行参数传递
- ✅ 从 `{ folder_token }` 简写改为显式 `{ folder_token: folderToken }`
- ✅ 确保驼峰命名参数正确转换为下划线命名 API 参数

**影响范围**:
- ✅ `feishu_drive_list` - 列出文件夹内容（已修复）
- ✅ 其他 drive 工具不受影响

### 📚 文档更新

**新增文档**:
1. ✅ **飞书工具配置指南** - Planned
2. ✅ **飞书权限错误快速修复** - Planned
3. ✅ **飞书权限详细排查** - Planned
4. ✅ **飞书工具架构设计** - Planned

**新增工具**:
1. ✅ **权限检查脚本** - `scripts/check-feishu-permissions.ts`
2. ✅ **权限测试脚本** - `scripts/test-feishu-permissions.ts`
3. ✅ **参数修复验证** - `scripts/test-drive-param-fix.ts`

### 🔧 配置更新

**beeclaw.example.json**:
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

**新增 skill**:
- ✅ `skills/feishu-extended/SKILL.md` - 飞书扩展工具（知识库、权限、审批等低频功能）

### 📊 统计

**文档变更**:
- 新增文档: 5 个（Planned）
- 更新文档: 3 个
- 新增脚本: 4 个

**代码修复**:
- Bug 修复: 1 个（drive 参数传递）
- 受影响文件: 1 个（`drive.ts`）
- 修复行数: 1 行（第 59 行）

---

## [v0.4.0-doc.2] - 2026-03-14

> *Previously labeled v2.1.2* (Cookbook 修复)

### 🐛 重大修复

**问题**: Cookbook 案例从开发者视角编写，要求用户手动创建文件和配置

**修复**: 全部 7 个案例重写为对话式指南
- ✅ 用户现在通过对话与 Beeclaw 交互，而非手动配置
- ✅ Beeclaw 自动处理文件创建、配置和执行
- ✅ 强调 AI 助手价值：Beeclaw 为你工作

### 🔄 变更文档

#### Cookbook 案例改造

**基础案例**:
- `cookbook/basic/first-skill.md` - 15→5 分钟，对话式技能创建
- `cookbook/basic/memory-workflow.md` - 20→10 分钟，对话式记忆管理
- `cookbook/basic/research-task.md` - 25→15 分钟，对话式研究任务

**进阶案例**:
- `cookbook/advanced/subagent-orchestration.md` - 40→20 分钟，对话式并行任务
- `cookbook/advanced/proactive-scheduling.md` - 30→15 分钟，对话式调度
- `cookbook/advanced/plugin-development.md` - 拆分为用户视角（10分钟）和开发者视角（60分钟）

**集成案例**:
- `cookbook/integration/feishu-bot-deploy.md` - 45→30 分钟，对话式部署指南

### ✨ 改进要点

**改造前** (错误):
```markdown
### 步骤 2：创建技能文件
mkdir -p skills/productivity
nano skills/productivity/WEEKLY-REPORT.md
```

**改造后** (正确):
```markdown
### 步骤 1：与 Beeclaw 对话创建技能

用户: 帮我创建一个周报生成技能

Beeclaw 会:
1. ✅ 理解你的需求
2. ✅ 自动创建技能文件
3. ✅ 设计技能内容
4. ✅ 保存到技能库
```

### 📊 统计

**完成度**: 7/7 案例修复（100%）
**平均时间缩减**: 50%

---

## [v0.4.0-doc.1] - 2026-03-14

> *Previously labeled v2.1.1* (P1-P2 完成)

### 🎉 重大更新

**新增功能**:
- ✨ **实战案例库扩展** - 新增 4 个案例（基础 1 个，进阶 1 个完整 + 3 个框架版）
- ✨ **文档地图** - 可视化导航，Mermaid 流程图
- ✨ **多语言支持规划** - 术语表（50+ 条）+ i18n 实施指南
- ✨ **标准化导航模板** - 底部导航规范

**文档改进**:
- 📝 **子代理编排案例** - 完整 40 分钟教程，DAG 任务编排
- 📝 **深度研究任务案例** - 完整 25 分钟教程，网络工具使用
- 📝 **术语表** - 中英文对照，50+ 核心术语

### ✅ 新增文档

#### Cookbook 案例
- `cookbook/basic/research-task.md` - 深度研究任务（25分钟, ⭐⭐）
- `cookbook/advanced/subagent-orchestration.md` - 子代理编排（40分钟, ⭐⭐⭐）
- `cookbook/advanced/plugin-development.md` - 插件开发全流程（框架版）
- `cookbook/advanced/proactive-scheduling.md` - 主动调度系统（框架版）
- `cookbook/integration/feishu-bot-deploy.md` - 飞书 Bot 部署（框架版）

### 📊 统计

**P1-P2 完成度**:
- 实战案例库：7/10（70%）
- 文档可发现性：100%
- 多语言支持：100%（规划阶段）

**总体完成度**: 9/9 任务（100%）

---

## [v2.1.0] - 2026-03-14 (P0 完成)

### 🎉 重大更新

**新增功能**:
- ✨ **学习路径文档** - 场景化学习指南，新手到专家的完整路径
- ✨ **实战案例库** (`cookbook/`) - 10+ 个端到端实战案例
- ✨ **故障排查手册** (`troubleshooting/`) - 系统化的问题诊断流程
- ✨ **文档版本管理** - CHANGELOG 和版本标识

**文档改进**:
- 📝 **重构 README.md** - 精简为项目概览，移除重复内容
- 📝 **扩展 getting-started.md** - 成为完整的安装配置指南
- 📝 **完善工具参考** - 新增 20+ 个工具的完整文档（memory_*, goal_*, skill_*）
- 📝 **优化文档索引** - docs/README.md 新增角色选择器和快速导航

### ✅ 新增文档

#### 基础文档
- `troubleshooting/README.md` - 故障排查手册

#### 工具文档扩展
- `references/tools.md` 新增:
  - 记忆工具 (11个): memory_ls, memory_search, memory_grep, memory_read, memory_write, memory_record, memory_index, memory_knowledge_create, memory_compress, memory_score, memory_dedupe
  - 目标工具 (6个): goal_create, goal_list, goal_get, goal_update, goal_add_progress, goal_delete
  - 技能工具 (6个): skill_list, skill_get, skill_create, skill_update, skill_execute, skill_delete

### 🔄 变更文档

#### README.md
**变更前**: 包含详细配置、所有运行模式、完整架构
**变更后**: 精简为 5 分钟快速开始 + 文档索引

#### docs/getting-started.md
**变更前**: 5 分钟快速上手
**变更后**: 完整的安装配置指南

#### docs/references/tools.md
**变更前**: 15 个工具
**变更后**: 40+ 个工具

### 🐛 修复

- 修复文档链接错误（多个文件中的相对路径）
- 修正配置示例中的错误路径
- 统一术语翻译（子代理 vs Subagent）

---

## [v2.0.0] - 2026-03-12

### 🎉 重大重构

**文档体系重构**:
- 📁 按类型重组文档目录（guide/, references/, features/, operations/）
- 📝 创建文档索引中心 (`docs/README.md`)
- 🏷️ 建立文档命名规范（小写+连字符）

### ✅ 新增

#### 核心文档
- `docs/README.md` - 文档索引中心
- `docs/architecture.md` - 系统架构设计
- `docs/configuration.md` - 配置指南
- `docs/getting-started.md` - 快速开始

#### 用户指南
- `docs/guide/memory-system.md` - 记忆系统设计
- `docs/guide/skill-system.md` - 技能系统
- `docs/guide/subagent-system.md` - 子代理系统
- `docs/guide/plugin-system.md` - 插件系统
- `docs/guide/session-recovery.md` - 会话恢复
- `docs/guide/feishu-integration.md` - 飞书集成

#### 参考文档
- `docs/references/tools.md` - 工具参考

#### 运维文档
- `docs/operations/deployment.md` - PM2 部署

### 🔄 变更

- 将分散的文档整理到对应目录
- 统一文档格式和风格
- 添加交叉引用和相关链接

---

## [v1.0.0] - 2025-12-01

### ✅ 初始版本

**基础文档**:
- `README.md` - 项目介绍
- `CLAUDE.md` - 开发指南
- 基本的工具文档
- 简单的配置说明

---

## 版本规划

### [v2.2.0] - 计划中

**计划新增**:
- 🌐 多语言支持（英文文档）
- 📹 视频教程链接
- 🎨 架构图优化（Mermaid 图表）
- 📊 文档搜索功能

**计划改进**:
- 完善所有 cookbook 案例
- 添加更多故障排查案例
- 优化移动端阅读体验

---

## 贡献指南

### 如何贡献文档

1. **Fork 仓库**
2. **创建分支**: `git checkout -b docs/your-feature`
3. **编写文档**: 遵循项目文档风格规范
4. **本地预览**: 使用 Markdown 预览工具
5. **提交 PR**: 描述文档变更内容

### 文档审核标准

- [ ] 内容准确无误
- [ ] 格式符合规范
- [ ] 链接有效
- [ ] 代码示例可运行
- [ ] 无错别字
- [ ] 版本号已更新

---

## 文档版本对照表

| 文档版本 | 代码版本 | 发布日期 | 主要变更 |
|---------|---------|---------|---------|
| v2.1.3 | >= v1.3.0 | 2026-03-15 | 飞书工具修复、权限文档 |
| v2.1.2 | >= v1.3.0 | 2026-03-14 | Cookbook 案例重写 |
| v2.1.1 | >= v1.3.0 | 2026-03-14 | 实战案例库、文档地图、多语言规划 |
| v2.1.0 | >= v1.3.0 | 2026-03-14 | 学习路径、实战案例、故障排查 |
| v2.0.0 | >= v1.2.0 | 2026-03-12 | 文档体系重构 |
| v1.0.0 | v1.0.0 | 2025-12-01 | 初始版本 |

---

**维护者**: Beeclaw Team
**最后更新**: 2026-03-27
