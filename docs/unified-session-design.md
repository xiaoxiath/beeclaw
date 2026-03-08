# CLI 和 Bot 会话统一方案

> 状态: ✅ **已实施** (2026-02-28)
>
> 本文档描述的统一会话管理架构已经实施完成。CLI 和 Bot 现在共享同一个 SessionManager。

## 问题分析

### 当前架构

目前 Beeclaw 有两套独立的会话管理系统：

#### 1. CLI 会话管理（`src/cli.ts`）

```typescript
// CLI 直接创建 Agent 实例
const agent = createAgent({
  provider: defaultProvider,
  model: config.agents[0]?.model || 'glm-4',
  systemPrompt: config.agents[0]?.systemPrompt,
  tools: getAllToolsForAI(),
  toolExecutor: createDefaultToolExecutor(),
});

// 会话在 Agent 内部，内存中
agent.chat(userMessage);
```

**特点：**
- ✅ 简单直接，响应快速
- ✅ 支持 CLI 特有命令（/help, /goal, /persona 等）
- ❌ 会话在内存中，退出后丢失
- ❌ 无法与 Bot 共享对话历史
- ❌ 无法从其他渠道继续对话

#### 2. Bot 会话管理（`src/session/index.ts`）

```typescript
// Bot 通过 SessionManager 管理会话
initSessionManager({
  provider: defaultProvider,
  model: config.agents[0]?.model || 'glm-4',
  systemPrompt: config.agents[0]?.systemPrompt,
  useTools: true,
});

// 使用统一的会话 API
const result = await continueConversation(sessionId, message);
```

**特点：**
- ✅ 支持多渠道（feishu, api, webhook）
- ✅ 会话持久化（内存中，可扩展）
- ✅ 支持会话恢复和继续
- ❌ 不支持 CLI 特有命令
- ❌ CLI 没有使用这个系统

### 核心问题

1. **会话隔离**：CLI 和 Bot 各自维护会话，无法互通
2. **状态丢失**：CLI 退出后会话丢失，Bot 的会话也在内存中（未持久化）
3. **功能重复**：两套系统都实现了类似的会话管理逻辑
4. **用户体验差**：用户无法跨渠道无缝切换对话

## 统一方案

### 设计原则

1. **单一会话源**：CLI 和 Bot 都使用同一个 SessionManager
2. **会话持久化**：使用 `src/services/session.ts` 持久化会话到 `data/sessions/`
3. **渠道隔离**：同一用户可以有多个渠道的会话，但可以共享记忆
4. **向后兼容**：保持现有 API 和功能不变

### 架构设计

```
┌─────────────────────────────────────────────────────┐
│                   统一会话管理                        │
│                (Unified Session Manager)             │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐        │
│  │   CLI    │   │ Feishu   │   │   API    │        │
│  │  Channel │   │ Channel  │   │ Channel  │        │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘        │
│       │              │              │                │
│       └──────────────┼──────────────┘                │
│                      │                               │
│           ┌──────────┴──────────┐                   │
│           │  SessionManager     │                   │
│           │  (src/session/)     │                   │
│           └──────────┬──────────┘                   │
│                      │                               │
│           ┌──────────┴──────────┐                   │
│           │  SessionService     │                   │
│           │  (src/services/)    │                   │
│           └──────────┬──────────┘                   │
│                      │                               │
│           ┌──────────┴──────────┐                   │
│           │  Agent + Tools      │                   │
│           │  (src/agent/)       │                   │
│           └──────────┬──────────┘                   │
│                      │                               │
│           ┌──────────┴──────────┐                   │
│           │  Memory System      │                   │
│           │  (共享记忆)          │                   │
│           └─────────────────────┘                   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 会话 ID 设计

```typescript
// 会话 ID 格式：{channel}-{userId}-{timestamp}
// 例如：
// - cli-default-user-1709020800000
// - feishu-ou_xxx-1709020800000
// - api-user123-1709020800000

interface UnifiedSession {
  id: string;
  userId: string;
  channel: 'cli' | 'feishu' | 'api' | 'webhook';

  // 对话历史
  messages: ChatMessage[];

  // 元数据
  metadata: {
    createdAt: string;
    updatedAt: string;
    title?: string; // 会话标题
    tags?: string[]; // 标签
  };
}
```

### CLI 改造方案

#### 1. 初始化时使用 SessionManager

```typescript
// src/cli.ts

async function main() {
  const config = await loadConfig();

  // 初始化统一的 SessionManager
  const defaultProvider = config.providers.find(p => p.default)!;
  initSessionManager({
    provider: defaultProvider,
    model: config.agents[0]?.model || 'glm-4',
    systemPrompt: config.agents[0]?.systemPrompt,
    useTools: true,
  });

  // 获取或创建 CLI 会话
  const session = getOrCreateSession({
    sessionId: `cli-${getUserId()}-${Date.now()}`,
    userId: getUserId(),
    channel: 'cli',
  });

  // ... 主循环
}
```

#### 2. 使用 continueConversation API

```typescript
// 替换 agent.chat()
const result = await continueConversation(session.id, userMessage);
if (result.success && result.response) {
  console.log(result.response);
}
```

#### 3. 添加会话管理命令

```typescript
// /sessions - 列出所有会话
// /session <id> - 切换到指定会话
// /session new - 创建新会话
// /session share - 分享会话到其他渠道（可选）
```

### Bot 改造方案

Bot 已经使用 SessionManager，主要需要：

1. **持久化集成**：将 SessionService 集成到 SessionManager
2. **会话恢复**：支持从持久化存储加载历史会话
3. **跨渠道查询**：支持查询用户的所有会话（可选）

### 持久化方案

使用现有的 `SessionService` (`src/services/session.ts`)：

```typescript
// src/session/index.ts 增强

import { sessionService } from '../services/session';

export async function getOrCreateSession(options: SessionOptions): Promise<Session> {
  // 先从持久化存储加载
  let session = await sessionService.get(options.sessionId);

  if (!session) {
    // 创建新会话
    session = await sessionService.create({
      userId: options.userId,
      channel: options.channel,
      ...options.metadata,
    });
  }

  // 缓存到内存
  sessions.set(session.id, session);
  return session;
}

export async function continueConversation(
  sessionId: string,
  message: string
): Promise<ProactiveMessageResult> {
  // 从持久化存储加载会话
  const session = await sessionService.get(sessionId);

  // ... 生成回复

  // 保存消息到持久化存储
  await sessionService.addMessage(sessionId, {
    role: 'user',
    content: message,
  });
  await sessionService.addMessage(sessionId, {
    role: 'assistant',
    content: response,
  });

  // ...
}
```

### 数据流

#### CLI 对话流程（改造后）

```
用户输入
  ↓
CLI 解析命令
  ↓
├─ 特殊命令 (/help, /goal) → 直接执行
└─ 普通消息
     ↓
  continueConversation(sessionId, message)
     ↓
  SessionManager → SessionService (持久化)
     ↓
  Agent.chat() → AI 回复
     ↓
  保存消息到 SessionService
     ↓
  显示回复
```

#### Bot 对话流程（改造后）

```
飞书消息
  ↓
Webhook 接收
  ↓
continueConversation(sessionId, message)
  ↓
SessionManager → SessionService (持久化)
  ↓
Agent.chat() → AI 回复
  ↓
保存消息到 SessionService
  ↓
发送回复到飞书
```

## 实施步骤

### Phase 1: 增强持久化层（Task 2）

1. ✅ SessionService 已实现持久化
2. 增强 SessionManager 集成 SessionService
3. 添加会话加载和保存逻辑

### Phase 2: 重构 CLI（Task 3）

1. 修改 CLI 使用 SessionManager
2. 添加会话管理命令
3. 保持 CLI 特有功能

### Phase 3: 更新文档和测试（Task 4）

1. 更新 architecture.md
2. 添加使用示例
3. 添加测试用例

## 预期效果

### 对用户

- ✅ CLI 和 Bot 可以共享对话历史
- ✅ CLI 退出后再进入可以恢复会话
- ✅ 可以在 CLI 中开始对话，在 Bot 中继续
- ✅ 所有对话都有持久化记录

### 对开发者

- ✅ 统一的会话管理代码
- ✅ 更容易添加新渠道（只需要注册 channel handler）
- ✅ 会话数据结构一致
- ✅ 更好的可维护性

## 风险和注意事项

1. **性能**：持久化会增加 I/O，需要优化
   - 解决方案：使用内存缓存 + 异步持久化

2. **兼容性**：现有 API 用户可能受影响
   - 解决方案：保持 REST API 不变，只改内部实现

3. **数据迁移**：现有会话数据需要迁移
   - 解决方案：提供迁移脚本（可选）

4. **CLI 用户体验**：首次加载可能变慢
   - 解决方案：懒加载会话历史

## 后续优化

1. **会话搜索**：支持搜索历史会话
2. **会话分享**：生成分享链接
3. **会话导出**：导出为 Markdown
4. **会话分析**：统计对话主题和频率
5. **智能会话恢复**：根据上下文自动恢复相关会话

## 参考

- [架构设计](./unify-cli-bot-architecture.md) - 完整的重构方案和实施记录
- [会话管理](../src/session/index.ts)
- [持久化服务](../src/services/session.ts)

---

## ✅ 实施完成 (2026-02-28)

### 核心改动

1. **统一初始化** (`src/app/index.ts`)
   - `initApp()` 现在初始化 SessionManager
   - 自动加载所有持久化会话
   - CLI 和 Bot 共享初始化流程

2. **CLI 重构** (`src/cli.ts`)
   - 使用 `getOrCreateSession()` 创建 CLI 会话
   - 使用 `continueConversation()` 处理对话
   - 会话 ID 格式: `cli-{userId}-{date}`

3. **Bot 无需修改** (`src/session/index.ts`)
   - SessionManager 已有完整功能
   - 持久化、压缩、超时处理均已实现

### 实施效果

✅ **CLI 获得新功能**:
- 会话持久化 (重启后恢复)
- 会话压缩 (自动压缩旧对话)
- 对话超时保护 (2分钟)
- 历史会话加载

✅ **CLI 和 Bot 统一**:
- 共享同一个 SessionManager
- 共享记忆系统 (data/memory/)
- 统一的 System Prompt
- 统一的工具集

✅ **代码质量提升**:
- 消除重复代码
- 统一对话处理流程
- 更好的可维护性

### 使用示例

#### CLI 使用

```bash
# 启动 CLI (自动创建或加载今日会话)
bun run src/cli.ts

# CLI 会话自动保存到:
# data/memory/sessions/cli-{user}-{date}.json
```

#### Bot 使用

```typescript
// Bot 继续使用现有 API
const result = await continueConversation(sessionId, message);
```

#### 跨渠道共享

```typescript
// CLI 和 Bot 可以访问同一个会话 (如果知道 sessionId)
const session = getSession('cli-keith-2026-02-28');
const result = await continueConversation(session.id, '继续上次的话题');
```

### 下一步优化

可选功能 (未实施):
- [ ] `/sessions` 命令 - 列出所有历史会话
- [ ] `/session <id>` - 切换到指定会话
- [ ] 会话搜索功能
- [ ] 会话导出为 Markdown
- [ ] 智能会话推荐
