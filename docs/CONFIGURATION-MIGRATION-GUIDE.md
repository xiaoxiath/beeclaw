# Beeclaw v4 配置系统迁移指南

> **版本**: v4.0
> **日期**: 2026-03-17
> **状态**: 完成

---

## 🎯 v4 配置系统核心改进

### 三层配置系统

```
Layer 1: Provider Models - 模型元数据和默认参数
Layer 2: Roles - 角色到模型的映射和参数覆盖
Layer 3: Usage - 使用场景（Agent/Router/Tier）参数微调
```

### 核心优势

- ✅ **配置统一**: 模型定义集中在一处
- ✅ **减少重复**: 模型名只出现 1 次（vs 4 次）
- ✅ **多 Provider**: 每个 Provider 独立的 models 和 roles
- ✅ **向后兼容**: 现有配置继续工作
- ✅ **类型安全**: 完整的 TypeScript 类型支持

---

## 📝 配置格式对比

### 旧格式（v1-v3）

```json
{
  "providers": [{
    "name": "zhipu",
    "apiKey": "${ZHIPU_API_KEY}",
    "models": ["glm-5", "glm-4.7-flashx"]  // 只是字符串数组
  }],
  "agents": [{
    "id": "default",
    "provider": "zhipu",
    "model": "glm-5"  // 重复
  }],
  "llmRouter": {
    "tiers": {
      "fast": { "models": ["glm-4.7-flashx"] }  // 重复
    }
  },
  "compression": { "model": "glm-4.7-flashx" }  // 重复
}
```

**问题**：
- ❌ 模型名重复 4 次
- ❌ 无法配置模型参数
- ❌ 无法定义模型能力

### 新格式（v4）

```json
{
  "providers": [{
    "name": "zhipu",
    "apiKey": "${ZHIPU_API_KEY}",

    "models": {
      "glm-5": {
        "displayName": "GLM-5",
        "maxTokens": 128000,
        "defaultParams": {
          "temperature": 0.7,
          "max_tokens": 4096
        }
      },
      "glm-4.7-flashx": {
        "displayName": "GLM-4.7 FlashX",
        "defaultParams": {
          "temperature": 0.3,
          "max_tokens": 2048
        }
      }
    },

    "roles": {
      "chat": {
        "model": "glm-5",
        "params": {
          "temperature": 0.7
        }
      },
      "fast": "glm-4.7-flashx"  // 简化写法
    }
  }],

  "agents": [{
    "id": "default",
    "role": "chat"  // 引用 role
  }],

  "llmRouter": {
    "tiers": {
      "fast": { "role": "fast" }  // 引用 role
    }
  },

  "compression": { "role": "fast" }  // 引用 role
}
```

**优势**：
- ✅ 模型只定义一次
- ✅ 支持模型参数配置
- ✅ 语义化的 role 引用

---

## 🚀 迁移步骤

### Step 1: 添加 models 定义

```json
{
  "providers": [{
    "name": "zhipu",
    "apiKey": "${ZHIPU_API_KEY}",

    // 旧格式（保留向后兼容）
    "models": ["glm-5", "glm-4.7-flashx"],

    // 新格式（添加）
    "modelDefinitions": {
      "glm-5": {
        "displayName": "GLM-5",
        "defaultParams": {
          "temperature": 0.7
        }
      }
    }
  }]
}
```

### Step 2: 添加 roles 映射

```json
{
  "providers": [{
    // ...

    "roles": {
      "chat": "glm-5",           // 简化写法
      "fast": "glm-4.7-flashx",
      "analysis": {
        "model": "glm-5",         // 完整写法
        "params": {
          "temperature": 0.9,
          "thinking": { "type": "enabled" }
        }
      }
    }
  }]
}
```

### Step 3: 使用 role 引用

```json
{
  "agents": [{
    "id": "default",
    "name": "Default Agent",
    "role": "chat",           // 使用 role
    "visionRole": "vision",   // vision role
    "params": {               // 场景级参数覆盖
      "temperature": 0.8
    }
  }]
}
```

### Step 4: 删除重复配置

```json
{
  "agents": [{
    "id": "default",
    "role": "chat"
    // 删除: "provider": "zhipu",  (自动从 role 推断)
    // 删除: "model": "glm-5"      (自动从 role 推断)
  }]
}
```

---

## 📊 参数合并规则

### 三层合并

```
最终参数 = Model 默认参数
         ← Role 参数覆盖
         ← 使用场景参数覆盖
```

### 示例

```json
// Layer 1: Model 默认参数
"models": {
  "glm-5": {
    "defaultParams": {
      "temperature": 0.7,
      "max_tokens": 4096,
      "do_sample": true,
      "stream": false
    }
  }
}

// Layer 2: Role 参数覆盖
"roles": {
  "chat": {
    "model": "glm-5",
    "params": {
      "temperature": 0.5,      // 覆盖
      "max_tokens": 2048       // 覆盖
      // do_sample: 继承 (true)
      // stream: 继承 (false)
    }
  }
}

// Layer 3: 使用场景参数覆盖
"agents": [{
  "role": "chat",
  "params": {
    "temperature": 0.8         // 再次覆盖
    // max_tokens: 继承 role (2048)
    // do_sample: 继承 model (true)
    // stream: 继承 model (false)
  }
}]

// 最终合并结果:
{
  "temperature": 0.8,      // 来自 Agent (Layer 3)
  "max_tokens": 2048,      // 来自 Role (Layer 2)
  "do_sample": true,       // 来自 Model (Layer 1)
  "stream": false          // 来自 Model (Layer 1)
}
```

---

## 🔄 向后兼容性

### 兼容策略

- ✅ 现有配置继续工作
- ✅ 可以混合使用新旧格式
- ✅ 渐进式迁移

### 混合使用示例

```json
{
  "providers": [{
    "name": "zhipu",
    "models": ["glm-5", "glm-4.7-flashx"],  // 旧格式
    "roles": {
      "chat": "glm-5"                        // 新格式
    }
  }],

  "agents": [
    {
      "id": "new-agent",
      "role": "chat"                         // 新格式
    },
    {
      "id": "old-agent",
      "provider": "zhipu",
      "model": "glm-5"                       // 旧格式
    }
  ]
}
```

---

## 🎯 配置示例

### 示例 1: 单 Provider（智谱）

```json
{
  "providers": [{
    "name": "zhipu",
    "type": "zhipu",
    "apiKey": "${ZHIPU_API_KEY}",
    "default": true,

    "models": {
      "glm-5": {
        "displayName": "GLM-5",
        "maxTokens": 128000,
        "defaultParams": {
          "temperature": 0.7,
          "max_tokens": 4096
        }
      },
      "glm-4.7-flashx": {
        "displayName": "GLM-4.7 FlashX",
        "defaultParams": {
          "temperature": 0.3,
          "max_tokens": 2048
        }
      }
    },

    "roles": {
      "chat": "glm-5",
      "fast": "glm-4.7-flashx"
    }
  }],

  "agents": [{
    "id": "default",
    "role": "chat"
  }]
}
```

### 示例 2: 多 Provider

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "default": true,

      "models": {
        "glm-5": { "displayName": "GLM-5" }
      },

      "roles": {
        "chat": "glm-5"
      }
    },
    {
      "name": "openai",
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",

      "models": {
        "gpt-4o": { "displayName": "GPT-4o" }
      },

      "roles": {
        "code": "gpt-4o"
      }
    }
  ],

  "agents": [
    {
      "id": "default",
      "role": "chat"              // 使用 zhipu (default provider)
    },
    {
      "id": "coder",
      "provider": "openai",
      "role": "code"               // 使用 openai
    }
  ]
}
```

---

## ✅ 迁移检查清单

- [ ] 备份现有 `beeclaw.json`
- [ ] 为每个 Provider 添加 `models` 定义
- [ ] 为每个 Provider 添加 `roles` 映射
- [ ] 将 Agent 的 `model` 改为 `role`
- [ ] 将 LLM Router 的 `models` 改为 `role`
- [ ] 将 Compression 的 `model` 改为 `role`
- [ ] 测试配置是否正常工作
- [ ] 删除重复的旧配置

---

## 📚 相关文档

- [配置 Schema](../src/infra/config/schema.ts)
- [Provider Resolver](../src/infra/config/provider-resolver.ts)
- [参数合并工具](../src/infra/config/params-merger.ts)
- [完整配置示例](./beeclaw.v4.example.json)
- [简化配置示例](./beeclaw.simple.example.json)

---

## 🆘 常见问题

### Q1: 旧配置会失效吗？

**A**: 不会。v4 完全向后兼容。可以继续使用旧配置，也可以渐进式迁移。

### Q2: 必须使用 role 吗？

**A**: 不必须。可以继续使用 `model` 字段，但推荐使用 `role` 以获得更好的配置管理。

### Q3: 如何验证配置正确？

**A**: 启动应用查看日志：
```bash
bun run bot

# 应该看到:
[INFO] Configuration loaded (sources: file > env > defaults)
[INFO] Agent "default" resolved: provider=zhipu, model=glm-5
[INFO] LLM Router tier "fast" resolved: model=glm-4.7-flashx
```

### Q4: 参数合并顺序是什么？

**A**: Model 默认参数 → Role 参数覆盖 → 使用场景参数覆盖。后者优先级更高。

---

**迁移完成后，享受更清晰、更灵活的配置系统！** 🎉

---

**文档版本**: v4.0
**最后更新**: 2026-03-17
