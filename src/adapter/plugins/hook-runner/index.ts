/**
 * Hook Runner - 钩子运行器
 *
 * 职责：
 * - 实现三种钩子执行模式（Void/Parallel、Modifying/Sequential、同步）
 * - 支持钩子优先级
 * - 提供具名便捷方法
 */

import type { PluginRegistry } from "../registry";
import type { PluginHookName, PluginHookHandlerMap } from "../types";

/**
 * Deep merge two objects. Arrays are replaced (not concatenated).
 * Handles nested objects without overwriting sibling keys.
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key];
    const tgtVal = target[key];

    if (
      srcVal !== null &&
      srcVal !== undefined &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal) &&
      tgtVal !== null
    ) {
      // Recursively merge nested objects
      result[key] = deepMerge(tgtVal as any, srcVal as any);
    } else if (srcVal !== undefined) {
      result[key] = srcVal as T[keyof T];
    }
  }
  return result;
}


export interface HookRunnerOptions {
  timeout?: number;  // 钩子执行超时（毫秒），默认 30000
  onError?: (hookName: string, pluginId: string, error: unknown) => void;
  /**
   * Merge strategy for modifying hooks:
   * - 'shallow' (default): { ...current, ...result } — top-level only
   * - 'deep': recursive merge — preserves nested object keys
   */
  mergeStrategy?: 'shallow' | 'deep';
}

export function createHookRunner(
  registry: PluginRegistry,
  options: HookRunnerOptions = {}
) {
  const { timeout = 30_000, onError, mergeStrategy = 'shallow' } = options;

  function handleError(hookName: string, pluginId: string, err: unknown) {
    if (onError) {
      onError(hookName, pluginId, err);
    } else {
      console.error(`[Hook:${hookName}] Plugin "${pluginId}" error:`, err);
    }
  }

  // ═══════════════════════════════════════════
  //  Void // Parallel 模式
  //  并发执行，互不干扰，无返回值
  // ═══════════════════════════════════════════
  async function runVoidHook<K extends PluginHookName>(
    hookName: K,
    event: Parameters<PluginHookHandlerMap[K]>[0]
  ): Promise<void> {
    const registrations = registry.typedHooks.get(hookName) ?? [];
    if (registrations.length === 0) return;

    await Promise.allSettled(
      registrations.map(async (reg) => {
        try {
          const promise = (reg.handler as Function)(event);
          if (promise instanceof Promise) {
            await Promise.race([
              promise,
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Hook timeout")), timeout)
              ),
            ]);
          }
        } catch (err) {
          handleError(hookName, reg.pluginId, err);
        }
      })
    );
  }

  // ═══════════════════════════════════════════
  //  Modifying // Sequential 模式
  //  串行执行，前一个输出合并到后一个输入
  // ═══════════════════════════════════════════
  async function runModifyingHook<K extends PluginHookName>(
    hookName: K,
    event: Parameters<PluginHookHandlerMap[K]>[0]
  ): Promise<typeof event> {
    const registrations = registry.typedHooks.get(hookName) ?? [];
    if (registrations.length === 0) return event;

    let current = event;

    for (const reg of registrations) {
      try {
        const result = await (reg.handler as Function)(current);
        if (result != null) {
          current = mergeStrategy === 'deep'
            ? deepMerge(current as any, result)
            : { ...current, ...result };
        }
      } catch (err) {
        handleError(hookName, reg.pluginId, err);
        // Modifying 模式下出错不中断，继续传递 current
      }
    }

    return current;
  }

  // ═══════════════════════════════════════════
  //  同步钩子（仅 tool_result_persist // before_message_write）
  // ═══════════════════════════════════════════
  function runSyncHook<K extends PluginHookName>(
    hookName: K,
    event: Parameters<PluginHookHandlerMap[K]>[0]
  ): typeof event {
    const registrations = registry.typedHooks.get(hookName) ?? [];
    if (registrations.length === 0) return event;

    let current = event;

    for (const reg of registrations) {
      try {
        const result = (reg.handler as Function)(current);
        if (result != null) {
          current = mergeStrategy === 'deep'
            ? deepMerge(current as any, result)
            : { ...current, ...result };
        }
      } catch (err) {
        handleError(hookName, reg.pluginId, err);
      }
    }

    return current;
  }

  // ═══════════════════════════════════════════
  //  具名便捷方法（对齐 OpenClaw 的 HookRunner）
  // ═══════════════════════════════════════════
  return {
    // 底层方法
    runVoidHook,
    runModifyingHook,
    runSyncHook,

    // 模型 // Prompt（Modifying）
    runBeforeModelResolve: (e: any) => runModifyingHook("before_model_resolve", e),
    runBeforePromptBuild: (e: any) => runModifyingHook("before_prompt_build", e),
    runLlmInput: (e: any) => runModifyingHook("llm_input", e),
    runLlmOutput: (e: any) => runModifyingHook("llm_output", e),

    // Agent
    runBeforeAgentStart: (e: any) => runVoidHook("before_agent_start", e),
    runAgentEnd: (e: any) => runVoidHook("agent_end", e),

    // 消息
    runMessageReceived: (e: any) => runVoidHook("message_received", e),
    runMessageSending: (e: any) => runModifyingHook("message_sending", e),
    runMessageSent: (e: any) => runVoidHook("message_sent", e),

    // 工具
    runBeforeToolCall: (e: any) => runModifyingHook("before_tool_call", e),
    runAfterToolCall: (e: any) => runModifyingHook("after_tool_call", e),
    runToolResultPersist: (e: any) => runSyncHook("tool_result_persist", e),

    // 会话
    runSessionStart: (e: any) => runVoidHook("session_start", e),
    runSessionEnd: (e: any) => runVoidHook("session_end", e),

    // 压缩
    runBeforeCompaction: (e: any) => runModifyingHook("before_compaction", e),
    runAfterCompaction: (e: any) => runVoidHook("after_compaction", e),
    runBeforeReset: (e: any) => runVoidHook("before_reset", e),

    // 持久化
    runBeforeMessageWrite: (e: any) => runSyncHook("before_message_write", e),

    // Sub-Agent
    runSubagentSpawning: (e: any) => runModifyingHook("subagent_spawning", e),
    runSubagentDeliveryTarget: (e: any) => runModifyingHook("subagent_delivery_target", e),
    runSubagentSpawned: (e: any) => runVoidHook("subagent_spawned", e),
    runSubagentEnded: (e: any) => runVoidHook("subagent_ended", e),

    // 网关
    runGatewayStart: (e: any) => runVoidHook("gateway_start", e),
    runGatewayStop: (e: any) => runVoidHook("gateway_stop", e),
  };
}

export type HookRunner = ReturnType<typeof createHookRunner>;
