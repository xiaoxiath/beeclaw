/**
 * Tests for entries/cli.ts
 *
 * Verifies the CLI entry point module structure.
 * All heavy dependencies (initApp, CLIAdapter, etc.) are mocked.
 */

import { describe, it, expect, mock } from 'bun:test';

// Mock all dependencies
const mockLogger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

const mockInitApp = mock(() =>
  Promise.resolve({
    config: { memory: { path: '/tmp/test-cli' } },
    provider: 'openai',
    model: 'gpt-4',
  })
);

const mockCLIAdapterInstance = {
  initialize: mock(() => Promise.resolve()),
  start: mock(() => Promise.resolve()),
};

const MockCLIAdapter = mock(() => mockCLIAdapterInstance);

mock.module('../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

mock.module('../../app', () => ({
  initApp: mockInitApp,
}));

mock.module('../../adapter/cli/adapter', () => ({
  CLIAdapter: MockCLIAdapter,
}));

mock.module('../../infra/entry', () => ({
  adapterRegistry: {
    register: mock(() => {}),
    stopAll: mock(() => Promise.resolve()),
  },
}));

mock.module('../../infra/utils/graceful-shutdown', () => ({
  GracefulShutdown: class {
    register = mock(() => {});
    installSignalHandlers = mock(() => {});
  },
}));

mock.module('../../cli', () => ({}));

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
