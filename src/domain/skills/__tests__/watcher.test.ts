import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), warn: vi.fn(() => {}), error: vi.fn(() => {}) },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Mock fs.watch
const mockWatcher = {
  on: vi.fn(() => mockWatcher),
  close: vi.fn(() => {}),
};
vi.mock('fs', () => ({
  watch: vi.fn(() => mockWatcher),
}));

import { SkillWatcher } from '../watcher';

describe('SkillWatcher', () => {
  let onInvalidate: ReturnType<typeof mock>;
  let watcher: SkillWatcher;

  beforeEach(() => {
    onInvalidate = vi.fn(() => {});
    watcher = new SkillWatcher('/tmp/skills', onInvalidate);
    mockWatcher.on.mockClear();
    mockWatcher.close.mockClear();
  });

  afterEach(() => {
    watcher.stop();
  });

  it('should construct without starting', () => {
    expect(watcher).toBeDefined();
  });

  it('should call stop safely when not started', () => {
    expect(() => watcher.stop()).not.toThrow();
  });

  it('should not start twice', () => {
    watcher.start();
    watcher.start(); // Should be no-op
  });

  it('should stop watching and clean up', () => {
    watcher.start();
    watcher.stop();
    expect(mockWatcher.close).toHaveBeenCalled();
  });
});
