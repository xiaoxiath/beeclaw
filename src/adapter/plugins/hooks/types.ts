/**
 * Hook System Types
 *
 * 参考 OpenClaw 的钩子系统设计
 * 支持事件驱动架构，允许插件和内部模块响应各种生命周期事件
 */

import type { ChatMessage, OpenAITool } from '../../../domain/agent/types';

// ============================================================================
// 钩子名称定义
// ============================================================================

export type HookName =
  // Agent 生命周期
  | 'before_model_resolve'    // 模型选择前（可覆盖模型/提供商）
  | 'before_prompt_build'     // 系统提示构建前（可注入上下文）
  | 'before_agent_start'      // Agent启动前（组合钩子）
  | 'llm_input'               // LLM输入观测
  | 'llm_output'              // LLM输出观测
  | 'agent_end'               // Agent完成

  // 上下文管理
  | 'before_compaction'       // 上下文压缩前
  | 'after_compaction'        // 上下文压缩后
  | 'before_reset'            // 会话重置前

  // 消息流
  | 'message_received'        // 收到消息
  | 'message_sending'         // 发送消息前（可修改/取消）
  | 'message_sent'            // 消息已发送

  // 工具调用
  | 'before_tool_call'        // 工具调用前（可阻止/修改）
  | 'after_tool_call'         // 工具调用后
  | 'tool_result_persist'     // 工具结果持久化前
  | 'before_message_write'    // 消息写入前

  // 会话
  | 'session_start'           // 会话开始
  | 'session_end'             // 会话结束

  // 子代理
  | 'subagent_spawning'       // 子代理生成中
  | 'subagent_delivery_target' // 子代理投递目标
  | 'subagent_spawned'        // 子代理已生成
  | 'subagent_ended'          // 子代理已结束

  // 记忆
  | 'memory_updated'          // 记忆更新
  | 'knowledge_extracted'     // 知识提取完成

  // 网关
  | 'gateway_start'           // 网关启动
  | 'gateway_stop';           // 网关停止

// ============================================================================
// 钩子上下文
// ============================================================================

export interface HookContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
  timestamp: string;
}

// Agent 上下文（共享）
export type PluginHookAgentContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
};

// ============================================================================
// 事件类型定义
// ============================================================================

// before_model_resolve
export type PluginHookBeforeModelResolveEvent = {
  prompt: string;
};

export type PluginHookBeforeModelResolveResult = {
  modelOverride?: string;
  providerOverride?: string;
};

// before_prompt_build
export type PluginHookBeforePromptBuildEvent = {
  prompt: string;
  messages: unknown[];
};

export type PluginHookBeforePromptBuildResult = {
  systemPrompt?: string;
  prependContext?: string;
};

// before_agent_start (遗留兼容)
export type PluginHookBeforeAgentStartEvent = {
  prompt: string;
  messages?: unknown[];
};

export type PluginHookBeforeAgentStartResult = PluginHookBeforePromptBuildResult &
  PluginHookBeforeModelResolveResult;

// llm_input
export type PluginHookLlmInputEvent = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  prompt: string;
  historyMessages: unknown[];
  imagesCount: number;
};

// llm_output
export type PluginHookLlmOutputEvent = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  assistantTexts: string[];
  lastAssistant?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
};

// agent_end
export type PluginHookAgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
};

// 压缩钩子
export type PluginHookBeforeCompactionEvent = {
  messageCount: number;
  compactingCount?: number;
  tokenCount?: number;
  messages?: unknown[];
  sessionFile?: string;
};

export type PluginHookBeforeResetEvent = {
  sessionFile?: string;
  messages?: unknown[];
  reason?: string;
};

export type PluginHookAfterCompactionEvent = {
  messageCount: number;
  tokenCount?: number;
  compactedCount: number;
  sessionFile?: string;
};

// 消息上下文
export type PluginHookMessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

// message_received
export type PluginHookMessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

// message_sending
export type PluginHookMessageSendingEvent = {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type PluginHookMessageSendingResult = {
  content?: string;
  cancel?: boolean;
};

// message_sent
export type PluginHookMessageSentEvent = {
  to: string;
  content: string;
  success: boolean;
  error?: string;
};

// 工具上下文
export type PluginHookToolContext = {
  agentId?: string;
  sessionKey?: string;
  toolName: string;
};

// before_tool_call
export type PluginHookBeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
};

export type PluginHookBeforeToolCallResult = {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
};

// after_tool_call
export type PluginHookAfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
};

// tool_result_persist
export type PluginHookToolResultPersistContext = {
  agentId?: string;
  sessionKey?: string;
  toolName?: string;
  toolCallId?: string;
};

export type PluginHookToolResultPersistEvent = {
  toolName?: string;
  toolCallId?: string;
  message: ChatMessage;
  isSynthetic?: boolean;
};

export type PluginHookToolResultPersistResult = {
  message?: ChatMessage;
};

// before_message_write
export type PluginHookBeforeMessageWriteEvent = {
  message: ChatMessage;
  sessionKey?: string;
  agentId?: string;
};

export type PluginHookBeforeMessageWriteResult = {
  block?: boolean;
  message?: ChatMessage;
};

// 会话上下文
export type PluginHookSessionContext = {
  agentId?: string;
  sessionId: string;
};

// session_start
export type PluginHookSessionStartEvent = {
  sessionId: string;
  resumedFrom?: string;
};

// session_end
export type PluginHookSessionEndEvent = {
  sessionId: string;
  messageCount: number;
  durationMs?: number;
};

// 子代理上下文
export type PluginHookSubagentContext = {
  runId?: string;
  childSessionKey?: string;
  requesterSessionKey?: string;
};

export type PluginHookSubagentTargetKind = 'subagent' | 'acp';

// subagent_spawning
export type PluginHookSubagentSpawningEvent = {
  childSessionKey: string;
  agentId: string;
  label?: string;
  mode: 'run' | 'session';
  requester?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
  threadRequested: boolean;
};

export type PluginHookSubagentSpawningResult =
  | {
      status: 'ok';
      threadBindingReady?: boolean;
    }
  | {
      status: 'error';
      error: string;
    };

// subagent_delivery_target
export type PluginHookSubagentDeliveryTargetEvent = {
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
  childRunId?: string;
  spawnMode?: 'run' | 'session';
  expectsCompletionMessage: boolean;
};

export type PluginHookSubagentDeliveryTargetResult = {
  origin?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
};

// subagent_spawned
export type PluginHookSubagentSpawnedEvent = {
  runId: string;
  childSessionKey: string;
  agentId: string;
  label?: string;
  mode: 'run' | 'session';
  requester?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
  threadRequested: boolean;
};

// subagent_ended
export type PluginHookSubagentEndedEvent = {
  targetSessionKey: string;
  targetKind: PluginHookSubagentTargetKind;
  reason: string;
  sendFarewell?: boolean;
  accountId?: string;
  runId?: string;
  endedAt?: number;
  outcome?: 'ok' | 'error' | 'timeout' | 'killed' | 'reset' | 'deleted';
  error?: string;
};

// 网关上下文
export type PluginHookGatewayContext = {
  port?: number;
};

// gateway_start
export type PluginHookGatewayStartEvent = {
  port: number;
};

// gateway_stop
export type PluginHookGatewayStopEvent = {
  reason?: string;
};

// ============================================================================
// 钩子处理器映射
// ============================================================================

export type PluginHookHandlerMap = {
  before_model_resolve: (
    event: PluginHookBeforeModelResolveEvent,
    ctx: PluginHookAgentContext
  ) => Promise<PluginHookBeforeModelResolveResult | void> | PluginHookBeforeModelResolveResult | void;

  before_prompt_build: (
    event: PluginHookBeforePromptBuildEvent,
    ctx: PluginHookAgentContext
  ) => Promise<PluginHookBeforePromptBuildResult | void> | PluginHookBeforePromptBuildResult | void;

  before_agent_start: (
    event: PluginHookBeforeAgentStartEvent,
    ctx: PluginHookAgentContext
  ) => Promise<PluginHookBeforeAgentStartResult | void> | PluginHookBeforeAgentStartResult | void;

  llm_input: (
    event: PluginHookLlmInputEvent,
    ctx: PluginHookAgentContext
  ) => Promise<void> | void;

  llm_output: (
    event: PluginHookLlmOutputEvent,
    ctx: PluginHookAgentContext
  ) => Promise<void> | void;

  agent_end: (
    event: PluginHookAgentEndEvent,
    ctx: PluginHookAgentContext
  ) => Promise<void> | void;

  before_compaction: (
    event: PluginHookBeforeCompactionEvent,
    ctx: PluginHookAgentContext
  ) => Promise<void> | void;

  after_compaction: (
    event: PluginHookAfterCompactionEvent,
    ctx: PluginHookAgentContext
  ) => Promise<void> | void;

  before_reset: (
    event: PluginHookBeforeResetEvent,
    ctx: PluginHookAgentContext
  ) => Promise<void> | void;

  message_received: (
    event: PluginHookMessageReceivedEvent,
    ctx: PluginHookMessageContext
  ) => Promise<void> | void;

  message_sending: (
    event: PluginHookMessageSendingEvent,
    ctx: PluginHookMessageContext
  ) => Promise<PluginHookMessageSendingResult | void> | PluginHookMessageSendingResult | void;

  message_sent: (
    event: PluginHookMessageSentEvent,
    ctx: PluginHookMessageContext
  ) => Promise<void> | void;

  before_tool_call: (
    event: PluginHookBeforeToolCallEvent,
    ctx: PluginHookToolContext
  ) => Promise<PluginHookBeforeToolCallResult | void> | PluginHookBeforeToolCallResult | void;

  after_tool_call: (
    event: PluginHookAfterToolCallEvent,
    ctx: PluginHookToolContext
  ) => Promise<void> | void;

  tool_result_persist: (
    event: PluginHookToolResultPersistEvent,
    ctx: PluginHookToolResultPersistContext
  ) => PluginHookToolResultPersistResult | void;

  before_message_write: (
    event: PluginHookBeforeMessageWriteEvent,
    ctx: { agentId?: string; sessionKey?: string }
  ) => PluginHookBeforeMessageWriteResult | void;

  session_start: (
    event: PluginHookSessionStartEvent,
    ctx: PluginHookSessionContext
  ) => Promise<void> | void;

  session_end: (
    event: PluginHookSessionEndEvent,
    ctx: PluginHookSessionContext
  ) => Promise<void> | void;

  subagent_spawning: (
    event: PluginHookSubagentSpawningEvent,
    ctx: PluginHookSubagentContext
  ) => Promise<PluginHookSubagentSpawningResult | void> | PluginHookSubagentSpawningResult | void;

  subagent_delivery_target: (
    event: PluginHookSubagentDeliveryTargetEvent,
    ctx: PluginHookSubagentContext
  ) => Promise<PluginHookSubagentDeliveryTargetResult | void> | PluginHookSubagentDeliveryTargetResult | void;

  subagent_spawned: (
    event: PluginHookSubagentSpawnedEvent,
    ctx: PluginHookSubagentContext
  ) => Promise<void> | void;

  subagent_ended: (
    event: PluginHookSubagentEndedEvent,
    ctx: PluginHookSubagentContext
  ) => Promise<void> | void;

  gateway_start: (
    event: PluginHookGatewayStartEvent,
    ctx: PluginHookGatewayContext
  ) => Promise<void> | void;

  gateway_stop: (
    event: PluginHookGatewayStopEvent,
    ctx: PluginHookGatewayContext
  ) => Promise<void> | void;
};

// ============================================================================
// 钩子注册
// ============================================================================

export type HookHandler = (event: any, ctx: HookContext) => Promise<any | void> | any | void;

export interface HookRegistration {
  id: string;
  hookName: HookName;
  handler: HookHandler;
  priority: number;
  source: 'builtin' | 'plugin' | 'user';
}

export type PluginHookRegistration<K extends HookName = HookName> = {
  pluginId: string;
  hookName: K;
  handler: K extends keyof PluginHookHandlerMap ? PluginHookHandlerMap[K] : HookHandler;
  priority?: number;
  source: string;
};
