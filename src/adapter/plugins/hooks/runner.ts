/**
 * Hook Runner (Legacy)
 *
 * @deprecated This standalone hook runner is superseded by the plugin-registry-aware
 * implementation in `src/adapter/plugins/hook-runner/index.ts` (`createHookRunner`).
 * That version integrates with the PluginRegistry, supports more hook types
 * (compaction, sub-agent, gateway, etc.), and offers configurable merge strategies.
 *
 * Existing call-sites using `getHookRunner()` / `registerHook()` should migrate to
 * `createHookRunner(registry)` from `../hook-runner`. This file is retained because
 * several modules (app/index.ts, subagent/registry.ts) still depend
 * on the singleton pattern.
 *
 * Original design: OpenClaw-style hook runner with sequential, parallel, and sync modes.
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

  /**
   * Bridge function to forward legacy hook registrations to the new hook system.
   * Set via `setBridge()` during app initialization after the new HookRunner
   * (createHookRunner) is created.
   */
  private bridgeToNew: ((hookName: string, handler: Function, priority: number) => void) | null = null;

  constructor(options: HookRunnerOptions = {}) {
    this.logger = options.logger || {
      warn: console.warn,
      error: console.error,
    };
    this.catchErrors = options.catchErrors ?? true;
  }

  /**
   * Connect a bridge so that hooks registered on this legacy runner are also
   * forwarded to the new plugin-registry-based hook system.
   *
   * @param bridge - callback that registers a handler in the new system
   */
  setBridge(bridge: (hookName: string, handler: Function, priority: number) => void): void {
    this.bridgeToNew = bridge;
  }

  /**
   * 注册钩子
   */
  register(registration: HookRegistration): () => void {
    const hooks = this.hooks.get(registration.hookName) || [];
    hooks.push(registration);
    this.hooks.set(registration.hookName, hooks);

    // Bridge to new hook system if available
    if (this.bridgeToNew) {
      try {
        this.bridgeToNew(registration.hookName, registration.handler, registration.priority || 0);
      } catch (e) {
        this.logger.debug?.(`[HookRunner] Bridge failed for ${registration.hookName}: ${e}`);
      }
    }

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
      } catch (err) {
        // B-P2-08: Always log, never let a single plugin break the pipeline
        console.warn(`[HookRunner] Plugin hook '${reg.id}' (${hookName}) failed:`, err);
        this.handleHookError(hookName, reg, err);
        if (!this.catchErrors) {
          throw err;
        }
        // Return safe default — continue with unmodified event
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
        } catch (err) {
          // B-P2-08: Always log, never let a single plugin break the pipeline
          console.warn(\`[HookRunner] Plugin hook '\${reg.id}' (\${hookName}) failed:\`, err);
          this.handleHookError(hookName, reg, err);
          if (!this.catchErrors) {
            throw err;
          }
          // Swallow error — continue with other hooks
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
            \`[hooks] \${hookName} handler \${reg.id} returned Promise in sync context\`,
          );
          continue;
        }
        if (result !== undefined && result !== null) {
          currentEvent = { ...currentEvent, ...result } as T;
        }
      } catch (err) {
        // B-P2-08: Always log, never let a single plugin break the pipeline
        console.warn(\`[HookRunner] Plugin hook '\${reg.id}' (\${hookName}) failed:\`, err);
        this.handleHookError(hookName, reg, err);
        if (!this.catchErrors) {
          throw err;
        }
        // Return safe default — continue with unmodified event
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
    try {
      const hookCtx: HookContext = {
        ...ctx,
        timestamp: new Date().toISOString(),
      };
      return await this.runSequential<PluginHookBeforeModelResolveResult>(
        'before_model_resolve',
        {} as PluginHookBeforeModelResolveResult,
        hookCtx,
      );
    } catch (err) {
      console.warn('[HookRunner] before_model_resolve failed:', err);
      return {} as PluginHookBeforeModelResolveResult;
    }
  }

  /**
   * before_prompt_build 钩子
   */
  async runBeforePromptBuild(
    _event: PluginHookBeforePromptBuildEvent,
    ctx: PluginHookAgentContext,
  ): Promise<PluginHookBeforePromptBuildResult> {
    try {
      const hookCtx: HookContext = {
        ...ctx,
        timestamp: new Date().toISOString(),
      };
      return await this.runSequential<PluginHookBeforePromptBuildResult>(
        'before_prompt_build',
        {} as PluginHookBeforePromptBuildResult,
        hookCtx,
      );
    } catch (err) {
      console.warn('[HookRunner] before_prompt_build failed:', err);
      return {} as PluginHookBeforePromptBuildResult;
    }
  }

  /**
   * message_sending 钩子（可取消消息）
   */
  async runMessageSending(
    event: PluginHookMessageSendingEvent,
    ctx: { channelId: string; accountId?: string },
  ): Promise<{ content: string; cancelled: boolean }> {
    try {
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
    } catch (err) {
      console.warn('[HookRunner] message_sending failed:', err);
      return { content: event.content, cancelled: false };
    }
  }

  /**
   * before_tool_call 钩子（可阻止工具调用）
   */
  async runBeforeToolCall(
    event: PluginHookBeforeToolCallEvent,
    ctx: { agentId?: string; sessionKey?: string; toolName: string },
  ): Promise<{ params: Record<string, unknown>; blocked: boolean; blockReason?: string }> {
    try {
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
    } catch (err) {
      console.warn('[HookRunner] before_tool_call failed:', err);
      return { params: event.params, blocked: false };
    }
  }

  /**
   * tool_result_persist 钩子（同步）
   */
  runToolResultPersist(
    event: PluginHookToolResultPersistEvent,
    ctx: { agentId?: string; sessionKey?: string; toolName?: string; toolCallId?: string },
  ): PluginHookToolResultPersistEvent {
    try {
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
    } catch (err) {
      console.warn('[HookRunner] tool_result_persist failed:', err);
      return event;
    }
  }

  /**
   * before_message_write 钩子（同步）
   */
  runBeforeMessageWrite(
    event: PluginHookBeforeMessageWriteEvent,
    ctx: { agentId?: string; sessionKey?: string },
  ): { message: typeof event.message; blocked: boolean } {
    try {
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
    } catch (err) {
      console.warn('[HookRunner] before_message_write failed:', err);
      return { message: event.message, blocked: false };
    }
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
