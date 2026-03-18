# Beeclaw 配置概念简化

> **问题**：roles、agents、llmRouter 三者概念重复，能否合并？

---

## 🔍 概念分析

### 当前三个概念

| 概念 | 作用 | 示例 |
|------|------|------|
| **roles** | 定义模型使用场景 | `chat`, `fast`, `vision` |
| **llmRouter** | 根据任务复杂度选择场景 | `fast` tier → `fast` role |
| **agents** | 业务实体 | `default` agent → `chat` role |

### 使用关系

```
┌─────────────┐
│   Roles     │ ← 定义场景（模型 + 参数）
│  (chat)     │
└──────┬──────┘
       │
   ┌───┴────┬─────────┐
   │        │         │
   ▼        ▼         ▼
llmRouter  agent  toolSelector
```

**问题**：
- ❌ llmRouter.tier 引用 role（多一层）
- ❌ agent 引用 role（多一层）
- ❌ 如果只有一个 agent，agents 数组冗余

---

## 💡 简化方案

### 方案 1：移除 agents 数组（推荐）

**原因**：大多数场景只有一个默认 agent

```json
// ❌ 简化前
"agents": [
  {
    "id": "default",
    "name": "Default Assistant",
    "role": "chat",
    "visionRole": "vision"
  }
]

// ✅ 简化后
"agent": {
  "role": "chat",
  "visionRole": "vision"
}
```

**节省**：6 行 → 3 行

---

### 方案 2：llmRouter.tiers 直接定义（可选）

**原因**：如果 tiers 和 roles 一一对应，可以合并

```json
// ❌ 简化前
"roles": {
  "fast": { "provider": "zhipu", "model": "glm-4.7-flashx" }
},
"llmRouter": {
  "tiers": {
    "fast": { "role": "fast" }  // ← 重复引用
  }
}

// ✅ 简化后（直接在 router 定义）
"llmRouter": {
  "tiers": {
    "fast": {
      "provider": "zhipu",
      "model": "glm-4.7-flashx",
      "params": { "temperature": 0.3 }
    }
  }
}
```

**问题**：
- ❌ 失去了 role 复用（agent 无法引用 router tier）
- ❌ Router 和 Agent 都要定义模型

**结论**：**不推荐**，保留 roles 作为共享定义

---

## 🎯 最终方案

### 保留三层概念，但简化 agents

```json
{
  "providers": [...],

  "roles": {
    "chat": { "provider": "zhipu", "model": "glm-5" },
    "fast": { "provider": "zhipu", "model": "glm-4.7-flashx" },
    "vision": { "provider": "zhipu", "model": "glm-4.6v" }
  },

  "llmRouter": {
    "tiers": {
      "fast": { "role": "fast" },
      "standard": { "role": "chat" }
    }
  },

  "agent": {
    "role": "chat",
    "visionRole": "vision"
  }
}
```

### 为什么保留三个概念？

#### 1. **Roles** - 模型配置的"函数"

```typescript
// Role 就像一个函数定义
function chat() {
  return { provider: "zhipu", model: "glm-5", temperature: 0.7 };
}

// 可以被多处调用
llmRouter.tiers.standard.role = chat();  // Router 使用
agent.role = chat();                      // Agent 使用
compression.role = chat();                // Compression 使用
```

**价值**：
- ✅ 定义一次，多处使用
- ✅ 统一修改模型配置

#### 2. **LLM Router** - 任务路由策略

```typescript
// Router 根据任务复杂度选择 role
function selectTier(task: Task): Role {
  if (task.complexity === 'simple') {
    return roles.fast;  // 使用 fast role
  } else {
    return roles.chat;  // 使用 chat role
  }
}
```

**价值**：
- ✅ 自动选择合适的模型
- ✅ 成本优化（简单任务用便宜模型）

#### 3. **Agent** - 业务实体

```typescript
// Agent 是面向用户的实体
const agent = {
  name: "Default Assistant",
  role: roles.chat,        // Agent 使用哪个 role
  visionRole: roles.vision, // Vision 使用哪个 role
  systemPrompt: "..."
};
```

**价值**：
- ✅ 面向用户的实体
- ✅ 可以有多个 agent（未来）
- ✅ Agent 级别的配置（systemPrompt, tools 等）

---

## 📊 概念对比表

| 概念 | 抽象层级 | 作用 | 能否移除？ |
|------|----------|------|-----------|
| **providers** | 0 - API | 提供 API 访问 | ❌ 必需 |
| **roles** | 1 - 配置 | 定义模型配置 | ❌ 必需（复用） |
| **llmRouter** | 2 - 路由 | 自动选择模型 | ✅ 可选（优化） |
| **agent(s)** | 3 - 业务 | 用户实体 | ⚠️ 简化（数组→对象） |

---

## 🔄 配置演进

### v6 Ultimate（最简）

```json
{
  "providers": [{
    "name": "zhipu",
    "models": {
      "glm-5": { "contextWindow": 128000 }
    }
  }],

  "roles": {
    "chat": { "model": "glm-5", "params": { "temperature": 0.7 } }
  },

  "agent": { "role": "chat" }  // ← 单个 agent
}
```

**行数**: ~15 行

### v5 Current（推荐）

```json
{
  "providers": [...],
  "roles": { ... },
  "llmRouter": { ... },
  "agent": { ... },           // ← 单个 agent
  "compression": { ... }
}
```

**行数**: ~70 行

---

## ✅ 结论

### 保留三个概念，但简化形式

1. **✅ 保留 roles** - 模型配置的复用
2. **✅ 保留 llmRouter** - 自动路由优化
3. **✅ 简化 agents → agent** - 单个 agent 对象

### 为什么不合并？

**尝试合并**：

```json
// ❌ 方案 A：移除 roles，直接在 agent 定义
"agent": {
  "provider": "zhipu",
  "model": "glm-5",
  "params": { "temperature": 0.7 }
}

// 问题：
// 1. llmRouter 无法引用 agent
// 2. compression 无法引用 agent
// 3. toolSelector 无法引用 agent
```

```json
// ❌ 方案 B：移除 agent，直接用 llmRouter
"llmRouter": {
  "default": { "provider": "zhipu", "model": "glm-5" }
}

// 问题：
// 1. 无法配置 visionRole
// 2. 无法配置 agent 级别的 systemPrompt
// 3. 概念混乱（Router 不是 Agent）
```

**结论**：三个概念职责不同，无法合并，但可以简化形式。

---

## 📚 相关文档

- [完整配置指南](./CONFIGURATION-FINAL.md)
- [配置快速开始](./configuration.md)
- [最终配置示例](../beeclaw.ultimate.json)

---

**简化后：概念清晰 + 形式简洁 + 易于理解！** 🎉

---

**文档版本**: v6-concepts
**最后更新**: 2026-03-17
