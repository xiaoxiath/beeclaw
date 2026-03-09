# Beeclaw

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

一个可进化的 AI 助手，支持 CLI 和飞书 Bot 两种使用方式。

## 特性

- **多 Provider 支持** — OpenAI、智谱 GLM、MiniMax、Anthropic
- **记忆系统** — 文件系统持久化，关键词索引，自动压缩
- **技能系统** — 可复用的技能模块，支持自动创建和进化
- **子代理系统** — 并行任务执行，DAG 任务编排，共享状态
- **插件系统** — OpenClaw 兼容层，22 个 Hook 点位
- **飞书集成** — WebSocket 长连接，无需公网 IP
- **主动系统** — 定时任务、主动聊天、通知推送
- **上下文管理** — Token 预算、Prompt 分层优先级、LLM 摘要压缩
- **弹性机制** — 熔断器、统一重试、跨进程文件锁
- **会话恢复** — 重启后自动恢复未回复的对话

## 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/xiaoxiath/beeclaw.git
cd beeclaw

# 安装依赖
bun install
```

### 配置

```bash
# 复制配置模板
cp .env.example .env

# 编辑 .env，填入 API Key
echo 'ZHIPU_API_KEY=your_key_here' >> .env
```

### 运行

```bash
# CLI 模式（交互式对话）
bun run cli

# 飞书 Bot 模式
bun run bot

# Bot + 后台守护进程（定时任务）
bun run bot --daemon

# PM2 生产部署
bun run pm2:start
```

## 使用方式

| 模式 | 命令 | 说明 |
|------|------|------|
| CLI | `bun run cli` | 交互式命令行 |
| CLI + Daemon | `bun run cli --daemon` | CLI + 后台调度 |
| Bot | `bun run bot` | 飞书机器人 |
| Bot + Daemon | `bun run bot --daemon` | 飞书机器人 + 后台调度 |
| PM2 | `bun run pm2:start` | 生产级进程管理 |

## 开发

```bash
# 运行测试
bun test

# 类型检查
bunx tsc --noEmit

# 代码检查
bun run lint
```

## 项目结构

```
beeclaw/
├── src/
│   ├── agent/           # Agent 核心（对话、上下文、工具调度）
│   ├── memory/          # 记忆系统
│   ├── skills/          # 技能存储和管理
│   ├── tools/           # 内置工具
│   ├── search/          # 搜索编排
│   ├── extraction/      # 知识提取和去重
│   ├── subagent/        # 子代理运行时
│   ├── plugins/         # 插件系统
│   ├── proactive/       # 主动系统（调度、通知）
│   ├── config/          # 配置加载和热更新
│   ├── session/         # 会话管理和恢复
│   ├── feishu/          # 飞书集成
│   ├── mcp/             # MCP 协议集成
│   ├── evolution/       # 自进化模块（实验性）
│   ├── goal/            # 目标追踪
│   ├── persona/         # 人格系统
│   └── utils/           # 工具函数（重试、熔断、日志）
├── skills/              # 内置技能集
├── docs/                # 文档体系
├── tests/               # 测试用例
└── plugins/             # 用户插件目录
```

## 文档

完整文档请查看 [docs/README.md](./docs/README.md)。

| 分类 | 文档 |
|------|------|
| **入门** | [快速开始](./docs/getting-started.md) · [配置指南](./docs/configuration.md) · [CLI 参考](./docs/cli-reference.md) |
| **用户指南** | [工具参考](./docs/tools-reference.md) · [记忆系统](./docs/guide/memory-system.md) · [技能系统](./docs/guide/skill-system.md) · [插件系统](./docs/guide/plugin-system.md) |
| **架构** | [系统架构](./docs/architecture.md) · [上下文管理](./docs/design/context-management.md) · [弹性设计](./docs/design/resilience.md) |
| **运维** | [PM2 部署](./docs/operations/deployment.md) · [性能优化](./docs/operations/performance.md) · [日志指南](./docs/operations/logging.md) |

## License

MIT
