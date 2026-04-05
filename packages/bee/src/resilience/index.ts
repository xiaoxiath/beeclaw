/**
 * bee — Resilience module barrel export.
 */

export {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  CIRCUIT_BREAKER_PRESETS,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreakerEvent,
  type CircuitBreakerListener,
} from './circuit-breaker';

export {
  UnifiedRetryEngine,
  RETRY_STRATEGIES,
  classifyError,
  computeDelay,
  type UnifiedErrorType,
  type ClassifiedError,
  type RetryStrategy,
  type RetryContext,
  type RetryResult,
  type RetryEvent,
  type RetryEventListener,
} from './retry';

export {
  LoopDetector,
  DEFAULT_LOOP_DETECTOR_CONFIG,
  type LoopDetectorConfig,
  type ToolCallRecord,
  type LoopDetectionResult,
} from './loop-detector';

export {
  TimeoutEnforcer,
  ToolTimeoutError,
  type TimeoutConfig,
  type ToolTimeoutPattern,
} from './timeout';
