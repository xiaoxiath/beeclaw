/**
 * Tests for preference-learning.ts
 *
 * All functions are deprecated stubs that return empty values.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  detectPreferenceExpressions,
  hasPreferenceExpression,
  getPreferenceLearningContext,
  checkPreferenceTriggers,
} from '../preference-learning';
import type { PreferenceExpression } from '../preference-learning';

describe('preference-learning (deprecated stubs)', () => {
  describe('detectPreferenceExpressions', () => {
    it('should always return empty array', () => {
      expect(detectPreferenceExpressions('I like dark mode')).toEqual([]);
      expect(detectPreferenceExpressions('')).toEqual([]);
      expect(detectPreferenceExpressions('any message')).toEqual([]);
    });
  });

  describe('hasPreferenceExpression', () => {
    it('should always return false', () => {
      expect(hasPreferenceExpression('I prefer TypeScript')).toBe(false);
      expect(hasPreferenceExpression('')).toBe(false);
    });
  });

  describe('getPreferenceLearningContext', () => {
    it('should always return empty string', () => {
      const mockExpressions: PreferenceExpression[] = [
        {
          type: 'positive',
          category: 'style',
          key: 'theme',
          value: 'dark',
          rawExpression: 'I like dark mode',
          confidence: 0.9,
        },
      ];
      expect(getPreferenceLearningContext(mockExpressions)).toBe('');
      expect(getPreferenceLearningContext([])).toBe('');
    });
  });

  describe('checkPreferenceTriggers', () => {
    it('should always return no preference', () => {
      const result = checkPreferenceTriggers('I like dark mode', []);
      expect(result.hasPreference).toBe(false);
      expect(result.expressions).toEqual([]);
      expect(result.context).toBe('');
    });

    it('should return same structure regardless of input', () => {
      const result = checkPreferenceTriggers('complex input', [{ something: true }]);
      expect(result).toEqual({ hasPreference: false, expressions: [], context: '' });
    });
  });

  describe('PreferenceExpression type', () => {
    it('should define valid type structure', () => {
      const expr: PreferenceExpression = {
        type: 'correction',
        category: 'tech',
        key: 'language',
        value: 'TypeScript',
        rawExpression: 'Use TypeScript',
        confidence: 0.85,
      };
      expect(expr.type).toBe('correction');
      expect(expr.category).toBe('tech');
      expect(typeof expr.confidence).toBe('number');
    });
  });
});
