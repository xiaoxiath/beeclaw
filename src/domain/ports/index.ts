/**
 * Domain Port Interfaces
 *
 * Dependency Inversion: domain layer accesses adapter-layer capabilities
 * through port interfaces. Adapter layer injects implementations at startup.
 *
 * This eliminates direct domain→adapter imports, enforcing clean architecture.
 */

// ============================================================================
// Hook Event Types (P1-4: type-safe IHookRunner)
// ============================================================================

/** Base hook event with common fields */
export interface BaseHookEvent {
  timestamp: string;
}

/** Tool-related hook events */
export interface ToolHookEvent extends BaseHookEvent {
  toolName: string;
  params?: Record<string, unknown>;
  result?: unknown;
  toolCallId?: string;
}

/** Model-related hook events */
export interface ModelHookEvent extends BaseHookEvent {
  model?: string;
  provider?: string;
  messages?: unknown[];
  response?: unknown;
  basePrompt?: string;
  context?: unknown;
}

/** Session-related hook events */
export interface SessionHookEvent extends BaseHookEvent {
  sessionId?: string;
  userId?: string;
  channel?: string;
  metadata?: unknown;
  messageCount?: number;
  createdAt?: string;
  endedAt?: string;
}

/** Message-related hook events */
export interface MessageHookEvent extends BaseHookEvent {
  message?: unknown;
  content?: string;
  role?: string;
  sessionId?: string;
  messages?: unknown[];
  metadata?: unknown;
}

/** Compression-related hook events */
export interface CompressionHookEvent extends BaseHookEvent {
  messages?: unknown[];
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
}

// ============================================================================
// Port Interfaces
// ============================================================================

/** MCP Manager Port — abstracts MCP client operations */
export interface IMCPManager {
  getAllToolsAsOpenAI(): any[];
  executeTool(serverName: string, toolName: string, params: any): Promise<any>;
}

/** Plugin Registry Port — abstracts plugin registry access */
export interface IPluginRegistry {
  getAll?(): any[];
  get?(id: string): any;
  tools: Map<string, any>;
  typedHooks: Map<string, any[]>;
}

/**
 * Hook Runner Port — abstracts plugin hook execution.
 *
 * Mirrors the named convenience methods returned by the adapter's
 * createHookRunner(). Each method is typed with concrete hook-event
 * types so that the domain layer benefits from compile-time safety.
 *
 * - Void hooks return `Promise<void>` (fire-and-forget notification).
 * - Modifying hooks return `Promise<Record<string, unknown>>` (may alter the event).
 */
export interface IHookRunner {
  // Low-level hooks
  runVoidHook?(hookName: string, event: BaseHookEvent): Promise<void>;
  runModifyingHook?(hookName: string, event: BaseHookEvent): Promise<Record<string, unknown>>;
  runSyncHook?(hookName: string, event: BaseHookEvent): Record<string, unknown>;

  // Model / Prompt (Modifying)
  runBeforeModelResolve(event: ModelHookEvent): Promise<Record<string, unknown>>;
  runBeforePromptBuild(event: ModelHookEvent): Promise<Record<string, unknown>>;
  runLlmInput(event: ModelHookEvent): Promise<Record<string, unknown>>;
  runLlmOutput(event: ModelHookEvent): Promise<Record<string, unknown>>;

  // Agent (Void)
  runBeforeAgentStart(event: SessionHookEvent): Promise<void>;
  runAgentEnd(event: SessionHookEvent): Promise<void>;

  // Messages (Modifying for sending, Void for received/sent)
  runMessageReceived(event: MessageHookEvent): Promise<void>;
  runMessageSending(event: MessageHookEvent): Promise<Record<string, unknown>>;
  runMessageSent(event: MessageHookEvent): Promise<void>;

  // Tools (Modifying)
  runBeforeToolCall(event: ToolHookEvent): Promise<Record<string, unknown>>;
  runAfterToolCall(event: ToolHookEvent): Promise<Record<string, unknown>>;
  runToolResultPersist(event: ToolHookEvent): Promise<Record<string, unknown>>;

  // Session (Void)
  runSessionStart(event: SessionHookEvent): Promise<void>;
  runSessionEnd(event: SessionHookEvent): Promise<void>;

  // Compression (Modifying for before, Void for after)
  runBeforeCompaction(event: CompressionHookEvent): Promise<Record<string, unknown>>;
  runAfterCompaction(event: CompressionHookEvent): Promise<void>;
  runBeforeReset(event: CompressionHookEvent): Promise<Record<string, unknown>>;

  // Persistence (Modifying)
  runBeforeMessageWrite(event: MessageHookEvent): Promise<Record<string, unknown>>;

  // Sub-Agent (Modifying for spawning/delivery, Void for spawned/ended)
  runSubagentSpawning?(event: SessionHookEvent): Promise<Record<string, unknown>>;
  runSubagentDeliveryTarget?(event: SessionHookEvent): Promise<Record<string, unknown>>;
  runSubagentSpawned?(event: SessionHookEvent): Promise<void>;
  runSubagentEnded?(event: SessionHookEvent): Promise<void>;

  // Gateway (Void)
  runGatewayStart?(event: BaseHookEvent): Promise<void>;
  runGatewayStop?(event: BaseHookEvent): Promise<void>;
}

/** Message Controller Port — abstracts Feishu card-v2 or other streaming renderers */
export interface IMessageController {
  pushContent(content: any): Promise<void>;
  finish(): Promise<void>;
}

/** Message Controller Factory — creates controller instances for a chat context */
export type MessageControllerFactory = (options: {
  client: any;
  parentMessageId?: string;  // Optional: if provided, uses reply mode; otherwise proactive mode
  chatId: string;
  debounceMs?: number;
}) => IMessageController;

/** Channel Client Port — abstracts Feishu/CLI/Web client for message sending */
export interface IChannelClient {
  sendTextMessage?(chatId: string, receiveIdType: string, content: string): Promise<void>;
  sendMarkdownMessage?(chatId: string, receiveIdType: string, content: string, options?: any): Promise<void>;
}

// ============================================================================
// Port Registry (Dependency Injection Container)
// ============================================================================

const _warnedPorts = new Set<string>();

const _ports: {
  mcpManager: (() => IMCPManager) | null;
  pluginRegistry: (() => IPluginRegistry) | null;
  hookRunnerFactory: ((registry: IPluginRegistry) => IHookRunner) | null;
  channelClient: (() => IChannelClient | null) | null;
  messageControllerFactory: MessageControllerFactory | null;
} = {
  mcpManager: null,
  pluginRegistry: null,
  hookRunnerFactory: null,
  channelClient: null,
  messageControllerFactory: null,
};

/**
 * Register port implementations. Called once during app initialization.
 *
 * @example
 * ```ts
 * registerPorts({
 *   mcpManager: () => getMCPManager(),
 *   pluginRegistry: () => getPluginRegistry(),
 *   hookRunnerFactory: (registry) => createHookRunner(registry),
 *   channelClient: () => getFeishuWSClient(),
 * });
 * ```
 */
export function registerPorts(ports: Partial<typeof _ports>): void {
  Object.assign(_ports, ports);
}

// ============================================================================
// Port Accessors (used by domain layer)
// ============================================================================

/** Get MCP Manager instance (or null if not registered) */
export function getMCPManagerPort(): IMCPManager | null {
  const instance = _ports.mcpManager?.() ?? null;
  if (!instance && !_warnedPorts.has('mcpManager')) {
    _warnedPorts.add('mcpManager');
    console.warn('[Ports] mcpManager port not registered. Call registerPorts() during app init.');
  }
  return instance;
}

/** Get Plugin Registry instance (or null if not registered) */
export function getPluginRegistryPort(): IPluginRegistry | null {
  const instance = _ports.pluginRegistry?.() ?? null;
  if (!instance && !_warnedPorts.has('pluginRegistry')) {
    _warnedPorts.add('pluginRegistry');
    console.warn('[Ports] pluginRegistry port not registered. Call registerPorts() during app init.');
  }
  return instance;
}

/**
 * Get a Hook Runner instance.
 * Creates a new runner from the registered factory + registry.
 * Returns null if either is not registered.
 */
export function getHookRunnerPort(): IHookRunner | null {
  const registry = _ports.pluginRegistry?.() ?? null;
  if (!registry || !_ports.hookRunnerFactory) return null;
  return _ports.hookRunnerFactory(registry);
}

/** Get Channel Client instance (or null if not registered) */
export function getChannelClientPort(): IChannelClient | null {
  const instance = _ports.channelClient?.() ?? null;
  if (!instance && !_warnedPorts.has('channelClient')) {
    _warnedPorts.add('channelClient');
    console.warn('[Ports] channelClient port not registered. Call registerPorts() during app init.');
  }
  return instance;
}

/** Get Message Controller Factory (or null if not registered) */
export function getMessageControllerFactory(): MessageControllerFactory | null {
  return _ports.messageControllerFactory ?? null;
}

// ============================================================================
// Health Monitor Port (A-P0-02)
// ============================================================================

/** Health Monitor Port — abstracts periodic health monitoring for data sources */
export interface IHealthMonitor {
  hasIssues(): boolean;
  buildHealthContext(): string;
  getStatus(): {
    isRunning: boolean;
    lastProbeTime: Date | null;
    currentHealthy: boolean;
    unhealthySources: string[];
  };
}

// Add to port registry
let _healthMonitor: (() => IHealthMonitor | null) | null = null;

/** Register health monitor port implementation. */
export function registerHealthMonitorPort(factory: () => IHealthMonitor | null): void {
  _healthMonitor = factory;
}

/** Get health monitor instance (or null if not registered). */
export function getHealthMonitorPort(): IHealthMonitor | null {
  return _healthMonitor?.() ?? null;
}
