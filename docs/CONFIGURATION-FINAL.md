# Beeclaw 配置最终方案

> **版本**: v6 Final
> **日期**: 2026-03-17
> **状态**: 完成

---

## 🎯 设计原则

### 1. 职责清晰

```
Providers → 提供 API 访问和模型信息
Roles     → 定义模型使用场景（可复用）
Router    → 自动路由优化（可选）
Agent     → 用户实体（单个）
```

### 2. 最小必要

- ✅ 只保留必要字段
- ❌ 移除所有冗余配置
- ✅ 语义清晰无歧义

### 3. 易于理解

- ✅ 扁平化结构
- ✅ 引用关系清晰
- ✅ 配置行数最少

---

## 📐 配置结构

### 核心概念

| 层级 | 概念 | 职责 | 必需？ |
|------|------|------|--------|
| **0** | providers | API 访问 | ✅ 必需 |
| **1** | roles | 模型配置 | ✅ 必需 |
| **2** | llmRouter | 路由优化 | ⚪ 可选 |
| **3** | agent | 用户实体 | ✅ 必需 |

### 引用关系

```
agent.role ──────────┐
                     │
llmRouter.tier.role ─┼──→ roles[name]
                     │       ↓
compression.role ────┘       provider + model + params
```

---

## 📝 完整配置

### 最小配置（单 Provider）

```json
{
  "providers": [{
    "name": "zhipu",
    "type": "zhipu",
    "apiKey": "${ZHIPU_API_KEY}",
    "default": true,
    "models": {
      "glm-5": { "contextWindow": 128000 },
      "glm-4.7-flashx": {}
    }
  }],

  "roles": {
    "chat": {
      "provider": "zhipu",
      "model": "glm-5",
      "params": { "temperature": 0.7 }
    },
    "fast": {
      "provider": "zhipu",
      "model": "glm-4.7-flashx",
      "params": { "temperature": 0.3 }
    }
  },

  "agent": { "role": "chat" }
}
```

**行数**: ~20 行

---

### 推荐配置（完整功能）

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "default": true,

      "models": {
        "glm-5": { "contextWindow": 131072, "maxTokens": 131072 },
        "glm-4.7-flashx": { "contextWindow": 131072, "maxTokens": 131072 },
        "glm-4.6v": { "contextWindow": 32768, "maxTokens": 32768 },
        "embedding-3": {}
      }
    }
  ],

  "roles": {
    "chat": {
      "provider": "zhipu",
      "model": "glm-5",
      "params": { "temperature": 0.7, "max_tokens": 65536 }
    },
    "fast": {
      "provider": "zhipu",
      "model": "glm-4.7-flashx",
      "params": { "temperature": 0.3, "max_tokens": 65536 }
    },
    "vision": {
      "provider": "zhipu",
      "model": "glm-4.6v",
      "params": { "temperature": 0.5, "max_tokens": 16384 }
    },
    "embedding": {
      "provider": "zhipu",
      "model": "embedding-3"
    }
  },

  "llmRouter": {
    "enabled": true,
    "tiers": {
      "fast": {
        "role": "fast",
        "params": { "max_tokens": 8192 }
      },
      "standard": { "role": "chat" }
    }
  },

  "agent": {
    "role": "chat",
    "visionRole": "vision"
  },

  "toolSelector": {
    "embedding": { "role": "embedding" }
  },

  "compression": { "role": "fast" },

  "feishu": { "enabled": true, "useCardV2": true },

  "user": { "location": "北京海淀", "timezone": "Asia/Shanghai" },

  "logging": { "level": "debug" }
}
```

**行数**: ~55 行

---

### 多 Provider 配置

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "default": true,

      "models": {
        "glm-5": { "contextWindow": 131072, "maxTokens": 131072 },
        "glm-4.7-flashx": { "contextWindow": 131072, "maxTokens": 131072 }
      }
    },
    {
      "name": "openai",
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",

      "models": {
        "gpt-4o": { "contextWindow": 128000, "maxTokens": 16384 },
        "gpt-4o-mini": { "contextWindow": 128000, "maxTokens": 16384 }
      }
    }
  ],

  "roles": {
    "chat": {
      "provider": "zhipu",
      "model": "glm-5",
      "params": { "temperature": 0.7, "max_tokens": 65536 }
    },
    "fast": {
      "provider": "zhipu",
      "model": "glm-4.7-flashx",
      "params": { "temperature": 0.3, "max_tokens": 65536 }
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
      "fast": { "role": "fast" },
      "standard": { "role": "chat" },
      "advanced": { "role": "code" }
    }
  },

  "agent": { "role": "chat" }
}
```

**行数**: ~40 行

---

## 🔧 配置字段详解

### 1. providers

**职责**: API 访问和模型信息

```json
{
  "providers": [{
    "name": "zhipu",              // Provider 标识
    "type": "zhipu",              // Provider 类型
    "apiKey": "${ZHIPU_API_KEY}", // API Key（支持环境变量）
    "baseUrl": "...",             // 可选：自定义 API 地址
    "default": true,              // 是否为默认 provider

    "models": {                   // 可选：模型信息
      "glm-5": {
        "contextWindow": 128000   // 上下文窗口大小
      }
    }
  }]
}
```

**必需字段**:
- ✅ `name` - Provider 标识
- ✅ `type` - Provider 类型
- ✅ `apiKey` - API Key

**可选字段**:
- ⚪ `default` - 默认 provider（第一个自动为默认）
- ⚪ `models` - 模型信息
- ⚪ `baseUrl` - 自定义 API 地址

---

### 2. roles

**职责**: 定义模型使用场景（可复用）

```json
{
  "roles": {
    "chat": {                     // Role 名称
      "provider": "zhipu",        // 引用 provider.name
      "model": "glm-5",           // 模型名称
      "params": {                 // 调用参数
        "temperature": 0.7,
        "max_tokens": 4096
      }
    }
  }
}
```

**必需字段**:
- ✅ `provider` - Provider 引用
- ✅ `model` - 模型名称

**可选字段**:
- ⚪ `params` - 调用参数（temperature, max_tokens 等）

---

### 3. llmRouter

**职责**: 自动路由优化

```json
{
  "llmRouter": {
    "enabled": true,              // 是否启用
    "tiers": {                    // 分级配置
      "fast": {
        "role": "fast",           // 引用 role
        "params": { ... }         // 覆盖参数（可选）
      }
    }
  }
}
```

**必需字段**:
- ✅ `enabled` - 是否启用

**可选字段**:
- ⚪ `tiers` - 分级配置
- ⚪ `fallbackEnabled` - 是否启用降级
- ⚪ `costTracking` - 是否跟踪成本

---

### 4. agent

**职责**: 用户实体（单个）

```json
{
  "agent": {
    "role": "chat",               // 引用 role
    "visionRole": "vision"        // Vision role 引用
  }
}
```

**必需字段**:
- ✅ `role` - Role 引用

**可选字段**:
- ⚪ `visionRole` - Vision role 引用
- ⚪ `systemPrompt` - 系统提示词

---

## 📊 简化历程

| 版本 | 行数 | 字段数 | 主要改进 |
|------|------|--------|---------|
| **v1** | 200+ | 20+ | 初始版本 |
| **v2** | 150 | 18 | 环境变量支持 |
| **v3** | 120 | 15 | 参数简化 |
| **v4** | 93 | 12 | 三层配置 |
| **v5** | 72 | 10 | 移除冗余字段 |
| **v6** | **55** | **8** | **agents → agent** |

**总简化**: **72%** ✅

---

## ✅ 最终方案优势

### 1. 职责清晰

```
Provider → API 访问
Role     → 模型配置（可复用）
Router   → 自动路由
Agent    → 用户实体
```

### 2. 配置简洁

- ✅ 单 Provider: ~20 行
- ✅ 完整配置: ~55 行
- ✅ 多 Provider: ~40 行

### 3. 易于理解

- ✅ 扁平化结构
- ✅ 引用关系清晰
- ✅ 无冗余配置

### 4. 灵活扩展

- ✅ 支持多 Provider
- ✅ 支持自定义 roles
- ✅ 支持参数覆盖

---

## 📚 相关文档

- [配置快速开始](./configuration.md)
- [概念说明](./CONFIGURATION-CONCEPTS.md)
- [环境变量与配置文件对比](./env-vs-config.md)

---

## 🎉 总结

**Beeclaw v6 配置系统**：
- ✅ **简洁** - 55 行配置覆盖所有功能
- ✅ **清晰** - 职责明确，引用关系清楚
- ✅ **灵活** - 支持多 Provider，参数覆盖
- ✅ **易用** - 学习曲线平缓，配置简单

**这是最终推荐的配置方案！** 🚀

---

**文档版本**: v6-final
**最后更新**: 2026-03-17
