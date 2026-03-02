# Beeclaw 文档

> AI 助手 - CLI 和飞书 Bot

## 快速链接

| 文档 | 说明 |
|------|------|
| [快速开始](./getting-started.md) | 安装和基本使用 |
| [CLI 参考](./cli-reference.md) | 命令行界面详解 |
| [配置指南](./configuration.md) | 配置文件详解 |
| [飞书 Bot](./feishu-integration.md) | 飞书机器人集成 |

## 核心文档

| 文档 | 说明 |
|------|------|
| [系统架构](./architecture.md) | 子代理系统、会话管理、共享状态 |
| [内置工具](./tools-reference.md) | 所有可用工具列表 |
| [记忆系统](./memory-design.md) | 记忆存储和管理 |
| [错误处理](./error-handling.md) | 错误分类和自动重试 |
| [超时配置](./timeout-config.md) | 智能超时机制配置 |

## 运维文档

| 文档 | 说明 |
|------|------|
| [PM2 部署指南](./PM2-GUIDE.md) | 使用 PM2 部署 Bot |

## 规划文档

| 文档 | 说明 |
|------|------|
| [自进化系统](./future/self-evolution-system.md) | Agent 自我优化设计 |
| [技能演进分析](./future/skill-evolution-analysis.md) | 技能系统优化方向 |

---

## 项目简介

**Beeclaw** 是一个 AI 助手，支持 CLI 和飞书 Bot 两种使用方式。

### 使用方式

| 模式 | 命令 | 说明 |
|------|------|------|
| CLI | `bun run cli` | 交互式命令行 |
| Bot | `bun run bot` | 飞书机器人 |

### 核心特性

- **多 Provider 支持** - OpenAI/智谱/MiniMax/Anthropic
- **记忆系统** - 文件系统存储 + 自动加载
- **技能系统** - 可复用的技能模块
- **目标追踪** - 长期目标管理
- **定时提醒** - 后台自动检查
- **飞书集成** - WebSocket 长连接，无需公网 IP
- **子代理系统** - 并行任务执行和 DAG 编排
- **智能重试** - 自动错误恢复
