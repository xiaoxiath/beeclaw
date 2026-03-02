# Beeclaw 文档

> AI 助手 - CLI 和飞书 Bot

## 目录

1. [快速开始](./getting-started.md)
2. [CLI 参考](./cli-reference.md)
3. [飞书 Bot](./feishu-integration.md)
4. [配置指南](./configuration.md)
5. [内置工具](./tools-reference.md)
6. [记忆系统](./memory-design.md)
7. [路线图](./roadmap.md)

---

## 项目简介

**Beeclaw** 是一个 AI 助手，支持 CLI 和飞书 Bot 两种使用方式。

### 使用方式

| 模式 | 命令 | 说明 |
|------|------|------|
| CLI | `bun run cli` | 交互式命令行 |
| Bot | `bun run bot` | 飞书机器人 |

### 核心特性

- ✅ **多 Provider 支持** - OpenAI/智谱/MiniMax/Anthropic
- ✅ **记忆系统** - 文件系统存储 + 自动加载
- ✅ **技能系统** - 可复用的技能模块
- ✅ **目标追踪** - 长期目标管理
- ✅ **定时提醒** - 后台自动检查
- ✅ **飞书集成** - WebSocket 长连接，无需公网 IP
