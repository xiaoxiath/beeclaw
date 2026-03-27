import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), warn: vi.fn(() => {}), error: vi.fn(() => {}), debug: vi.fn(() => {}) },
}));
vi.mock('../store', () => ({
  getSkillStore: vi.fn(() => ({
    get: vi.fn(() => null),
    getEvals: vi.fn(() => ({ success: false, data: null })),
  })),
}));

import { ExperimentEngine, createExperimentEngine } from '../experiment-engine';

describe('ExperimentEngine', () => {
  const mockVersioning: any = {
    snapshot: vi.fn(() => ({ versionId: 'v1' })),
    markDiscarded: vi.fn(() => {}),
  };
  const mockEvaluator: any = {
    evaluate: vi.fn(async () => ({
      compositeScore: 0.7,
      metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, complexityScore: 0.3 },
      testResults: [],
    })),
  };
  const mockJudge: any = {
    judge: vi.fn(async () => ({
      failed: false,
      result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
    })),
  };
  const mockLedger: any = {
    log: vi.fn(() => {}),
  };

  it('should construct without errors', () => {
    const engine = new ExperimentEngine(mockVersioning, mockEvaluator, mockJudge, mockLedger);
    expect(engine).toBeDefined();
  });

  it('should throw when skill not found', async () => {
    const engine = new ExperimentEngine(mockVersioning, mockEvaluator, mockJudge, mockLedger);
    await expect(engine.run({ skillName: 'nonexistent' })).rejects.toThrow('not found');
  });

  describe('createExperimentEngine', () => {
    it('should be a function', () => {
      expect(typeof createExperimentEngine).toBe('function');
    });
  });
});
