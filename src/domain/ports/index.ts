/**
 * Domain Port Interfaces
 *
 * Dependency Inversion: domain layer accesses adapter-layer capabilities
 * through port interfaces. Adapter layer injects implementations at startup.
 *
 * This eliminates direct domain→adapter imports, enforcing clean architecture.
 */

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
 * createHookRunner(). Each method is typed as `(event: any) => any`
 * because the domain layer doesn't depend on the adapter's hook-event
 * type definitions; the adapter is responsible for type safety.
 */
export interface IHookRunner {
  // Low-level hooks
  runVoidHook?(hookName: string, event: any): Promise<void>;
  runModifyingHook?(hookName: string, event: any): Promise<any>;
  runSyncHook?(hookName: string, event: any): any;

  // Model / Prompt (Modifying)
  runBeforeModelResolve(event: any): any;
  runBeforePromptBuild(event: any): any;
  runLlmInput(event: any): any;
  runLlmOutput(event: any): any;

  // Agent
  runBeforeAgentStart(event: any): any;
  runAgentEnd(event: any): any;

  // Messages
  runMessageReceived(event: any): any;
  runMessageSending(event: any): any;
  runMessageSent(event: any): any;

  // Tools
  runBeforeToolCall(event: any): any;
  runAfterToolCall(event: any): any;
  runToolResultPersist(event: any): any;

  // Session
  runSessionStart(event: any): any;
  runSessionEnd(event: any): any;

  // Compression
  runBeforeCompaction(event: any): any;
  runAfterCompaction(event: any): any;
  runBeforeReset(event: any): any;

  // Persistence
  runBeforeMessageWrite(event: any): any;

  // Sub-Agent
  runSubagentSpawning?(event: any): any;
  runSubagentDeliveryTarget?(event: any): any;
  runSubagentSpawned?(event: any): any;
  runSubagentEnded?(event: any): any;

  // Gateway
  runGatewayStart?(event: any): any;
  runGatewayStop?(event: any): any;
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
