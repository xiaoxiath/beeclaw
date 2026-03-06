# Beeclaw 文档

> AI 助手 - CLI 和飞书 Bot

---

## 📚 核心文档

### 快速开始

| 文档 | 说明 |
|------|------|
| [快速开始](./getting-started.md) | 安装和基本使用 |
| [飞书集成指南](./FEISHU-GUIDE.md) | 飞书 Bot 配置 + 插件使用 |

### 用户指南

| 文档 | 说明 |
|------|------|
| [CLI 参考](./cli-reference.md) | 命令行界面详解 |
| [配置指南](./configuration.md) | 配置文件详解 |
| [工具参考](./tools-reference.md) | 所有可用工具列表 |
| [主动系统](./PROACTIVE-SYSTEM.md) | 定时任务、主动聊天、通知推送 |
| [通知使用指南](./notification-usage-guide.md) | 通知功能详解 |
| [记忆系统](./memory-design.md) | 记忆存储和管理 |

### 架构文档

| 文档 | 说明 |
|------|------|
| [系统架构](./architecture.md) | 子代理系统、会话管理、共享状态 |
| [错误处理](./error-handling.md) | 错误分类和自动重试 |
| [超时配置](./timeout-config.md) | 智能超时机制配置 |
| [日志指南](./logging-guide.md) | 日志系统使用 |
| [性能优化](./performance-optimization.md) | 性能调优指南 |
| [会话恢复](./session-recovery-guide.md) | 会话持久化和恢复 |

### 部署运维

| 文档 | 说明 |
|------|------|
| [PM2 部署指南](./PM2-DEPLOYMENT.md) | 使用 PM2 部署 Bot (Daemon 模式) |

---

## 🚀 项目简介

**Beeclaw** 是一个 AI 助手，支持 CLI 和飞书 Bot 两种使用方式。

### 使用方式

| 模式 | 命令 | 说明 |
|------|------|------|
| CLI | `bun run cli` | 交互式命令行 |
| Bot | `bun run bot` | 飞书机器人 |
| Bot (Daemon) | `bun run bot --daemon` | 飞书机器人 + 后台调度 |

### 核心特性

- **多 Provider 支持** - OpenAI/智谱/MiniMax/Anthropic
- **记忆系统** - 文件系统存储 + 自动加载
- **技能系统** - 可复用的技能模块
- **目标追踪** - 长期目标管理
- **主动系统** - 定时提醒、主动聊天、通知推送
- **飞书集成** - WebSocket 长连接，无需公网 IP
- **飞书插件** - 3个工具 (发送消息、卡片、批量发送)
- **子代理系统** - 并行任务执行和 DAG 编排
- **智能重试** - 自动错误恢复

---

## 📂 文档归档

历史开发文档已移至 `archive/` 目录：

- **开发记录** - Phase 1/2/3 实现过程
- **技术分析** - Jiti、OpenClaw 扩展分析
- **重构记录** - 系统重构和优化历史

详见 [archive/README.md](./archive/README.md)

---

## 🔗 快速链接

### 新手入门
1. [快速开始](./getting-started.md) - 5分钟上手
2. [飞书集成指南](./FEISHU-GUIDE.md) - 配置飞书 Bot
3. [CLI 参考](./cli-reference.md) - 学习基本命令

### 深入了解
1. [系统架构](./architecture.md) - 理解核心设计
2. [主动系统](./PROACTIVE-SYSTEM.md) - 定时任务和主动聊天
3. [工具参考](./tools-reference.md) - 查看所有工具

### 生产部署
1. [PM2 部署指南](./PM2-DEPLOYMENT.md) - 使用 PM2 部署
2. [会话恢复](./session-recovery-guide.md) - 持久化配置
3. [性能优化](./performance-optimization.md) - 调优建议

---

## 📝 文档版本

- **最后更新**: 2026-03-06
- **文档重组**: 完成 (详见 [重组计划](./DOCUMENTATION-REORGANIZATION-PLAN.md))
- **核心文档**: 16 个
- **归档文档**: 32 个

---

## 💡 贡献

发现文档问题？请：
1. 查看 [archive/](./archive/) 中的历史文档
2. 提交 Issue 或 PR
3. 更新相关文档
