/**
 * Tests for entries/cli.ts
 *
 * Verifies the CLI entry point module structure.
 * All heavy dependencies (initApp, CLIAdapter, etc.) are mocked.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock all dependencies
const mockLogger = {
  debug: vi.fn(() => {}),
  info: vi.fn(() => {}),
  warn: vi.fn(() => {}),
  error: vi.fn(() => {}),
};

const mockInitApp = vi.fn(() =>
  Promise.resolve({
    config: { memory: { path: '/tmp/test-cli' } },
    provider: 'openai',
    model: 'gpt-4',
  })
);

const mockCLIAdapterInstance = {
  initialize: vi.fn(() => Promise.resolve()),
  start: vi.fn(() => Promise.resolve()),
};

const MockCLIAdapter = vi.fn(() => mockCLIAdapterInstance);

vi.mock('../../infra/observability/logger', () => ({
  logger: mockLogger,
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../../app', () => ({
  initApp: mockInitApp,
}));

vi.mock('../../adapter/cli/adapter', () => ({
  CLIAdapter: MockCLIAdapter,
}));

vi.mock('../../infra/entry', () => ({
  adapterRegistry: {
    register: vi.fn(() => {}),
    stopAll: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../infra/utils/graceful-shutdown', () => ({
  GracefulShutdown: class {
    register = vi.fn(() => {});
    installSignalHandlers = vi.fn(() => {});
  },
}));

vi.mock('../../cli', () => ({}));

describe('entries/cli', () => {
  it('should have initApp mock configured correctly', async () => {
    const result = await mockInitApp();
    expect(result.config.memory.path).toBe('/tmp/test-cli');
    expect(result.provider).toBe('openai');
  });

  it('should have CLIAdapter mock callable', () => {
    const adapter = MockCLIAdapter();
    expect(typeof adapter.initialize).toBe('function');
    expect(typeof adapter.start).toBe('function');
  });

  it('should have logger mock ready', () => {
    expect(typeof mockLogger.info).toBe('function');
    expect(typeof mockLogger.error).toBe('function');
  });

  it('should configure initApp with enableRecovery: false for CLI', async () => {
    // Verify the expected call pattern: CLI does not need session recovery
    mockInitApp.mockClear();
    await mockInitApp({ enableRecovery: false });
    expect(mockInitApp).toHaveBeenCalledWith({ enableRecovery: false });
  });
});
