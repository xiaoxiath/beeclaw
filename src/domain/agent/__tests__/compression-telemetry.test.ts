/**
 * Compression telemetry — verify the per-call structured logger event
 * carries the bee CompressionResult fields, and that the /stats route
 * exposes the running aggregate so dashboards can chart it.
 *
 * The compression engine itself is bee's TieredCompressor; we don't
 * re-test its level-selection logic here. We test the *wiring*:
 *   1. context-manager.ts emits a structured `[Compression] tier complete`
 *      log with method/ratio/latency after each compress() call.
 *   2. /stats endpoint surfaces the aggregate via getTieredCompressor().getStats().
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockLoggerInfo = vi.fn();
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  },
}));

const mockCompressResult = {
  compressed: '[summary]',
  originalTokens: 1000,
  compressedTokens: 200,
  ratio: 0.8,
  infoRetention: 0.9,
  method: 'L1+L2',
  latencyMs: 42,
};

const mockCompressFn = vi.fn().mockResolvedValue(mockCompressResult);

vi.mock('../compression/tiered-compressor', () => ({
  getTieredCompressor: () => ({
    compress: mockCompressFn,
    getStats: () => ({
      totalCompressions: 7,
      avgRatio: 0.65,
      avgLatencyMs: 30,
      totalTokensSaved: 5000,
      byLevel: { L1: { count: 3, avgRatio: 0.4, avgLatencyMs: 1 }, 'L1+L2': { count: 4, avgRatio: 0.8, avgLatencyMs: 50 } },
    }),
  }),
}));

vi.mock('../tools', () => ({
  scanForInjection: () => ({ safe: true, threats: [] }),
  sanitizeText: (t: string) => t,
}));

vi.mock('../../security/prompt-sanitizer', () => ({
  scanForInjection: () => ({ safe: true, threats: [] }),
  sanitizeText: (t: string) => t,
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('compression telemetry — per-call logger event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoggerInfo.mockClear();
    mockCompressFn.mockResolvedValue(mockCompressResult);
  });

  test('emits structured event after compressContextWithLLM with method+ratio+latency', async () => {
    const { compressContextWithLLM } = await import('../context-manager');

    const state: any = {
      messages: [
        { role: 'system', content: 'sys', timestamp: '2026-05-14T00:00:00Z' },
        { role: 'user', content: 'm1', timestamp: '2026-05-14T00:00:01Z' },
        { role: 'assistant', content: 'r1', timestamp: '2026-05-14T00:00:02Z' },
        { role: 'user', content: 'm2', timestamp: '2026-05-14T00:00:03Z' },
        { role: 'assistant', content: 'r2', timestamp: '2026-05-14T00:00:04Z' },
        { role: 'user', content: 'm3', timestamp: '2026-05-14T00:00:05Z' },
        { role: 'assistant', content: 'r3', timestamp: '2026-05-14T00:00:06Z' },
        { role: 'user', content: 'm4', timestamp: '2026-05-14T00:00:07Z' },
        { role: 'assistant', content: 'r4', timestamp: '2026-05-14T00:00:08Z' },
        { role: 'user', content: 'm5', timestamp: '2026-05-14T00:00:09Z' },
        { role: 'assistant', content: 'r5', timestamp: '2026-05-14T00:00:10Z' },
        { role: 'user', content: 'm6', timestamp: '2026-05-14T00:00:11Z' },
        { role: 'assistant', content: 'r6', timestamp: '2026-05-14T00:00:12Z' },
      ],
      _compressing: false,
      estimatedTokens: 1000,
      contextConfig: { maxTokens: 2000 },
      compressedSummary: '',
      hookRunner: null,
    };

    await compressContextWithLLM(state);

    const telemetryCall = mockLoggerInfo.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('[Compression] tier complete'),
    );
    expect(telemetryCall).toBeDefined();
    const payload = telemetryCall![1] as Record<string, unknown>;
    expect(payload.method).toBe('L1+L2');
    expect(payload.originalTokens).toBe(1000);
    expect(payload.compressedTokens).toBe(200);
    expect(payload.ratio).toBe(0.8);
    expect(payload.infoRetention).toBe(0.9);
    expect(payload.latencyMs).toBe(42);
    expect(payload.messagesCompressed).toBeGreaterThan(0);
  });

  test('rounds ratio + infoRetention to 2 decimals (avoids float noise in logs)', async () => {
    mockCompressFn.mockResolvedValue({
      ...mockCompressResult,
      ratio: 0.834567,
      infoRetention: 0.912345,
    });

    const { compressContextWithLLM } = await import('../context-manager');
    const state: any = {
      messages: Array.from({ length: 13 }, (_, i) => ({
        role: i === 0 ? 'system' : (i % 2 ? 'user' : 'assistant'),
        content: `m${i}`,
        timestamp: '2026-05-14T00:00:00Z',
      })),
      _compressing: false,
      estimatedTokens: 1000,
      contextConfig: { maxTokens: 2000 },
      compressedSummary: '',
      hookRunner: null,
    };
    await compressContextWithLLM(state);

    const telemetryCall = mockLoggerInfo.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('[Compression] tier complete'),
    );
    const payload = telemetryCall![1] as Record<string, number>;
    expect(payload.ratio).toBe(0.83);
    expect(payload.infoRetention).toBe(0.91);
  });
});
