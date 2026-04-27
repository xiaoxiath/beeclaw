import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), error: vi.fn(() => {}), debug: vi.fn(() => {}), warn: vi.fn(() => {}) },
}));

vi.mock('../runtime', () => ({
  spawnSubagent: vi.fn(async (config: any) => ({
    success: true,
    output: 'result',
    tokensUsed: 100,
    duration: 500,
    id: 'sub-1',
  })),
  spawnParallelSubagents: vi.fn(async (configs: any[]) =>
    configs.map((_, i) => ({
      success: true,
      output: `result-${i}`,
      tokensUsed: 50,
      duration: 200,
      id: `sub-${i}`,
    }))
  ),
}));

vi.mock('../tools', () => ({
  formatSubagentResult: vi.fn((result: any, task: string) => `Formatted: ${task}`),
  formatParallelResults: vi.fn((results: any[], tasks: string[]) => `Parallel: ${tasks.join(', ')}`),
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
      const { spawnParallelSubagents } = await import('../runtime');
      const result = await executeSpawnParallel({
        tasks: [
          { type: 'research', task: 'Task A' },
          { type: 'research', task: 'Task B' },
        ],
        maxParallelism: 2,
      });
      expect(result.success).toBe(true);
      expect(result.data).toContain('Task A');
      expect(spawnParallelSubagents).toHaveBeenCalledWith(expect.any(Array), 2);
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
