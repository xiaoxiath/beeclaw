# Beeclaw

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

一个可进化的 AI 助手，支持 CLI、飞书 Bot 和 Web UI 三种使用方式。

## 特性

- **多 Provider 支持** — OpenAI、智谱 GLM、MiniMax、Anthropic
- **多端支持** — CLI 命令行、飞书机器人、Web UI 界面
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

# 构建 Web UI
bun run build:web

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
| Web UI | `bun run build:web && bun run bot` | Web 界面（需先构建） |
| PM2 | `bun run pm2:start` | 生产级进程管理 |

## 开发

```bash
# 运行测试
bun test

# 类型检查
bunx tsc --noEmit

# 代码检查
bun run lint

# 构建 Web UI
bun run build:web

# Web UI 开发模式（监听变化）
bun run dev:web
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
│   ├── web/             # Web UI（React + Hono）
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
| **Web UI** | [开发指南](./docs/web-development.md) · [功能文档](./docs/webui.md) · [认证配置](./docs/webui-auth.md) |
| **架构** | [系统架构](./docs/architecture.md) · [上下文管理](./docs/design/context-management.md) · [弹性设计](./docs/design/resilience.md) |
| **运维** | [PM2 部署](./docs/operations/deployment.md) · [性能优化](./docs/operations/performance.md) · [日志指南](./docs/operations/logging.md) |

## License

MIT

## Sandbox 沙箱系统 ⚠️ 实验性功能

**状态**: 🧪 实验性 - 尚未完全实现

Beeclaw 提供安全的代码执行沙箱环境，支持本地进程隔离和 Docker 容器隔离两种模式。

### ⚠️ 重要提示

**当前状态**:
- ✅ 架构设计和配置已完成
- ⚠️ Local Provider 和 Docker Provider **尚未实现**（存根代码）
- ⚠️ 使用时会抛出错误

**建议**: 在配置文件中**禁用沙箱功能**：

```json
{
  "sandbox": {
    "enabled": false
  }
}
```

### 计划特性
- **多种隔离级别**: 本地进程（开发）、Docker 容器（生产）
- **安全保护**: 命令黑名单、路径遍历检测、资源限制
- **虚拟路径**: 真实路径映射，防止路径泄露
- **容器池**: 预热容器，减少冷启动延迟

### 当前状态

详见 [Sandbox 实验性功能文档](./docs/experimental/sandbox-system.md)

###

#### 本地模式（开发)
```json
{
  "sandbox": {
    "enabled": true,
    "provider": "local",
    "workspaceBase": "./data/sandbox"
  }
}
```

#### Docker 模式（生产）
```bash
# 构建镜像
docker build -t beeclaw-sandbox:latest -f src/sandbox/image/Dockerfile .

# 配置
```json
{
  "sandbox": {
    "enabled": true,
    "provider": "docker",
    "docker": {
      "enabled": true,
      "image": "beeclaw-sandbox:latest"
    }
  }
}
```

### 已具列表
- `sandbox_exec` - 在沙箱中执行命令
- `sandbox_write_file` - 写入文件
- `sandbox_read_file` - 读取文件
- `sandbox_list_files` - 列出文件
- `sandbox_status` - 沙箱状态

### 更多信息
详见 [src/sandbox/README.md](./src/sandbox/README.md) 和 [src/sandbox/DOCKER.md](./src/sandbox/DOCKER.md)
