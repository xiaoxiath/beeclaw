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
- **飞书集成** — WebSocket 长连接，Card V2 流式消息
- **主动系统** — 定时任务、主动聊天、通知推送
- **上下文管理** — Token 预算、Prompt 分层优先级、LLM 摘要压缩
- **弹性机制** — 熔断器、统一重试、跨进程文件锁
- **会话恢复** — 重启后自动恢复未回复的对话
- **沙箱系统** — 安全的代码执行环境（进程隔离/容器隔离）
- **自进化系统** — LLM 驱动的自我反思和技能优化

## 最新亮点 ✨

### Card V2 流式消息 (2026-03-13)

飞书集成现在支持 **Card Schema 2.0**，提供更好的用户体验：

- **实时进度反馈** - 用户看到 agent 推理步骤实时更新
- **可折叠工具面板** - 工具调用显示在可展开/折叠的面板中
- **丰富的 Markdown 渲染** - 代码高亮、表格、列表正确显示
- **流式更新** - 卡片实时更新，无需等待完整响应

启用方式：在 `beeclaw.json` 中设置 `feishu.useCardV2: true`

### Evolution 自进化系统 (2026-03-13)

由 LLM 驱动的自我改进系统：

- **查询跟踪** - 记录用户查询，检测重复模式
- **智能建议** - 当检测到重复需求时，建议创建新技能
- **反思统计** - 跟踪技能失败，连续失败 3 次触发优化
- **LLM 驱动** - 通过 System Prompt 赋予 agent 自我进化能力

### 完整的 Feishu 工具集 (2026-03-13)

新增 **40+ Feishu 工具**，覆盖：

- **云文档** - 上传、下载、搜索、分享、移动、复制、重命名、删除
- **知识库** - 创建、搜索、获取、列出
- **日历** - 创建事件、搜索、列出日历
- **多维表格** - 创建记录、更新、搜索
- **文档** - 创建、获取、更新

详见 [飞书工具指南](./docs/feishu-tools-guide.md)

### Sandbox 沙箱系统 ✅

提供两种隔离级别的安全代码执行环境：

- **Local Provider** - 进程级隔离，适合开发测试
- **Docker Provider** - 容器级隔离，适合生产环境

详见下文 [Sandbox 沙箱系统](#sandbox-沙箱系统)

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
| **飞书集成** | [飞书工具指南](./docs/feishu-tools-guide.md) · [API 参考](./docs/api-reference.md) |
| **Web UI** | [开发指南](./docs/web-development.md) · [功能文档](./docs/webui.md) · [认证配置](./docs/webui-auth.md) |
| **架构** | [系统架构](./docs/architecture.md) · [上下文管理](./docs/design/context-management.md) · [弹性设计](./docs/design/resilience.md) |
| **运维** | [PM2 部署](./docs/operations/deployment.md) · [性能优化](./docs/operations/performance.md) · [日志指南](./docs/operations/logging.md) |
| **最新进展** | [任务完成报告](./docs/all-tasks-completed-2026-03-13.md) · [TODO 列表](./docs/TODO.md) |

## License

MIT

## Sandbox 沙箱系统

**状态**: ✅ 生产就绪 - Local 和 Docker Provider 都已实现

Beeclaw 提供安全的代码执行沙箱环境，支持两种隔离级别：

### Local Provider (进程隔离)

- **进程隔离**: 使用 Bun subprocess API
- **命令过滤**: 阻止危险命令（rm -rf /, fork bombs 等）
- **资源限制**: 超时控制、输出大小限制
- **文件系统隔离**: 每个沙箱独立工作目录
- **安全特性**: 可配置的命令黑名单/白名单
- **适用场景**: 开发、测试、受信任的代码执行

### Docker Provider (容器隔离)

- **容器隔离**: 使用 Docker 容器
- **资源限制**: CPU 限制、内存限制
- **网络隔离**: 可禁用网络访问
- **安全增强**: 能力降级、无新权限标志
- **卷挂载**: 工作目录自动挂载到容器
- **适用场景**: 生产环境、不受信任的代码执行

### 快速开始

```typescript
import { SandboxManager } from './domain/sandbox';

const manager = SandboxManager.getInstance();
await manager.initialize({
  enabled: true,
  provider: 'local', // 或 'docker'
  workspaceBase: './data/sandbox',
  local: {
    enabled: true,
    defaultTimeout: 30000,
    maxOutputSize: 1048576,
    blockedCommands: ['rm\\s+-rf\\s+/', 'mkfs']
  },
  docker: {
    enabled: true,
    image: 'alpine:latest',
    memoryLimitMb: 512,
    cpuLimit: 1.0,
    networkEnabled: false
  }
});

// 创建沙箱
const sandbox = await manager.acquire({ sessionId: 'test' });

// 执行命令
const result = await sandbox.exec('echo "Hello World"');

// 文件操作
await sandbox.writeFile('test.txt', 'content');
const content = await sandbox.readFile('test.txt');

// 销毁沙箱
await manager.release(sandbox.id);
```

### 配置示例

#### 本地模式（开发）

```json
{
  "sandbox": {
    "enabled": true,
    "provider": "local",
    "workspaceBase": "./data/sandbox",
    "local": {
      "enabled": true,
      "defaultTimeout": 30000,
      "maxOutputSize": 1048576,
      "blockedCommands": [
        "rm\\s+-rf\\s+/",
        "mkfs",
        "dd\\s+if=",
        ":(){ :|:& };:"
      ]
    }
  }
}
```

#### Docker 模式（生产）

```bash
# 构建镜像
docker build -t beeclaw-sandbox:latest -f src/sandbox/image/Dockerfile .
```

```json
{
  "sandbox": {
    "enabled": true,
    "provider": "docker",
    "docker": {
      "enabled": true,
      "image": "beeclaw-sandbox:latest",
      "memoryLimitMb": 512,
      "cpuLimit": 1.0,
      "networkEnabled": false
    }
  }
}
```

### 可用工具

- `sandbox_exec` - 在沙箱中执行命令
- `sandbox_write_file` - 写入文件
- `sandbox_read_file` - 读取文件
- `sandbox_list_files` - 列出文件
- `sandbox_status` - 沙箱状态

### 测试

```bash
# Local Provider 测试（39 个测试）
bun test src/domain/sandbox/__tests__/local-provider.test.ts

# Docker Provider 测试（需要 Docker 运行）
DOCKER_AVAILABLE=true bun test src/domain/sandbox/__tests__/docker-provider.test.ts
```

**测试覆盖**:
- Local Provider: 39 个测试，全部通过 ✅
- Docker Provider: 集成测试（需要 Docker daemon）

### 安全建议

| Provider | 安全等级 | 适用场景 |
|----------|---------|---------|
| Local | ⚠️ 进程级隔离 | 开发、测试、受信任的代码 |
| Docker | ✅ 容器级隔离 | 生产环境、不受信任的代码 |

### 更多信息

详见 [src/sandbox/README.md](./src/sandbox/README.md) 和 [src/sandbox/DOCKER.md](./src/sandbox/DOCKER.md)

---

## 项目状态

**最新更新**: 2026-03-13

- ✅ TODO 完成率: **87%** (20/23 任务)
- ✅ 测试覆盖: **99%+**
- ✅ 文档完善: **1,600+ 行**新文档
- ✅ 代码质量: 优秀

详见 [任务完成报告](./docs/all-tasks-completed-2026-03-13.md)

---

## License

MIT
