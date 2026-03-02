# Beeclaw 架构设计

本文档描述 Beeclaw 的核心系统架构。

## 系统概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestrator Agent                          │
│  (主代理 - 任务分解、调度、结果聚合)                              │
└───────────────────────┬─────────────────────────────────────────┘
                        │
          ┌─────────────┼─────────────┬─────────────┐
          ▼             ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
    │ Research │  │  Memory  │  │  Skill   │  │  Code    │
    │ Subagent │  │ Subagent │  │ Subagent │  │ Subagent │
    └──────────┘  └──────────┘  └──────────┘  └──────────┘
          │             │             │             │
          └─────────────┴─────────────┴─────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Shared State   │
                    └─────────────────┘
```

## 核心系统

### 1. Agent 系统

Agent 是 AI 对话的核心，负责：
- 管理对话历史
- 调用 AI API
- 执行工具调用
- 上下文管理

**上下文管理**：基于 Token 的智能上下文管理，防止对话超出模型限制。

```typescript
interface ContextConfig {
  maxTokens: 120000;           // 最大 token 数
  keepRecent: 6;               // 保留最近 N 条消息
  keepSystem: true;            // 保留 system prompt
  compressionThreshold: 0.8;   // 80% 时触发压缩
}
```

**文件**：`src/agent/`

### 2. 子代理系统

支持并行任务执行和 DAG 任务编排：

| 类型 | 职责 | 可用工具 |
|------|------|----------|
| `research` | 搜索、调研、信息收集 | web_search, web_fetch, memory_read |
| `memory` | 记忆读写、知识管理 | memory_read, memory_write |
| `skill` | 技能创建、执行、评估 | skill_* tools |
| `code` | 代码生成、文件操作 | file_*, shell |
| `general` | 通用任务 | 所有工具 |

**工具接口**：
```typescript
// 生成单个子代理
spawn_subagent({ type: "research", task: "Search React 19 features" })

// 并行生成多个子代理
spawn_parallel({
  tasks: [
    { type: "research", task: "Search docs" },
    { type: "memory", task: "Read knowledge" }
  ]
})
```

**文件**：`src/subagent/`

### 3. 记忆系统

双层存储架构：

```
data/memory/
├── SOUL.md           # AI 人格设定
├── USER.md           # 用户信息
├── facts/            # 动态事实（日/周级更新）
│   ├── events.md     # 近期事件
│   ├── preferences.md # 偏好设置
│   └── lessons.md    # 经验教训
├── knowledge/        # 稳定知识（月/年级更新）
│   ├── career.md     # 职业信息
│   └── family.md     # 家庭信息
├── sessions/         # 会话持久化
└── archive/          # 长期存档
```

**记忆压缩**：7 天后自动压缩为摘要，90 天后归档。

**文件**：`src/memory/`

### 4. 会话系统

CLI 和 Bot 共享统一的会话管理：

```
┌─────────────────────────────────────────────────────┐
│                   统一会话管理                        │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐        │
│  │   CLI    │   │ Feishu   │   │   API    │        │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘        │
│       └──────────────┼──────────────┘                │
│                      │                               │
│           ┌──────────┴──────────┐                   │
│           │  SessionManager     │                   │
│           └──────────┬──────────┘                   │
│                      │                               │
│           ┌──────────┴──────────┐                   │
│           │  Memory System      │                   │
│           └─────────────────────┘                   │
└─────────────────────────────────────────────────────┘
```

**会话 ID 格式**：`{channel}-{userId}-{timestamp}`

**文件**：`src/session/`

### 5. 共享状态

子代理间共享数据的机制：

| 工具 | 说明 |
|------|------|
| `state_set` | 存储值（支持 TTL） |
| `state_get` | 获取值 |
| `state_update` | 原子更新（increment/append/merge） |
| `state_lock` | 获取锁 |
| `state_unlock` | 释放锁 |

**Key 命名规范**：`category:subcategory:item`

**文件**：`src/subagent/state.ts`

### 6. 技能系统

动态技能管理：

```
skills/
├── skill-name/
│   ├── SKILL.md          # 技能定义（必需）
│   ├── scripts/          # 可执行脚本
│   ├── references/       # 参考文档
│   └── evals/            # 评估测试
```

**技能工具**：`skill_ensure`, `skill_search`, `skill_record`, `skill_maturity`

**文件**：`src/skills/`

### 7. 飞书集成

WebSocket 长连接，无需公网 IP：

```
用户消息 → WebSocket → 表情确认 → Session Manager → Agent → 回复
```

**文件**：`src/feishu/`

## 配置

### AI Provider

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["glm-4"],
      "default": true
    }
  ]
}
```

### 环境变量

```bash
# AI Provider
ZHIPU_API_KEY=your-key

# 飞书 Bot
LARK_BEECLAW_APPID=cli_xxx
LARK_BEECLAW_AS=your-secret
```

## 设计决策

### 为什么用文件系统而非数据库？

- 简单、透明、易于调试
- AI 可以直接读写文件
- 版本控制友好
- 无需额外依赖

### 为什么上下文压缩不用 AI？

- 速度：无额外 API 调用
- 成本：不增加 token 消耗
- 可靠性：规则稳定可控

### 为什么需要子代理系统？

- 并行执行：多个独立任务同时进行
- 专业分工：不同类型任务使用专门工具集
- 隔离性：单个子代理失败不影响整体

## 相关文档

- [详细架构文档](./docs/architecture.md)
- [工具参考](./docs/tools-reference.md)
- [错误处理](./docs/error-handling.md)
