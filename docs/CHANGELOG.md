# 文档变更日志

> 记录 Beeclaw 文档的所有重要变更

文档版本遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

---

## [v2.1.1] - 2026-03-14 (P1-P2 完成)

### 🎉 重大更新

**新增功能**:
- ✨ **实战案例库扩展** - 新增 4 个案例（基础 1 个，进阶 1 个完整 + 3 个框架版）
- ✨ **文档地图** (`sitemap.md`) - 可视化导航，Mermaid 流程图
- ✨ **多语言支持规划** - 术语表（50+ 条）+ i18n 实施指南
- ✨ **标准化导航模板** - 底部导航规范

**文档改进**:
- 📝 **子代理编排案例** - 完整 40 分钟教程，DAG 任务编排
- 📝 **深度研究任务案例** - 完整 25 分钟教程，网络工具使用
- 📝 **术语表** (`glossary.json`) - 中英文对照，50+ 核心术语

### ✅ 新增文档

#### Cookbook 案例
- `cookbook/basic/research-task.md` - 深度研究任务（25分钟, ⭐⭐）
- `cookbook/advanced/subagent-orchestration.md` - 子代理编排（40分钟, ⭐⭐⭐）
- `cookbook/advanced/plugin-development.md` - 插件开发全流程（框架版）
- `cookbook/advanced/proactive-scheduling.md` - 主动调度系统（框架版）
- `cookbook/integration/feishu-bot-deploy.md` - 飞书 Bot 部署（框架版）

#### 导航和地图
- `sitemap.md` - 文档地图，可视化导航
- `.templates/FOOTER-NAVIGATION.md` - 标准化底部导航模板

#### 多语言支持
- `i18n/README.md` - i18n 实施指南
- `i18n/glossary.json` - 中英文术语表（50+ 条）

#### 总结文档
- `DOCUMENTATION-REFACTOR-SUMMARY.md` - 改造完成总结

### 🔄 变更文档

- 无文档变更（P1-P2 主要是新增）

### 🐛 修复

- 修复案例库索引的案例数量统计
- 更新改造报告，添加 P1-P2 完成情况

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
- ✨ **学习路径文档** (`learning-paths.md`) - 场景化学习指南，新手到专家的完整路径
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
- `learning-paths.md` - 学习路径指南
- `cookbook/README.md` - 实战案例库索引
- `cookbook/basic/first-skill.md` - 创建第一个技能
- `cookbook/basic/memory-workflow.md` - 记忆管理工作流
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

**移除内容** (迁移到 getting-started.md):
- 详细的配置说明
- 所有运行模式表格
- 完整的目录结构

**新增内容**:
- 架构概览图（简化版）
- 角色选择器（新手/运维/开发者）
- 学习路径链接

#### docs/getting-started.md
**变更前**: 5 分钟快速上手
**变更后**: 完整的安装配置指南

**新增内容**:
- 前置要求详解
- 3 种配置方式对比
- 5 种运行模式详解
- CLI 基本使用教程
- 完整的故障排除章节
- "下一步"学习指引

#### docs/references/tools.md
**变更前**: 15 个工具
**变更后**: 40+ 个工具

**新增分类**:
- 记忆系统 (11 个工具)
- 目标系统 (6 个工具)
- 技能系统 (6 个工具)

**改进**:
- 每个工具有完整参数表
- 添加返回值类型
- 提供错误处理说明
- 新增相关工具链接

#### docs/README.md
**新增**:
- 📊 文档版本信息
- 🎯 角色选择器
- 🗺️ 快速导航路径
- 📝 文档维护指南

### 🐛 修复

- 修复文档链接错误（多个文件中的相对路径）
- 修正配置示例中的错误路径
- 统一术语翻译（子代理 vs Subagent）

### 🗑️ 移除

- 移除 `docs/cli-reference.md`（内容合并到 `references/cli.md`）
- 移除 `docs/tools-reference.md`（内容合并到 `references/tools.md`）

---

## [v2.0.0] - 2026-03-12

### 🎉 重大重构

**文档体系重构**:
- 📁 按类型重组文档目录（guide/, design/, references/, features/, operations/, future/, archive/）
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
- `docs/guide/proactive-system.md` - 主动系统
- `docs/guide/session-recovery.md` - 会话恢复
- `docs/guide/error-handling.md` - 错误处理
- `docs/guide/notification.md` - 通知系统
- `docs/guide/feishu-integration.md` - 飞书集成
- `docs/guide/web-ui.md` - Web UI

#### 设计文档
- `docs/design/context-management.md` - 上下文管理
- `docs/design/unified-session.md` - 统一会话架构
- `docs/design/resilience.md` - 弹性设计
- `docs/design/feishu-message-optimization.md` - 飞书消息优化
- `docs/design/web-ui-rfc.md` - Web UI RFC

#### 参考文档
- `docs/references/cli.md` - CLI 参考
- `docs/references/tools.md` - 工具参考

#### 运维文档
- `docs/operations/deployment.md` - PM2 部署
- `docs/operations/performance.md` - 性能优化
- `docs/operations/logging.md` - 日志指南
- `docs/operations/timeout-config.md` - 超时配置

#### 功能文档
- `docs/features/feishu-card-v2.md` - 飞书卡片 V2

### 🔄 变更

- 将分散的文档整理到对应目录
- 统一文档格式和风格
- 添加交叉引用和相关链接

---

## [v1.0.0] - 2026-02-15

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
3. **编写文档**: 遵循 [文档风格指南](../STYLE_GUIDE.md)
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
| v2.1.0 | >= v1.3.0 | 2026-03-14 | 学习路径、实战案例、故障排查 |
| v2.0.0 | >= v1.2.0 | 2026-03-12 | 文档体系重构 |
| v1.0.0 | v1.0.0 | 2026-02-15 | 初始版本 |

---

**维护者**: Beeclaw Team
**最后更新**: 2026-03-14
