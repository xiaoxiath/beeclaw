import { describe, it, expect, beforeEach, vi } from 'vitest';

// Create mock functions that we can control per-test
const mockExistsSync = vi.fn(() => false);
const mockWriteFileSync = vi.fn();

// Mock fs module
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
}));

// Mock path module (needed for join)
vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
}));

// Mock readline
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_q: string, cb: Function) => cb('test answer')),
    close: vi.fn(),
  })),
}));

// Mock logger
vi.mock('../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { needsOnboarding, quickSetup } from '../onboarding';

describe('onboarding', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  describe('needsOnboarding', () => {
    it('should return true when files do not exist', () => {
      mockExistsSync.mockImplementation(() => false);
      const result = needsOnboarding('/test/memory');
      expect(result).toBe(true);
    });

    it('should return false when both files exist', () => {
      mockExistsSync.mockImplementation(() => true);
      const result = needsOnboarding('/test/memory');
      expect(result).toBe(false);
    });
  });

  describe('quickSetup', () => {
    it('should create default files when they do not exist', async () => {
      mockExistsSync.mockImplementation(() => false);
      mockWriteFileSync.mockImplementation(() => {});

      await quickSetup('/test/memory');

      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('should not overwrite existing files', async () => {
      mockExistsSync.mockImplementation(() => true);
      mockWriteFileSync.mockImplementation(() => {});

      await quickSetup('/test/memory');

      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });
});
