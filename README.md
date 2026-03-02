# Beeclaw

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

一个可进化的 AI 助手，支持 CLI 和飞书 Bot 两种使用方式。

## 特性

- **多 Provider 支持** - OpenAI、智谱 GLM、MiniMax、Anthropic
- **记忆系统** - 持久化存储，自动压缩，智能检索
- **技能系统** - 可复用的技能模块，支持自动创建和优化
- **子代理系统** - 并行任务执行，DAG 任务编排
- **飞书集成** - WebSocket 长连接，无需公网 IP
- **自我进化** - 从对话中学习偏好和技能

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

创建 `beeclaw.json`（参考 `beeclaw.example.json`）：

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["glm-4"],
      "default": true
    }
  ]
}
```

设置环境变量：

```bash
export ZHIPU_API_KEY=your-key-here
```

### 运行

```bash
# CLI 模式
bun run cli

# Bot 模式（飞书）
bun run bot

# Bot 模式 + Daemon（支持定时任务）
bun run bot --daemon

# 使用 PM2 管理（推荐生产环境）
bun run pm2:start
```

### 定时任务（Daemon 模式）

Beeclaw 支持定时任务功能，包括：
- 每日内存压缩（凌晨 3 点）
- 目标进度检查
- 自定义提醒和任务

启用方式：
```bash
# 方式 1: 直接启动（带 daemon）
bun run bot --daemon

# 方式 2: 使用 PM2（推荐）
bun run pm2:start
```

详细说明请查看：
- [PM2 Daemon 模式快速参考](./docs/pm2-quick-reference.md)
- [PM2 Daemon 模式详细指南](./docs/pm2-daemon-guide.md)

## CLI 命令

```
/help              显示帮助
/quit              退出
/clear             清除对话历史
/model list        列出可用模型
/model switch      切换模型

# 记忆管理
/memory ls         列出记忆目录
/memory grep       搜索记忆
/memory record     记录事实

# 目标管理
/goal              列出所有目标
/goal create       创建新目标
/goal update       更新目标状态

# 技能管理
/skill list        列出所有技能
/skill get         获取技能详情
```

## 文档

| 文档 | 描述 |
|------|------|
| [快速开始](./docs/getting-started.md) | 详细安装和配置指南 |
| [CLI 参考](./docs/cli-reference.md) | CLI 命令详解 |
| [系统架构](./ARCHITECTURE.md) | 核心系统设计 |
| [飞书集成](./docs/feishu-integration.md) | 飞书 Bot 配置 |
| [配置指南](./docs/configuration.md) | 完整配置参考 |
| [PM2 Daemon 快速参考](./docs/pm2-quick-reference.md) | PM2 管理定时任务（快速参考） |
| [PM2 Daemon 详细指南](./docs/pm2-daemon-guide.md) | PM2 管理定时任务（详细版） |

## 项目结构

```
src/
├── cli.ts            # CLI 入口
├── bot.ts            # 飞书 Bot 入口
├── agent/            # AI Agent 核心
├── subagent/         # 子代理系统
├── session/          # 会话管理
├── memory/           # 记忆系统
├── skills/           # 技能系统
├── goal/             # 目标系统
└── feishu/           # 飞书集成

data/memory/          # 记忆存储
skills/               # 技能定义
docs/                 # 文档
```

## License

MIT
