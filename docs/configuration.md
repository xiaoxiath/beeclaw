# Beeclaw 配置指南

> 配置 schema 的源头是 `src/infra/config/schema.ts`（Zod）。`beeclaw.schema.json` 由 `bun run gen:config-schema` 生成，CI 跑 drift guard 拒绝二者不同步。本文档解释结构 + 常用项；遇到分歧以 Zod 为准。

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

**→ [完整配置示例](../beeclaw.example.json)** 

---

## 配置结构总览

Beeclaw 配置由几个独立的顶层段组成（详见 `AppConfigSchema`）：

```
providers   → API 访问 + 模型信息（必需）
roles       → 模型使用场景，可复用（必需）
agent       → agent 实例配置（必需）
llmRouter   → 路由优化（可选）
toolSelector→ 工具筛选（可选）
user        → 用户实体覆盖（可选）
memory      → 记忆系统路径与开关（可选）
search      → 搜索 provider（可选；启用后 deep_research 才可用）
feishu      → 飞书集成（可选）
mcp.servers → MCP 服务器列表（可选）
sandbox     → 沙箱配置（实验性，see Zod schema）
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

### 字段说明

| 字段 | 职责 | 必需？ |
|------|------|--------|
| `providers` | API 访问 | ✅ 必需 |
| `roles` | 模型配置 | ✅ 必需 |
| `agent` | agent 实例（绑定 role + tool flags + per-turn 预算）| ✅ 必需 |
| `llmRouter` | 自动按场景挑模型（fast/main/long-context 分层）| ⚪ 可选 |
| `toolSelector` | HybridToolSelector budget cap | ⚪ 可选 |
| `user` | user identity / 偏好 | ⚪ 可选 |

<!-- 详细配置说明已整合到本文档中 -->

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
  "logging": {...},      // 日志配置
  "toolSelector": {...}, // 工具选择器
  "weather": {...},      // 天气服务
  "hooks": {...},        // 钩子配置
  "web": {...},          // Web UI
  "search": {...}        // 搜索配置
}
```

---

## 扩展配置

### 工具选择器 (toolSelector)

智能选择工具子集以优化性能：

```json
{
  "toolSelector": {
    "enabled": true,
    "mode": "hybrid",  // "static" | "hybrid" | "dynamic"
    "maxTools": 20
  }
}
```

### 用户配置 (user)

个性化用户设置：

```json
{
  "user": {
    "name": "Your Name",
    "timezone": "Asia/Shanghai",
    "locale": "zh-CN"
  }
}
```

### 天气服务 (weather)

集成天气查询：

```json
{
  "weather": {
    "enabled": true,
    "apiHost": "devapi.qweather.com",
    "apiKey": "${QWEATHER_API_KEY}"
  }
}
```

### 钩子系统 (hooks)

配置事件钩子：

```json
{
  "hooks": {
    "enabled": true,
    "beforeToolCall": [],
    "afterToolCall": []
  }
}
```

### Web UI (web)

启用 Web 管理界面：

```json
{
  "web": {
    "enabled": true,
    "port": 3000,
    "auth": {
      "level": "token",
      "tokens": ["${WEBUI_AUTH_TOKEN}"]
    }
  }
}
```

### 搜索配置 (search)

网络搜索服务：

```json
{
  "search": {
    "enabled": true,
    "defaultProvider": "tavily",
    "providers": {
      "tavily": {
        "apiKey": "${TAVILY_API_KEY}"
      }
    }
  }
}
```

### 日志配置 (logging)

日志级别和输出：

```json
{
  "logging": {
    "level": "info",  // "debug" | "info" | "warn" | "error"
    "file": "logs/beeclaw.log",
    "console": true
  }
}
```

---

## 详细文档

| 文档 | 说明 |
|------|------|
| [完整配置示例](../beeclaw.example.json) | 所有配置字段的完整示例 |
| [架构设计](./architecture.md) | 系统架构和技术选型 |

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

## Sandbox 配置 ⚠️ 实验性

Sandbox 系统目前为**实验性功能，尚未完全实现**。Local 和 Docker 提供者仅为存根，如果使用会抛出错误。

```json
{
  "sandbox": {
    "enabled": false,  // 推荐：保持禁用直到实现完成
    "provider": "auto",
    "workspaceBase": "./data/sandbox",
    "local": {
      "enabled": true,
      "defaultTimeout": 30000,
      "maxOutputSize": 1048576,
      "blockedCommands": [
        "rm\\s+-rf\\s+/",
        "mkfs",
        "dd\\s+if=",
        ":(){ :|:& };:",
        "chmod\\s+-R\\s+777\\s+/",
        "shutdown",
        "reboot",
        "halt",
        "init\\s+0"
      ]
    },
    "docker": {
      "enabled": false,  // 未实现 - 不会工作
      "image": "beeclaw-sandbox:latest",
      "memoryLimitMb": 512,
      "cpuLimit": 1,
      "networkEnabled": false,
      "defaultTimeout": 60000
    },
    "pool": {
      "enabled": false,  // 未实现
      "minIdle": 1,
      "maxTotal": 5
    }
  }
}
```

**实现状态**:
- ✅ **配置 Schema**: 已定义和验证
- ⚠️ **Local Provider**: 仅存根 - 抛出 `Error('LocalSandboxProvider not implemented yet')`
- ⚠️ **Docker Provider**: 仅存根 - 抛出 `Error('DockerSandboxProvider not implemented yet')`
- ⚠️ **Pool System**: 未实现

**推荐**: 生产环境禁用 sandbox

---

## 配置管理最佳实践

### 配置分层策略

Beeclaw 采用三层配置策略：

**Layer 1: 环境变量（.env）- 敏感信息**

存储 API Keys、密码等敏感信息：

```bash
# AI Provider API Keys（必需）
ZHIPU_API_KEY=your_zhipu_api_key_here

# Feishu 飞书配置（用于飞书机器人）
LARK_BEECLAW_APPID=your_app_id_here
LARK_BEECLAW_AS=your_app_secret_here

# 第三方 API Keys（可选）
TAVILY_API_KEY=your_tavily_api_key_here
QWEATHER_API_KEY=your_qweather_api_key_here
```

**Layer 2: 应用配置（beeclaw.json）- 业务配置**

存储应用逻辑配置，通过环境变量引用敏感信息：

```json
{
  "providers": [{
    "apiKey": "${ZHIPU_API_KEY}",  // 引用环境变量
    "baseUrl": "${API_BASE_URL:-https://api.zhipu.ai}"  // 带默认值
  }],
  "feishu": {
    "appId": "${LARK_BEECLAW_APPID}",
    "appSecret": "${LARK_BEECLAW_AS}"
  }
}
```

**Layer 3: 配置模板（.example 文件）- 提交到 Git**

提供配置示例和文档：
- `.env.example` - 环境变量模板
- `beeclaw.example.json` - 完整配置模板
- `beeclaw.schema.json` - JSON Schema 验证

### 推荐工作流程

**新开发者加入**:
```bash
# 1. 复制模板文件
cp .env.example .env
cp beeclaw.example.json beeclaw.json

# 2. 编辑 .env，填入自己的 API keys
vim .env

# 3. 根据需要调整 beeclaw.json
vim beeclaw.json

# 4. 启动应用
bun run bot
```

**部署到生产**:
```bash
# 1. 设置生产环境变量
export ZHIPU_API_KEY=prod_key_here
export LARK_BEECLAW_APPID=prod_app_id

# 2. 使用生产配置文件
cp beeclaw.prod.json beeclaw.json

# 3. 启动服务
pm2 start beeclaw
```

### 配置注意事项

1. **不要提交 .env 和 beeclaw.json**
   - 已在 .gitignore 中
   - 包含敏感信息

2. **定期更新 .example 文件**
   - 添加新配置时同步更新模板
   - 添加注释说明

3. **文档化配置项**
   - 在 CLAUDE.md 中说明配置方法
   - 在 .example 文件中添加注释

---

## 更多帮助

- **完整配置示例**: [beeclaw.example.json](../beeclaw.example.json)
- **系统架构**: [architecture.md](./architecture.md)
- **配置示例**: [../beeclaw.example.json](../beeclaw.example.json)
- **Schema 定义**: [../beeclaw.schema.json](../beeclaw.schema.json)
- **快速开始**: [getting-started.md](./getting-started.md)
