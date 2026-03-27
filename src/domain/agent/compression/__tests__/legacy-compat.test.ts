/**
 * Tests for compression/legacy-compat.ts
 *
 * Covers: hybridCompress, selectCompressionStrategy, ruleBasedCompress
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../../../infra/config/schema', () => ({}));

vi.mock('../../context', () => ({
  estimateTokens: (text: string) => Math.ceil(text.length / 3),
  estimateTotalTokens: (msgs: any[]) =>
    msgs.reduce((s: number, m: any) => {
      const c = typeof m.content === 'string' ? m.content : '';
      return s + Math.ceil(c.length / 3);
    }, 0),
}));

const mockCallAI = vi.fn(async () => ({
  choices: [{ message: { content: '## Summary\nCompressed content here' } }],
}));
vi.mock('../../api', () => ({ callAI: mockCallAI }));

import { hybridCompress, type LegacyCompressionResult } from '../legacy-compat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMessages(count: number, contentLength = 100) {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i}: ${'x'.repeat(contentLength)}`,
  }));
}

const provider = { type: 'zhipu', apiKey: 'test' } as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('legacy-compat hybridCompress', () => {
  beforeEach(() => {
    mockCallAI.mockReset();
    mockCallAI.mockResolvedValue({
      choices: [{ message: { content: '## Summary\nCompressed content here' } }],
    });
  });

  it('returns no compression when under threshold', async () => {
    const messages = makeMessages(3, 20);
    const result = await hybridCompress(messages, provider, {
      maxTokens: 100000,
      currentTokens: 100,
    });
    expect(result.method).toBe('none');
    expect(result.keptMessages.length).toBe(messages.length);
  });

  it('returns no compression when no old messages to compress', async () => {
    const messages = makeMessages(3, 20);
    const result = await hybridCompress(messages, provider, {
      maxTokens: 100,
      currentTokens: 90,
      config: { keepRecent: 10 }, // keepRecent > messages.length
    });
    expect(result.method).toBe('none');
  });

  it('uses rule-based compression for few messages', async () => {
    const messages = makeMessages(4, 50);
    const result = await hybridCompress(messages, provider, {
      maxTokens: 100,
      currentTokens: 90,
      config: { keepRecent: 2 },
    });
    // With 4 messages and keepRecent 2, old messages < 5 → rule-based
    expect(result.method).toBe('rule');
    expect(result.keptMessages.length).toBe(2);
  });

  it('uses LLM compression for many messages with high utilization', async () => {
    const messages = makeMessages(20, 400);
    const result = await hybridCompress(messages, provider, {
      maxTokens: 1000,
      currentTokens: 950,
      config: { keepRecent: 4 },
    });
    expect(result.method).toBe('llm');
    expect(result.summary).toBeTruthy();
    expect(result.keptMessages.length).toBe(4);
  });

  it('falls back to rule-based when LLM compression fails', async () => {
    mockCallAI.mockRejectedValue(new Error('API down'));
    const messages = makeMessages(20, 400);
    const result = await hybridCompress(messages, provider, {
      maxTokens: 1000,
      currentTokens: 950,
      config: { keepRecent: 4 },
    });
    expect(result.method).toBe('rule');
  });

  it('respects strategy: rule config', async () => {
    const messages = makeMessages(20, 100);
    const result = await hybridCompress(messages, provider, {
      maxTokens: 1000,
      currentTokens: 900,
      config: { strategy: 'rule', keepRecent: 4 },
    });
    expect(result.method).toBe('rule');
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('respects strategy: llm config', async () => {
    const messages = makeMessages(20, 100);
    const result = await hybridCompress(messages, provider, {
      maxTokens: 1000,
      currentTokens: 900,
      config: { strategy: 'llm', keepRecent: 4 },
    });
    expect(result.method).toBe('llm');
  });

  it('compression ratio is between 0 and 1', async () => {
    const messages = makeMessages(20, 400);
    const result = await hybridCompress(messages, provider, {
      maxTokens: 1000,
      currentTokens: 950,
      config: { keepRecent: 4 },
    });
    expect(result.compressionRatio).toBeGreaterThan(0);
    expect(result.compressionRatio).toBeLessThanOrEqual(1);
  });
});
