# Beeclaw 架构设计

> 本文档描述 Beeclaw 的核心系统架构，包括子代理系统、会话管理和状态管理。

## 目录

1. [系统概览](#系统概览)
2. [子代理系统](#子代理系统)
3. [会话管理](#会话管理)
4. [共享状态](#共享状态)
5. [配置参考](#配置参考)

---

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
    │ (搜索/调研)│  │ (记忆操作)│  │ (技能执行)│  │ (代码任务)│
    └──────────┘  └──────────┘  └──────────┘  └──────────┘
          │             │             │             │
          └─────────────┴─────────────┴─────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Shared State   │
                    │  (任务状态/结果) │
                    └─────────────────┘
```

---

## 子代理系统

### 子代理类型

| 类型 | 职责 | 可用工具 |
|------|------|----------|
| `research` | 搜索、调研、信息收集 | web_search, web_fetch, memory_read |
| `memory` | 记忆读写、知识管理 | memory_read, memory_write, keyword_* |
| `skill` | 技能创建、执行、评估 | skill_* tools |
| `code` | 代码生成、文件操作 | file_*, shell |
| `general` | 通用任务 | 所有工具 |

### 工具接口

#### spawn_subagent - 生成单个子代理

```typescript
spawn_subagent({
  type: "research",        // 子代理类型
  task: "Search React 19 features",  // 任务描述
  context: "User prefers TypeScript",  // 可选上下文
  timeout: 60000           // 可选超时（毫秒）
})
```

#### spawn_parallel - 并行生成多个子代理

```typescript
spawn_parallel({
  tasks: [
    { type: "research", task: "Search official docs" },
    { type: "memory", task: "Read existing knowledge" }
  ],
  maxParallelism: 3  // 最大并行数
})
```

### DAG 任务编排

系统支持自动任务分解和 DAG 调度：

```
1. 分解任务 (decompose)
   ├─ LLM 分解复杂任务
   ├─ 验证依赖关系
   └─ 生成 TaskDecomposition

2. 初始化调度器 (scheduler.initialize)
   └─ 创建任务状态映射

3. 执行循环 (while !scheduler.isComplete)
   ├─ 获取可并行任务
   ├─ 并行执行任务
   └─ 进度回调

4. 聚合结果
   ├─ 按类型分组
   └─ 合并输出
```

---

## 会话管理

### 统一架构

CLI 和 Bot 共享同一个 SessionManager：

```
┌─────────────────────────────────────────────────────┐
│                   统一会话管理                        │
│                (Unified Session Manager)             │
├─────────────────────────────────────────────────────┤
│  ┌──────────┐   ┌──────────┐   ┌──────────┐        │
│  │   CLI    │   │ Feishu   │   │   API    │        │
│  │  Channel │   │ Channel  │   │ Channel  │        │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘        │
│       └──────────────┼──────────────┘                │
│                      │                               │
│           ┌──────────┴──────────┐                   │
│           │  SessionManager     │                   │
│           └──────────┬──────────┘                   │
│                      │                               │
│           ┌──────────┴──────────┐                   │
│           │  Memory System      │                   │
│           │  (共享记忆)          │                   │
│           └─────────────────────┘                   │
└─────────────────────────────────────────────────────┘
```

### 会话 ID 格式

```
{channel}-{userId}-{timestamp}

例如：
- cli-default-user-1709020800000
- feishu-ou_xxx-1709020800000
- api-user123-1709020800000
```

### 会话持久化

会话自动持久化到 `data/memory/sessions/`：

```typescript
interface UnifiedSession {
  id: string;
  userId: string;
  channel: 'cli' | 'feishu' | 'api';
  messages: ChatMessage[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    title?: string;
  };
}
```

---

## 共享状态

### 状态管理工具

| 工具 | 说明 |
|------|------|
| `state_set` | 存储值（支持 TTL） |
| `state_get` | 获取值 |
| `state_delete` | 删除值 |
| `state_update` | 原子更新 |
| `state_exists` | 检查存在 |
| `state_list` | 列出所有键 |
| `state_stats` | 获取统计 |
| `state_lock` | 获取锁 |
| `state_unlock` | 释放锁 |

### Key 命名规范

```
category:subcategory:item

示例：
- research:react19:hooks
- config:api:timeout
- counter:tasks_completed
```

### 使用示例

```typescript
// 存储研究结果
state_set({
  key: "research:react19:hooks",
  value: ["useOptimistic", "useFormStatus"],
  ttl: 3600000  // 1小时
})

// 读取结果
const hooks = state_get({ key: "research:react19:hooks" })

// 原子更新
state_update({
  key: "counter:completed",
  operation: "increment",
  value: 1
})
```

---

## 配置参考

### 子代理配置

```json
{
  "subagent": {
    "defaultTimeout": 180000,
    "maxParallelism": 3,
    "maxRetries": 2
  }
}
```

### 会话配置

```json
{
  "session": {
    "timeout": 120000,
    "compressionThreshold": 20,
    "retention": "90d"
  }
}
```

### 状态配置

```json
{
  "state": {
    "defaultTtl": 3600000,
    "cleanupInterval": 60000,
    "enableAutoCleanup": true
  }
}
```

---

## 相关文档

- [记忆系统](./guide/memory-system.md) - 记忆存储设计
- [工具参考](./references/tools.md) - 所有工具详情
- [故障排查](./troubleshooting/README.md) - 问题诊断和解决方案
