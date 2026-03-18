# Beeclaw 文档

> 一个可进化的 AI 助手，支持 CLI 和飞书 Bot

**文档版本**: v3.0.0
**最后更新**: 2026-03-19

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
git clone https://github.com/your-repo/beeclaw.git
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

## 🔧 开发者指南

详细的开发指南请参考根目录的 [CLAUDE.md](../CLAUDE.md)，包含：

- 开发命令和测试
- 核心架构说明
- 代码规范和最佳实践
- 常见开发任务

---

## 📖 功能特性

- **记忆系统**: 文件系统记忆存储和智能检索
- **技能系统**: 可复用技能的创建、进化和管理
- **子代理系统**: 并行任务执行和 DAG 编排
- **插件系统**: OpenClaw 兼容插件和 Hook 机制
- **飞书集成**: 完整的飞书 Bot 支持
- **Web UI**: Web 管理界面

---

## 🎯 常见场景

| 场景 | 推荐文档 |
|------|---------|
| 快速上手 | [快速开始](./getting-started.md) |
| 配置系统 | [配置指南](./configuration.md) |
| 理解架构 | [系统架构](./architecture.md) |
| 开发调试 | [CLAUDE.md](../CLAUDE.md) |

---

**文档简化**: v3.0.0 将文档从 73 个精简至 5 个核心文档，提升查找效率。
