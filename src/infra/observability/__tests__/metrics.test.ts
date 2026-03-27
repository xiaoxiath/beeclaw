import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Mock the logger to avoid circular dependency issues
mock.module('../logger', () => ({
  logger: {
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  },
}));

import {
  Observability,
  createSpan,
  createRequestLogger,
  AGENT_METRICS,
  createObservabilityHooks,
  metrics,
  type LogExporter,
  type MetricExporter,
  type TraceExporter,
} from '../metrics';

describe('metrics (observability)', () => {
  describe('Observability', () => {
    it('should configure log level', () => {
      expect(() => Observability.configure({ level: 'debug' })).not.toThrow();
      // Reset
      Observability.configure({ level: 'info' });
    });

    it('should configure structured mode', () => {
      expect(() => Observability.configure({ structured: true })).not.toThrow();
      Observability.configure({ structured: false });
    });

    it('should return a logger', () => {
      const log = Observability.getLogger();
      expect(log).toBeDefined();
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.debug).toBe('function');
    });

    it('should return metrics collector', () => {
      const m = Observability.getMetrics();
      expect(m).toBeDefined();
      expect(typeof m.increment).toBe('function');
      expect(typeof m.histogram).toBe('function');
      expect(typeof m.gauge).toBe('function');
    });

    it('should accept custom log exporter', () => {
      const exporter: LogExporter = { write: mock() };
      expect(() => Observability.configure({ logExporter: exporter })).not.toThrow();
      // Reset
      Observability.configure({ logExporter: undefined });
    });

    it('should accept custom metric exporter', () => {
      const exporter: MetricExporter = { export: mock() };
      expect(() => Observability.configure({ metricExporter: exporter })).not.toThrow();
    });

    it('should flush without error', async () => {
      await expect(Observability.flush()).resolves.toBeUndefined();
    });

    it('should flush custom exporters', async () => {
      const logFlush = mock(() => Promise.resolve());
      const traceFlush = mock(() => Promise.resolve());
      const metricFlush = mock(() => Promise.resolve());

      Observability.configure({
        logExporter: { write: mock(), flush: logFlush },
        traceExporter: { export: mock(), flush: traceFlush },
        metricExporter: { export: mock(), flush: metricFlush },
      });

      await Observability.flush();

      expect(logFlush).toHaveBeenCalled();
      expect(traceFlush).toHaveBeenCalled();
      expect(metricFlush).toHaveBeenCalled();
    });
  });

  describe('StructuredLogger (via Observability.getLogger)', () => {
    it('should log info messages', () => {
      const log = Observability.getLogger();
      expect(() => log.info('test message')).not.toThrow();
    });

    it('should log with fields', () => {
      const log = Observability.getLogger();
      expect(() => log.info('test', { key: 'value' })).not.toThrow();
    });

    it('should log errors with Error objects', () => {
      const log = Observability.getLogger();
      expect(() => log.error('error occurred', new Error('test error'))).not.toThrow();
    });

    it('should log errors with non-Error objects', () => {
      const log = Observability.getLogger();
      expect(() => log.error('error occurred', 'string error')).not.toThrow();
    });

    it('should create child module logger', () => {
      const log = Observability.getLogger();
      const child = log.child('test-module');
      expect(child).toBeDefined();
      expect(() => child.info('child message')).not.toThrow();
      expect(() => child.warn('child warning')).not.toThrow();
      expect(() => child.error('child error', new Error('oops'))).not.toThrow();
      expect(() => child.debug('child debug')).not.toThrow();
    });

    it('should create context-bound logger', () => {
      const log = Observability.getLogger();
      const contextLog = log.withContext({ traceId: 'abc123', sessionId: 'sess1' });
      expect(contextLog).toBeDefined();
      expect(() => contextLog.info('with context')).not.toThrow();
    });
  });

  describe('MetricsCollector (via metrics)', () => {
    it('should increment counter', () => {
      expect(() => metrics.increment('test_counter')).not.toThrow();
    });

    it('should increment counter with labels', () => {
      expect(() => metrics.increment('test_counter', { tool: 'search' })).not.toThrow();
    });

    it('should record histogram', () => {
      expect(() => metrics.histogram('test_latency', 150)).not.toThrow();
    });

    it('should record gauge', () => {
      expect(() => metrics.gauge('test_gauge', 42)).not.toThrow();
    });

    it('should start and stop timer', () => {
      const stop = metrics.startTimer('test_timer');
      expect(typeof stop).toBe('function');
      const elapsed = stop();
      expect(typeof elapsed).toBe('number');
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });

    it('should return snapshot from in-memory exporter', () => {
      const snapshot = metrics.getSnapshot();
      // Could be null if exporter was swapped, or an object
      expect(snapshot === null || typeof snapshot === 'object').toBe(true);
    });
  });

  describe('createSpan', () => {
    it('should create a span', () => {
      const span = createSpan('test-span');
      expect(span).toBeDefined();
      expect(span.traceId).toBeDefined();
      expect(span.spanId).toBeDefined();
    });

    it('should create span with attributes', () => {
      const span = createSpan('test-span', { userId: 'user1' });
      expect(span).toBeDefined();
    });

    it('should record events on span', () => {
      const span = createSpan('test-span');
      expect(() => span.event('some-event', { key: 'val' })).not.toThrow();
    });

    it('should set attributes', () => {
      const span = createSpan('test-span');
      expect(() => span.setAttribute('key', 'value')).not.toThrow();
    });

    it('should create child spans', () => {
      const parent = createSpan('parent');
      const child = parent.createChild('child', { step: 1 });
      expect(child.traceId).toBe(parent.traceId);
    });

    it('should mark error on span', () => {
      const span = createSpan('test-span');
      expect(() => span.setError(new Error('test'))).not.toThrow();
      expect(() => span.setError('string error')).not.toThrow();
    });

    it('should end span', () => {
      const span = createSpan('test-span');
      span.event('test-event');
      expect(() => span.end()).not.toThrow();
    });

    it('should auto-end child spans on parent end', () => {
      const parent = createSpan('parent');
      const child = parent.createChild('child');
      parent.end();
      // child should be ended too
      const json = child.toJSON();
      expect(json.endTime).toBeDefined();
    });

    it('should serialize to JSON', () => {
      const span = createSpan('test-span', { foo: 'bar' });
      span.event('evt');
      span.end();
      const json = span.toJSON();
      expect(json.name).toBe('test-span');
      expect(json.attributes.foo).toBe('bar');
      expect(json.events).toHaveLength(1);
      expect(json.duration).toBeDefined();
    });

    it('should use parent trace ID when provided', () => {
      const parent = createSpan('parent');
      const child = createSpan('child', {}, parent);
      expect(child.traceId).toBe(parent.traceId);
      parent.end();
      child.end();
    });
  });

  describe('createRequestLogger', () => {
    it('should create a request-scoped logger', () => {
      const reqLog = createRequestLogger({
        traceId: 'trace-123',
        sessionId: 'session-456',
        userId: 'user-789',
      });
      expect(reqLog).toBeDefined();
      expect(() => reqLog.info('request started')).not.toThrow();
    });

    it('should work with partial context', () => {
      const reqLog = createRequestLogger({ traceId: 'trace-only' });
      expect(() => reqLog.info('test')).not.toThrow();
    });
  });

  describe('AGENT_METRICS', () => {
    it('should define all expected metric names', () => {
      expect(AGENT_METRICS.CHAT_REQUESTS_TOTAL).toBeDefined();
      expect(AGENT_METRICS.CHAT_LATENCY_MS).toBeDefined();
      expect(AGENT_METRICS.LLM_CALLS_TOTAL).toBeDefined();
      expect(AGENT_METRICS.TOOL_CALLS_TOTAL).toBeDefined();
      expect(AGENT_METRICS.TOKENS_USED).toBeDefined();
      expect(AGENT_METRICS.CONTEXT_COMPRESSIONS).toBeDefined();
      expect(AGENT_METRICS.MEMORY_QUERIES_TOTAL).toBeDefined();
    });
  });

  describe('createObservabilityHooks', () => {
    it('should return a record of hook functions', () => {
      const hooks = createObservabilityHooks();
      expect(typeof hooks.beforeAgentStart).toBe('function');
      expect(typeof hooks.agentEnd).toBe('function');
      expect(typeof hooks.llmInput).toBe('function');
      expect(typeof hooks.llmOutput).toBe('function');
      expect(typeof hooks.beforeToolCall).toBe('function');
      expect(typeof hooks.afterToolCall).toBe('function');
      expect(typeof hooks.beforeCompaction).toBe('function');
      expect(typeof hooks.afterCompaction).toBe('function');
    });

    it('should execute hooks without errors', () => {
      const hooks = createObservabilityHooks();
      expect(() => hooks.beforeAgentStart({})).not.toThrow();
      expect(() => hooks.agentEnd({ iterations: 5, totalTokens: 1000 })).not.toThrow();
      expect(() => hooks.llmInput({ model: 'gpt-4', messageCount: 3 })).not.toThrow();
      expect(() => hooks.llmOutput({ model: 'gpt-4', tokensUsed: 500, latencyMs: 1200 })).not.toThrow();
      expect(() => hooks.beforeToolCall({ toolName: 'search', params: {} })).not.toThrow();
      expect(() => hooks.afterToolCall({ toolName: 'search', latencyMs: 200, success: true })).not.toThrow();
      expect(() => hooks.beforeCompaction({ currentTokens: 5000, threshold: 4000 })).not.toThrow();
      expect(() => hooks.afterCompaction({ tokensBefore: 5000, tokensAfter: 2000, tokensFreed: 3000 })).not.toThrow();
    });

    it('should handle failed tool calls', () => {
      const hooks = createObservabilityHooks();
      expect(() => hooks.afterToolCall({ toolName: 'search', latencyMs: 200, success: false })).not.toThrow();
    });
  });
});
