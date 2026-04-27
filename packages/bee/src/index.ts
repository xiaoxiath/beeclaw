/**
 * bee — AI Agent Harness.
 *
 * A lightweight, production-honed agent harness extracted from beeclaw.
 */

// Core types and logger
export * from './core';

// Context: token estimation, budget
export {
  estimateTokens,
  estimateMessageTokens,
  estimateTotalTokens,
  MODEL_CONTEXT_WINDOWS,
} from './context/token-estimator';
export { TokenBudgetManager } from './context/budget';

// Context: compression
export {
  L1FormatCompressor,
  L2ExtractiveCompressor,
  L3AbstractiveCompressor,
  TieredCompressor,
  createEmptyStats,
  DEFAULT_AGE_ZONES,
} from './context/compression';
export type {
  CompressionLevel,
  CompressionResult,
  CompressionPlan,
  CompressionLLMClient,
  CompressionStats,
  AgeZone,
  Compressor,
  CompressionRule,
} from './context/compression';

// Provider: AI calling, concurrency, routing
export {
  AIClient,
  ConcurrencyLimiter,
  LLMRequestPriority,
  TieredLLMRouter,
  LLMTier,
  LLMTask,
  LLM_TIER_CONFIGS,
  TASK_TIER_MAP,
  convertToAnthropicFormat,
  convertFromAnthropicFormat,
  hasToolCalls,
  extractToolCalls,
  extractContent,
  executeToolCalls,
} from './provider';
export type {
  AIClientOptions,
  CallAIOptions,
  StreamAIOptions,
  AcquireOptions,
  ConcurrencyLimiterOptions,
  ConcurrencyStats,
  TieredLLMRouterOptions,
} from './provider';

// Resilience: retry, circuit breaker, loop detection, timeout
export {
  UnifiedRetryEngine,
  RETRY_STRATEGIES,
  classifyError,
  computeDelay,
} from './resilience/retry';
export type {
  RetryStrategy,
  RetryResult,
  RetryContext,
  ClassifiedError,
} from './resilience/retry';

export {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  CIRCUIT_BREAKER_PRESETS,
} from './resilience/circuit-breaker';
export type {
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitBreakerEvent,
  CircuitBreakerListener,
} from './resilience/circuit-breaker';

export {
  LoopDetector,
} from './resilience/loop-detector';
export type {
  LoopDetectorConfig,
  LoopDetectionResult,
} from './resilience/loop-detector';

export {
  TimeoutEnforcer,
  ToolTimeoutError,
} from './resilience/timeout';
export type {
  TimeoutConfig,
  ToolTimeoutPattern,
} from './resilience/timeout';

// Tools: registration and dispatch
export {
  ToolRegistry,
  ToolDispatcher,
} from './tool';
export type {
  ToolDefinition,
  ToolExecutorFn,
  ToolDispatcherConfig,
} from './tool';

// Agent: main orchestrator
export {
  Agent,
} from './agent';
export type {
  AgentConfig,
  AgentResponse,
} from './agent';

// Hooks: lifecycle interface
export { NoOpHookRunner } from './hooks/types';
export type {
  IHookRunner,
  BaseHookEvent,
  HookContext,
  ModelHookEvent,
  SessionHookEvent,
  ToolHookEvent,
} from './hooks/types';

// Memory: store interface (no implementation)
export type {
  IMemoryStore,
  MemoryReadResult,
  MemoryWriteResult,
  MemorySearchOptions,
  MemorySearchResult,
} from './memory/interface';

// MCP: client types and utilities
export {
  isMCPToolName,
  parseMCPToolName,
} from './mcp/types';
export type {
  MCPServerConfig,
  MCPToolResult,
  MCPServerStatus,
  IMCPManager,
} from './mcp/types';

// Safety: prompt injection, memory fencing, command approval
export {
  scanForInjection,
  sanitizeText,
} from './safety/injection-scanner';
export type { ScanResult } from './safety/injection-scanner';

export {
  fenceMemoryContent,
  sanitizeMemoryContent,
} from './safety/memory-fence';

export {
  CommandApproval,
  COMMAND_TOOLS,
  DANGER_PATTERNS,
} from './safety/command-approval';
export type {
  DangerLevel,
  DangerPattern,
  ApprovalAssessment,
  CommandApprovalOptions,
} from './safety/command-approval';

// Data: trajectory generation
export {
  convertToShareGPT,
  saveTrajectory,
  generateAndSaveTrajectory,
} from './data/trajectory';
export type {
  ShareGPTTurn,
  TrajectoryRecord,
  TrajectoryConfig,
} from './data/trajectory';
