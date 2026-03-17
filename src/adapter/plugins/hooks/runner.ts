/**
 * Hook Runner
 *
 * 参考 OpenClaw 的钩子运行器设计
 * 支持顺序执行（可修改）、并行执行（fire-and-forget）、同步执行（热路径）
 */

import type {
  HookName,
  HookHandler,
  HookContext,
  HookRegistration,
  PluginHookAgentContext,
  PluginHookBeforeModelResolveEvent,
  PluginHookBeforeModelResolveResult,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforePromptBuildResult,
  PluginHookMessageSendingEvent,
  PluginHookMessageSendingResult,
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolResultPersistEvent,
  PluginHookToolResultPersistResult,
  PluginHookBeforeMessageWriteEvent,
  PluginHookBeforeMessageWriteResult,
} from './types';

export type HookRunnerLogger = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type HookRunnerOptions = {
  logger?: HookRunnerLogger;
  /** 如果为 true，钩子中的错误将被捕获并记录而不是抛出 */
  catchErrors?: boolean;
};

/**
 * 按优先级获取指定名称的钩子（高优先级优先）
 */
function getHooksForName<K extends HookName>(
  hooks: Map<HookName, HookRegistration[]>,
  hookName: K,
): HookRegistration[] {
  const registrations = hooks.get(hookName) || [];
  return [...registrations].sort((a, b) => b.priority - a.priority);
}

/**
 * 钩子运行器
 */
export class HookRunner {
  private hooks: Map<HookName, HookRegistration[]> = new Map();
  private logger: HookRunnerLogger;
  private catchErrors: boolean;

  constructor(options: HookRunnerOptions = {}) {
    this.logger = options.logger || {
      warn: console.warn,
      error: console.error,
    };
    this.catchErrors = options.catchErrors ?? true;
  }

  /**
   * 注册钩子
   */
  register(registration: HookRegistration): () => void {
    const hooks = this.hooks.get(registration.hookName) || [];
    hooks.push(registration);
    this.hooks.set(registration.hookName, hooks);

    // 返回取消注册函数
    return () => {
      const idx = hooks.findIndex(h => h.id === registration.id);
      if (idx >= 0) {
        hooks.splice(idx, 1);
      }
    };
  }

  /**
   * 取消注册钩子
   */
  unregister(hookName: HookName, id: string): boolean {
    const hooks = this.hooks.get(hookName);
    if (!hooks) return false;

    const idx = hooks.findIndex(h => h.id === id);
    if (idx >= 0) {
      hooks.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * 获取指定钩子的注册数量
   */
  getRegistrationCount(hookName: HookName): number {
    return this.hooks.get(hookName)?.length || 0;
  }

  /**
   * 获取所有注册的钩子名称
   */
  getRegisteredHookNames(): HookName[] {
    return Array.from(this.hooks.keys());
  }

  // ============================================================================
  // 顺序执行（可修改结果）
  // ============================================================================

  /**
   * 顺序执行钩子，允许每个钩子修改事件
   * 高优先级先执行，后续钩子可以覆盖之前的结果
   */
  async runSequential<T>(
    hookName: HookName,
    event: T,
    ctx: HookContext,
  ): Promise<T> {
    const hooks = getHooksForName(this.hooks, hookName);
    if (hooks.length === 0) {
      return event;
    }

    let currentEvent = event;

    for (const reg of hooks) {
      try {
        const result = await reg.handler(currentEvent, ctx);
        if (result !== undefined && result !== null) {
          // 合并结果到事件
          currentEvent = { ...currentEvent, ...result } as T;
        }
      } catch (error) {
        this.handleHookError(hookName, reg, error);
        if (!this.catchErrors) {
          throw error;
        }
      }
    }

    return currentEvent;
  }

  // ============================================================================
  // 并行执行（fire-and-forget）
  // ============================================================================

  /**
   * 并行执行所有钩子，不修改事件
   * 适用于观测性质的钩子（日志、分析等）
   */
  async runParallel(
    hookName: HookName,
    event: unknown,
    ctx: HookContext,
  ): Promise<void> {
    const hooks = getHooksForName(this.hooks, hookName);
    if (hooks.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      hooks.map(async (reg) => {
        try {
          await reg.handler(event, ctx);
        } catch (error) {
          this.handleHookError(hookName, reg, error);
          if (!this.catchErrors) {
            throw error;
          }
        }
      }),
    );

    // 记录失败的钩子
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        this.logger.error?.(
          `[hooks] ${hookName} handler from ${hooks[idx].id} rejected: ${result.reason}`,
        );
      }
    });
  }

  // ============================================================================
  // 同步执行（热路径）
  // ============================================================================

  /**
   * 同步执行钩子（用于热路径，如工具结果持久化）
   * 所有处理器必须是同步的
   */
  runSync<T>(hookName: HookName, event: T, ctx: HookContext): T {
    const hooks = getHooksForName(this.hooks, hookName);
    if (hooks.length === 0) {
      return event;
    }

    let currentEvent = event;

    for (const reg of hooks) {
      try {
        const result = reg.handler(currentEvent, ctx);
        // 不支持异步结果
        if (result instanceof Promise) {
          this.logger.warn?.(
            `[hooks] ${hookName} handler ${reg.id} returned Promise in sync context`,
          );
          continue;
        }
        if (result !== undefined && result !== null) {
          currentEvent = { ...currentEvent, ...result } as T;
        }
      } catch (error) {
        this.handleHookError(hookName, reg, error);
        if (!this.catchErrors) {
          throw error;
        }
      }
    }

    return currentEvent;
  }

  // ============================================================================
  // 特定类型钩子的便捷方法
  // ============================================================================

  /**
   * before_model_resolve 钩子
   */
  async runBeforeModelResolve(
    _event: PluginHookBeforeModelResolveEvent,
    ctx: PluginHookAgentContext,
  ): Promise<PluginHookBeforeModelResolveResult> {
    const hookCtx: HookContext = {
      ...ctx,
      timestamp: new Date().toISOString(),
    };
    return this.runSequential<PluginHookBeforeModelResolveResult>(
      'before_model_resolve',
      {} as PluginHookBeforeModelResolveResult,
      hookCtx,
    );
  }

  /**
   * before_prompt_build 钩子
   */
  async runBeforePromptBuild(
    _event: PluginHookBeforePromptBuildEvent,
    ctx: PluginHookAgentContext,
  ): Promise<PluginHookBeforePromptBuildResult> {
    const hookCtx: HookContext = {
      ...ctx,
      timestamp: new Date().toISOString(),
    };
    return this.runSequential<PluginHookBeforePromptBuildResult>(
      'before_prompt_build',
      {} as PluginHookBeforePromptBuildResult,
      hookCtx,
    );
  }

  /**
   * message_sending 钩子（可取消消息）
   */
  async runMessageSending(
    event: PluginHookMessageSendingEvent,
    ctx: { channelId: string; accountId?: string },
  ): Promise<{ content: string; cancelled: boolean }> {
    const hookCtx: HookContext = {
      ...ctx,
      timestamp: new Date().toISOString(),
    };
    const result = await this.runSequential<PluginHookMessageSendingResult>(
      'message_sending',
      {} as PluginHookMessageSendingResult,
      hookCtx,
    );

    return {
      content: result.content ?? event.content,
      cancelled: result.cancel ?? false,
    };
  }

  /**
   * before_tool_call 钩子（可阻止工具调用）
   */
  async runBeforeToolCall(
    event: PluginHookBeforeToolCallEvent,
    ctx: { agentId?: string; sessionKey?: string; toolName: string },
  ): Promise<{ params: Record<string, unknown>; blocked: boolean; blockReason?: string }> {
    const hookCtx: HookContext = {
      ...ctx,
      timestamp: new Date().toISOString(),
    };
    const result = await this.runSequential<PluginHookBeforeToolCallResult>(
      'before_tool_call',
      {} as PluginHookBeforeToolCallResult,
      hookCtx,
    );

    return {
      params: result.params ?? event.params,
      blocked: result.block ?? false,
      blockReason: result.blockReason,
    };
  }

  /**
   * tool_result_persist 钩子（同步）
   */
  runToolResultPersist(
    event: PluginHookToolResultPersistEvent,
    ctx: { agentId?: string; sessionKey?: string; toolName?: string; toolCallId?: string },
  ): PluginHookToolResultPersistEvent {
    const hookCtx: HookContext = {
      ...ctx,
      timestamp: new Date().toISOString(),
    };
    const result = this.runSync<PluginHookToolResultPersistResult>(
      'tool_result_persist',
      {} as PluginHookToolResultPersistResult,
      hookCtx,
    );

    if (result.message) {
      return { ...event, message: result.message };
    }
    return event;
  }

  /**
   * before_message_write 钩子（同步）
   */
  runBeforeMessageWrite(
    event: PluginHookBeforeMessageWriteEvent,
    ctx: { agentId?: string; sessionKey?: string },
  ): { message: typeof event.message; blocked: boolean } {
    const hookCtx: HookContext = {
      ...ctx,
      timestamp: new Date().toISOString(),
    };
    const result = this.runSync<PluginHookBeforeMessageWriteResult>(
      'before_message_write',
      {} as PluginHookBeforeMessageWriteResult,
      hookCtx,
    );

    return {
      message: result.message ?? event.message,
      blocked: result.block ?? false,
    };
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  private toHookContext(ctx: Record<string, unknown>): HookContext {
    return {
      ...ctx,
      timestamp: new Date().toISOString(),
    } as HookContext;
  }

  private handleHookError(
    hookName: HookName,
    registration: HookRegistration,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error?.(
      `[hooks] ${hookName} handler from ${registration.id} (${registration.source}) failed: ${message}`,
    );
  }

  /**
   * 清除所有钩子注册
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * 清除特定来源的钩子
   */
  clearBySource(source: string): number {
    let count = 0;
    for (const [name, hooks] of this.hooks.entries()) {
      const filtered = hooks.filter((h) => {
        if (h.source === source) {
          count++;
          return false;
        }
        return true;
      });
      this.hooks.set(name, filtered);
    }
    return count;
  }
}

// ============================================================================
// 单例
// ============================================================================

let hookRunner: HookRunner | null = null;

export function getHookRunner(): HookRunner {
  if (!hookRunner) {
    hookRunner = new HookRunner();
  }
  return hookRunner;
}

export function resetHookRunner(): void {
  if (hookRunner) {
    hookRunner.clear();
  }
  hookRunner = null;
}

/**
 * 注册钩子的便捷方法
 */
export function registerHook(
  hookName: HookName,
  handler: HookHandler,
  options?: { id?: string; priority?: number; source?: string },
): () => void {
  return getHookRunner().register({
    id: options?.id || `${hookName}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    hookName,
    handler,
    priority: options?.priority ?? 0,
    source: (options?.source as any) ?? 'user',
  });
}
