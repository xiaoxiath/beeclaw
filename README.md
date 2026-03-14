# Beeclaw

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue?logo=typescript)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/xiaoxiath/beeclaw/pulls)

**一个可进化的 AI 助手** - 支持 CLI、飞书 Bot 和 Web UI，具备记忆、技能、自进化能力。

## ✨ 核心特性

### 🤖 AI 能力
- **多 Provider** — OpenAI、智谱 GLM、MiniMax、Anthropic
- **智能上下文** — Token 预算、分层优先级、自动压缩
- **会话恢复** — 重启后自动恢复未完成对话

### 🧠 记忆与技能
- **记忆系统** — 文件系统持久化，关键词索引，零 Embedding 成本
- **技能系统** — 可复用提示词模块，支持自动创建和进化
- **自进化** — LLM 驱动的自我反思和技能优化

### 🚀 多端支持
- **CLI 模式** — 交互式命令行，支持斜杠命令
- **飞书 Bot** — WebSocket 长连接，Card V2 流式消息
- **Web UI** — React + Hono 现代化界面

### 🏢 企业级特性
- **插件系统** — OpenClaw 兼容，25+ Hook 点位
- **沙箱执行** — 进程/容器隔离，安全代码执行
- **主动系统** — 定时任务、主动聊天、通知推送
- **子代理** — 并行任务执行，DAG 任务编排
- **弹性机制** — 熔断器、统一重试、跨进程文件锁

## 🚀 5 分钟快速开始

```bash
# 1. 安装
git clone https://github.com/xiaoxiath/beeclaw.git
cd beeclaw && bun install

# 2. 配置（选择一种方式）
cp .env.example .env && echo 'ZHIPU_API_KEY=your_key' >> .env

# 3. 运行
bun run cli        # CLI 模式
# 或
bun run bot        # 飞书 Bot 模式
```

**→ [完整安装和配置指南](./docs/getting-started.md)**

## 📖 文档

| 新手入门 | 进阶使用 | 架构设计 | 运维部署 |
|---------|---------|---------|---------|
| [学习路径](./docs/learning-paths.md) | [工具参考](./docs/references/tools.md) | [系统架构](./docs/architecture.md) | [PM2 部署](./docs/operations/deployment.md) |
| [快速开始](./docs/getting-started.md) | [记忆系统](./docs/guide/memory-system.md) | [上下文管理](./docs/design/context-management.md) | [性能优化](./docs/operations/performance.md) |
| [配置指南](./docs/configuration.md) | [技能系统](./docs/guide/skill-system.md) | [弹性设计](./docs/design/resilience.md) | [日志指南](./docs/operations/logging.md) |

**→ [完整文档目录](./docs/README.md)** · **[实战案例库](./docs/cookbook/)** · **[故障排查](./docs/troubleshooting/)**

## 🎯 选择你的路径

| 你的角色 | 推荐起点 |
|---------|---------|
| **初次使用者** | [5 分钟快速开始](./docs/getting-started.md) |
| **运维工程师** | [PM2 部署指南](./docs/operations/deployment.md) |
| **开发者** | [开发指南](./CLAUDE.md) |
| **飞书 Bot 用户** | [飞书集成](./docs/guide/feishu-integration.md) |

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────┐
│            Orchestrator Agent                    │
│      (主代理 - 任务分解、调度、聚合)               │
└────────────────┬────────────────────────────────┘
                 │
    ┌────────────┼────────────┬────────────┐
    ▼            ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
│Research│  │ Memory │  │ Skill  │  │  Code  │
│Subagent│  │Subagent│  │Subagent│  │Subagent│
└────────┘  └────────┘  └────────┘  └────────┘
    │            │            │            │
    └────────────┴────────────┴────────────┘
                      │
                      ▼
            ┌──────────────────┐
            │  Shared State    │
            │  (任务状态/结果)  │
            └──────────────────┘
```

**→ [详细架构设计](./docs/architecture.md)**

## 🔧 开发

```bash
bun test              # 运行测试
bunx tsc --noEmit     # 类型检查
bun run lint          # 代码检查
bun run build:web     # 构建 Web UI
```

**→ [开发指南](./CLAUDE.md)**

## 📊 项目状态

**版本**: v1.3.0+ | **测试覆盖**: 99%+ | **文档**: 1,600+ 行

**→ [任务完成报告](./docs/all-tasks-completed-2026-03-13.md)**

## 🤝 贡献

我们欢迎所有形式的贡献！

- 🐛 提交 Bug 报告或功能建议（[Issues](https://github.com/xiaoxiath/beeclaw/issues)）
- 📝 改进文档
- 🔧 提交代码修复或新功能（[Pull Requests](https://github.com/xiaoxiath/beeclaw/pulls)）

**→ [贡献指南](./CONTRIBUTING.md)**

## 📄 License

本项目基于 [MIT](./LICENSE) 许可证开源。

---

**Made with ❤️ by the Beeclaw Team**
