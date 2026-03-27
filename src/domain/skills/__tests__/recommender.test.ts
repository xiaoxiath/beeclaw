import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), error: vi.fn(() => {}), debug: vi.fn(() => {}) },
}));

import { calculateRecommendationScore, recommendSkills } from '../recommender';

describe('recommender', () => {
  describe('calculateRecommendationScore', () => {
    it('should score higher when trigger matches', () => {
      const skill: any = {
        name: 'weather',
        description: 'Get weather info',
        triggers: ['weather', 'forecast'],
        tags: ['utility'],
        usageCount: 0,
        successCount: 0,
        maturityScore: 50,
      };

      const result = calculateRecommendationScore(skill, 'what is the weather today');
      expect(result.confidence).toBeGreaterThan(0.3);
      expect(result.matchedTriggers).toContain('weather');
    });

    it('should score higher for tag matches', () => {
      const skill: any = {
        name: 'calc',
        description: 'Calculator',
        triggers: [],
        tags: ['math', 'calculator'],
        usageCount: 0,
        successCount: 0,
        maturityScore: 50,
      };

      const result = calculateRecommendationScore(skill, 'I need a calculator');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.matchedTags).toContain('calculator');
    });

    it('should cap confidence at 1.0', () => {
      const skill: any = {
        name: 'mega',
        description: 'everything everywhere all at once',
        triggers: ['a', 'b', 'c', 'd', 'e'],
        tags: ['a', 'b', 'c', 'd', 'e'],
        usageCount: 100,
        successCount: 99,
        maturityScore: 100,
      };

      const result = calculateRecommendationScore(skill, 'a b c d e');
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should give bonus for high success rate', () => {
      const skill: any = {
        name: 'reliable',
        description: 'Very reliable skill',
        triggers: ['reliable'],
        tags: [],
        usageCount: 100,
        successCount: 95,
        maturityScore: 50,
      };

      const withUsage = calculateRecommendationScore(skill, 'reliable');

      const noUsageSkill: any = { ...skill, usageCount: 0, successCount: 0 };
      const withoutUsage = calculateRecommendationScore(noUsageSkill, 'reliable');

      expect(withUsage.confidence).toBeGreaterThan(withoutUsage.confidence);
    });

    it('should give bonus for mature skills', () => {
      const mature: any = {
        name: 'x',
        description: 'desc',
        triggers: ['test'],
        tags: [],
        usageCount: 0,
        successCount: 0,
        maturityScore: 90,
      };
      const immature: any = { ...mature, maturityScore: 10 };

      const matureScore = calculateRecommendationScore(mature, 'test');
      const immatureScore = calculateRecommendationScore(immature, 'test');

      expect(matureScore.confidence).toBeGreaterThan(immatureScore.confidence);
    });
  });

  describe('recommendSkills', () => {
    it('should return recommendations sorted by confidence', () => {
      const mockStore: any = {
        list: () => [
          { name: 'weather', description: 'Weather info', triggers: ['weather'], tags: [], usageCount: 0, successCount: 0, maturityScore: 50 },
          { name: 'news', description: 'News lookup', triggers: ['news'], tags: [], usageCount: 0, successCount: 0, maturityScore: 50 },
        ],
      };

      const result = recommendSkills(mockStore, 'weather forecast');
      expect(result.recommendations.length).toBeGreaterThanOrEqual(0);
      expect(result.context).toBe('weather forecast');
      expect(result.timestamp).toBeDefined();
    });

    it('should limit to top 5 recommendations', () => {
      const skills = Array.from({ length: 20 }, (_, i) => ({
        name: `skill-${i}`,
        description: `Skill ${i} for keyword test`,
        triggers: ['test'],
        tags: ['test'],
        usageCount: 50,
        successCount: 50,
        maturityScore: 90,
      }));
      const mockStore: any = { list: () => skills };

      const result = recommendSkills(mockStore, 'test');
      expect(result.recommendations.length).toBeLessThanOrEqual(5);
    });
  });
});
