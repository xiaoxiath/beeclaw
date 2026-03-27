import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

mock.module('../../../infra/observability/logger', () => ({
  logger: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
}));

// Mock fs.watch
const mockWatcher = {
  on: mock(() => mockWatcher),
  close: mock(() => {}),
};
mock.module('fs', () => ({
  watch: mock(() => mockWatcher),
}));

import { SkillWatcher } from '../watcher';

describe('SkillWatcher', () => {
  let onInvalidate: ReturnType<typeof mock>;
  let watcher: SkillWatcher;

  beforeEach(() => {
    onInvalidate = mock(() => {});
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
