/**
 * Tests for reflection-trigger.ts
 *
 * Tests skill failure tracking, consecutive failure detection, and reflection triggers.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  recordSkillFailure,
  checkConsecutiveFailures,
  clearReflectionTracking,
  getReflectionStats,
  shouldTriggerReflection,
} from '../reflection-trigger';

describe('reflection-trigger', () => {
  beforeEach(() => {
    clearReflectionTracking();
  });

  describe('recordSkillFailure', () => {
    it('should record a failure', () => {
      recordSkillFailure('web_search', 'timeout');
      const stats = getReflectionStats();
      expect(stats.recentFailures).toBe(1);
      expect(stats.failureDetails).toHaveLength(1);
      expect(stats.failureDetails[0].skillName).toBe('web_search');
      expect(stats.failureDetails[0].count).toBe(1);
    });

    it('should record multiple failures for the same skill', () => {
      recordSkillFailure('web_search', 'timeout');
      recordSkillFailure('web_search', 'rate limit');
      const stats = getReflectionStats();
      expect(stats.recentFailures).toBe(2);
      expect(stats.failureDetails).toHaveLength(1);
      expect(stats.failureDetails[0].count).toBe(2);
    });

    it('should record failures for different skills', () => {
      recordSkillFailure('web_search', 'timeout');
      recordSkillFailure('code_run', 'syntax error');
      const stats = getReflectionStats();
      expect(stats.recentFailures).toBe(2);
      expect(stats.failureDetails).toHaveLength(2);
    });
  });

  describe('checkConsecutiveFailures', () => {
    it('should return 0 for a skill with no failures', () => {
      expect(checkConsecutiveFailures('web_search')).toBe(0);
    });

    it('should return the count for a skill with failures', () => {
      recordSkillFailure('web_search', 'fail 1');
      recordSkillFailure('web_search', 'fail 2');
      recordSkillFailure('code_run', 'fail 1');
      expect(checkConsecutiveFailures('web_search')).toBe(2);
      expect(checkConsecutiveFailures('code_run')).toBe(1);
    });
  });

  describe('clearReflectionTracking', () => {
    it('should clear all tracked failures', () => {
      recordSkillFailure('web_search', 'fail');
      recordSkillFailure('code_run', 'fail');
      expect(getReflectionStats().recentFailures).toBe(2);

      clearReflectionTracking();
      expect(getReflectionStats().recentFailures).toBe(0);
      expect(getReflectionStats().failureDetails).toHaveLength(0);
    });
  });

  describe('getReflectionStats', () => {
    it('should return empty stats initially', () => {
      const stats = getReflectionStats();
      expect(stats.recentFailures).toBe(0);
      expect(stats.failureDetails).toEqual([]);
    });

    it('should aggregate failure details by skill', () => {
      recordSkillFailure('a', 'err');
      recordSkillFailure('b', 'err');
      recordSkillFailure('a', 'err');
      recordSkillFailure('a', 'err');

      const stats = getReflectionStats();
      expect(stats.recentFailures).toBe(4);
      const aDetail = stats.failureDetails.find(d => d.skillName === 'a');
      const bDetail = stats.failureDetails.find(d => d.skillName === 'b');
      expect(aDetail?.count).toBe(3);
      expect(bDetail?.count).toBe(1);
    });
  });

  describe('shouldTriggerReflection', () => {
    it('should not trigger with no failures', () => {
      const result = shouldTriggerReflection();
      expect(result.shouldTrigger).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it('should not trigger with 1-2 total failures from different skills', () => {
      recordSkillFailure('a', 'err');
      recordSkillFailure('b', 'err');
      const result = shouldTriggerReflection();
      // 2 failures but from different skills (1 each), so signal 1 (>=3) not met
      // Signal 2: each skill has count 1 (< 2), so not met
      expect(result.shouldTrigger).toBe(false);
    });

    it('should trigger when total failures >= 3', () => {
      recordSkillFailure('a', 'err');
      recordSkillFailure('b', 'err');
      recordSkillFailure('c', 'err');
      const result = shouldTriggerReflection();
      expect(result.shouldTrigger).toBe(true);
      expect(result.reason).toContain('3');
      expect(result.failingSkills).toBeDefined();
      expect(result.failingSkills!.length).toBeGreaterThanOrEqual(1);
    });

    it('should trigger when single skill has >= 2 repeated failures', () => {
      recordSkillFailure('web_search', 'fail 1');
      recordSkillFailure('web_search', 'fail 2');
      const result = shouldTriggerReflection();
      expect(result.shouldTrigger).toBe(true);
      expect(result.reason).toContain('web_search');
      expect(result.failingSkills).toContain('web_search');
    });
  });
});
