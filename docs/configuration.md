# 配置指南

Beeclaw 支持多种配置方式，按优先级从高到低：

1. 环境变量
2. 配置文件 (`beeclaw.json`)
3. 默认值

## 配置文件

### 基本结构

```json
{
  "providers": [ ... ],
  "agents": [ ... ],
  "memory": { ... },
  "skills": { ... },
  "feishu": { ... },
  "logging": { ... }
}
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
      "tools": ["memory_*", "goal_*", "skill_*"]
    }
  ],
  "memory": {
    "path": "./data/memory"
  },
  "skills": {
    "userPath": "./data/memory/skills"
  },
  "logging": {
    "level": "info"
  }
}
```

## 环境变量

### AI Provider

| 变量 | 说明 |
|------|------|
| `ZHIPU_API_KEY` | 智谱 GLM API Key |
| `OPENAI_API_KEY` | OpenAI API Key |
| `ANTHROPIC_API_KEY` | Anthropic API Key |
| `MINIMAX_API_KEY` | MiniMax API Key |

### 飞书 Bot

| 变量 | 说明 |
|------|------|
| `LARK_BEECLAW_APPID` | 飞书应用 ID |
| `LARK_BEECLAW_AS` | 飞书应用密钥 |

### 其他

| 变量 | 说明 |
|------|------|
| `BEECLAW_LOG_LEVEL` | 日志级别 (debug/info/warn/error) |

## 配置详解

### Provider 配置

```typescript
interface AIProvider {
  name: string;                              // 提供商名称
  type: 'openai' | 'anthropic' | 'zhipu' | 'minimax' | 'custom';
  apiKey: string;                            // API 密钥
  baseUrl?: string;                          // API 基础 URL（可选）
  models: string[];                          // 可用模型列表
  default?: boolean;                         // 是否为默认提供商
}
```

**支持的 Provider 类型：**

| 类型 | 说明 | 默认 Base URL |
|------|------|---------------|
| `openai` | OpenAI API | https://api.openai.com/v1 |
| `anthropic` | Anthropic Claude | https://api.anthropic.com/v1 |
| `zhipu` | 智谱 GLM | https://open.bigmodel.cn/api/paas/v4 |
| `minimax` | MiniMax | https://api.minimaxi.com/v1 |

### Agent 配置

```typescript
interface AgentConfig {
  id: string;            // 代理 ID
  name: string;          // 显示名称
  provider: string;      // 使用的提供商名称
  model: string;         // 使用的模型
  systemPrompt?: string; // 系统提示词
  temperature?: number;  // 温度 (0-2)
  tools?: string[];      // 可用工具列表（支持通配符）
}
```

### Memory 配置

```typescript
interface MemoryConfig {
  path: string;  // 存储路径，默认 ./data/memory
}
```

### Feishu 配置

```typescript
interface FeishuConfig {
  appId?: string;       // 飞书应用 ID
  appSecret?: string;   // 飞书应用密钥
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}
```

通过环境变量配置：

```bash
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="your-app-secret"
```

## 相关文档

| 文档 | 描述 |
|------|------|
| [快速开始](./getting-started.md) | 安装和配置指南 |
| [CLI 参考](./cli-reference.md) | CLI 命令详解 |
| [飞书集成](./feishu-integration.md) | 飞书 Bot 配置 |
