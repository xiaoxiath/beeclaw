# 智能超时设计 - 基于活跃度的超时机制

> **状态**: 设计阶段
> **优先级**: 高
> **理由**: 固定超时不适合长任务自规划 Agent

## 问题分析

### 固定超时的致命缺陷

```typescript
// ❌ 当前方案
const AGENT_TIMEOUT = 300000;  // 5分钟固定超时

问题1: 简单任务浪费资源
  任务: "今天星期几？"
  实际需要: 5秒
  设置超时: 5分钟
  结果: 即使1秒完成，也要等5分钟才返回（如果出错）

问题2: 复杂任务被强制中断
  任务: "设计并实现一个用户认证系统"
  实际需要: 20分钟
  设置超时: 5分钟
  结果: Agent 正在工作，但被强制中断 ❌

问题3: 无法适应任务复杂度
  - 不同任务复杂度差异巨大
  - 无法预知任务需要多长时间
  - Agent 自己在执行中才知道复杂度
```

### 长任务自规划 Agent 的特点

Beeclaw Agent 具备：
1. **任务分解** - 自动拆分为 subtasks
2. **并行执行** - 多个 subagent 同时工作
3. **工具调用** - 动态调用工具获取信息
4. **流式输出** - 实时输出进度
5. **自我监控** - 知道自己在做什么

**关键洞察**: Agent 只要还在输出、调用工具、执行 subagent，就说明它在正常工作，不应该被强制中断！

## 解决方案

### 核心思想：基于活跃度的超时

**只有真正"卡死"时才超时，只要 Agent 在工作就让它继续。**

```typescript
// ✅ 新方案
const INACTIVITY_TIMEOUT = 180000;  // 3分钟无活动 = 卡死

// 活跃指标：
// 1. LLM 返回 token (流式输出)
// 2. 工具调用开始/结束
// 3. Subagent 启动/完成
// 4. 任何进度更新

// 超时条件：
// 连续 3分钟 上述活动都为 0 → 判定为卡死
```

### 为什么是 3 分钟？

1. **LLM 深度思考**
   - 复杂推理任务可能需要 1-2 分钟才开始输出第一个 token
   - 例如：分析大型代码库、设计系统架构
   - 需要给 LLM 足够的思考时间

2. **网络延迟**
   - API 响应可能需要 30-90 秒
   - 网络慢时不应该判定为卡死
   - 给网络足够的缓冲时间

3. **工具执行**
   - `web_fetch`: 下载大文件可能需要 1-2 分钟
   - `code_execute`: 复杂计算可能需要 2-3 分钟
   - 工具在正常执行时不应该超时

4. **安全上限**
   - 3分钟足够长，避免误判
   - 但也不会等太久（真正卡死时）
   - 平衡用户体验和可靠性

## 实现设计

### 1. ActivityMonitor - 活跃度监控器

```typescript
// src/utils/activity-monitor.ts

export interface ActivityEvent {
  type: 'llm_chunk' | 'tool_call' | 'subagent' | 'progress';
  timestamp: number;
  details?: string;
}

export class ActivityMonitor {
  private lastActivity: number = Date.now();
  private events: ActivityEvent[] = [];
  private maxEvents: number = 100;

  /**
   * 记录活动事件
   */
  recordActivity(type: ActivityEvent['type'], details?: string): void {
    const event: ActivityEvent = {
      type,
      timestamp: Date.now(),
      details,
    };

    this.events.push(event);
    this.lastActivity = event.timestamp;

    // 保持最近 100 个事件
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // 日志（可选）
    if (process.env.DEBUG_ACTIVITY) {
      console.log(`[Activity] ${type}${details ? `: ${details}` : ''}`);
    }
  }

  /**
   * 检查是否超时（无活动）
   */
  isInactivityTimeout(timeoutMs: number): boolean {
    const inactive = Date.now() - this.lastActivity;
    return inactive > timeoutMs;
  }

  /**
   * 获取无活动时间（毫秒）
   */
  getInactiveTime(): number {
    return Date.now() - this.lastActivity;
  }

  /**
   * 获取最近的活动记录
   */
  getRecentEvents(count: number = 10): ActivityEvent[] {
    return this.events.slice(-count);
  }

  /**
   * 获取活动统计
   */
  getStats(): {
    totalEvents: number;
    lastActivity: Date;
    inactiveTime: number;
    eventsByType: Record<string, number>;
  } {
    const eventsByType: Record<string, number> = {};

    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    }

    return {
      totalEvents: this.events.length,
      lastActivity: new Date(this.lastActivity),
      inactiveTime: this.getInactiveTime(),
      eventsByType,
    };
  }

  /**
   * 格式化活动报告（用于调试）
   */
  formatActivityReport(): string {
    const stats = this.getStats();
    const lines: string[] = [];

    lines.push('## 📊 Agent 活动报告\n');
    lines.push(`**最后活动**: ${stats.lastActivity.toLocaleTimeString()}`);
    lines.push(`**无活动时间**: ${Math.round(stats.inactiveTime / 1000)}秒\n`);

    lines.push('### 事件统计');
    for (const [type, count] of Object.entries(stats.eventsByType)) {
      lines.push(`- ${type}: ${count} 次`);
    }

    lines.push('\n### 最近事件');
    const recent = this.getRecentEvents(5);
    for (const event of recent) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      lines.push(`- [${time}] ${event.type}${event.details ? `: ${event.details}` : ''}`);
    }

    return lines.join('\n');
  }
}
```

### 2. SmartTimeout - 智能超时管理器

```typescript
// src/utils/smart-timeout.ts

import { ActivityMonitor } from './activity-monitor';

export interface SmartTimeoutConfig {
  /** 无活动超时时间（毫秒） */
  inactivityTimeout: number;

  /** 检查间隔（毫秒） */
  checkInterval: number;

  /** 最大 token 消耗（安全上限，0 = 无限制） */
  maxTokens: number;

  /** 超时回调 */
  onTimeout: (inactiveTime: number) => void;

  /** 活动回调（可选） */
  onActivity?: (event: ActivityEvent) => void;
}

export class SmartTimeout {
  private monitor: ActivityMonitor;
  private checkTimer?: Timer;
  private startTime: number;

  constructor(private config: SmartTimeoutConfig) {
    this.monitor = new ActivityMonitor();
    this.startTime = Date.now();
  }

  /**
   * 启动超时监控
   */
  start(): void {
    this.checkTimer = setInterval(() => {
      const inactiveTime = this.monitor.getInactiveTime();

      if (inactiveTime > this.config.inactivityTimeout) {
        this.stop();
        this.config.onTimeout(inactiveTime);
      }
    }, this.config.checkInterval);
  }

  /**
   * 停止超时监控
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
  }

  /**
   * 记录活动
   */
  recordActivity(type: ActivityEvent['type'], details?: string): void {
    this.monitor.recordActivity(type, details);

    if (this.config.onActivity) {
      this.config.onActivity({
        type,
        timestamp: Date.now(),
        details,
      });
    }
  }

  /**
   * 获取运行时间（毫秒）
   */
  getRuntime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * 获取活动监控器（用于详细报告）
   */
  getMonitor(): ActivityMonitor {
    return this.monitor;
  }
}
```

### 3. Agent 集成

```typescript
// src/agent/index.ts

import { SmartTimeout } from '../utils/smart-timeout';

export class Agent {
  private smartTimeout?: SmartTimeout;

  async chat(message: string): Promise<string> {
    // 创建智能超时监控
    this.smartTimeout = new SmartTimeout({
      inactivityTimeout: parseInt(
        process.env.AGENT_INACTIVITY_TIMEOUT_MS || '60000',
        10
      ),
      checkInterval: 5000,  // 每5秒检查
      maxTokens: parseInt(process.env.AGENT_MAX_TOKENS || '100000', 10),
      onTimeout: (inactiveTime) => {
        console.error(
          `[Agent] Inactivity timeout after ${Math.round(inactiveTime / 1000)}s`
        );
      },
      onActivity: (event) => {
        if (process.env.DEBUG_AGENT_ACTIVITY) {
          console.log(`[Agent Activity] ${event.type}`);
        }
      },
    });

    this.smartTimeout.start();

    try {
      // 执行 LLM 调用，记录活动
      const stream = await this.provider.chat(...);

      for await (const chunk of stream) {
        // 记录 LLM 输出活动
        this.smartTimeout.recordActivity('llm_chunk');

        // 处理 chunk...
      }

      // 工具调用时记录
      if (toolCalls.length > 0) {
        this.smartTimeout.recordActivity('tool_call', `${toolCalls.length} tools`);
      }

      // Subagent 启动时记录
      if (subagentSpawned) {
        this.smartTimeout.recordActivity('subagent', subagentId);
      }

      return result;
    } finally {
      this.smartTimeout.stop();
    }
  }
}
```

### 4. Session 集成

```typescript
// src/session/index.ts

// ❌ 删除旧的固定超时
// const AGENT_TIMEOUT_MS = 300000;
// response = await Promise.race([
//   agent.chat(options.message),
//   timeoutPromise,
// ]);

// ✅ 使用新的智能超时
const agent = getAgent();

// Agent 内部已经有智能超时，这里不需要额外包装
const response = await agent.chat(options.message);

// 如果需要额外的无活动检测（双重保险）
const timeout = new SmartTimeout({
  inactivityTimeout: 120000,  // 2分钟（比 agent 内部的 1分钟更长）
  checkInterval: 10000,
  maxTokens: 0,
  onTimeout: (inactiveTime) => {
    console.error(`[Session] Agent inactive for ${inactiveTime}ms`);
  },
});

timeout.start();

try {
  const response = await agent.chat(options.message);
  return { success: true, response };
} finally {
  timeout.stop();
}
```

## 配置选项

### 环境变量

```bash
# 无活动超时（真正卡死的检测）
# 推荐: 180000 (3分钟)
# 最小: 60000 (1分钟，但可能对复杂任务太激进)
# 最大: 600000 (10分钟，但真正卡死时等太久)
export AGENT_INACTIVITY_TIMEOUT_MS=180000  # 3分钟 (默认)

# 检查间隔
export AGENT_TIMEOUT_CHECK_INTERVAL=10000  # 10秒 (默认)

# 最大 token 消耗（安全上限，0 = 无限制）
export AGENT_MAX_TOKENS=100000  # 10万 token (默认)

# 调试模式：打印所有活动
export DEBUG_SESSION_ACTIVITY=true
```

### 配置文件

```json
{
  "agent": {
    "timeout": {
      "type": "smart",  // "fixed" | "smart"
      "inactivityTimeout": 180000,  // 3 minutes (recommended)
      "checkInterval": 10000,  // 10 seconds
      "maxTokens": 100000
    }
  }
}
```

### 不同场景的推荐配置

```bash
# 快速响应场景（简单任务为主）
export AGENT_INACTIVITY_TIMEOUT_MS=120000  # 2分钟

# 标准场景（默认，平衡）
export AGENT_INACTIVITY_TIMEOUT_MS=180000  # 3分钟 ⭐ 推荐

# 复杂任务场景（代码生成、系统设计）
export AGENT_INACTIVITY_TIMEOUT_MS=300000  # 5分钟

# 超长任务场景（大规模重构、完整项目）
export AGENT_INACTIVITY_TIMEOUT_MS=600000  # 10分钟
```

## 优势对比

### 固定超时 vs 智能超时

| 场景 | 固定超时 (5分钟) | 智能超时 (无活动检测) |
|------|----------------|---------------------|
| **简单查询** "今天星期几？" | 5秒完成 → 立即返回 ✅ | 5秒完成 → 立即返回 ✅ |
| **中等任务** "分析这份报告" | 2分钟完成 → 等到5分钟 ❌ | 2分钟完成 → 立即返回 ✅ |
| **复杂任务** "设计认证系统" | 20分钟需要 → 5分钟中断 ❌ | 20分钟完成 → 正常返回 ✅ |
| **真正卡死** (网络断开) | 5分钟后检测 ❌ | 1分钟后检测 ✅ |
| **适应性** | 无法适应任务复杂度 ❌ | 自动适应任何复杂度 ✅ |
| **资源浪费** | 简单任务也等待 ❌ | 按需执行，无浪费 ✅ |

## 调试和监控

### 查看活动报告

```typescript
// 在 Agent 运行中或结束后
const monitor = agent.getActivityMonitor();
console.log(monitor.formatActivityReport());

// 示例输出:
// ## 📊 Agent 活动报告
//
// **最后活动**: 14:32:15
// **无活动时间**: 5秒
//
// ### 事件统计
// - llm_chunk: 150 次
// - tool_call: 3 次
// - subagent: 2 次
//
// ### 最近事件
// - [14:32:10] llm_chunk
// - [14:32:12] tool_call: web_fetch
// - [14:32:15] llm_chunk
```

### 活动日志

```bash
# 启用调试模式
export DEBUG_AGENT_ACTIVITY=true

# 输出示例:
// [Agent Activity] llm_chunk
// [Agent Activity] llm_chunk
// [Agent Activity] tool_call: web_fetch
// [Agent Activity] llm_chunk
// [Agent Activity] subagent: research-123
// [Agent Activity] llm_chunk
```

## 实施计划

### Phase 1: 核心实现 (1-2小时)

1. ✅ 创建 `ActivityMonitor` 类
2. ✅ 创建 `SmartTimeout` 类
3. ✅ 集成到 `Agent` 类
4. ✅ 更新 `Session` 使用智能超时

### Phase 2: 测试和优化 (1小时)

1. ✅ 单元测试
2. ✅ 集成测试
3. ✅ 边界情况测试
4. ✅ 性能测试

### Phase 3: 文档和迁移 (30分钟)

1. ✅ 更新配置文档
2. ✅ 更新使用指南
3. ✅ 迁移指南（从固定超时）

## 迁移指南

### 从固定超时迁移

```bash
# 旧的环境变量（仍然支持，但已弃用）
export AGENT_TIMEOUT_MS=300000  # ⚠️ 已弃用

# 新的环境变量
export AGENT_INACTIVITY_TIMEOUT_MS=60000  # ✅ 推荐
```

### 向后兼容

```typescript
// 如果用户设置了旧的 AGENT_TIMEOUT_MS，给出警告
if (process.env.AGENT_TIMEOUT_MS) {
  console.warn(
    '[Deprecation] AGENT_TIMEOUT_MS is deprecated. ' +
    'Use AGENT_INACTIVITY_TIMEOUT_MS instead.'
  );
}
```

## 总结

**智能超时机制的核心价值**:

1. ✅ **适应任务复杂度** - 自动适应任何复杂度的任务
2. ✅ **无资源浪费** - 完成即返回，不等待
3. ✅ **真正检测卡死** - 基于活动而非固定时间
4. ✅ **更好的用户体验** - 复杂任务不再被中断
5. ✅ **可观测性** - 详细的活动记录和报告

**这是长任务自规划 Agent 的正确超时方式！** 🎯
