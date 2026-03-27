/**
 * Tests for fast-llm-judge.ts
 *
 * Covers: FastLLMJudge — judge, parseJSON, extractContent, buildPrompt,
 *         getFastLLMJudge, resetFastLLMJudge, getFastModelFromConfig
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { mockCallAI, mockGetConfig } = vi.hoisted(() => ({
  mockCallAI: vi.fn(async () => ({
    choices: [{ message: { content: '{"result": "ok"}' } }],
  })),
  mockGetConfig: vi.fn(() => ({
    llmRouter: {
      tiers: {
        fast: { role: 'fast-role', params: { max_tokens: 256 } },
      },
    },
    roles: {
      'fast-role': { model: 'glm-4-flash', params: { max_tokens: 512 } },
    },
  })),
}));

vi.mock('../api', () => ({ callAI: mockCallAI }));
vi.mock('../../../app', () => ({ getConfig_: mockGetConfig }));

import {
  FastLLMJudge,
  getFastLLMJudge,
  resetFastLLMJudge,
  getFastModelFromConfig,
} from '../fast-llm-judge';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('fast-llm-judge', () => {
  const provider = { type: 'zhipu', apiKey: 'test-key' } as any;

  beforeEach(() => {
    resetFastLLMJudge();
    mockCallAI.mockReset();
    mockCallAI.mockResolvedValue({
      choices: [{ message: { content: '{"result": "ok"}' } }],
    });
  });

  describe('getFastModelFromConfig', () => {
    it('returns model name from config', () => {
      const result = getFastModelFromConfig();
      expect(result).toBeDefined();
      expect(result!.model).toBe('glm-4-flash');
    });

    it('uses tier params for maxTokens (overrides role params)', () => {
      const result = getFastModelFromConfig();
      expect(result!.maxTokens).toBe(256);
    });

    it('returns undefined when config is missing', () => {
      mockGetConfig.mockReturnValueOnce(null);
      const result = getFastModelFromConfig();
      expect(result).toBeUndefined();
    });

    it('returns undefined when fast tier not configured', () => {
      mockGetConfig.mockReturnValueOnce({ llmRouter: { tiers: {} } });
      const result = getFastModelFromConfig();
      expect(result).toBeUndefined();
    });
  });

  describe('judge — success', () => {
    it('returns validated result from LLM', async () => {
      mockCallAI.mockResolvedValue({
        choices: [{ message: { content: '{"action": "search", "confidence": 0.9}' } }],
      });

      const judge = new FastLLMJudge(provider, 'glm-4-flash');
      const result = await judge.judge({
        taskName: 'test',
        promptTemplate: 'Choose action for: {query}',
        promptVariables: { query: 'find news' },
        validateOutput: (o) => o.action && o.confidence ? o : null,
        defaultValue: { action: 'none', confidence: 0 },
      });

      expect(result.failed).toBe(false);
      expect(result.result.action).toBe('search');
      expect(result.result.confidence).toBe(0.9);
    });

    it('replaces template variables in prompt', async () => {
      const judge = new FastLLMJudge(provider, 'glm-4-flash');
      await judge.judge({
        taskName: 'test',
        promptTemplate: 'User: {name}, Task: {task}',
        promptVariables: { name: 'Alice', task: 'search' },
        validateOutput: () => 'ok',
        defaultValue: 'default',
      });

      const calledMessages = mockCallAI.mock.calls[0][0].messages;
      expect(calledMessages[0].content).toContain('Alice');
      expect(calledMessages[0].content).toContain('search');
    });
  });

  describe('JSON parsing', () => {
    it('handles markdown code blocks', async () => {
      mockCallAI.mockResolvedValue({
        choices: [{ message: { content: '```json\n{"x": 1}\n```' } }],
      });

      const judge = new FastLLMJudge(provider, 'glm-4-flash');
      const result = await judge.judge({
        taskName: 'test',
        promptTemplate: 'test',
        promptVariables: {},
        validateOutput: (o) => o.x === 1 ? o : null,
        defaultValue: { x: 0 },
      });
      expect(result.result.x).toBe(1);
    });

    it('handles double-brace template syntax', async () => {
      mockCallAI.mockResolvedValue({
        choices: [{ message: { content: '{{"action": "go"}}' } }],
      });

      const judge = new FastLLMJudge(provider, 'glm-4-flash');
      const result = await judge.judge({
        taskName: 'test',
        promptTemplate: 'test',
        promptVariables: {},
        validateOutput: (o) => o.action ? o : null,
        defaultValue: { action: 'none' },
      });
      expect(result.result.action).toBe('go');
    });

    it('extracts JSON from mixed text', async () => {
      mockCallAI.mockResolvedValue({
        choices: [{ message: { content: 'Here is the result: {"value": 42} done.' } }],
      });

      const judge = new FastLLMJudge(provider, 'glm-4-flash');
      const result = await judge.judge({
        taskName: 'test',
        promptTemplate: 'test',
        promptVariables: {},
        validateOutput: (o) => o.value === 42 ? o : null,
        defaultValue: { value: 0 },
      });
      expect(result.result.value).toBe(42);
    });
  });

  describe('judge — failure', () => {
    it('returns default value when LLM call fails', async () => {
      mockCallAI.mockRejectedValue(new Error('API timeout'));

      const judge = new FastLLMJudge(provider, 'glm-4-flash');
      const result = await judge.judge({
        taskName: 'test',
        promptTemplate: 'test',
        promptVariables: {},
        validateOutput: (o) => o,
        defaultValue: 'fallback',
      });

      expect(result.failed).toBe(true);
      expect(result.result).toBe('fallback');
      expect(result.error).toContain('API timeout');
    });

    it('returns default when validation fails', async () => {
      mockCallAI.mockResolvedValue({
        choices: [{ message: { content: '{"wrong": "format"}' } }],
      });

      const judge = new FastLLMJudge(provider, 'glm-4-flash');
      const result = await judge.judge({
        taskName: 'test',
        promptTemplate: 'test',
        promptVariables: {},
        validateOutput: () => null,
        defaultValue: 'default',
      });

      expect(result.failed).toBe(true);
      expect(result.result).toBe('default');
    });

    it('returns default when response format is invalid', async () => {
      mockCallAI.mockResolvedValue({ unexpected: true });

      const judge = new FastLLMJudge(provider, 'glm-4-flash');
      const result = await judge.judge({
        taskName: 'test',
        promptTemplate: 'test',
        promptVariables: {},
        validateOutput: (o) => o,
        defaultValue: 'safe',
      });

      expect(result.failed).toBe(true);
      expect(result.result).toBe('safe');
    });
  });

  describe('getStats', () => {
    it('tracks judgment statistics', async () => {
      const judge = new FastLLMJudge(provider, 'glm-4-flash');

      await judge.judge({
        taskName: 't1',
        promptTemplate: 'test',
        promptVariables: {},
        validateOutput: () => 'ok',
        defaultValue: 'def',
      });

      const stats = judge.getStats();
      expect(stats.totalJudgments).toBe(1);
      expect(stats.llmCalls).toBe(1);
    });
  });

  describe('singleton', () => {
    it('getFastLLMJudge requires provider on first call', () => {
      expect(() => getFastLLMJudge()).toThrow();
    });

    it('getFastLLMJudge returns same instance', () => {
      const a = getFastLLMJudge(provider);
      const b = getFastLLMJudge();
      expect(a).toBe(b);
    });

    it('resetFastLLMJudge clears instance', () => {
      const a = getFastLLMJudge(provider);
      resetFastLLMJudge();
      const b = getFastLLMJudge(provider);
      expect(a).not.toBe(b);
    });
  });

  describe('extractContent edge cases', () => {
    it('extracts from reasoning_content format', async () => {
      mockCallAI.mockResolvedValue({
        choices: [{ message: { reasoning_content: '{"val": 1}' } }],
      });

      const judge = new FastLLMJudge(provider, 'glm-4-flash');
      const result = await judge.judge({
        taskName: 'test',
        promptTemplate: 'test',
        promptVariables: {},
        validateOutput: (o) => o.val === 1 ? o : null,
        defaultValue: { val: 0 },
      });
      expect(result.result.val).toBe(1);
    });

    it('extracts from direct message format', async () => {
      mockCallAI.mockResolvedValue({
        message: { content: '{"val": 2}' },
      });

      const judge = new FastLLMJudge(provider, 'glm-4-flash');
      const result = await judge.judge({
        taskName: 'test',
        promptTemplate: 'test',
        promptVariables: {},
        validateOutput: (o) => o.val === 2 ? o : null,
        defaultValue: { val: 0 },
      });
      expect(result.result.val).toBe(2);
    });
  });
});
