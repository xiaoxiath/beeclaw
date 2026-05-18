/**
 * Tests for skill-runner.ts
 *
 * Covers: SkillRunner — init, resetTurn, trackSkillUsage, matchSkillsForQuery,
 *         validateOutputCompleteness, buildRetryPrompt, getSkillsPrompt
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../../skills/enforcement', () => ({
  SkillEnforcementEngine: class SkillEnforcementEngine {
    matchSkillsForQuery = vi.fn((_q: string) => ({ matched: true, skills: [{ name: 'test-skill' }] }));
    validateOutputCompleteness = vi.fn(() => []);
    buildRetryPrompt = vi.fn((issues: string[]) => `Retry: ${issues.join(',')}`);
    clearTraces = vi.fn(() => {});
  },
}));

import { SkillRunner } from '../skill-runner';
import { SkillEnforcementEngine } from '../../skills/enforcement';

describe('SkillRunner', () => {
  let runner: SkillRunner;

  beforeEach(() => {
    runner = new SkillRunner();
  });

  describe('before initialization', () => {
    it('available returns false', () => {
      expect(runner.available).toBe(false);
    });

    it('matchSkillsForQuery returns undefined', () => {
      expect(runner.matchSkillsForQuery('test')).toBeUndefined();
    });

    it('validateOutputCompleteness returns empty array', () => {
      expect(runner.validateOutputCompleteness('output', [])).toEqual([]);
    });

    it('buildRetryPrompt returns empty string', () => {
      expect(runner.buildRetryPrompt(['issue'])).toBe('');
    });
  });

  describe('after initialization', () => {
    beforeEach(() => {
      const engine = new SkillEnforcementEngine() as any;
      runner.init(engine);
    });

    it('available returns true', () => {
      expect(runner.available).toBe(true);
    });

    it('matchSkillsForQuery delegates to engine', () => {
      const result = runner.matchSkillsForQuery('test query');
      expect(result).toBeDefined();
      expect(result!.matched).toBe(true);
    });

    it('validateOutputCompleteness delegates to engine', () => {
      const result = runner.validateOutputCompleteness('output', []);
      expect(result).toEqual([]);
    });

    it('buildRetryPrompt delegates to engine', () => {
      const result = runner.buildRetryPrompt(['missing output']);
      expect(result).toContain('Retry');
    });
  });

  describe('skill usage tracking', () => {
    it('tracks used skills', () => {
      runner.trackSkillUsage('skill-a');
      runner.trackSkillUsage('skill-b');
      const used = runner.getUsedSkills();
      expect(used.has('skill-a')).toBe(true);
      expect(used.has('skill-b')).toBe(true);
    });

    it('resetTurn clears used skills', () => {
      runner.trackSkillUsage('skill-a');
      runner.resetTurn();
      expect(runner.getUsedSkills().size).toBe(0);
    });

    it('getUsedSkills returns a copy', () => {
      runner.trackSkillUsage('skill-a');
      const copy = runner.getUsedSkills();
      copy.add('not-tracked');
      expect(runner.getUsedSkills().has('not-tracked')).toBe(false);
    });
  });

  describe('getSkillsPrompt', () => {
    it('returns empty string for empty skills', () => {
      expect(runner.getSkillsPrompt([])).toBe('');
    });

    it('formats skills with name, description, and triggers', () => {
      const result = runner.getSkillsPrompt([
        { name: 'test', description: 'Test skill', triggers: ['go', 'run'] },
      ]);
      expect(result).toContain('**test**');
      expect(result).toContain('Test skill');
      expect(result).toContain('go');
    });

    it('handles skills without triggers', () => {
      const result = runner.getSkillsPrompt([
        { name: 'basic', description: 'Basic skill' },
      ]);
      expect(result).toContain('**basic**');
      expect(result).not.toContain('triggers');
    });
  });

  describe('clearTraces', () => {
    it('does not throw when engine not initialized', () => {
      expect(() => runner.clearTraces()).not.toThrow();
    });

    it('delegates to engine when initialized', () => {
      const engine = new SkillEnforcementEngine() as any;
      runner.init(engine);
      runner.clearTraces();
      expect(engine.clearTraces).toHaveBeenCalled();
    });
  });
});
