/**
 * Plugin System Types
 *
 * 这个文件包含插件系统所需的核心类型定义
 */

// ═══════════════════════════════════════════════════════════════
//  插件钩子名称（25 个）
// ═══════════════════════════════════════════════════════════════

export type PluginHookName =
  // ─── 模型与 Prompt（Modifying/Sequential） ───
  | "before_model_resolve"
  | "before_prompt_build"
  | "llm_input"
  | "llm_output"
  // ─── Agent 生命周期（Void） ───
  | "before_agent_start"
  | "agent_end"
  // ─── 消息处理 ───
  | "message_received"
  | "message_sending"
  | "message_sent"
  // ─── 工具调用 ───
  | "before_tool_call"
  | "after_tool_call"
  | "tool_result_persist" // ⚠️ 同步
  // ─── 会话管理（Void） ───
  | "session_start"
  | "session_end"
  // ─── 上下文压缩 ───
  | "before_compaction"
  | "after_compaction"
  | "before_reset"
  // ─── 消息持久化 ───
  | "before_message_write" // ⚠️ 同步
  // ─── Sub-Agent ───
  | "subagent_spawning"
  | "subagent_delivery_target"
  | "subagent_spawned"
  | "subagent_ended"
  // ─── 网关（Void） ───
  | "gateway_start"
  | "gateway_stop";

// ═══════════════════════════════════════════════════════════════
//  钩子事件类型
// ═══════════════════════════════════════════════════════════════

export interface BeforeModelResolveEvent {
  prompt: string;
}

export interface BeforePromptBuildEvent {
  prompt: string;
  messages: unknown[];
}

export interface LlmInputEvent {
  runId: string;
  provider: string;
  model: string;
  prompt: string;
}

export interface MessageReceivedEvent {
  from: string;
  content: string;
  timestamp?: number;
}

export interface MessageSendingEvent {
  to: string;
  content: string;
}

export interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
}

export interface AfterToolCallEvent {
  toolName: string;
  result: unknown;
}

// ═══════════════════════════════════════════════════════════════
//  钩子 Handler Map（类型安全的钩子注册）
// ═══════════════════════════════════════════════════════════════

export interface PluginHookHandlerMap {
  before_model_resolve: (event: BeforeModelResolveEvent) => Promise<void> | void;
  before_prompt_build: (event: BeforePromptBuildEvent) => Promise<void> | void;
  llm_input: (event: LlmInputEvent) => Promise<void> | void;
  llm_output: (event: any) => Promise<void> | void;

  before_agent_start: (event: any) => Promise<void> | void;
  agent_end: (event: any) => Promise<void> | void;

  message_received: (event: MessageReceivedEvent) => Promise<void> | void;
  message_sending: (event: MessageSendingEvent) => Promise<any> | void;
  message_sent: (event: any) => Promise<void> | void;

  before_tool_call: (event: BeforeToolCallEvent) => Promise<any> | void;
  after_tool_call: (event: AfterToolCallEvent) => Promise<void> | void;
  tool_result_persist: (event: any) => any | void; // ⚠️ 同步

  session_start: (event: any) => Promise<void> | void;
  session_end: (event: any) => Promise<void> | void;

  before_compaction: (event: any) => Promise<any> | void;
  after_compaction: (event: any) => Promise<void> | void;
  before_reset: (event: any) => Promise<void> | void;

  before_message_write: (event: any) => any | void; // ⚠️ 同步

  subagent_spawning: (event: any) => Promise<any> | void;
  subagent_delivery_target: (event: any) => Promise<any> | void;
  subagent_spawned: (event: any) => Promise<void> | void;
  subagent_ended: (event: any) => Promise<void> | void;

  gateway_start: (event: any) => Promise<void> | void;
  gateway_stop: (event: any) => Promise<void> | void;
}

// ═══════════════════════════════════════════════════════════════
//  Plugin API（插件注册 API）
// ═══════════════════════════════════════════════════════════════

export interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: any;
  pluginConfig?: Record<string, unknown>;
  runtime: any;
  logger: PluginLogger;

  // 10 种扩展注册方法
  registerTool(tool: any, opts?: any): void;
  registerHook(hook: any): void;
  registerChannel(channel: any): void;
  registerCommand(command: any): void;
  registerHttpRoute(route: any): void;
  registerProvider(provider: any): void;
  registerCli(registrar: any): void;
  registerService(service: any): void;
  registerGatewayMethod(method: any): void;

  // 生命周期钩子注册
  on<K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    options?: { priority?: number }
  ): void;

  resolvePath(input: string): string;
}

export interface PluginLogger {
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  debug(...args: any[]): void;
}
