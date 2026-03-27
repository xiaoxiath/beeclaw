import { describe, it, expect, mock } from 'bun:test';

mock.module('../../../infra/observability/logger', () => ({
  logger: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) },
}));
mock.module('../store', () => ({
  getSkillStore: mock(() => ({
    get: mock(() => null),
    getEvals: mock(() => ({ success: false, data: null })),
  })),
}));

import { ExperimentEngine, createExperimentEngine } from '../experiment-engine';

describe('ExperimentEngine', () => {
  const mockVersioning: any = {
    snapshot: mock(() => ({ versionId: 'v1' })),
    markDiscarded: mock(() => {}),
  };
  const mockEvaluator: any = {
    evaluate: mock(async () => ({
      compositeScore: 0.7,
      metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, complexityScore: 0.3 },
      testResults: [],
    })),
  };
  const mockJudge: any = {
    judge: mock(async () => ({
      failed: false,
      result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
    })),
  };
  const mockLedger: any = {
    log: mock(() => {}),
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
