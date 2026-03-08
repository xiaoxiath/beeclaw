# Beeclaw 待办事项清单

> 检查时间: 2026-02-28
> 状态: Phase 5 完成后的项目审查

## ✅ 已完成的系统

### 子代理系统 (Phase 1-5)

1. ✅ **Phase 1**: 并行工具执行
2. ✅ **Phase 2**: 子代理运行时
3. ✅ **Phase 3**: 任务分解与编排
4. ✅ **Phase 4**: 子代理工具集成
5. ✅ **Phase 5**: 共享状态管理

**状态**: 所有核心功能已实现，代码已提交并推送

### 其他已完成系统

- ✅ 统一初始化系统 (initApp)
- ✅ 会话管理系统 (SessionManager)
- ✅ 记忆系统
- ✅ 目标系统
- ✅ 技能系统
- ✅ 主动任务系统
- ✅ 飞书 Bot 集成

---

## 📋 待实现内容

### 优先级 1: 测试补充

#### 子代理系统测试

**文件**: `src/subagent/__tests__/`

**需要创建的测试文件**:

1. `runtime.test.ts` - 子代理运行时测试
   ```typescript
   - 测试子代理生成和执行
   - 测试工具过滤
   - 测试超时处理
   - 测试并行执行
   ```

2. `orchestrator.test.ts` - 任务编排器测试
   ```typescript
   - 测试任务分解
   - 测试 DAG 调度
   - 测试循环依赖检测
   - 测试重试机制
   ```

3. `state.test.ts` - 共享状态测试
   ```typescript
   - 测试基本 CRUD 操作
   - 测试锁机制
   - 测试 TTL 和过期
   - 测试订阅通知
   - 测试原子更新
   ```

4. `tools.test.ts` - 工具定义测试
   ```typescript
   - 测试工具参数验证
   - 测试结果格式化
   ```

**预计工作量**: 1-2 天

**优先级**: ⭐⭐⭐⭐⭐ (高)

---

### 优先级 2: 功能增强

#### 2.1 Token 统计提取

**文件**: `src/subagent/runtime.ts:114`

**当前状态**:
```typescript
tokensUsed: 0, // TODO: extract from agent
```

**需要实现**:
- 从 Agent 实例中提取实际 token 使用量
- 更新 SubagentResult.tokensUsed 字段

**预计工作量**: 1-2 小时

**优先级**: ⭐⭐⭐ (中)

---

#### 2.2 CLI 可选功能

**文件**: `src/cli.ts`

**待实现命令**:

1. `/save` - 手动保存当前会话
2. `/load <session-id>` - 加载指定会话
3. `/sessions` - 列出所有会话

**代码示例**:
```typescript
// /save 命令
if (input === '/save') {
  const sessionId = getCurrentSessionId();
  await saveSession(sessionId);
  console.log(`✅ Session saved: ${sessionId}`);
}

// /load 命令
if (input.startsWith('/load ')) {
  const sessionId = input.substring(6).trim();
  const session = await loadSession(sessionId);
  setCurrentSession(session);
  console.log(`✅ Loaded session: ${sessionId}`);
}

// /sessions 命令
if (input === '/sessions') {
  const sessions = await listAllSessions();
  sessions.forEach(s => {
    console.log(`${s.id} - ${s.messageCount} messages - ${s.lastUpdated}`);
  });
}
```

**预计工作量**: 0.5 天

**优先级**: ⭐⭐ (低)

---

#### 2.3 Daemon 模式任务处理

**文件**: `src/cli.ts` 或新建 `src/daemon.ts`

**功能描述**:
- CLI 启动时检查是否有定时任务需要执行
- 后台执行主动任务 (proactive tasks)
- 显示任务执行通知

**实现要点**:
```typescript
// 在 CLI 启动时
async function checkPendingTasks() {
  const tasks = await getPendingProactiveTasks();
  if (tasks.length > 0) {
    console.log(`\n📅 You have ${tasks.length} pending tasks:`);
    tasks.forEach(task => {
      console.log(`  - ${task.description}`);
    });
  }
}
```

**预计工作量**: 1 天

**优先级**: ⭐⭐⭐ (中)

---

### 优先级 3: 错误处理改进

#### 3.1 统一错误类

**文件**: `src/utils/errors.ts` (新建)

**需要创建的错误类**:
```typescript
// 基础错误类
export class BeeclawError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'BeeclawError';
  }
}

// 子代理错误
export class SubagentError extends BeeclawError {
  constructor(message: string, public subagentId: string) {
    super(message, 'SUBAGENT_ERROR');
    this.name = 'SubagentError';
  }
}

// 状态错误
export class StateError extends BeeclawError {
  constructor(message: string, public key: string) {
    super(message, 'STATE_ERROR');
    this.name = 'StateError';
  }
}

// 锁错误
export class LockError extends BeeclawError {
  constructor(message: string, public key: string) {
    super(message, 'LOCK_ERROR');
    this.name = 'LockError';
  }
}

// 任务编排错误
export class OrchestrationError extends BeeclawError {
  constructor(message: string, public taskId?: number) {
    super(message, 'ORCHESTRATION_ERROR');
    this.name = 'OrchestrationError';
  }
}
```

**预计工作量**: 0.5 天

**优先级**: ⭐⭐⭐ (中)

---

#### 3.2 统一日志格式

**文件**: `src/utils/logger.ts`

**改进方向**:
- 统一日志前缀
- 添加模块标识
- 改进错误堆栈显示
- 添加性能指标

**日志格式示例**:
```
[Beeclaw:Subagent] Spawning research subagent...
[Beeclaw:Subagent] Task: "Search React 19 features"
[Beeclaw:Subagent] ✅ Completed in 3200ms (847 tokens)
```

**预计工作量**: 0.5 天

**优先级**: ⭐⭐ (低)

---

### 优先级 4: 文档改进

#### 4.1 更新 README

**文件**: `README.md`

**需要添加的内容**:
- 子代理系统介绍
- 状态管理工具说明
- 使用示例
- 性能特性

**预计工作量**: 1-2 小时

**优先级**: ⭐⭐⭐ (中)

---

#### 4.2 工具文档

**文件**: `docs/tools-reference.md`

**需要添加**:
- 子代理工具 (spawn_subagent, spawn_parallel)
- 状态管理工具 (state_set, state_get, 等)

**预计工作量**: 2-3 小时

**优先级**: ⭐⭐⭐ (中)

---

### 优先级 5: 性能优化

#### 5.1 子代理嵌套深度限制

**文件**: `src/subagent/runtime.ts`

**功能**: 防止子代理嵌套过深

**实现**:
```typescript
const MAX_SUBAGENT_DEPTH = 2;

function spawnSubagent(config: SubagentConfig): Promise<SubagentResult> {
  const currentDepth = getCurrentDepth();

  if (currentDepth >= MAX_SUBAGENT_DEPTH) {
    throw new SubagentError(
      `Maximum subagent depth (${MAX_SUBAGENT_DEPTH}) reached`,
      config.id || 'unknown'
    );
  }

  // ... 继续执行
}
```

**预计工作量**: 2-3 小时

**优先级**: ⭐⭐⭐ (中)

---

#### 5.2 状态持久化

**文件**: `src/subagent/state.ts`

**功能**: 将共享状态持久化到磁盘

**实现要点**:
```typescript
class SharedState {
  private persistencePath?: string;

  constructor(options: SharedStateOptions = {}) {
    // ...
    this.persistencePath = options.persistencePath;

    if (this.persistencePath) {
      this.loadFromDisk();
    }
  }

  async saveToDisk(): Promise<void> {
    if (!this.persistencePath) return;

    const data = await this.export();
    await writeFile(this.persistencePath, data, 'utf-8');
  }

  async loadFromDisk(): Promise<void> {
    if (!this.persistencePath) return;

    try {
      const data = await readFile(this.persistencePath, 'utf-8');
      await this.import(data);
    } catch (error) {
      // 文件不存在，忽略
    }
  }
}
```

**预计工作量**: 1 天

**优先级**: ⭐⭐ (低)

---

## 📊 工作量汇总

| 优先级 | 任务 | 预计工作量 |
|--------|------|-----------|
| ⭐⭐⭐⭐⭐ | 子代理系统测试 | 1-2 天 |
| ⭐⭐⭐ | Token 统计提取 | 1-2 小时 |
| ⭐⭐⭐ | Daemon 模式 | 1 天 |
| ⭐⭐⭐ | 统一错误类 | 0.5 天 |
| ⭐⭐⭐ | 文档更新 | 0.5 天 |
| ⭐⭐⭐ | 嵌套深度限制 | 2-3 小时 |
| ⭐⭐ | CLI 可选功能 | 0.5 天 |
| ⭐⭐ | 统一日志格式 | 0.5 天 |
| ⭐⭐ | 状态持久化 | 1 天 |

**总计**: 约 5-7 天工作量

---

## 🎯 建议实施顺序

### 阶段 1: 质量保证 (1-2 天)

1. ✅ 编写子代理系统测试
   - runtime.test.ts
   - orchestrator.test.ts
   - state.test.ts
   - tools.test.ts

### 阶段 2: 功能完善 (1-2 天)

1. ✅ Token 统计提取 (1-2 小时)
2. ✅ 嵌套深度限制 (2-3 小时)
3. ✅ 统一错误类 (0.5 天)
4. ✅ Daemon 模式 (1 天)

### 阶段 3: 文档和优化 (1 天)

1. ✅ 更新 README (1-2 小时)
2. ✅ 更新工具文档 (2-3 小时)
3. ✅ CLI 可选功能 (0.5 天)
4. ⏸️ 状态持久化 (可选，按需实现)

---

## 💡 优先级说明

- ⭐⭐⭐⭐⭐ **非常高**: 核心功能，影响系统稳定性
- ⭐⭐⭐⭐ **高**: 重要功能，影响用户体验
- ⭐⭐⭐ **中**: 增强功能，提升系统质量
- ⭐⭐ **低**: 可选功能，锦上添花
- ⭐ **非常低**: 未来考虑，非当前重点

---

## 🚀 立即可以做的

如果你现在想继续推进，建议从以下任务开始：

### 最小可行改进 (2-3 小时)

1. **Token 统计提取** - 完善 runtime.ts
2. **嵌套深度限制** - 防止无限嵌套
3. **统一错误类** - 创建 errors.ts

### 或者

### 测试先行 (1 天)

编写完整的子代理系统测试，确保代码质量。

---

## ✅ 总结

**子代理系统的所有核心功能已经完成！**

剩余的主要是：
1. **测试补充** - 提高代码质量
2. **功能增强** - 提升用户体验
3. **文档完善** - 便于使用和维护

这些都是增强性工作，不影响核心系统的使用。你可以：
- 现在立即实施
- 等有需求时再实施
- 或者有其他优先级更高的任务

**建议**: 先使用一段时间，根据实际使用反馈决定后续优化方向。
