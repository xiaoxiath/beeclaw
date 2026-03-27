/**
 * Tests for Queue Workers - createJobProcessor utility
 */
import { describe, it, expect, vi } from 'vitest';

// Mock dependencies
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
}));

vi.mock('../../../infra/queue/manager', () => ({
  getTaskManager: vi.fn(() => ({
    initialize: vi.fn(async () => {}),
    registerWorker: vi.fn(() => {}),
  })),
}));

vi.mock('../handlers', () => ({
  handleProactiveJob: vi.fn(async () => ({})),
}));

import { createJobProcessor } from '../index';

describe('createJobProcessor', () => {
  it('returns a function', () => {
    const processor = createJobProcessor(async (data: any) => data);
    expect(typeof processor).toBe('function');
  });

  it('calls handler with job data', async () => {
    const handler = vi.fn(async (data: { value: number }) => ({ result: data.value * 2 }));
    const processor = createJobProcessor(handler);

    const mockJob = {
      data: { value: 5 },
      updateProgress: vi.fn(async () => {}),
    } as any;

    const result = await processor(mockJob);
    expect(handler).toHaveBeenCalledWith({ value: 5 });
    expect(result).toEqual({ result: 10 });
  });

  it('updates progress to 10 at start and 100 at end', async () => {
    const handler = vi.fn(async () => 'done');
    const processor = createJobProcessor(handler);

    const updateProgress = vi.fn(async () => {});
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
    const handler = vi.fn(async () => {
      throw new Error('handler failed');
    });
    const processor = createJobProcessor(handler);

    const mockJob = {
      data: {},
      updateProgress: vi.fn(async () => {}),
    } as any;

    await expect(processor(mockJob)).rejects.toThrow('handler failed');
  });
});
