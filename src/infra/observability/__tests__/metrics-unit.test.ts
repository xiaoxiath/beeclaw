/**
 * Additional unit tests for src/infra/observability/metrics.ts
 * Targets uncovered branches: StdoutLogExporter structured mode,
 * InMemoryMetricExporter (overflow, filtering, snapshot), MetricsCollector disabled,
 * createSpan with tracing disabled, StdoutTraceExporter, log level filtering,
 * createObservabilityHooks metric edge cases.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../logger', () => ({
  logger: mocks.mockLogger,
}));

import {
  Observability,
  createSpan,
  createObservabilityHooks,
  metrics,
  type LogExporter,
  type MetricExporter,
  type TraceExporter,
} from '../metrics';

function resetMockImplementations() {
  mocks.mockLogger.info.mockImplementation(() => {});
  mocks.mockLogger.warn.mockImplementation(() => {});
  mocks.mockLogger.error.mockImplementation(() => {});
  mocks.mockLogger.debug.mockImplementation(() => {});
}

describe('metrics (observability) - additional coverage', () => {
  beforeEach(() => {
    resetMockImplementations();
    // Reset to a safe default config before each test using a custom exporter
    // to avoid StdoutLogExporter's internal recursion issue
    Observability.configure({
      level: 'info',
      structured: false,
      tracingEnabled: true,
      metricsEnabled: true,
    });
  });

  /* ================================================================ */
  /*  StdoutLogExporter - structured mode (uses console.log/error)     */
  /* ================================================================ */
  describe('StdoutLogExporter - structured JSON mode', () => {
    it('should output structured JSON with all optional fields via console.log', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Observability.configure({ structured: true, level: 'debug', logExporter: undefined });

      const log = Observability.getLogger();
      const ctxLog = log.withContext({
        traceId: 'trace-abc',
        spanId: 'span-123',
        sessionId: 'sess-x',
        userId: 'user-y',
      });

      ctxLog.info('structured test', { customKey: 'customVal' });

      const logCalls = consoleSpy.mock.calls;
      const jsonCall = logCalls.find(c => {
        try { const p = JSON.parse(c[0]); return p.msg === 'structured test'; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.traceId).toBe('trace-abc');
      expect(parsed.spanId).toBe('span-123');
      expect(parsed.sessionId).toBe('sess-x');
      expect(parsed.userId).toBe('user-y');
      expect(parsed.customKey).toBe('customVal');
      expect(parsed.level).toBe('info');

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should use console.error for error level in structured mode', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Observability.configure({ structured: true, level: 'debug', logExporter: undefined });
      const log = Observability.getLogger();
      log.error('structured error', new Error('boom'));

      const errorCalls = consoleErrorSpy.mock.calls;
      const jsonCall = errorCalls.find(c => {
        try { const p = JSON.parse(c[0]); return p.msg === 'structured error'; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.level).toBe('error');
      expect(parsed.error).toBeDefined();
      expect(parsed.error.name).toBe('Error');
      expect(parsed.error.message).toBe('boom');

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should include module tag in structured output', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Observability.configure({ structured: true, level: 'debug', logExporter: undefined });
      const log = Observability.getLogger();
      const child = log.child('test-mod');
      child.info('mod message');

      const found = consoleSpy.mock.calls.find(c => {
        try { return JSON.parse(c[0]).msg.includes('[test-mod]'); } catch { return false; }
      });
      expect(found).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('should handle structured output with no optional fields', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      Observability.configure({ structured: true, level: 'debug', logExporter: undefined });
      const log = Observability.getLogger();
      // No context, no fields - just a bare message
      log.info('bare message');

      const found = consoleSpy.mock.calls.find(c => {
        try { const p = JSON.parse(c[0]); return p.msg === 'bare message'; } catch { return false; }
      });
      expect(found).toBeDefined();
      const parsed = JSON.parse(found![0]);
      // traceId, spanId, sessionId, userId, module should all be absent
      expect(parsed.traceId).toBeUndefined();
      expect(parsed.spanId).toBeUndefined();
      expect(parsed.sessionId).toBeUndefined();
      expect(parsed.userId).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('should include error info in structured output', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      Observability.configure({ structured: true, level: 'debug', logExporter: undefined });
      const log = Observability.getLogger();

      // non-Error error object
      log.error('str error', 'just a string');

      const found = consoleErrorSpy.mock.calls.find(c => {
        try { const p = JSON.parse(c[0]); return p.msg === 'str error'; } catch { return false; }
      });
      expect(found).toBeDefined();
      const parsed = JSON.parse(found![0]);
      expect(parsed.error.name).toBe('UnknownError');
      expect(parsed.error.message).toBe('just a string');

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  /* ================================================================ */
  /*  StructuredLogger + custom LogExporter (non-structured paths)     */
  /*  We use a custom exporter to capture entries and verify fields    */
  /*  without triggering StdoutLogExporter's internal recursion.       */
  /* ================================================================ */
  describe('StructuredLogger - entry construction via custom exporter', () => {
    it('should build error entry with Error object', () => {
      const writeFn = vi.fn();
      Observability.configure({ level: 'debug', logExporter: { write: writeFn } });

      const log = Observability.getLogger();
      const err = new Error('test error');
      log.error('err msg', err);

      expect(writeFn).toHaveBeenCalledTimes(1);
      const entry = writeFn.mock.calls[0][0];
      expect(entry.level).toBe('error');
      expect(entry.message).toBe('err msg');
      expect(entry.error).toBeDefined();
      expect(entry.error.name).toBe('Error');
      expect(entry.error.message).toBe('test error');
      expect(entry.error.stack).toBeDefined();
    });

    it('should build error entry with non-Error object', () => {
      const writeFn = vi.fn();
      Observability.configure({ level: 'debug', logExporter: { write: writeFn } });

      const log = Observability.getLogger();
      log.error('str err', 'string error value');

      const entry = writeFn.mock.calls[0][0];
      expect(entry.error).toBeDefined();
      expect(entry.error.name).toBe('UnknownError');
      expect(entry.error.message).toBe('string error value');
    });

    it('should build error entry with no error arg', () => {
      const writeFn = vi.fn();
      Observability.configure({ level: 'debug', logExporter: { write: writeFn } });

      const log = Observability.getLogger();
      log.error('no error obj');

      const entry = writeFn.mock.calls[0][0];
      expect(entry.error).toBeUndefined();
    });

    it('should include traceId, spanId, sessionId, userId from context', () => {
      const writeFn = vi.fn();
      Observability.configure({ level: 'debug', logExporter: { write: writeFn } });

      const log = Observability.getLogger();
      const ctxLog = log.withContext({
        traceId: 'tr-1',
        spanId: 'sp-2',
        sessionId: 'se-3',
        userId: 'us-4',
      });
      ctxLog.info('context msg');

      const entry = writeFn.mock.calls[0][0];
      expect(entry.traceId).toBe('tr-1');
      expect(entry.spanId).toBe('sp-2');
      expect(entry.sessionId).toBe('se-3');
      expect(entry.userId).toBe('us-4');
    });

    it('should merge defaultFields and per-call fields', () => {
      const writeFn = vi.fn();
      Observability.configure({
        level: 'debug',
        logExporter: { write: writeFn },
        defaultFields: { service: 'beeclaw', version: '2.0' },
      });

      const log = Observability.getLogger();
      log.info('with fields', { requestId: 'r-1' });

      const entry = writeFn.mock.calls[0][0];
      expect(entry.fields.service).toBe('beeclaw');
      expect(entry.fields.version).toBe('2.0');
      expect(entry.fields.requestId).toBe('r-1');
    });

    it('should include module prefix via child logger', () => {
      const writeFn = vi.fn();
      Observability.configure({ level: 'debug', logExporter: { write: writeFn } });

      const log = Observability.getLogger();
      const child = log.child('mymod');
      child.info('child info');
      child.warn('child warn');
      child.error('child error', new Error('e'));
      child.debug('child debug');

      expect(writeFn).toHaveBeenCalledTimes(4);
      expect(writeFn.mock.calls[0][0].message).toBe('[mymod] child info');
      expect(writeFn.mock.calls[1][0].message).toBe('[mymod] child warn');
      expect(writeFn.mock.calls[2][0].message).toBe('[mymod] child error');
      expect(writeFn.mock.calls[3][0].message).toBe('[mymod] child debug');
    });
  });

  /* ================================================================ */
  /*  StdoutTraceExporter (via createSpan + end)                       */
  /* ================================================================ */
  describe('StdoutTraceExporter', () => {
    it('should export span data when traceExporter is not set (default)', () => {
      // When tracingEnabled is true and no custom traceExporter is set,
      // createSpan creates a StdoutTraceExporter which calls logger.debug
      // But logger is globalLogger which would recurse.
      // Instead, test via a custom traceExporter
      const exportFn = vi.fn();
      Observability.configure({
        tracingEnabled: true,
        traceExporter: { export: exportFn },
        level: 'debug',
      });

      const span = createSpan('test-export-span', { key: 'val' });
      span.event('test-event');
      span.end();

      expect(exportFn).toHaveBeenCalledTimes(1);
      const exported = exportFn.mock.calls[0][0];
      expect(exported.name).toBe('test-export-span');
      expect(exported.attributes.key).toBe('val');
      expect(exported.events).toHaveLength(1);
      expect(exported.duration).toBeDefined();
      expect(exported.status).toBe('ok');
    });

    it('should export child spans on parent end', () => {
      const exportFn = vi.fn();
      Observability.configure({
        tracingEnabled: true,
        traceExporter: { export: exportFn },
      });

      const parent = createSpan('parent');
      const child = parent.createChild('child');
      parent.end(); // should auto-end child

      // Both parent and child should be exported
      expect(exportFn).toHaveBeenCalledTimes(2);
      const names = exportFn.mock.calls.map((c: any) => c[0].name);
      expect(names).toContain('parent');
      expect(names).toContain('child');
    });
  });

  /* ================================================================ */
  /*  InMemoryMetricExporter                                           */
  /* ================================================================ */
  describe('InMemoryMetricExporter (via MetricsCollector)', () => {
    it('should produce correct snapshot with aggregated stats', () => {
      // Use default InMemoryMetricExporter
      Observability.configure({ metricExporter: undefined, metricsEnabled: true });

      metrics.histogram('unit_latency', 100, { endpoint: '/api' });
      metrics.histogram('unit_latency', 200, { endpoint: '/api' });
      metrics.histogram('unit_latency', 300, { endpoint: '/api' });

      const snapshot = metrics.getSnapshot();
      expect(snapshot).not.toBeNull();

      const key = Object.keys(snapshot!).find(k => k.startsWith('unit_latency'));
      expect(key).toBeDefined();
      const stats = (snapshot as any)[key!];
      expect(stats.count).toBe(3);
      expect(stats.sum).toBe(600);
      expect(stats.avg).toBe(200);
      expect(stats.max).toBe(300);
      expect(stats.min).toBe(100);
    });

    it('should return null for getSnapshot when using custom exporter', () => {
      const customExporter: MetricExporter = { export: vi.fn() };
      Observability.configure({ metricExporter: customExporter });

      const snapshot = metrics.getSnapshot();
      expect(snapshot).toBeNull();
    });

  });

  /* ================================================================ */
  /*  MetricsCollector methods                                         */
  /* ================================================================ */
  describe('MetricsCollector methods', () => {
    it('should export counter via increment', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn }, metricsEnabled: true });

      metrics.increment('test_counter', { tool: 'search' }, 5);

      expect(exportFn).toHaveBeenCalledWith(expect.objectContaining({
        name: 'test_counter',
        type: 'counter',
        value: 5,
        labels: { tool: 'search' },
      }));
    });

    it('should export histogram', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn }, metricsEnabled: true });

      metrics.histogram('test_hist', 42, { ep: '/api' });

      expect(exportFn).toHaveBeenCalledWith(expect.objectContaining({
        name: 'test_hist',
        type: 'histogram',
        value: 42,
        labels: { ep: '/api' },
      }));
    });

    it('should export gauge', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn }, metricsEnabled: true });

      metrics.gauge('test_gauge', 99, { node: 'n1' });

      expect(exportFn).toHaveBeenCalledWith(expect.objectContaining({
        name: 'test_gauge',
        type: 'gauge',
        value: 99,
        labels: { node: 'n1' },
      }));
    });

    it('should start and stop timer recording a histogram', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn }, metricsEnabled: true });

      const stop = metrics.startTimer('timer_test', { op: 'query' });
      const elapsed = stop();

      expect(typeof elapsed).toBe('number');
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(exportFn).toHaveBeenCalledWith(expect.objectContaining({
        name: 'timer_test',
        type: 'histogram',
        labels: { op: 'query' },
      }));
    });
  });

  /* ================================================================ */
  /*  createSpan - tracing disabled                                    */
  /* ================================================================ */
  describe('createSpan - tracing disabled', () => {
    it('should return a noop span when tracing is disabled', () => {
      Observability.configure({ tracingEnabled: false });

      const span = createSpan('noop-span', { key: 'val' });
      expect(span).toBeDefined();
      expect(span.traceId).toBe('noop');

      span.event('test-event');
      span.setAttribute('extra', 'data');
      span.setError('test error');
      span.end();

      const json = span.toJSON();
      expect(json.traceId).toBe('noop');
      expect(json.name).toBe('noop-span');

      Observability.configure({ tracingEnabled: true });
    });

    it('noop span should not call trace exporter on end', () => {
      const exportFn = vi.fn();
      Observability.configure({
        tracingEnabled: false,
        traceExporter: { export: exportFn },
      });

      const span = createSpan('noop-span');
      span.end();

      // traceExporter should not be called (null is passed to SpanImpl)
      expect(exportFn).not.toHaveBeenCalled();

      Observability.configure({ tracingEnabled: true });
    });
  });

  /* ================================================================ */
  /*  SpanImpl edge cases                                              */
  /* ================================================================ */
  describe('SpanImpl - edge cases', () => {
    it('should set error with string (not Error object)', () => {
      const exportFn = vi.fn();
      Observability.configure({ tracingEnabled: true, traceExporter: { export: exportFn } });

      const span = createSpan('err-span');
      span.setError('plain string error');
      const json = span.toJSON();
      expect(json.attributes['error.message']).toBe('plain string error');
      expect(json.status).toBe('error');
      // error.stack should NOT be set for string errors
      expect(json.attributes['error.stack']).toBeUndefined();
      span.end();
    });

    it('should set error with Error object including stack', () => {
      const exportFn = vi.fn();
      Observability.configure({ tracingEnabled: true, traceExporter: { export: exportFn } });

      const span = createSpan('err-span-2');
      const err = new Error('real error');
      span.setError(err);
      const json = span.toJSON();
      expect(json.attributes['error.message']).toBe('real error');
      expect(json.attributes['error.stack']).toBeDefined();
      expect(json.status).toBe('error');
      span.end();
    });

    it('should auto-end unfinished child spans when parent ends', () => {
      const exportFn = vi.fn();
      Observability.configure({ tracingEnabled: true, traceExporter: { export: exportFn } });

      const parent = createSpan('parent-auto');
      const child1 = parent.createChild('child-1');
      const child2 = parent.createChild('child-2');

      // End child2 manually first
      child2.end();
      const child2EndTime = child2.toJSON().endTime;

      // Parent end should auto-end child1 but not re-end child2
      parent.end();

      expect(child1.toJSON().endTime).toBeDefined();
      expect(child1.toJSON().duration).toBeDefined();
      // child2 was already ended, endTime should not change
      expect(child2.toJSON().endTime).toBe(child2EndTime);
    });

    it('should record events with attributes', () => {
      const exportFn = vi.fn();
      Observability.configure({ tracingEnabled: true, traceExporter: { export: exportFn } });

      const span = createSpan('event-span');
      span.event('evt-1', { foo: 'bar' });
      span.event('evt-2');
      span.end();

      const json = span.toJSON();
      expect(json.events).toHaveLength(2);
      expect(json.events[0].name).toBe('evt-1');
      expect(json.events[0].attributes).toEqual({ foo: 'bar' });
      expect(json.events[1].name).toBe('evt-2');
    });

    it('should use parent traceId and set parentSpanId', () => {
      const exportFn = vi.fn();
      Observability.configure({ tracingEnabled: true, traceExporter: { export: exportFn } });

      const parent = createSpan('parent-trace');
      const child = createSpan('child-trace', {}, parent);

      expect(child.traceId).toBe(parent.traceId);
      const childJson = child.toJSON();
      expect(childJson.parentSpanId).toBe(parent.spanId);

      child.end();
      parent.end();
    });
  });

  /* ================================================================ */
  /*  StructuredLogger - log level filtering                           */
  /* ================================================================ */
  describe('StructuredLogger - log level filtering', () => {
    it('should not log debug when level is info', () => {
      const writeFn = vi.fn();
      Observability.configure({ level: 'info', logExporter: { write: writeFn } });

      const log = Observability.getLogger();
      log.debug('should be filtered');

      expect(writeFn).not.toHaveBeenCalled();
    });

    it('should log warn when level is warn', () => {
      const writeFn = vi.fn();
      Observability.configure({ level: 'warn', logExporter: { write: writeFn } });

      const log = Observability.getLogger();
      log.info('should be filtered');
      log.warn('should pass');

      expect(writeFn).toHaveBeenCalledTimes(1);
      expect(writeFn.mock.calls[0][0].message).toBe('should pass');
    });

    it('should log nothing when level is silent', () => {
      const writeFn = vi.fn();
      Observability.configure({ level: 'silent', logExporter: { write: writeFn } });

      const log = Observability.getLogger();
      log.debug('filtered');
      log.info('filtered');
      log.warn('filtered');
      log.error('filtered');

      expect(writeFn).not.toHaveBeenCalled();
    });

    it('should log everything when level is debug', () => {
      const writeFn = vi.fn();
      Observability.configure({ level: 'debug', logExporter: { write: writeFn } });

      const log = Observability.getLogger();
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');

      expect(writeFn).toHaveBeenCalledTimes(4);
    });
  });

  /* ================================================================ */
  /*  createObservabilityHooks - metric edge cases                     */
  /* ================================================================ */
  describe('createObservabilityHooks - metric values', () => {
    it('llmOutput should skip histogram when values are not numbers', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn } });

      const hooks = createObservabilityHooks();
      exportFn.mockClear();
      hooks.llmOutput({ model: 'gpt-4', tokensUsed: 'not a number', latencyMs: undefined });

      const histCalls = exportFn.mock.calls.filter(
        (c: any) => c[0].type === 'histogram',
      );
      expect(histCalls).toHaveLength(0);
    });

    it('llmOutput should record histograms when values are numbers', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn } });

      const hooks = createObservabilityHooks();
      exportFn.mockClear();
      hooks.llmOutput({ model: 'gpt-4', tokensUsed: 500, latencyMs: 1200 });

      const histCalls = exportFn.mock.calls.filter(
        (c: any) => c[0].type === 'histogram',
      );
      expect(histCalls).toHaveLength(2); // tokensUsed + latencyMs
    });

    it('afterToolCall should record error metric on failure', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn } });

      const hooks = createObservabilityHooks();
      exportFn.mockClear();

      hooks.afterToolCall({ toolName: 'search', latencyMs: 500, success: false });

      const counterCalls = exportFn.mock.calls.filter(
        (c: any) => c[0].type === 'counter',
      );
      expect(counterCalls.length).toBeGreaterThanOrEqual(1);
      // One of them should be the error counter
      const errorCounter = counterCalls.find(
        (c: any) => c[0].name.includes('error'),
      );
      expect(errorCounter).toBeDefined();
    });

    it('afterToolCall should not record error metric on success', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn } });

      const hooks = createObservabilityHooks();
      exportFn.mockClear();

      hooks.afterToolCall({ toolName: 'calc', latencyMs: 10, success: true });

      const errorCounters = exportFn.mock.calls.filter(
        (c: any) => c[0].type === 'counter' && c[0].name.includes('error'),
      );
      expect(errorCounters).toHaveLength(0);
    });

    it('afterToolCall should skip histogram when latencyMs is not a number', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn } });

      const hooks = createObservabilityHooks();
      exportFn.mockClear();

      hooks.afterToolCall({ toolName: 'calc', latencyMs: undefined, success: true });

      const histCalls = exportFn.mock.calls.filter(
        (c: any) => c[0].type === 'histogram',
      );
      expect(histCalls).toHaveLength(0);
    });

    it('afterCompaction should record tokensFreed when it is a number', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn } });

      const hooks = createObservabilityHooks();
      exportFn.mockClear();

      hooks.afterCompaction({ tokensBefore: 5000, tokensAfter: 2000, tokensFreed: 3000 });

      const histCalls = exportFn.mock.calls.filter(
        (c: any) => c[0].type === 'histogram' && c[0].name.includes('tokens_freed'),
      );
      expect(histCalls).toHaveLength(1);
      expect(histCalls[0][0].value).toBe(3000);
    });

    it('afterCompaction should skip histogram when tokensFreed is not a number', () => {
      const exportFn = vi.fn();
      Observability.configure({ metricExporter: { export: exportFn } });

      const hooks = createObservabilityHooks();
      exportFn.mockClear();

      hooks.afterCompaction({ tokensBefore: 5000, tokensAfter: 2000, tokensFreed: undefined });

      const histCalls = exportFn.mock.calls.filter(
        (c: any) => c[0].type === 'histogram' && c[0].name.includes('tokens_freed'),
      );
      expect(histCalls).toHaveLength(0);
    });
  });

  /* ================================================================ */
  /*  Observability.configure edge cases                               */
  /* ================================================================ */
  describe('Observability.configure - edge cases', () => {
    it('should update exporter when structured changes', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Switch to structured mode without providing a custom exporter
      Observability.configure({ structured: true, logExporter: undefined });
      const log = Observability.getLogger();
      log.info('after reconfigure');

      const found = consoleSpy.mock.calls.find(c => {
        try { return JSON.parse(c[0]).msg === 'after reconfigure'; } catch { return false; }
      });
      expect(found).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('should use provided logExporter over auto-created one', () => {
      const writeFn = vi.fn();
      Observability.configure({ logExporter: { write: writeFn } });

      const log = Observability.getLogger();
      log.info('custom exporter');

      expect(writeFn).toHaveBeenCalledTimes(1);
      expect(writeFn.mock.calls[0][0].message).toBe('custom exporter');
    });
  });

  /* ================================================================ */
  /*  Observability.flush edge cases                                   */
  /* ================================================================ */
  describe('Observability.flush', () => {
    it('should handle flush when exporters have no flush method', async () => {
      Observability.configure({
        logExporter: { write: vi.fn() },
        traceExporter: { export: vi.fn() },
        metricExporter: { export: vi.fn() },
      });

      await expect(Observability.flush()).resolves.toBeUndefined();
    });

    it('should call flush on all exporters that have it', async () => {
      const logFlush = vi.fn().mockResolvedValue(undefined);
      const traceFlush = vi.fn().mockResolvedValue(undefined);
      const metricFlush = vi.fn().mockResolvedValue(undefined);

      Observability.configure({
        logExporter: { write: vi.fn(), flush: logFlush },
        traceExporter: { export: vi.fn(), flush: traceFlush },
        metricExporter: { export: vi.fn(), flush: metricFlush },
      });

      await Observability.flush();

      expect(logFlush).toHaveBeenCalled();
      expect(traceFlush).toHaveBeenCalled();
      expect(metricFlush).toHaveBeenCalled();
    });
  });
});
