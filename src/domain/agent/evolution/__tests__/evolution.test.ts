import { describe, test, expect, beforeEach } from 'bun:test';
import {
  detectPreferenceExpressions,
  hasPreferenceExpression,
  getPreferenceLearningContext,
  checkPreferenceTriggers,
  type PreferenceExpression,
} from '../preference-learning';
import {
  recordSkillFailure,
  checkConsecutiveFailures,
  clearReflectionTracking,
  getReflectionStats,
  checkReflectionTriggers,
} from '../reflection-trigger';

/**
 * Evolution System Tests (LLM-based)
 *
 * After refactoring, preference detection and trigger analysis
 * are handled by LLM through System Prompt, not regex patterns.
 *
 * These tests verify that:
 * 1. Deprecated functions return empty/null (backward compatibility)
 * 2. Statistics functions still work (for maturity tracking)
 */

describe('Preference Learning (LLM-based)', () => {
  describe('Deprecated Functions', () => {
    test('detectPreferenceExpressions returns empty array (LLM handles detection)', () => {
      // Previously detected "不要用emoji" via regex
      // Now LLM handles this through System Prompt
      const expressions = detectPreferenceExpressions('不要用emoji');
      expect(expressions.length).toBe(0);
    });

    test('hasPreferenceExpression returns false (LLM handles detection)', () => {
      expect(hasPreferenceExpression('不要用emoji')).toBe(false);
      expect(hasPreferenceExpression('我喜欢这样')).toBe(false);
    });

    test('getPreferenceLearningContext returns empty string', () => {
      const expressions: PreferenceExpression[] = [
        {
          type: 'correction',
          category: 'style',
          key: 'style.emoji',
          value: false,
          rawExpression: '不要用emoji',
          confidence: 0.8,
        },
      ];

      const context = getPreferenceLearningContext(expressions);
      expect(context).toBe('');
    });

    test('checkPreferenceTriggers returns empty (LLM handles detection)', () => {
      const result = checkPreferenceTriggers('不要用emoji', []);
      expect(result.hasPreference).toBe(false);
      expect(result.expressions.length).toBe(0);
      expect(result.context).toBe('');
    });
  });

  describe('Type Exports', () => {
    test('PreferenceExpression type is available for external use', () => {
      const expr: PreferenceExpression = {
        type: 'correction',
        category: 'style',
        key: 'style.emoji',
        value: false,
        rawExpression: '不要用emoji',
        confidence: 0.8,
      };
      expect(expr.type).toBe('correction');
      expect(expr.category).toBe('style');
    });
  });
});

describe('Reflection Statistics (for maturity tracking)', () => {
  beforeEach(() => {
    clearReflectionTracking();
  });

  describe('recordSkillFailure', () => {
    test('records skill failures for statistics', () => {
      recordSkillFailure('test-skill', 'user message context');

      const stats = getReflectionStats();
      expect(stats.recentFailures).toBe(1);
      expect(stats.failureDetails).toHaveLength(1);
      expect(stats.failureDetails[0].skillName).toBe('test-skill');
      expect(stats.failureDetails[0].count).toBe(1);
    });

    test('accumulates failures for same skill', () => {
      recordSkillFailure('test-skill', 'context 1');
      recordSkillFailure('test-skill', 'context 2');
      recordSkillFailure('test-skill', 'context 3');

      const stats = getReflectionStats();
      expect(stats.recentFailures).toBe(3);
      expect(stats.failureDetails[0].count).toBe(3);
    });

    test('tracks different skills separately', () => {
      recordSkillFailure('skill-a', 'context');
      recordSkillFailure('skill-b', 'context');
      recordSkillFailure('skill-a', 'context');

      const stats = getReflectionStats();
      expect(stats.recentFailures).toBe(3);
      expect(stats.failureDetails).toHaveLength(2);

      const skillA = stats.failureDetails.find(s => s.skillName === 'skill-a');
      const skillB = stats.failureDetails.find(s => s.skillName === 'skill-b');
      expect(skillA?.count).toBe(2);
      expect(skillB?.count).toBe(1);
    });
  });

  describe('checkConsecutiveFailures', () => {
    test('returns failure count for skill', () => {
      recordSkillFailure('test-skill', 'context 1');
      recordSkillFailure('test-skill', 'context 2');

      const count = checkConsecutiveFailures('test-skill');
      expect(count).toBe(2);
    });

    test('returns 0 for skill with no failures', () => {
      const count = checkConsecutiveFailures('unknown-skill');
      expect(count).toBe(0);
    });
  });

  describe('clearReflectionTracking', () => {
    test('clears all tracking data', () => {
      recordSkillFailure('skill-a', 'context');
      recordSkillFailure('skill-b', 'context');

      clearReflectionTracking();

      const stats = getReflectionStats();
      expect(stats.recentFailures).toBe(0);
      expect(stats.failureDetails).toHaveLength(0);
    });
  });

  describe('Deprecated checkReflectionTriggers', () => {
    test('always returns false (LLM handles detection)', () => {
      const result = checkReflectionTriggers('不对，不是这样', {});
      expect(result.shouldReflect).toBe(false);
      expect(result.trigger).toBeNull();
      expect(result.context).toBe('');
    });
  });
});
