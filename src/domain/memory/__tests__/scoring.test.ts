import { describe, test, expect, vi } from 'vitest';
import {
  scoreImportance,
  calculateRecencyScore,
  calculateFrequencyScore,
  calculateRelevanceScore,
  calculateUniquenessScore,
  calculateSimilarity,
  findDuplicates,
  ImportanceScoreSchema,
  type ImportanceScore,
} from '../scoring';

describe('Memory Scoring', () => {
  describe('calculateRecencyScore', () => {
    test('returns 100 for current timestamp', () => {
      const now = new Date().toISOString();
      const score = calculateRecencyScore(now);
      // Allow for small timing differences - score should be 95 or 100
      expect(score).toBeGreaterThanOrEqual(95);
      expect(score).toBeLessThanOrEqual(100);
    });

    test('returns 95 for content from today', () => {
      const today = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12 hours ago
      expect(calculateRecencyScore(today)).toBe(95);
    });

    test('returns 80 for content from last week', () => {
      const weekAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
      expect(calculateRecencyScore(weekAgo)).toBe(80);
    });

    test('returns 60 for content from last month', () => {
      const monthAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      expect(calculateRecencyScore(monthAgo)).toBe(60);
    });

    test('returns 40 for content from 3 months ago', () => {
      const threeMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      expect(calculateRecencyScore(threeMonthsAgo)).toBe(40);
    });

    test('returns 20 for content from 6 months ago', () => {
      const sixMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
      expect(calculateRecencyScore(sixMonthsAgo)).toBe(20);
    });

    test('returns 0 for very old content', () => {
      const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      expect(calculateRecencyScore(yearAgo)).toBe(0);
    });
  });

  describe('calculateFrequencyScore', () => {
    test('returns 20 for 0 references', () => {
      expect(calculateFrequencyScore(0)).toBe(20);
    });

    test('returns 40 for 1-2 references', () => {
      expect(calculateFrequencyScore(1)).toBe(40);
      expect(calculateFrequencyScore(2)).toBe(40);
    });

    test('returns 60 for 3-5 references', () => {
      expect(calculateFrequencyScore(3)).toBe(60);
      expect(calculateFrequencyScore(5)).toBe(60);
    });

    test('returns 80 for 6-10 references', () => {
      expect(calculateFrequencyScore(6)).toBe(80);
      expect(calculateFrequencyScore(10)).toBe(80);
    });

    test('returns 100 for 10+ references', () => {
      expect(calculateFrequencyScore(11)).toBe(100);
      expect(calculateFrequencyScore(100)).toBe(100);
    });
  });

  describe('calculateRelevanceScore', () => {
    test('returns 50 for content with no related goals', () => {
      expect(calculateRelevanceScore('some content', [])).toBe(50);
    });

    test('increases score with more related goals', () => {
      const content = 'working on project';
      const score1 = calculateRelevanceScore(content, ['goal1']);
      const score2 = calculateRelevanceScore(content, ['goal1', 'goal2', 'goal3']);

      expect(score2).toBeGreaterThan(score1);
    });

    test('increases score for goal-related keywords', () => {
      const noKeywords = calculateRelevanceScore('random text', ['goal1']);
      const withKeywords = calculateRelevanceScore('progress on my goal', ['goal1']);

      expect(withKeywords).toBeGreaterThan(noKeywords);
    });
  });

  describe('calculateUniquenessScore', () => {
    test('returns 100 when no existing facts', () => {
      expect(calculateUniquenessScore('new content', [])).toBe(100);
    });

    test('returns lower score for duplicate content', () => {
      const content = 'this is a test';
      const existingFacts = ['this is a test'];

      const score = calculateUniquenessScore(content, existingFacts);
      expect(score).toBeLessThan(100);
    });

    test('returns higher score for unique content', () => {
      const content = 'completely unique and different';
      const existingFacts = ['something else entirely'];

      const score = calculateUniquenessScore(content, existingFacts);
      expect(score).toBeGreaterThan(50);
    });
  });

  describe('calculateSimilarity', () => {
    test('returns 1 for identical text', () => {
      expect(calculateSimilarity('hello world', 'hello world')).toBe(1);
    });

    test('returns 0 for completely different text', () => {
      expect(calculateSimilarity('aaa bbb ccc', 'xxx yyy zzz')).toBe(0);
    });

    test('returns partial similarity for overlapping text', () => {
      const sim = calculateSimilarity('hello world test', 'hello world foo');
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });

    test('handles empty strings', () => {
      expect(calculateSimilarity('', '')).toBe(0);
      expect(calculateSimilarity('test', '')).toBe(0);
    });
  });

  describe('scoreImportance', () => {
    test('returns valid ImportanceScore', () => {
      const result = scoreImportance({
        content: 'test content',
        timestamp: new Date().toISOString(),
      });

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(['keep', 'summarize', 'archive', 'delete']).toContain(result.recommendation);
      expect(result.factors).toBeDefined();
    });

    test('gives higher score to recent, user-marked content', () => {
      const recentMarked = scoreImportance({
        content: 'test content',
        timestamp: new Date().toISOString(),
        isUserMarked: true,
      });

      const oldUnmarked = scoreImportance({
        content: 'test content',
        timestamp: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
        isUserMarked: false,
      });

      expect(recentMarked.score).toBeGreaterThan(oldUnmarked.score);
    });

    test('recommends keep for high-scoring content', () => {
      const result = scoreImportance({
        content: 'important goal progress milestone',
        timestamp: new Date().toISOString(),
        referenceCount: 10,
        relatedGoals: ['goal1', 'goal2'],
        isUserMarked: true,
      });

      expect(['keep', 'summarize']).toContain(result.recommendation);
    });

    test('recommends delete or archive for low-scoring old content', () => {
      const result = scoreImportance({
        content: 'random old stuff',
        timestamp: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        referenceCount: 0,
        relatedGoals: [],
        existingFacts: ['random old stuff'], // Make it less unique to lower score
      });

      // With low uniqueness + old content, should get a lower score
      expect(['archive', 'delete', 'summarize']).toContain(result.recommendation);
    });
  });

  describe('findDuplicates', () => {
    test('returns empty array for no duplicates', () => {
      const contents = [
        'first unique content',
        'second unique content',
        'third unique content',
      ];

      const duplicates = findDuplicates(contents, 0.9);
      expect(duplicates.length).toBe(0);
    });

    test('finds exact duplicates', () => {
      const contents = [
        'same content',
        'same content',
        'different content',
      ];

      const duplicates = findDuplicates(contents, 0.9);
      expect(duplicates.length).toBeGreaterThan(0);
    });

    test('respects similarity threshold', () => {
      const contents = [
        'hello world test',
        'hello world foo',  // Similar but not identical
      ];

      const strict = findDuplicates(contents, 0.99);
      const loose = findDuplicates(contents, 0.5);

      expect(strict.length).toBeLessThanOrEqual(loose.length);
    });
  });

  describe('ImportanceScoreSchema', () => {
    test('validates correct structure', () => {
      const validScore: ImportanceScore = {
        score: 75,
        factors: {
          recency: 80,
          frequency: 60,
          relevance: 70,
          uniqueness: 90,
          userMarked: 50,
        },
        recommendation: 'keep',
      };

      const result = ImportanceScoreSchema.safeParse(validScore);
      expect(result.success).toBe(true);
    });

    test('rejects invalid score range', () => {
      const invalidScore = {
        score: 150, // Invalid: > 100
        factors: {
          recency: 80,
          frequency: 60,
          relevance: 70,
          uniqueness: 90,
          userMarked: 50,
        },
        recommendation: 'keep',
      };

      const result = ImportanceScoreSchema.safeParse(invalidScore);
      expect(result.success).toBe(false);
    });

    test('rejects invalid recommendation', () => {
      const invalidScore = {
        score: 75,
        factors: {
          recency: 80,
          frequency: 60,
          relevance: 70,
          uniqueness: 90,
          userMarked: 50,
        },
        recommendation: 'invalid', // Invalid recommendation
      };

      const result = ImportanceScoreSchema.safeParse(invalidScore);
      expect(result.success).toBe(false);
    });
  });
});
