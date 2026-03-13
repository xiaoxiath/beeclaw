# Beeclaw

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue?logo=typescript)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/xiaoxiath/beeclaw/pulls)

**一个可进化的 AI 助手** - 支持 CLI、飞书 Bot 和 Web UI 三种使用方式，具备记忆、技能、自进化能力。

## ✨ 核心特性

### AI 能力
- **多 Provider 支持** — OpenAI、智谱 GLM、MiniMax、Anthropic
- **上下文管理** — Token 预算、Prompt 分层优先级、LLM 摘要压缩
- **会话恢复** — 重启后自动恢复未回复的对话

### 记忆与技能
- **记忆系统** — 文件系统持久化，关键词索引，自动压缩
- **技能系统** — 可复用的技能模块，支持自动创建和进化
- **自进化系统** — LLM 驱动的自我反思和技能优化

### 多端支持
- **CLI 模式** — 交互式命令行界面
- **飞书 Bot** — WebSocket 长连接，Card V2 流式消息
- **Web UI** — React + Hono 现代化界面

### 企业级特性
- **插件系统** — OpenClaw 兼容层，25+ Hook 点位
- **沙箱系统** — 安全的代码执行环境（进程隔离/容器隔离）
- **主动系统** — 定时任务、主动聊天、通知推送
- **子代理系统** — 并行任务执行，DAG 任务编排
- **弹性机制** — 熔断器、统一重试、跨进程文件锁

## 🚀 快速开始

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

# Web UI
bun run build:web && bun run bot

# PM2 生产部署
bun run pm2:start
```

<details>
<summary>📖 查看所有运行模式</summary>

| 模式 | 命令 | 说明 |
|------|------|------|
| CLI | `bun run cli` | 交互式命令行 |
| CLI + Daemon | `bun run cli --daemon` | CLI + 后台调度 |
| Bot | `bun run bot` | 飞书机器人 |
| Bot + Daemon | `bun run bot --daemon` | 飞书机器人 + 后台调度 |
| Web UI | `bun run build:web && bun run bot` | Web 界面（需先构建） |
| PM2 | `bun run pm2:start` | 生产级进程管理 |

</details>

## 📖 文档

完整文档请查看 [docs/README.md](./docs/README.md)。

| 分类 | 文档 |
|------|------|
| **入门** | [快速开始](./docs/getting-started.md) · [配置指南](./docs/configuration.md) · [CLI 参考](./docs/cli-reference.md) |
| **用户指南** | [工具参考](./docs/tools-reference.md) · [记忆系统](./docs/guide/memory-system.md) · [技能系统](./docs/guide/skill-system.md) |
| **飞书集成** | [飞书工具指南](./docs/feishu-tools-guide.md) · [API 参考](./docs/api-reference.md) |
| **Web UI** | [开发指南](./docs/web-development.md) · [功能文档](./docs/webui.md) |
| **架构** | [系统架构](./docs/architecture.md) · [上下文管理](./docs/design/context-management.md) · [弹性设计](./docs/design/resilience.md) |
| **运维** | [PM2 部署](./docs/operations/deployment.md) · [性能优化](./docs/operations/performance.md) |
| **最新进展** | [任务完成报告](./docs/all-tasks-completed-2026-03-13.md) · [TODO 列表](./docs/TODO.md) |

## 🏗️ 架构

```
beeclaw/
├── src/
│   ├── agent/           # Agent 核心（对话、上下文、工具调度）
│   ├── memory/          # 记忆系统
│   ├── skills/          # 技能存储和管理
│   ├── tools/           # 内置工具
│   ├── plugins/         # 插件系统（OpenClaw 兼容）
│   ├── feishu/          # 飞书集成（Card V2、流式消息）
│   ├── web/             # Web UI（React + Hono）
│   ├── evolution/       # 自进化模块
│   ├── sandbox/         # 沙箱系统
│   ├── proactive/       # 主动系统（调度、通知）
│   └── ...              # 其他模块
├── skills/              # 内置技能集
├── docs/                # 完整文档
└── tests/               # 测试用例
```

详见 [项目结构说明](./docs/architecture.md)。

## 🔧 开发

```bash
# 运行测试
bun test

# 类型检查
bunx tsc --noEmit

# 代码检查
bun run lint

# 构建 Web UI
bun run build:web

# Web UI 开发模式
bun run dev:web
```

## 🛡️ Sandbox 沙箱系统

Beeclaw 提供安全的代码执行沙箱环境：

| Provider | 隔离级别 | 适用场景 |
|----------|---------|---------|
| **Local** | 进程隔离 | 开发、测试、受信任的代码 |
| **Docker** | 容器隔离 | 生产环境、不受信任的代码 |

**核心特性**:
- ✅ 命令过滤（阻止危险命令）
- ✅ 资源限制（CPU、内存、超时）
- ✅ 文件系统隔离
- ✅ 网络隔离（Docker 模式）

**快速使用**:

```typescript
import { SandboxManager } from './domain/sandbox';

const manager = SandboxManager.getInstance();
const sandbox = await manager.acquire({ sessionId: 'test' });
await sandbox.exec('echo "Hello World"');
await manager.release(sandbox.id);
```

详见 [Sandbox 文档](./src/domain/sandbox/README.md) · [Docker 配置](./src/domain/sandbox/DOCKER.md)

## 📊 项目状态

**最新更新**: 2026-03-13

| 指标 | 状态 |
|------|------|
| **TODO 完成率** | 87% (20/23 任务) |
| **测试覆盖** | 99%+ |
| **文档完善** | 1,600+ 行新文档 |
| **代码质量** | 优秀 |

详见 [任务完成报告](./docs/all-tasks-completed-2026-03-13.md)

## 🤝 贡献

我们欢迎所有形式的贡献！

### 贡献方式

- 🐛 提交 Bug 报告或功能建议（[Issues](https://github.com/xiaoxiath/beeclaw/issues)）
- 📝 改进文档
- 🔧 提交代码修复或新功能（[Pull Requests](https://github.com/xiaoxiath/beeclaw/pulls)）
- 💬 参与讨论

### 开发流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交改动 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

## 📄 License

本项目基于 [MIT](./LICENSE) 许可证开源。

---

**Made with ❤️ by the Beeclaw Team**
