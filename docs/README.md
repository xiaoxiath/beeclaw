# Beeclaw 文档

> 一个可进化的 AI 助手，支持 CLI、飞书 Bot 和 Web UI

**项目版本**: v0.4.0（与 package.json 同步）
**最后更新**: 2026-05-15

---

## 📚 核心文档

| 文档 | 说明 |
|------|------|
| [快速开始](./getting-started.md) | 5 分钟安装配置和基本使用 |
| [配置指南](./configuration.md) | 环境变量、配置文件、最佳实践 |
| [系统架构](./architecture.md) | 核心架构、模块设计、技术选型 |
| [变更日志](./CHANGELOG.md) | 文档变更记录 |

---

## 🚀 快速开始

### 1. 安装配置

```bash
# 克隆仓库
git clone https://github.com/xiaoxiath/beeclaw.git
cd beeclaw

# 安装依赖
bun install

# 配置
cp beeclaw.example.json beeclaw.json
export ZHIPU_API_KEY=your_key_here

# 启动
bun run cli
```

### 2. 飞书 Bot

```bash
export LARK_BEECLAW_APPID=your_app_id
export LARK_BEECLAW_AS=your_app_secret
bun run bot
```

---

## 📖 使用指南

### 核心系统

| 文档 | 说明 |
|------|------|
| [记忆系统](./guide/memory-system.md) | 文件系统记忆存储和智能检索 |
| [技能系统](./guide/skill-system.md) | 可复用技能的创建、进化和管理 |
| [子代理系统](./guide/subagent-system.md) | 并行任务执行和 DAG 编排 |
| [插件系统](./guide/plugin-system.md) | OpenClaw 兼容插件和 Hook 机制 |

### 集成功能

| 文档 | 说明 |
|------|------|
| [飞书集成](./guide/feishu-integration.md) | 飞书 Bot 完整配置流程 |
| [会话恢复](./guide/session-recovery.md) | 重启后自动恢复未回复的对话 |

---

## 🔧 运维部署

| 文档 | 说明 |
|------|------|
| [部署指南](./operations/deployment.md) | PM2 部署、监控、备份策略 |

---

## 📚 参考文档

| 文档 | 说明 |
|------|------|
| [工具参考](./references/tools.md) | 所有内置工具的参数和示例 |

---

## 🔍 故障排查

| 文档 | 说明 |
|------|------|
| [故障排查手册](./troubleshooting/README.md) | 系统化的问题诊断和解决方案 |

---

## 🎯 开发者指南

详细的开发指南请参考根目录的 [CLAUDE.md](../CLAUDE.md)，包含：

- 开发命令和测试
- 核心架构说明
- 代码规范和最佳实践
- 常见开发任务

---

## 🎯 常见场景

| 场景 | 推荐文档 |
|------|---------|
| 快速上手 | [快速开始](./getting-started.md) |
| 配置系统 | [配置指南](./configuration.md) |
| 理解架构 | [系统架构](./architecture.md) |
| 使用记忆 | [记忆系统](./guide/memory-system.md) |
| 创建技能 | [技能系统](./guide/skill-system.md) |
| 飞书 Bot | [飞书集成](./guide/feishu-integration.md) |
| 生产部署 | [部署指南](./operations/deployment.md) |
| 遇到问题 | [故障排查](./troubleshooting/README.md) |
| 开发调试 | [CLAUDE.md](../CLAUDE.md) |

---

**最后更新**: 2026-04-05
**文档版本**: v2.1.4
