import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../store', () => ({
  getSkillStore: vi.fn(() => ({
    search: vi.fn(() => []),
    get: vi.fn(() => null),
  })),
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), warn: vi.fn(() => {}), debug: vi.fn(() => {}) },
}));

import { SkillEnforcementEngine } from '../enforcement';

describe('SkillEnforcementEngine', () => {
  let engine: SkillEnforcementEngine;

  beforeEach(() => {
    engine = new SkillEnforcementEngine();
  });

  describe('matchSkillsForQuery', () => {
    it('should return not matched when store returns no skills', () => {
      const result = engine.matchSkillsForQuery('hello world');
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.directive).toBe('');
    });
  });

  describe('recordToolCall', () => {
    it('should not throw with no active traces', () => {
      expect(() => engine.recordToolCall('web_search', {})).not.toThrow();
    });
  });

  describe('startSkillTracking', () => {
    it('should return empty string for unknown skill', () => {
      const traceId = engine.startSkillTracking('nonexistent');
      expect(traceId).toBe('');
    });
  });

  describe('validateOutputCompleteness', () => {
    it('should return empty array when validation disabled', () => {
      const eng = new SkillEnforcementEngine({ validateOutput: false });
      const issues = eng.validateOutputCompleteness('short', [{ name: 'test' } as any]);
      expect(issues).toEqual([]);
    });

    it('should flag short output for skill-backed response', () => {
      const issues = engine.validateOutputCompleteness('ok', [{ name: 'test' } as any]);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain('suspiciously short');
    });

    it('should flag multiple summarization indicators', () => {
      const output = 'In summary, to summarize the key takeaway is that things are fine. '.repeat(3);
      const issues = engine.validateOutputCompleteness(output, [{ name: 'x' } as any]);
      const summaryIssue = issues.find(i => i.includes('summarization'));
      expect(summaryIssue).toBeDefined();
    });

    it('should return no issues for long complete output', () => {
      const output = 'A'.repeat(500);
      const issues = engine.validateOutputCompleteness(output, [{ name: 'x' } as any]);
      // No short-output issue
      const shortIssue = issues.find(i => i.includes('suspiciously short'));
      expect(shortIssue).toBeUndefined();
    });
  });

  describe('buildRetryPrompt', () => {
    it('should include issues in prompt', () => {
      const prompt = engine.buildRetryPrompt(['Too short', 'Missing data']);
      expect(prompt).toContain('Too short');
      expect(prompt).toContain('Missing data');
      expect(prompt).toContain('incomplete');
    });
  });

  describe('clearTraces / getTraces', () => {
    it('should clear all traces', () => {
      engine.clearTraces();
      expect(engine.getTraces()).toEqual([]);
    });
  });
});
