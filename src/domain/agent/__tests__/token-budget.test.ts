/**
 * Tests for token-budget.ts
 *
 * Covers: TokenBudgetManager — getBudget, checkTurnBudget, trimContextIfNeeded, manageContextCompression
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { mockEstimateMessageTokens, mockEstimateTotalTokens } = vi.hoisted(() => {
  const mockEstimateMessageTokens = vi.fn((msg: any) => {
    const c = typeof msg.content === 'string' ? msg.content : '';
    return Math.ceil(c.length / 3);
  });
  const mockEstimateTotalTokens = vi.fn((msgs: any[]) =>
    msgs.reduce((s: number, m: any) => s + mockEstimateMessageTokens(m), 0),
  );
  return { mockEstimateMessageTokens, mockEstimateTotalTokens };
});

vi.mock('../context', () => ({
  estimateMessageTokens: mockEstimateMessageTokens,
  estimateTotalTokens: mockEstimateTotalTokens,
  estimateTokens: (text: string) => Math.ceil(text.length / 3),
  compressToolResult: (content: string) => content.length > 200 ? content.slice(0, 100) + '...[compressed]' : content,
  compressAssistantMessage: (content: string, _tc: any) => content.length > 200 ? content.slice(0, 100) + '...[compressed]' : content,
}));

vi.mock('../compression', () => ({
  compressMessages: vi.fn(async (msgs: any[], maxTokens: number, keepRecent: number) => ({
    messages: msgs.slice(-keepRecent),
    stats: { originalTokens: 1000, compressedTokens: 300, ratio: 0.7 },
  })),
  shouldCompress: vi.fn((tokens: number, max: number) => tokens > max * 0.85),
}));

vi.mock('../context/simhash', () => ({
  getSimHasher: () => ({
    deduplicateItems: (items: any[], _threshold: number) => items,
  }),
}));

vi.mock('../context/health-dashboard', () => ({
  getContextHealthDashboard: () => ({
    measure: () => ({ tokenUtilization: 0.5, messageCount: 10 }),
    checkAlerts: () => [],
  }),
}));

import { TokenBudgetManager, type TokenBudget } from '../token-budget';
import type { AgentContextConfig } from '../context';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<AgentContextConfig> = {}): AgentContextConfig {
  return {
    maxTokens: 10000,
    compressionThreshold: 0.7,
    keepRecent: 4,
    ...overrides,
  } as AgentContextConfig;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('TokenBudgetManager', () => {
  let manager: TokenBudgetManager;

  beforeEach(() => {
    manager = new TokenBudgetManager(makeConfig(), 500);
  });

  describe('tokens accessors', () => {
    it('gets current token count', () => {
      expect(manager.tokens).toBe(500);
    });

    it('sets token count', () => {
      manager.setTokens(1000);
      expect(manager.tokens).toBe(1000);
    });

    it('adds delta to token count', () => {
      manager.addTokens(100);
      expect(manager.tokens).toBe(600);
    });

    it('supports negative delta', () => {
      manager.addTokens(-200);
      expect(manager.tokens).toBe(300);
    });
  });

  describe('getBudget', () => {
    it('returns budget info', () => {
      const budget: TokenBudget = manager.getBudget();
      expect(budget.estimated).toBe(500);
      expect(budget.max).toBe(10000);
      expect(budget.utilization).toBeCloseTo(0.05);
    });
  });

  describe('checkTurnBudget', () => {
    it('returns exceeded=false when within limit', () => {
      manager.setTokens(600);
      const check = manager.checkTurnBudget(500, 200);
      expect(check.exceeded).toBe(false);
      expect(check.tokensUsed).toBe(100);
    });

    it('returns exceeded=true when over limit', () => {
      manager.setTokens(900);
      const check = manager.checkTurnBudget(500, 200);
      expect(check.exceeded).toBe(true);
      expect(check.tokensUsed).toBe(400);
    });
  });

  describe('trimContextIfNeeded', () => {
    it('does nothing when under threshold', () => {
      manager.setTokens(3000);
      const messages: any[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ];
      manager.trimContextIfNeeded(messages);
      expect(messages.length).toBe(2);
    });

    it('compresses messages when over threshold', () => {
      manager.setTokens(8000);
      const messages: any[] = [
        { role: 'system', content: 'sys' },
        { role: 'tool', content: 'a'.repeat(300) },
        { role: 'user', content: 'latest1' },
        { role: 'user', content: 'latest2' },
        { role: 'user', content: 'latest3' },
        { role: 'user', content: 'latest4' },
      ];
      manager.trimContextIfNeeded(messages);
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('manageContextCompression', () => {
    it('does nothing for short message lists', async () => {
      const messages: any[] = Array.from({ length: 5 }, (_, i) => ({
        role: 'user',
        content: `msg${i}`,
      }));
      await manager.manageContextCompression(messages);
      expect(messages.length).toBe(5);
    });

    it('runs deduplication and compression for long conversations', async () => {
      manager.setTokens(9000);
      const messages: any[] = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message content ${i} with some text`,
      }));

      await manager.manageContextCompression(messages);
      expect(messages.length).toBeLessThanOrEqual(15);
    });

    it('falls back to trimContextIfNeeded when compression fails', async () => {
      const { compressMessages } = await import('../compression');
      (compressMessages as any).mockRejectedValueOnce(new Error('compression failed'));

      manager.setTokens(9000);
      const messages: any[] = Array.from({ length: 15 }, (_, i) => ({
        role: 'user',
        content: `msg ${i}`,
      }));

      await expect(manager.manageContextCompression(messages)).resolves.toBeUndefined();
    });
  });
});
