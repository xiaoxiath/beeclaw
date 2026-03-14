# 快速开始

> 本指南将帮助你在几分钟内启动 Beeclaw。如需 30 秒极速上手，请查看 [README](../README.md)。

## 目录

- [前置要求](#前置要求)
- [安装步骤](#安装步骤)
- [配置方式](#配置方式)
- [运行模式](#运行模式)
- [CLI 基本使用](#cli-基本使用)
- [故障排除](#故障排除)
- [下一步](#下一步)

---

## 前置要求

| 依赖 | 版本要求 | 检查命令 |
|------|---------|---------|
| **Bun** | >= 1.0.0 | `bun --version` |
| **API Key** | 智谱 GLM / OpenAI / 其他 | - |

### 安装 Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# 或使用 npm
npm install -g bun
```

---

## 安装步骤

### 1. 克隆仓库

```bash
git clone https://github.com/xiaoxiath/beeclaw.git
cd beeclaw
```

### 2. 安装依赖

```bash
bun install
```

<details>
<summary>🔍 遇到依赖问题？</summary>

```bash
# 清理并重新安装
rm -rf node_modules bun.lock
bun install

# 如果仍有问题，检查 Bun 版本
bun --version  # 应该 >= 1.0.0
```

</details>

### 3. 配置环境

```bash
# 复制示例配置
cp .env.example .env

# 编辑 .env 文件
nano .env  # 或使用你喜欢的编辑器
```

**最少配置**（使用智谱 GLM）：
```bash
ZHIPU_API_KEY=your_key_here
```

<details>
<summary>📖 如何获取 API Key？</summary>

| Provider | 获取方式 | 费用 |
|----------|---------|------|
| **智谱 GLM** | [开放平台](https://open.bigmodel.cn/) | 新用户送 100 万 tokens |
| **OpenAI** | [Platform](https://platform.openai.com/) | 按 token 计费 |
| **Anthropic** | [Console](https://console.anthropic.com/) | 按 token 计费 |
| **MiniMax** | [开放平台](https://www.minimaxi.com/) | 新用户送 tokens |

</details>

---

## 配置方式

### 方式 1：环境变量（推荐新手）

**适用场景**：单一 Provider、快速测试

```bash
# 智谱 GLM（推荐国内用户）
export ZHIPU_API_KEY="eyJhbGc..."

# OpenAI
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.openai.com/v1"  # 可选

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# MiniMax
export MINIMAX_API_KEY="..."
export MINIMAX_GROUP_ID="..."
```

### 方式 2：配置文件（推荐进阶用户）

**适用场景**：多 Provider、多 Agent、复杂配置

```bash
# 复制配置模板
cp beeclaw.example.json beeclaw.json
```

编辑 `beeclaw.json`：

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["glm-4", "glm-5"],
      "default": true
    },
    {
      "name": "openai",
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",
      "baseUrl": "https://api.openai.com/v1",
      "models": ["gpt-4o", "gpt-4o-mini"]
    }
  ],
  "agents": [
    {
      "id": "beeclaw",
      "name": "Beeclaw Assistant",
      "provider": "zhipu",
      "model": "glm-4",
      "systemPrompt": "You are Beeclaw, a helpful AI assistant.",
      "tools": ["memory_*", "goal_*", "skill_*"],
      "temperature": 0.7,
      "maxTokens": 4096
    }
  ]
}
```

**配置说明**：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `providers[].name` | Provider 标识符 | - |
| `providers[].apiKey` | 支持 `${ENV_VAR}` 插值 | - |
| `providers[].default` | 是否为默认 Provider | false |
| `agents[].tools` | 启用的工具（支持通配符 `*`） | [] |
| `agents[].temperature` | 生成温度 (0-2) | 0.7 |

<details>
<summary>🔧 高级配置选项</summary>

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
      }
    }
  },
  "session": {
    "timeout": 120000,
    "compressionThreshold": 20,
    "retention": "90d"
  },
  "subagent": {
    "defaultTimeout": 180000,
    "maxParallelism": 3,
    "maxRetries": 2
  },
  "proactive": {
    "enabled": true,
    "checkInterval": 60000
  }
}
```

详见 [配置指南](./configuration.md)

</details>

### 方式 3：混合使用

环境变量 + 配置文件组合，配置文件中引用环境变量：

```json
{
  "providers": [{
    "apiKey": "${ZHIPU_API_KEY}"  // 从环境变量读取
  }]
}
```

---

## 运行模式

Beeclaw 支持多种运行模式，适应不同使用场景。

### CLI 模式

**适用场景**：个人使用、开发调试

```bash
# 基础模式
bun run cli

# 禁用工具调用（纯聊天）
bun run cli --no-tools

# 启用后台守护进程（定时任务）
bun run cli --daemon
```

**特性**：
- ✅ 交互式命令行界面
- ✅ 斜杠命令支持
- ✅ 多行输入自动检测
- ✅ 彩色输出和进度显示

### 飞书 Bot 模式

**适用场景**：团队协作、企业使用

```bash
# 设置飞书凭证
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="your-app-secret"

# 启动 Bot
bun run bot

# Bot + 后台守护进程
bun run bot --daemon
```

**特性**：
- ✅ WebSocket 长连接
- ✅ Card V2 流式消息
- ✅ 多人群聊支持
- ✅ 主动推送通知

<details>
<summary>📖 飞书 Bot 配置详解</summary>

详见 [飞书集成指南](./guide/feishu-integration.md)

**快速步骤**：
1. 创建飞书应用：[开放平台](https://open.feishu.cn/app)
2. 获取 App ID 和 App Secret
3. 配置事件订阅（消息接收）
4. 启动 Bot：`bun run bot`

</details>

### Web UI 模式

**适用场景**：可视化界面、非技术用户

```bash
# 构建 Web UI
bun run build:web

# 启动服务（同时提供 API）
bun run bot

# 访问 http://localhost:3000
```

**开发模式**（热重载）：
```bash
bun run dev:web
```

### PM2 生产部署

**适用场景**：生产环境、高可用

```bash
# 启动
bun run pm2:start

# 查看日志
bun run pm2:logs

# 重启
bun run pm2:restart

# 停止
bun run pm2:stop
```

<details>
<summary>🔧 PM2 配置详解</summary>

详见 [PM2 部署指南](./operations/deployment.md)

**自动功能**：
- 进程守护（崩溃自动重启）
- 日志轮转
- 内存监控
- 多实例负载均衡

</details>

---

## CLI 基本使用

### 常用命令

```bash
# 帮助
> /help

# 模型管理
> /model list                  # 列出可用模型
> /model switch zhipu glm-4    # 切换模型

# 记忆管理
> /memory ls                   # 列出记忆目录
> /memory search 投资          # 搜索记忆
> /memory record user 我喜欢简洁的代码  # 记录事实

# 目标管理
> /goal create 学习新技能      # 创建目标
> /goal list                   # 查看目标列表

# 技能管理
> /skill list                  # 列出技能
> /skill get coding            # 查看技能详情

# 其他
> /quit                        # 退出
> /clear                       # 清屏
```

### 多行输入

当粘贴大量内容时，CLI 会自动检测并显示摘要：

```
> [粘贴 1000+ 行代码]

📋 检测到多行输入 (1234 行)
   首行: const express = require('express');
   末行: app.listen(3000);

是否继续？(y/n)
```

### 会话管理

CLI 会话自动持久化到 `data/sessions/`，重启后可恢复：

```bash
# 查看会话文件
ls data/sessions/
# cli-default-user-1709020800000.json

# 恢复会话（自动）
bun run cli  # 会自动恢复未完成的对话
```

---

## 故障排除

### API Key 无效

**症状**：
```
Error: Invalid API key
  at ZhipuClient.request (...)
```

**诊断**：
```bash
# 检查环境变量
echo $ZHIPU_API_KEY

# 验证 Key 格式
# 智谱: 以 eyJ 开头
# OpenAI: 以 sk- 开头
```

**解决**：
1. 重新生成 API Key
2. 确保 `.env` 文件无多余空格
3. 重启终端使环境变量生效

### 依赖安装失败

**症状**：
```
error: Failed to install dependencies
```

**解决**：
```bash
# 清理缓存
rm -rf node_modules bun.lock

# 重新安装
bun install

# 如果仍有问题，升级 Bun
bun upgrade
```

### 飞书连接失败

**症状**：
```
Error: WebSocket connection failed
```

**诊断**：
1. 检查 App ID 和 App Secret 是否正确
2. 确保应用已发布并可用
3. 检查网络是否能访问 `open.feishu.cn`

**解决**：
```bash
# 验证凭证
echo $LARK_BEECLAW_APPID
echo $LARK_BEECLAW_AS

# 测试网络
curl -I https://open.feishu.cn

# 查看详细日志
bun run bot 2>&1 | tee bot.log
```

### 端口被占用

**症状**：
```
Error: Port 3000 is already in use
```

**解决**：
```bash
# 查找占用端口的进程
lsof -i :3000

# 杀死进程
kill -9 <PID>

# 或使用其他端口
PORT=3001 bun run bot
```

<details>
<summary>📖 更多故障排查</summary>

详见 [故障排查手册](./troubleshooting/)

- [启动问题](./troubleshooting/startup-issues.md)
- [记忆系统问题](./troubleshooting/memory-issues.md)
- [飞书集成问题](./troubleshooting/feishu-issues.md)
- [性能问题](./troubleshooting/performance-issues.md)
- [错误代码参考](./troubleshooting/error-codes.md)

</details>

---

## 下一步

### 📚 深入学习

- **[学习路径](./learning-paths.md)** - 系统化学习指南
- **[配置指南](./configuration.md)** - 完整配置选项
- **[工具参考](./references/tools.md)** - 所有内置工具

### 🎯 实战练习

- **[创建第一个技能](./cookbook/basic/first-skill.md)**
- **[记忆管理工作流](./cookbook/basic/memory-workflow.md)**
- **[深度研究任务](./cookbook/basic/research-task.md)**

### 🏗️ 架构理解

- **[系统架构](./architecture.md)** - 核心设计理念
- **[记忆系统](./guide/memory-system.md)** - 记忆存储设计
- **[上下文管理](./design/context-management.md)** - Token 管理

### 🚀 生产部署

- **[PM2 部署](./operations/deployment.md)** - 生产环境部署
- **[性能优化](./operations/performance.md)** - 性能调优
- **[日志指南](./operations/logging.md)** - 日志排查

---

## 相关文档

- [配置指南](./configuration.md) - 详细配置选项
- [CLI 参考](./references/cli.md) - 命令行详解
- [飞书集成](./guide/feishu-integration.md) - Bot 配置
- [故障排查](./troubleshooting/) - 问题诊断
