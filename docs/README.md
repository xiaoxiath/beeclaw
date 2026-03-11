# Beeclaw 文档

> 一个可进化的 AI 助手，支持 CLI 和飞书 Bot

---

## 🚀 快速开始

| 文档 | 说明 |
|------|------|
| [快速开始](./getting-started.md) | 安装、配置、5 分钟上手 |
| [配置指南](./configuration.md) | 环境变量、配置文件、用户设置 |

---

## 📖 用户指南

### 核心系统

| 文档 | 说明 |
|------|------|
| [记忆系统](./guide/memory-system.md) | 文件系统记忆存储和智能检索 |
| [技能系统](./guide/skill-system.md) | 可复用技能的创建、进化和管理 |
| [子代理系统](./guide/subagent-system.md) | 并行任务执行和 DAG 编排 |
| [插件系统](./guide/plugin-system.md) | OpenClaw 兼容插件和 Hook 机制 |

### 高级功能

| 文档 | 说明 |
|------|------|
| [主动系统](./guide/proactive-system.md) | 定时任务、主动聊天、通知推送 |
| [会话恢复](./guide/session-recovery.md) | 重启后自动恢复未回复的对话 |
| [错误处理](./guide/error-handling.md) | 错误分类、自动重试和降级 |
| [通知系统](./guide/notification.md) | CLI 和飞书的通知功能 |

### 集成与界面

| 文档 | 说明 |
|------|------|
| [飞书集成](./guide/feishu-integration.md) | 飞书 Bot 完整配置流程 |
| [Web UI](./guide/web-ui.md) | Web 管理界面使用指南 |
| [架构特性](./guide/architecture-features.md) | SQLite、消息网关、任务调度器 |

---

## 📚 参考文档

| 文档 | 说明 |
|------|------|
| [CLI 参考](./references/cli.md) | 命令行界面和斜杠命令 |
| [工具参考](./references/tools.md) | 所有内置工具的参数和示例 |

---

## 🏗 架构设计

### 核心架构

| 文档 | 说明 |
|------|------|
| [系统架构](./architecture.md) | 核心架构、子代理、会话管理、共享状态 |
| [上下文管理](./design/context-management.md) | Token 预算、Prompt 分层、智能压缩 |
| [统一会话架构](./design/unified-session.md) | CLI/Bot 统一会话管理 |
| [弹性设计](./design/resilience.md) | 熔断、重试、降级策略 |

### 功能设计

| 文档 | 说明 |
|------|------|
| [飞书消息优化](./design/feishu-message-optimization.md) | 飞书 Card 2.0 流式消息方案 |
| [Web UI RFC](./design/web-ui-rfc.md) | Web UI 产品设计与技术方案 |

### 未来规划

| 文档 | 说明 |
|------|------|
| [自动知识提取](./design/auto-knowledge.md) | 从对话中自动提取知识 |
| [语义记忆搜索](./design/semantic-memory-search.md) | 记忆检索设计 |

---

## 🎯 功能特性

| 文档 | 说明 |
|------|------|
| [飞书卡片 V2](./features/feishu-card-v2.md) | 飞书 Interactive Card 2.0 支持 |

---

## 🔧 运维部署

| 文档 | 说明 |
|------|------|
| [PM2 部署](./operations/deployment.md) | 生产环境 PM2 部署完整指南 |
| [性能优化](./operations/performance.md) | 响应延迟分析和优化方案 |
| [日志指南](./operations/logging.md) | 日志级别、格式、排查技巧 |
| [超时配置](./operations/timeout-config.md) | 智能超时机制配置 |

---

## 🔮 未来规划

| 文档 | 说明 |
|------|------|
| [自进化系统](./future/self-evolution.md) | Agent 自主代码修改和部署 |
| [技能进化分析](./future/skill-evolution.md) | 技能系统完善性分析和路线图 |

---

## 🎮 独立项目

| 文档 | 说明 |
|------|------|
| [Agora Town PRD](./projects/agora-town/prd.md) | AI Agent 虚拟世界需求文档 |
| [Agora Town MVP](./projects/agora-town/mvp-plan.md) | MVP 阶段实施计划 |

---

## 📂 归档文档

历史开发文档已整理至 [`archive/`](./archive/README.md) 目录，包括：

- **开发记录**：Phase 1-3 插件系统实现、子代理各阶段实现、Web UI 开发记录
- **技术分析**：OpenClaw 集成、Jiti 运行时、日志增强
- **重构记录**：Job Handler 重构、工具系统简化
- **已替代文档**：被新文档合并替代的旧版文档

---

## 🗺️ 快速导航

### 新手入门
```
快速开始 → 配置指南 → CLI 参考 → 工具参考
```
[快速开始](./getting-started.md) → [配置指南](./configuration.md) → [CLI 参考](./references/cli.md) → [工具参考](./references/tools.md)

### 深入了解
```
系统架构 → 上下文管理 → 子代理系统 → 插件系统
```
[系统架构](./architecture.md) → [上下文管理](./design/context-management.md) → [子代理系统](./guide/subagent-system.md) → [插件系统](./guide/plugin-system.md)

### 生产部署
```
PM2 部署 → 会话恢复 → 性能优化 → 日志指南
```
[PM2 部署](./operations/deployment.md) → [会话恢复](./guide/session-recovery.md) → [性能优化](./operations/performance.md) → [日志指南](./operations/logging.md)

### 飞书集成
```
飞书集成 → 飞书消息优化 → 飞书卡片 V2
```
[飞书集成](./guide/feishu-integration.md) → [飞书消息优化](./design/feishu-message-optimization.md) → [飞书卡片 V2](./features/feishu-card-v2.md)

---

## 📝 文档维护指南

### 文档分类标准

- **根目录**: 仅保留 4-5 个核心文档（README、快速开始、配置、架构）
- **guide/**: 用户使用指南（如何使用功能）
- **design/**: 技术设计文档（架构设计、RFC）
- **references/**: 参考文档（API、CLI、工具）
- **features/**: 功能特性文档（具体功能说明）
- **operations/**: 运维文档（部署、监控、性能）
- **future/**: 未来规划（未实现功能）
- **projects/**: 独立项目文档
- **archive/**: 历史归档

### 命名规范

- 文件名使用**小写 + 连字符**: `memory-system.md` ✅
- 避免大写和下划线: `Memory-System.md` ❌ `memory_system.md` ❌
- 使用完整单词，避免缩写: `architecture.md` ✅ `arch.md` ❌

### 文档模板

每个文档应包含：
1. **标题和简介**: 说明文档目的
2. **目录**: 方便导航（超过 50 行的文档）
3. **核心内容**: 结构化组织
4. **示例**: 代码示例和配置示例
5. **相关链接**: 指向相关文档

---

**最后更新**: 2026-03-12
**文档版本**: v2.0
