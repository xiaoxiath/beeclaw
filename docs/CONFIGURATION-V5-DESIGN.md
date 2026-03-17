# Beeclaw v5 配置系统 - 扁平化设计

> **版本**: v5.0
> **日期**: 2026-03-17
> **状态**: 设计中

---

## 🎯 设计原则

### 核心理念：职责清晰、引用明确

```
Provider  → 提供 API 访问和模型定义
Roles     → 定义模型使用场景（全局）
Router    → 路由策略（引用 Roles）
Agents    → 业务实体（引用 Roles）
```

---

## 📊 设计对比

### ❌ v4 设计（嵌套式）

```json
{
  "providers": [{
    "name": "zhipu",
    "models": { "glm-5": {...} },
    "roles": {              // ❌ role 在 provider 内部
      "chat": {
        "model": "glm-5",  // ❌ 不知道是哪个 provider
        "params": {...}
      }
    }
  }],

  "llmRouter": {           // ❌ 和 roles 概念重复
    "tiers": {
      "fast": { "role": "fast" }
    }
  },

  "agents": [{
    "role": "chat"         // ❌ 不知道用哪个 provider
  }]
}
```

**问题**：
1. ❌ role 嵌套在 provider 内，无法跨 provider
2. ❌ llmRouter.tiers 和 roles 重复
3. ❌ agent.role 不知道对应哪个 provider
4. ❌ 多 provider 时每个都要定义 role

---

### ✅ v5 设计（扁平化）

```json
{
  "providers": [{
    "name": "zhipu",
    "models": {
      "glm-5": {           // ✅ 只定义模型元数据
        "maxTokens": 128000,
        "defaultParams": {
          "temperature": 0.7
        }
      }
    }
  }],

  "roles": {               // ✅ 全局 roles，清晰引用 provider
    "chat": {
      "provider": "zhipu", // ✅ 明确指定 provider
      "model": "glm-5",
      "params": {...}
    },
    "code": {
      "provider": "openai", // ✅ 可以跨 provider
      "model": "gpt-4o"
    }
  },

  "llmRouter": {           // ✅ 只做路由策略
    "tiers": {
      "fast": { "role": "fast" }
    }
  },

  "agents": [{
    "role": "chat"         // ✅ 引用全局 role
  }]
}
```

**优势**：
1. ✅ role 全局定义，可跨 provider
2. ✅ role 明确指定 provider + model
3. ✅ llmRouter 只做路由策略
4. ✅ agent 直接引用 role，语义清晰

---

## 🏗 配置结构

### 1. Providers - API 访问层

**职责**：提供 API 访问和模型元数据

```json
{
  "providers": [
    {
      "name": "zhipu",           // Provider 标识
      "type": "zhipu",           // Provider 类型
      "apiKey": "${ZHIPU_API_KEY}",
      "baseUrl": "https://...",  // 可选
      "default": true,           // 是否为默认 provider

      "models": {                // 模型定义（Layer 1）
        "glm-5": {
          "displayName": "GLM-5",
          "maxTokens": 128000,
          "capabilities": ["text", "vision"],
          "defaultParams": {
            "temperature": 0.7,
            "max_tokens": 4096
          }
        }
      }
    }
  ]
}
```

**关键点**：
- ✅ 只定义模型元数据和默认参数
- ✅ 不包含 roles（roles 是全局的）
- ✅ 职责单一：API 访问 + 模型信息

---

### 2. Roles - 模型使用场景（全局）

**职责**：定义模型使用场景和参数

```json
{
  "roles": {
    "chat": {
      "provider": "zhipu",     // 引用 provider.name
      "model": "glm-5",        // 引用 provider.models
      "params": {              // Layer 2 参数
        "temperature": 0.7,
        "max_tokens": 4096
      }
    },
    "fast": {
      "provider": "zhipu",
      "model": "glm-4.7-flashx",
      "params": {
        "temperature": 0.3,
        "max_tokens": 1000
      }
    },
    "code": {
      "provider": "openai",    // 跨 provider
      "model": "gpt-4o",
      "params": {
        "temperature": 0.3
      }
    }
  }
}
```

**关键点**：
- ✅ 全局定义，不在 provider 内部
- ✅ 明确指定 provider + model
- ✅ 可以跨 provider
- ✅ 定义 Layer 2 参数

---

### 3. LLM Router - 路由策略

**职责**：根据任务复杂度选择合适的 role

```json
{
  "llmRouter": {
    "enabled": true,
    "tiers": {
      "fast": {
        "role": "fast",          // 引用全局 role
        "params": {              // Layer 3 参数覆盖
          "max_tokens": 500
        }
      },
      "standard": {
        "role": "chat"
      },
      "advanced": {
        "role": "code"
      }
    },
    "fallbackEnabled": true,
    "costTracking": true
  }
}
```

**关键点**：
- ✅ 只做路由策略
- ✅ 引用全局 roles
- ✅ 可以覆盖参数（Layer 3）

---

### 4. Agents - 业务实体

**职责**：定义具体的业务 agent

```json
{
  "agents": [
    {
      "id": "default",
      "name": "Default Assistant",
      "role": "chat",           // 引用全局 role
      "visionRole": "vision",   // 引用全局 role
      "params": {               // Layer 3 参数覆盖
        "temperature": 0.8
      }
    }
  ]
}
```

**关键点**：
- ✅ 引用全局 roles
- ✅ 语义清晰
- ✅ 可以覆盖参数（Layer 3）

---

## 📐 三层参数合并

```
Layer 1: Provider Models (defaultParams)
  ↓ 继承 + 覆盖
Layer 2: Roles (params)
  ↓ 继承 + 覆盖
Layer 3: Usage (Agent/Router params)
  ↓
最终参数
```

### 示例

```json
// Layer 1: Provider Models
"models": {
  "glm-5": {
    "defaultParams": {
      "temperature": 0.7,
      "max_tokens": 4096,
      "do_sample": true
    }
  }
}

// Layer 2: Role
"roles": {
  "chat": {
    "provider": "zhipu",
    "model": "glm-5",
    "params": {
      "temperature": 0.5,      // 覆盖
      "max_tokens": 2048       // 覆盖
      // do_sample: 继承 (true)
    }
  }
}

// Layer 3: Agent
"agents": [{
  "role": "chat",
  "params": {
    "temperature": 0.8         // 再次覆盖
    // max_tokens: 继承 role (2048)
    // do_sample: 继承 model (true)
  }
}]

// 最终合并结果:
{
  "temperature": 0.8,      // 来自 Agent (Layer 3)
  "max_tokens": 2048,      // 来自 Role (Layer 2)
  "do_sample": true        // 来自 Model (Layer 1)
}
```

---

## 🔄 完整示例

### 单 Provider（智谱）

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "default": true,

      "models": {
        "glm-5": {
          "maxTokens": 128000,
          "defaultParams": {
            "temperature": 0.7,
            "max_tokens": 4096
          }
        },
        "glm-4.7-flashx": {
          "defaultParams": {
            "temperature": 0.3,
            "max_tokens": 2048
          }
        },
        "glm-4.6v": {
          "capabilities": ["vision"],
          "defaultParams": {
            "temperature": 0.5
          }
        },
        "embedding-3": {}
      }
    }
  ],

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
    },
    "vision": {
      "provider": "zhipu",
      "model": "glm-4.6v"
    },
    "embedding": {
      "provider": "zhipu",
      "model": "embedding-3"
    }
  },

  "llmRouter": {
    "enabled": true,
    "tiers": {
      "fast": { "role": "fast" },
      "standard": { "role": "chat" }
    }
  },

  "agents": [{
    "id": "default",
    "role": "chat",
    "visionRole": "vision"
  }],

  "compression": {
    "role": "fast"
  },

  "toolSelector": {
    "embedding": { "role": "embedding" }
  }
}
```

---

### 多 Provider（智谱 + OpenAI）

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "default": true,

      "models": {
        "glm-5": {
          "maxTokens": 128000,
          "defaultParams": { "temperature": 0.7 }
        }
      }
    },
    {
      "name": "openai",
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",

      "models": {
        "gpt-4o": {
          "maxTokens": 128000,
          "defaultParams": { "temperature": 0.7 }
        },
        "gpt-4o-mini": {
          "defaultParams": { "temperature": 0.5 }
        }
      }
    }
  ],

  "roles": {
    "chat": {
      "provider": "zhipu",
      "model": "glm-5",
      "params": { "temperature": 0.7 }
    },
    "fast": {
      "provider": "zhipu",
      "model": "glm-5",  // 智谱最快
      "params": { "temperature": 0.3 }
    },
    "code": {
      "provider": "openai",
      "model": "gpt-4o",
      "params": { "temperature": 0.3 }
    },
    "analysis": {
      "provider": "openai",
      "model": "gpt-4o",
      "params": {
        "temperature": 0.9,
        "thinking": { "type": "enabled" }
      }
    }
  },

  "llmRouter": {
    "enabled": true,
    "tiers": {
      "fast": { "role": "fast" },
      "standard": { "role": "chat" },
      "advanced": { "role": "analysis" }
    }
  },

  "agents": [
    {
      "id": "default",
      "role": "chat"
    },
    {
      "id": "coder",
      "role": "code"
    }
  ]
}
```

---

## 📋 Schema 定义

### Provider Schema

```typescript
export const AIProviderSchema = z.object({
  name: z.string(),
  type: z.enum(['openai', 'anthropic', 'zhipu', 'minimax', 'custom']),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  default: z.boolean().default(false),

  models: z.record(z.string(), z.object({
    displayName: z.string().optional(),
    maxTokens: z.number().optional(),
    capabilities: z.array(z.string()).optional(),
    defaultParams: ModelParamsSchema.optional(),
  })),
});
```

### Role Schema

```typescript
export const RoleDefinitionSchema = z.object({
  provider: z.string(),      // Provider name
  model: z.string(),         // Model name
  params: ModelParamsSchema.optional(),  // Layer 2 params
});
```

### AppConfig Schema

```typescript
export const AppConfigSchema = z.object({
  providers: z.array(AIProviderSchema),
  roles: z.record(z.string(), RoleDefinitionSchema),  // Global roles
  llmRouter: LLMRouterConfigSchema.optional(),
  agents: z.array(AgentConfigSchema),
  compression: CompressionConfigSchema.optional(),
  toolSelector: ToolSelectorConfigSchema.optional(),
  // ...
});
```

---

## ✅ v5 优势总结

### 1. 职责清晰

- ✅ **Provider**: API 访问 + 模型元数据
- ✅ **Roles**: 模型使用场景（全局）
- ✅ **Router**: 路由策略
- ✅ **Agents**: 业务实体

### 2. 引用明确

- ✅ Role 明确指定 `provider + model`
- ✅ Agent/Router 引用全局 `role`
- ✅ 无歧义，无重复

### 3. 灵活性

- ✅ Roles 可以跨 provider
- ✅ 多 provider 配置清晰
- ✅ 三层参数合并

### 4. 可维护性

- ✅ 扁平化结构，易于理解
- ✅ 修改模型只需改 provider.models
- ✅ 修改场景只需改 roles

---

## 🔄 迁移路径

### 从 v4 迁移到 v5

1. **提取 roles**: 将 `provider.roles` 提取到全局 `roles`
2. **添加 provider 引用**: 在每个 role 中添加 `provider` 字段
3. **删除嵌套**: 删除 `provider.roles`

### 迁移工具

```bash
# 自动迁移脚本（待实现）
bun run migrate-config --from v4 --to v5
```

---

## 📚 相关文档

- [配置 Schema](../src/infra/config/schema.ts)
- [Provider Resolver](../src/infra/config/provider-resolver.ts)
- [参数合并工具](../src/infra/config/params-merger.ts)
- [完整配置示例](./beeclaw.v5.flat.json)

---

**文档版本**: v5.0
**最后更新**: 2026-03-17
