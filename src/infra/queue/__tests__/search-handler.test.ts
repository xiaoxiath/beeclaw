import { describe, test, expect } from 'bun:test';
import {
  handleSearchJob,
} from '../handlers/search-handler';
import type { SearchJobData } from '../types';
import type { Job } from 'bunqueue/client';

// Mock Job object
function createMockJob<T>(data: T): Job<T> {
  let progress = 0;
  return {
    id: `job-${Date.now()}`,
    name: 'test-job',
    data,
    queueName: 'test-queue',
    state: 'waiting',
    progress: 0,
    timestamp: Date.now(),
    updateProgress: async (p: number) => {
      progress = p;
    },
    getProgress: () => progress,
  } as unknown as Job<T>;
}

describe('Search Handler', () => {
  describe('handleSearchJob', () => {
    test('executes search with query', async () => {
      const job = createMockJob<SearchJobData>({
        query: 'test query',
      });

      const result = await handleSearchJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
      expect((result as any).query).toBe('test query');
      expect(Array.isArray((result as any).results)).toBe(true);
    });

    test('executes search with options', async () => {
      const job = createMockJob<SearchJobData>({
        query: 'AI news',
        numResults: 5,
        region: 'cn',
        timeRange: 'week',
      });

      const result = await handleSearchJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
      expect((result as any).count).toBeGreaterThanOrEqual(0);
    });

    test('handles search with default options', async () => {
      const job = createMockJob<SearchJobData>({
        query: 'default search',
      });

      const result = await handleSearchJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
    });

    test('returns results array', async () => {
      const job = createMockJob<SearchJobData>({
        query: 'TypeScript',
        numResults: 3,
      });

      const result = await handleSearchJob(job);

      expect(Array.isArray((result as any).results)).toBe(true);
    });
  });
});
