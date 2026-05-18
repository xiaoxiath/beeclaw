import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), error: vi.fn(() => {}), debug: vi.fn(() => {}), warn: vi.fn(() => {}) },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));
vi.mock('../../../infra/queue/manager', () => ({
  getTaskManager: vi.fn(() => ({
    initialize: vi.fn(async () => {}),
    addJob: vi.fn(async () => ({ jobId: 'job-123' })),
  })),
}));
vi.mock('../../ports', () => ({
  getChannelClientPort: vi.fn(() => ({
    sendTextMessage: vi.fn(async () => {}),
  })),
}));

import {
  setDeepAnalysisContext,
  clearDeepAnalysisContext,
  getDeepAnalysisContext,
  isDeepAnalysisTool,
  requestDeepAnalysisTool,
} from '../deep-analysis';

describe('deep-analysis', () => {
  beforeEach(() => {
    clearDeepAnalysisContext();
  });

  describe('context management', () => {
    it('should set and get context', () => {
      const ctx = { sessionId: 's1', userId: 'u1', chatId: 'c1', originalMessage: 'test' };
      setDeepAnalysisContext(ctx);
      const result = getDeepAnalysisContext('s1');
      expect(result).toEqual(ctx);
    });

    it('should return null when no context set', () => {
      expect(getDeepAnalysisContext()).toBeNull();
    });

    it('should clear specific session context', () => {
      setDeepAnalysisContext({ sessionId: 's1', userId: 'u1', chatId: 'c1', originalMessage: 'a' });
      setDeepAnalysisContext({ sessionId: 's2', userId: 'u2', chatId: 'c2', originalMessage: 'b' });
      clearDeepAnalysisContext('s1');
      expect(getDeepAnalysisContext('s1')).toBeNull();
      expect(getDeepAnalysisContext('s2')).not.toBeNull();
    });

    it('should clear all contexts when no sessionId', () => {
      setDeepAnalysisContext({ sessionId: 's1', userId: 'u1', chatId: 'c1', originalMessage: 'a' });
      clearDeepAnalysisContext();
      expect(getDeepAnalysisContext('s1')).toBeNull();
    });

    it('should handle null context in set', () => {
      setDeepAnalysisContext(null);
      expect(getDeepAnalysisContext()).toBeNull();
    });

    it('should return last context when no sessionId specified', () => {
      setDeepAnalysisContext({ sessionId: 's1', userId: 'u1', chatId: 'c1', originalMessage: 'first' });
      setDeepAnalysisContext({ sessionId: 's2', userId: 'u2', chatId: 'c2', originalMessage: 'second' });
      const ctx = getDeepAnalysisContext();
      expect(ctx?.sessionId).toBe('s2');
    });
  });

  describe('isDeepAnalysisTool', () => {
    it('should return true for request_deep_analysis', () => {
      expect(isDeepAnalysisTool('request_deep_analysis')).toBe(true);
    });

    it('should return false for other tools', () => {
      expect(isDeepAnalysisTool('web_search')).toBe(false);
      expect(isDeepAnalysisTool('')).toBe(false);
    });
  });

  describe('requestDeepAnalysisTool', () => {
    it('should have correct name', () => {
      expect(requestDeepAnalysisTool.name).toBe('request_deep_analysis');
    });

    it('should require reason and quick_response', () => {
      expect(requestDeepAnalysisTool.parameters.required).toContain('reason');
      expect(requestDeepAnalysisTool.parameters.required).toContain('quick_response');
    });
  });
});
