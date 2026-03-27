import { describe, it, expect, mock } from 'bun:test';

mock.module('../../../infra/observability/logger', () => ({
  logger: { info: mock(() => {}), error: mock(() => {}), debug: mock(() => {}), warn: mock(() => {}) },
}));

mock.module('../runtime', () => ({
  spawnSubagent: mock(async (config: any) => ({
    success: true,
    output: 'result',
    tokensUsed: 100,
    duration: 500,
    id: 'sub-1',
  })),
  spawnParallelSubagents: mock(async (configs: any[]) =>
    configs.map((_, i) => ({
      success: true,
      output: `result-${i}`,
      tokensUsed: 50,
      duration: 200,
      id: `sub-${i}`,
    }))
  ),
}));

mock.module('../tools', () => ({
  formatSubagentResult: mock((result: any, task: string) => `Formatted: ${task}`),
  formatParallelResults: mock((results: any[], tasks: string[]) => `Parallel: ${tasks.join(', ')}`),
}));

import { executeSpawnSubagent, executeSpawnParallel } from '../executor';

describe('subagent/executor', () => {
  describe('executeSpawnSubagent', () => {
    it('should return success result', async () => {
      const result = await executeSpawnSubagent({
        type: 'research',
        task: 'Search for info',
      });
      expect(result.success).toBe(true);
      expect(result.data).toContain('Search for info');
    });

    it('should handle runtime errors gracefully', async () => {
      const { spawnSubagent } = await import('../runtime');
      (spawnSubagent as any).mockImplementationOnce(async () => {
        throw new Error('Connection refused');
      });

      const result = await executeSpawnSubagent({
        type: 'research',
        task: 'will fail',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('executeSpawnParallel', () => {
    it('should return combined results', async () => {
      const result = await executeSpawnParallel({
        tasks: [
          { type: 'research', task: 'Task A' },
          { type: 'research', task: 'Task B' },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.data).toContain('Task A');
    });

    it('should handle thrown errors', async () => {
      const { spawnParallelSubagents } = await import('../runtime');
      (spawnParallelSubagents as any).mockImplementationOnce(async () => {
        throw new Error('All failed');
      });

      const result = await executeSpawnParallel({
        tasks: [{ type: 'research', task: 'fail' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('All failed');
    });
  });
});
