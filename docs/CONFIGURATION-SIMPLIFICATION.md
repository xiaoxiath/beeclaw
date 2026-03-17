# Beeclaw v5 配置简化说明

> **目标**：移除所有冗余字段，只保留必要配置

---

## 🗑️ 移除的字段

### 1. ❌ displayName

**原因**：仅用于 UI 展示，CLI 不需要

```json
// ❌ 移除前
"models": {
  "glm-5": {
    "displayName": "GLM-5"  // ← 移除
  }
}

// ✅ 移除后
"models": {
  "glm-5": {}  // 直接用 model name
}
```

### 2. ❌ capabilities

**原因**：目前代码未使用，且可以从模型名推断

```json
// ❌ 移除前
"glm-4.6v": {
  "capabilities": ["vision"]  // ← 移除
}

// ✅ 移除后
// 从模型名 "glm-4.6v" 即可推断是 vision 模型
```

### 3. ❌ defaultParams（三层简化为两层）

**原因**：三层参数过于复杂，两层足够

```json
// ❌ 移除前（三层）
"models": {
  "glm-5": {
    "defaultParams": {          // Layer 1
      "temperature": 0.7,
      "max_tokens": 4096
    }
  }
},
"roles": {
  "chat": {
    "params": {                 // Layer 2
      "temperature": 0.8
    }
  }
},
"agents": [{
  "params": {                   // Layer 3
    "temperature": 0.9
  }
}]

// ✅ 移除后（两层）
"roles": {
  "chat": {
    "params": {                 // Layer 1: Role 默认参数
      "temperature": 0.7,
      "max_tokens": 4096
    }
  }
},
"agents": [{
  "params": {                   // Layer 2: Agent 覆盖
    "temperature": 0.9
  }
}]
```

**简化逻辑**：
- ✅ Role 定义默认参数（Role = 使用场景）
- ✅ Agent/Router 可以覆盖（使用时微调）
- ❌ 不需要 Model 层的 defaultParams

### 4. ✅ 保留 maxTokens → contextWindow

**原因**：明确语义，避免混淆

```json
// ❌ 混淆
"models": {
  "glm-5": {
    "maxTokens": 128000,           // 模型最大容量
    "defaultParams": {
      "max_tokens": 4096           // 输出长度限制（混淆！）
    }
  }
}

// ✅ 清晰
"models": {
  "glm-5": {
    "contextWindow": 128000        // 模型上下文窗口大小
  }
},
"roles": {
  "chat": {
    "params": {
      "max_tokens": 4096           // 输出 token 限制
    }
  }
}
```

**语义清晰**：
- `contextWindow`: 模型支持的最大上下文（输入+输出）
- `max_tokens`: 本次请求的输出限制（params）

---

## 📊 简化前后对比

### 简化前（v4）

```json
{
  "providers": [{
    "models": {
      "glm-5": {
        "displayName": "GLM-5",              // ❌ 移除
        "maxTokens": 128000,
        "capabilities": ["text", "vision"],  // ❌ 移除
        "defaultParams": {                   // ❌ 移除
          "temperature": 0.7,
          "max_tokens": 4096,
          "do_sample": true,
          "stream": false
        }
      }
    },

    "roles": {
      "chat": {
        "model": "glm-5",
        "params": {
          "temperature": 0.7,                // 重复
          "max_tokens": 4096                 // 重复
        }
      }
    }
  }]
}
```

**行数**: ~30 行（单个模型定义）

### 简化后（v5）

```json
{
  "providers": [{
    "models": {
      "glm-5": {
        "contextWindow": 128000              // ✅ 只保留必要字段
      }
    }
  }],

  "roles": {
    "chat": {
      "provider": "zhipu",
      "model": "glm-5",
      "params": {
        "temperature": 0.7,
        "max_tokens": 4096
      }
    }
  }
}
```

**行数**: ~15 行（减少 50%）

---

## 🎯 简化原则

### 1. 只保留必要字段

| 字段 | 保留？ | 原因 |
|------|--------|------|
| `provider.name` | ✅ | 必需，标识 provider |
| `provider.type` | ✅ | 必需，API 类型 |
| `provider.apiKey` | ✅ | 必需，认证 |
| `provider.default` | ✅ | 必需，默认 provider |
| `model.contextWindow` | ✅ | 有用，上下文管理 |
| `model.displayName` | ❌ | 无用，仅 UI |
| `model.capabilities` | ❌ | 无用，未使用 |
| `model.defaultParams` | ❌ | 冗余，简化为两层 |
| `role.provider` | ✅ | 必需，指定 provider |
| `role.model` | ✅ | 必需，指定模型 |
| `role.params` | ✅ | 必需，参数配置 |

### 2. 两层参数系统

```
Layer 1: Role params (默认参数)
  ↓ 覆盖
Layer 2: Usage params (Agent/Router)
```

**为什么不需要三层？**

- ❌ Model defaultParams → 几乎每个 role 都要覆盖
- ✅ Role params → 定义场景的默认参数
- ✅ Usage params → 使用时微调

**实际场景**：
- Role "chat" 定义 `temperature: 0.7`
- Agent 使用 chat role，覆盖为 `temperature: 0.8`
- 完成！不需要 model.defaultParams

### 3. 明确语义

| 字段名 | 语义 | 示例 |
|--------|------|------|
| `contextWindow` | 模型上下文窗口 | 128000 |
| `max_tokens` | 输出 token 限制 | 4096 |
| `temperature` | 生成温度 | 0.7 |

**避免混淆**：
- ❌ `maxTokens` vs `max_tokens` → 混淆
- ✅ `contextWindow` vs `max_tokens` → 清晰

---

## 📝 完整示例

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
        "glm-5": { "contextWindow": 128000 },
        "glm-4.7-flashx": { "contextWindow": 128000 },
        "glm-4.6v": { "contextWindow": 8192 },
        "embedding-3": {}
      }
    }
  ],

  "roles": {
    "chat": {
      "provider": "zhipu",
      "model": "glm-5",
      "params": {
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
    "vision": {
      "provider": "zhipu",
      "model": "glm-4.6v",
      "params": {
        "temperature": 0.5,
        "max_tokens": 2048
      }
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
        "params": { "max_tokens": 500 }
      },
      "standard": { "role": "chat" }
    }
  },

  "agents": [{
    "id": "default",
    "role": "chat",
    "visionRole": "vision"
  }],

  "compression": { "role": "fast" },
  "toolSelector": { "embedding": { "role": "embedding" } },

  "feishu": { "enabled": true },
  "user": { "location": "北京" }
}
```

**总行数**: ~60 行（vs 简化前 100+ 行）

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
        "glm-5": { "contextWindow": 128000 },
        "glm-4.7-flashx": {}
      }
    },
    {
      "name": "openai",
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",

      "models": {
        "gpt-4o": { "contextWindow": 128000 },
        "gpt-4o-mini": {}
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
    "code": {
      "provider": "openai",
      "model": "gpt-4o",
      "params": { "temperature": 0.3 }
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

  "agents": [
    { "id": "default", "role": "chat" },
    { "id": "coder", "role": "code" }
  ]
}
```

---

## ✅ 简化效果

| 指标 | 简化前 | 简化后 | 改进 |
|------|--------|--------|------|
| 配置行数 | 100+ | ~60 | **-40%** |
| 字段数量 | 15+ | 8 | **-47%** |
| 参数层级 | 3 层 | 2 层 | **-33%** |
| 语义清晰度 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | **+67%** |
| 学习曲线 | 陡峭 | 平缓 | **更容易** |

---

## 🔄 迁移路径

### 迁移步骤

1. **删除无用字段**
   ```bash
   # 删除 displayName, capabilities
   jq 'del(.providers[].models[].displayName, .providers[].models[].capabilities)'
   ```

2. **重命名 maxTokens → contextWindow**
   ```bash
   jq '.providers[].models[].contextWindow = .providers[].models[].maxTokens | del(.providers[].models[].maxTokens)'
   ```

3. **移除 defaultParams**
   ```bash
   jq 'del(.providers[].models[].defaultParams)'
   ```

4. **将 roles 提取到全局**（v4 → v5）
   ```bash
   # 手动迁移或使用迁移脚本
   ```

---

## 📚 相关文档

- [v5 设计文档](./CONFIGURATION-V5-DESIGN.md)
- [完整配置示例](../beeclaw.minimal.v5.json)

---

**简化后的配置更清晰、更易用、更易维护！** 🎉

---

**文档版本**: v5.0-simplified
**最后更新**: 2026-03-17
