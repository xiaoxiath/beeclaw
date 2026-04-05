/**
 * bee — Hook system types and interfaces.
 *
 * Defines the hook lifecycle interface used by the Agent.
 * Implementations are provided by consumers (e.g. beeclaw).
 */

// ============================================================================
// Hook Events
// ============================================================================

export interface HookContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  timestamp: string;
}

/** Base event for all hooks */
export interface BaseHookEvent {
  context: HookContext;
  [key: string]: unknown;
}

/** Event for model-related hooks */
export interface ModelHookEvent extends BaseHookEvent {
  model?: string;
  messages?: unknown[];
  response?: unknown;
}

/** Event for session-related hooks */
export interface SessionHookEvent extends BaseHookEvent {
  sessionId?: string;
}

/** Event for tool-related hooks */
export interface ToolHookEvent extends BaseHookEvent {
  toolName: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

// ============================================================================
// Hook Runner Interface
// ============================================================================

/**
 * Hook runner interface.
 *
 * Bee defines the interface; consumers provide the implementation.
 * A no-op default is available via `NoOpHookRunner`.
 */
export interface IHookRunner {
  runVoidHook(hookName: string, event: BaseHookEvent): Promise<void>;
  runModifyingHook(hookName: string, event: BaseHookEvent): Promise<Record<string, unknown>>;
}

/**
 * No-op hook runner that does nothing. Used as a safe default.
 */
export class NoOpHookRunner implements IHookRunner {
  async runVoidHook(_hookName: string, _event: BaseHookEvent): Promise<void> {
    // No-op
  }

  async runModifyingHook(
    _hookName: string,
    event: BaseHookEvent,
  ): Promise<Record<string, unknown>> {
    return event as Record<string, unknown>;
  }
}
