/**
 * Tests for Queue Workers - createJobProcessor utility
 */
import { describe, it, expect, mock } from 'bun:test';

// Mock dependencies
mock.module('../../../infra/observability/logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

mock.module('../../../infra/queue/manager', () => ({
  getTaskManager: mock(() => ({
    initialize: mock(async () => {}),
    registerWorker: mock(() => {}),
  })),
}));

mock.module('../handlers', () => ({
  handleProactiveJob: mock(async () => ({})),
}));

import { createJobProcessor } from '../index';

describe('createJobProcessor', () => {
  it('returns a function', () => {
    const processor = createJobProcessor(async (data: any) => data);
    expect(typeof processor).toBe('function');
  });

  it('calls handler with job data', async () => {
    const handler = mock(async (data: { value: number }) => ({ result: data.value * 2 }));
    const processor = createJobProcessor(handler);

    const mockJob = {
      data: { value: 5 },
      updateProgress: mock(async () => {}),
    } as any;

    const result = await processor(mockJob);
    expect(handler).toHaveBeenCalledWith({ value: 5 });
    expect(result).toEqual({ result: 10 });
  });

  it('updates progress to 10 at start and 100 at end', async () => {
    const handler = mock(async () => 'done');
    const processor = createJobProcessor(handler);

    const updateProgress = mock(async () => {});
    const mockJob = {
      data: {},
      updateProgress,
    } as any;

    await processor(mockJob);
    expect(updateProgress).toHaveBeenCalledTimes(2);
    expect(updateProgress.mock.calls[0][0]).toBe(10);
    expect(updateProgress.mock.calls[1][0]).toBe(100);
  });

  it('propagates handler errors', async () => {
    const handler = mock(async () => {
      throw new Error('handler failed');
    });
    const processor = createJobProcessor(handler);

    const mockJob = {
      data: {},
      updateProgress: mock(async () => {}),
    } as any;

    await expect(processor(mockJob)).rejects.toThrow('handler failed');
  });
});
