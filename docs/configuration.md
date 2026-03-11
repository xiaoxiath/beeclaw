# Beeclaw 配置指南

本文档涵盖 Beeclaw 的所有配置方式，包括环境变量、配置文件和用户偏好设置。

---

## 快速开始（30 秒）

```bash
# 1. 复制配置模板
cp .env.example .env

# 2. 编辑 .env，填入 API Key
echo 'ZHIPU_API_KEY=your_key_here' >> .env

# 3. 启动
bun run cli
```

---

## 配置方式

| 方式 | 难度 | 灵活性 | 推荐场景 |
|------|------|--------|----------|
| 环境变量 | ⭐ | 中等 | 快速测试、单一 Provider |
| 配置文件 | ⭐⭐ | 高 | 多 Provider、多 Agent |
| 混合使用 | ⭐⭐⭐ | 最高 | 生产环境 |

---

## 方式 1：环境变量

### AI Provider

```bash
# 智谱 GLM（推荐国内用户）
ZHIPU_API_KEY=your_key_here

# OpenAI
OPENAI_API_KEY=your_key_here
OPENAI_BASE_URL=https://api.openai.com/v1   # 可选，自定义 endpoint

# Anthropic
ANTHROPIC_API_KEY=your_key_here

# MiniMax
MINIMAX_API_KEY=your_key_here
MINIMAX_GROUP_ID=your_group_id
```

### 飞书 Bot

```bash
LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
LARK_BEECLAW_AS="your-app-secret"
```

### 可选配置

```bash
# 模型选择
BEECLAW_MODEL=glm-4                  # 默认模型
BEECLAW_TEMPERATURE=0.7              # 温度参数

# 网络搜索
TAVILY_API_KEY=your_key_here         # Tavily 搜索
SERPER_API_KEY=your_key_here         # Serper 搜索
JINA_API_KEY=your_key_here           # Jina AI 网页抓取

# 数据目录
BEECLAW_DATA_DIR=./data              # 数据存储位置
```

---

## 方式 2：配置文件

### 文件结构

```
beeclaw.json                          # 主配置文件
├── providers[]                       # AI 提供商列表
├── agents[]                          # Agent 定义
├── mcp{}                             # MCP 服务器配置
├── proactive{}                       # 主动系统配置
├── session{}                         # 会话配置
├── subagent{}                        # 子代理配置
└── user{}                            # 用户配置
```

### 完整配置示例

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
      "tools": ["memory_*", "goal_*", "skill_*", "persona_*"],
      "temperature": 0.7,
      "maxTokens": 4096
    }
  ],
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
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
    "checkInterval": 60000,
    "daemon": {
      "enabled": true,
      "schedules": []
    }
  }
}
```

### 环境变量插值

配置文件中支持 `${ENV_VAR}` 语法引用环境变量：

```json
{
  "apiKey": "${ZHIPU_API_KEY}"
}
```

运行时会自动替换为对应的环境变量值。

---

## 用户配置

### user 配置段

`user` 配置段用于个性化用户体验，包括时区、位置和语言。

```json
{
  "user": {
    "location": "北京",
    "timezone": "Asia/Shanghai",
    "locale": "zh-CN"
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `location` | string | - | 地理位置，用于天气查询和本地化搜索 |
| `timezone` | string | 系统时区 | IANA 时区标识（如 `Asia/Shanghai`） |
| `locale` | string | `zh-CN` | 语言环境 |

### 影响范围

- **天气工具**：基于 `location` 自动查询当地天气
- **时间感知**：系统提示词中的当前时间使用 `timezone`
- **搜索优化**：`location` 影响搜索结果的区域偏好
- **日期格式**：`locale` 决定日期、数字的显示格式

---

## 配置热加载

Beeclaw 支持配置文件的热加载，修改 `beeclaw.json` 后无需重启：

- 文件变更自动检测（基于 fs.watch）
- 200ms 防抖避免频繁重载
- 变更 diff 通知（新增/删除/修改的字段）
- 日志记录所有配置变更

> **注意**：Provider 相关的配置变更需要重启才能生效。

---

## 相关文档

- [快速开始](./getting-started.md) — 安装和首次运行
- [CLI 参考](./references/cli.md) — 命令行使用详解
- [飞书集成](./guide/feishu-integration.md) — 飞书 Bot 配置
- [部署指南](./operations/deployment.md) — PM2 生产部署
