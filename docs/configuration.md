# Beeclaw 配置指南

> **最新版本**: v6
> **配置文档**: [CONFIGURATION-FINAL.md](./CONFIGURATION-FINAL.md)

本文档涵盖 Beeclaw 的所有配置方式，包括环境变量、配置文件和用户偏好设置。

---

## 快速开始（30 秒）

```bash
# 1. 复制配置模板
cp beeclaw.example.json beeclaw.json

# 2. 设置环境变量
export ZHIPU_API_KEY=your_key_here

# 3. 启动
bun run cli
```

**→ [完整配置示例](../beeclaw.example.json)** · **[v6 配置详解](./CONFIGURATION-FINAL.md)**

---

## v6 配置系统

Beeclaw v6 采用简化的配置结构：

```
providers  → 提供 API 访问和模型信息
roles      → 定义模型使用场景（可复用）
llmRouter  → 自动路由优化（可选）
agent      → 用户实体（单个）
```

### 最小配置

```json
{
  "providers": [{
    "name": "zhipu",
    "type": "zhipu",
    "apiKey": "${ZHIPU_API_KEY}",
    "default": true,
    "models": {
      "glm-5": { "contextWindow": 131072, "maxTokens": 131072 }
    }
  }],

  "roles": {
    "chat": {
      "provider": "zhipu",
      "model": "glm-5",
      "params": { "temperature": 0.7, "max_tokens": 65536 }
    }
  },

  "agent": { "role": "chat" }
}
```

### 核心概念

| 层级 | 概念 | 职责 | 必需？ |
|------|------|------|--------|
| **0** | providers | API 访问 | ✅ 必需 |
| **1** | roles | 模型配置 | ✅ 必需 |
| **2** | llmRouter | 路由优化 | ⚪ 可选 |
| **3** | agent | 用户实体 | ✅ 必需 |

**→ [详细配置说明](./CONFIGURATION-FINAL.md)** · **[概念说明](./CONFIGURATION-CONCEPTS.md)**

---

## 环境变量

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
# 网络搜索
TAVILY_API_KEY=your_key_here         # Tavily 搜索
SERPER_API_KEY=your_key_here         # Serper 搜索
JINA_API_KEY=your_key_here           # Jina AI 网页抓取

# 天气服务
QWEATHER_API_KEY=your_key_here       # 和风天气

# Web UI 认证
WEB_AUTH_TOKEN=your_token_here       # Bearer token
WEB_ADMIN_PASSWORD=admin_password    # Basic auth
```

---

## 配置文件

### 文件位置

- `beeclaw.json` - 主配置文件（必需）
- `beeclaw.schema.json` - JSON Schema 验证（可选）

### 配置结构

```json
{
  "$schema": "./beeclaw.schema.json",

  "providers": [...],    // AI 提供商
  "roles": {...},        // 模型角色
  "llmRouter": {...},    // 路由配置
  "agent": {...},        // Agent 配置

  "compression": {...},  // 上下文压缩
  "feishu": {...},       // 飞书 Bot
  "memory": {...},       // 记忆系统
  "mcp": {...},          // MCP 服务器
  "user": {...},         // 用户配置
  "logging": {...}       // 日志配置
}
```

---

## 详细文档

| 文档 | 说明 |
|------|------|
| [CONFIGURATION-FINAL.md](./CONFIGURATION-FINAL.md) | v6 完整配置指南 |
| [CONFIGURATION-CONCEPTS.md](./CONFIGURATION-CONCEPTS.md) | 核心概念说明 |
| [CONFIGURATION-SIMPLIFICATION.md](./CONFIGURATION-SIMPLIFICATION.md) | 配置简化历程 |
| [CONFIGURATION-V5-DESIGN.md](./CONFIGURATION-V5-DESIGN.md) | v5 设计文档 |
| [CONFIGURATION-MIGRATION-GUIDE.md](./CONFIGURATION-MIGRATION-GUIDE.md) | 迁移指南 |

---

## 常见配置场景

### 单 Provider（最简）

```json
{
  "providers": [{
    "name": "zhipu",
    "type": "zhipu",
    "apiKey": "${ZHIPU_API_KEY}",
    "default": true,
    "models": {
      "glm-5": { "contextWindow": 131072, "maxTokens": 131072 }
    }
  }],
  "roles": {
    "chat": {
      "provider": "zhipu",
      "model": "glm-5",
      "params": { "temperature": 0.7, "max_tokens": 65536 }
    }
  },
  "agent": { "role": "chat" }
}
```

### 多 Provider

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "default": true,
      "models": {
        "glm-5": { "contextWindow": 131072, "maxTokens": 131072 }
      }
    },
    {
      "name": "openai",
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",
      "models": {
        "gpt-4o": { "contextWindow": 128000, "maxTokens": 16384 }
      }
    }
  ],
  "roles": {
    "chat": {
      "provider": "zhipu",
      "model": "glm-5",
      "params": { "temperature": 0.7, "max_tokens": 65536 }
    },
    "code": {
      "provider": "openai",
      "model": "gpt-4o",
      "params": { "temperature": 0.3, "max_tokens": 16384 }
    }
  },
  "llmRouter": {
    "enabled": true,
    "tiers": {
      "standard": { "role": "chat" },
      "advanced": { "role": "code" }
    }
  },
  "agent": { "role": "chat" }
}
```

### 飞书 Bot

```json
{
  "providers": [...],
  "roles": {...},
  "agent": { "role": "chat" },

  "feishu": {
    "enabled": true,
    "appId": "${LARK_BEECLAW_APPID}",
    "appSecret": "${LARK_BEECLAW_AS}",
    "useCardV2": true
  }
}
```

---

## 配置验证

Beeclaw 使用 JSON Schema 和 Zod 进行配置验证：

```bash
# 验证配置文件
bun run config:validate

# 或使用 JSON Schema（IDE 自动验证）
{
  "$schema": "./beeclaw.schema.json",
  ...
}
```

---

## 环境变量插值

配置文件支持环境变量插值：

```json
{
  "providers": [{
    "apiKey": "${ZHIPU_API_KEY}",     // 从环境变量读取
    "baseUrl": "${API_BASE_URL:-https://api.zhipu.ai}"  // 带默认值
  }]
}
```

---

## 故障排查

### 配置文件未找到

```bash
Error: Cannot find module './beeclaw.json'
```

**解决方案**：
```bash
cp beeclaw.example.json beeclaw.json
```

### API Key 未设置

```bash
Error: ZHIPU_API_KEY is not defined
```

**解决方案**：
```bash
export ZHIPU_API_KEY=your_key_here
# 或在 .env 文件中设置
echo 'ZHIPU_API_KEY=your_key_here' >> .env
```

### 配置验证失败

```bash
Error: Invalid configuration: ...
```

**解决方案**：
1. 检查 JSON 格式是否正确
2. 检查必填字段是否完整
3. 参考完整配置示例：`beeclaw.example.json`

---

## 更多帮助

- **完整配置文档**: [CONFIGURATION-FINAL.md](./CONFIGURATION-FINAL.md)
- **配置示例**: [../beeclaw.example.json](../beeclaw.example.json)
- **Schema 定义**: [../beeclaw.schema.json](../beeclaw.schema.json)
- **迁移指南**: [CONFIGURATION-MIGRATION-GUIDE.md](./CONFIGURATION-MIGRATION-GUIDE.md)
