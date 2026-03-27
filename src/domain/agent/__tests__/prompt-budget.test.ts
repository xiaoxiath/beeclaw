/**
 * Tests for prompt-budget.ts
 *
 * Covers: detectUserIntent, parseExamplesIntoTagged, selectExamples,
 *         assembleBudgetedPrompt, calculatePromptBudget, LAYER_PRIORITIES
 */
import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock('../context', () => ({
  estimateTokens: (text: string) => Math.ceil(text.length / 3),
}));

import {
  detectUserIntent,
  parseExamplesIntoTagged,
  selectExamples,
  assembleBudgetedPrompt,
  calculatePromptBudget,
  LAYER_PRIORITIES,
  DEFAULT_PROMPT_BUDGET,
  type PromptLayer,
  type TaggedExample,
} from '../prompt-budget';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('prompt-budget', () => {

  // -----------------------------------------------------------------------
  // LAYER_PRIORITIES
  // -----------------------------------------------------------------------
  describe('LAYER_PRIORITIES', () => {
    it('has CORE as highest priority', () => {
      expect(LAYER_PRIORITIES.CORE).toBe(100);
    });

    it('has EXAMPLES as lowest priority', () => {
      expect(LAYER_PRIORITIES.EXAMPLES).toBe(10);
    });

    it('maintains ordering: CORE > RUNTIME > TRAITS > SOUL > USER_CONTEXT > FACTS > SKILLS > EXAMPLES', () => {
      expect(LAYER_PRIORITIES.CORE).toBeGreaterThan(LAYER_PRIORITIES.RUNTIME);
      expect(LAYER_PRIORITIES.RUNTIME).toBeGreaterThan(LAYER_PRIORITIES.TRAITS);
      expect(LAYER_PRIORITIES.TRAITS).toBeGreaterThan(LAYER_PRIORITIES.SOUL);
      expect(LAYER_PRIORITIES.SOUL).toBeGreaterThan(LAYER_PRIORITIES.USER_CONTEXT);
      expect(LAYER_PRIORITIES.USER_CONTEXT).toBeGreaterThan(LAYER_PRIORITIES.FACTS);
      expect(LAYER_PRIORITIES.FACTS).toBeGreaterThan(LAYER_PRIORITIES.SKILLS);
      expect(LAYER_PRIORITIES.SKILLS).toBeGreaterThan(LAYER_PRIORITIES.EXAMPLES);
    });
  });

  // -----------------------------------------------------------------------
  // detectUserIntent
  // -----------------------------------------------------------------------
  describe('detectUserIntent', () => {
    it('detects preference intent from Chinese keywords', () => {
      const intents = detectUserIntent([{ role: 'user', content: '记住我喜欢暗色主题' }]);
      expect(intents.has('preference')).toBe(true);
    });

    it('detects reminder intent', () => {
      const intents = detectUserIntent([{ role: 'user', content: '帮我设置一个提醒' }]);
      expect(intents.has('reminder')).toBe(true);
    });

    it('detects skill-creation intent', () => {
      const intents = detectUserIntent([{ role: 'user', content: '创建一个新技能' }]);
      expect(intents.has('skill-creation')).toBe(true);
    });

    it('detects error-recovery intent', () => {
      const intents = detectUserIntent([{ role: 'user', content: '报错了，帮我修复' }]);
      expect(intents.has('error-recovery')).toBe(true);
    });

    it('detects search intent from English', () => {
      const intents = detectUserIntent([{ role: 'user', content: 'search for the latest news' }]);
      expect(intents.has('search')).toBe(true);
    });

    it('returns general when no specific intent detected', () => {
      const intents = detectUserIntent([{ role: 'user', content: '嗯' }]);
      expect(intents.has('general')).toBe(true);
    });

    it('only looks at last 3 user messages', () => {
      const messages = [
        { role: 'user', content: '记住' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'user', content: '嗯' },
      ];
      const intents = detectUserIntent(messages);
      // '记住' is beyond the last 3 user messages
      expect(intents.has('preference')).toBe(false);
    });

    it('handles empty array', () => {
      const intents = detectUserIntent([]);
      expect(intents.has('general')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // parseExamplesIntoTagged
  // -----------------------------------------------------------------------
  describe('parseExamplesIntoTagged', () => {
    it('returns empty array for empty input', () => {
      expect(parseExamplesIntoTagged('')).toEqual([]);
      expect(parseExamplesIntoTagged('  ')).toEqual([]);
    });

    it('parses examples separated by ## headings', () => {
      const content = `## Example 1: Preference learning
User says they prefer dark mode.

## Example 2: Error recovery
User encounters a bug.`;

      const tagged = parseExamplesIntoTagged(content);
      expect(tagged.length).toBe(2);
      expect(tagged[0].intents).toContain('preference');
      expect(tagged[1].intents).toContain('error-recovery');
    });

    it('always includes general intent', () => {
      const tagged = parseExamplesIntoTagged('## Simple example\nHello world');
      expect(tagged[0].intents).toContain('general');
    });

    it('sets token estimates', () => {
      const tagged = parseExamplesIntoTagged('## Test\nSome content here');
      expect(tagged[0].tokens).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // selectExamples
  // -----------------------------------------------------------------------
  describe('selectExamples', () => {
    const examples: TaggedExample[] = [
      { id: 'ex1', content: 'pref example', intents: ['preference', 'general'], tokens: 50 },
      { id: 'ex2', content: 'search example', intents: ['search', 'general'], tokens: 60 },
      { id: 'ex3', content: 'general example', intents: ['general'], tokens: 40 },
      { id: 'ex4', content: 'big example', intents: ['preference', 'general'], tokens: 200 },
    ];

    it('selects examples matching user intents', () => {
      const selected = selectExamples(examples, new Set(['preference']), 500, 3);
      expect(selected.length).toBeGreaterThan(0);
      expect(selected[0].id).toBe('ex1'); // preference matches
    });

    it('respects token budget', () => {
      const selected = selectExamples(examples, new Set(['general']), 100, 10);
      const totalTokens = selected.reduce((s, e) => s + e.tokens, 0);
      expect(totalTokens).toBeLessThanOrEqual(100);
    });

    it('respects maxExamples', () => {
      const selected = selectExamples(examples, new Set(['general']), 10000, 2);
      expect(selected.length).toBeLessThanOrEqual(2);
    });

    it('returns empty array when budget is 0', () => {
      const selected = selectExamples(examples, new Set(['general']), 0, 3);
      expect(selected.length).toBe(0);
    });

    it('prioritizes specific matches over general', () => {
      const selected = selectExamples(examples, new Set(['preference']), 500, 2);
      // ex1 and ex4 have preference intent and should rank higher
      const ids = selected.map(e => e.id);
      expect(ids.includes('ex1')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // assembleBudgetedPrompt
  // -----------------------------------------------------------------------
  describe('assembleBudgetedPrompt', () => {
    it('returns all layers when within budget', () => {
      const layers: PromptLayer[] = [
        { name: 'core', content: 'core content', priority: 100, trimmable: false },
        { name: 'examples', content: 'ex content', priority: 10, trimmable: true },
      ];

      const result = assembleBudgetedPrompt(layers, { ...DEFAULT_PROMPT_BUDGET, maxSystemPromptTokens: 10000 });
      expect(result.droppedLayers.length).toBe(0);
      expect(result.prompt).toContain('core content');
      expect(result.prompt).toContain('ex content');
    });

    it('drops lowest-priority trimmable layers first when over budget', () => {
      const layers: PromptLayer[] = [
        { name: 'core', content: 'a'.repeat(100), priority: 100, trimmable: false },
        { name: 'examples', content: 'b'.repeat(100), priority: 10, trimmable: true },
        { name: 'facts', content: 'c'.repeat(100), priority: 70, trimmable: true },
      ];

      const result = assembleBudgetedPrompt(layers, { ...DEFAULT_PROMPT_BUDGET, maxSystemPromptTokens: 80 });
      expect(result.droppedLayers).toContain('examples');
    });

    it('does not drop non-trimmable layers', () => {
      const layers: PromptLayer[] = [
        { name: 'core', content: 'a'.repeat(300), priority: 100, trimmable: false },
        { name: 'examples', content: 'b'.repeat(300), priority: 10, trimmable: true },
      ];

      const result = assembleBudgetedPrompt(layers, { ...DEFAULT_PROMPT_BUDGET, maxSystemPromptTokens: 120 });
      expect(result.droppedLayers).not.toContain('core');
    });

    it('truncates largest trimmable layer when dropping is not enough', () => {
      const layers: PromptLayer[] = [
        { name: 'core', content: 'a'.repeat(300), priority: 100, trimmable: false },
        { name: 'facts', content: 'b'.repeat(600), priority: 70, trimmable: true },
      ];

      const result = assembleBudgetedPrompt(layers, { ...DEFAULT_PROMPT_BUDGET, maxSystemPromptTokens: 200 });
      expect(result.truncatedLayers.length + result.droppedLayers.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // calculatePromptBudget
  // -----------------------------------------------------------------------
  describe('calculatePromptBudget', () => {
    it('sets maxSystemPromptTokens to 25% of context window', () => {
      const budget = calculatePromptBudget(100000);
      expect(budget.maxSystemPromptTokens).toBe(25000);
    });

    it('applies custom config overrides', () => {
      const budget = calculatePromptBudget(100000, { minCoreTokens: 5000 });
      expect(budget.minCoreTokens).toBe(5000);
    });

    it('preserves defaults for unspecified fields', () => {
      const budget = calculatePromptBudget(100000);
      expect(budget.dynamicExamples).toBe(true);
      expect(budget.maxExamples).toBe(3);
    });
  });
});
