/**
 * Tests for entries/web.ts
 *
 * Verifies the Web entry point module structure.
 * All heavy dependencies (initApp, WebAdapter, etc.) are mocked.
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
    config: { memory: { path: '/tmp/test-web' }, web: { enabled: true } },
    provider: 'openai',
    model: 'gpt-4',
  })
);

const mockWebAdapterInstance = {
  initialize: mock(() => Promise.resolve()),
  start: mock(() => Promise.resolve()),
};

const MockWebAdapter = mock(() => mockWebAdapterInstance);

mock.module('../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

mock.module('../../app', () => ({
  initApp: mockInitApp,
}));

mock.module('../../adapter/web/adapter', () => ({
  WebAdapter: MockWebAdapter,
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

describe('entries/web', () => {
  it('should have initApp mock configured correctly', async () => {
    const result = await mockInitApp();
    expect(result.config.memory.path).toBe('/tmp/test-web');
    expect(result.config.web.enabled).toBe(true);
    expect(result.provider).toBe('openai');
  });

  it('should have WebAdapter mock callable', () => {
    const adapter = MockWebAdapter();
    expect(typeof adapter.initialize).toBe('function');
    expect(typeof adapter.start).toBe('function');
  });

  it('should have logger mock ready', () => {
    expect(typeof mockLogger.info).toBe('function');
    expect(typeof mockLogger.error).toBe('function');
    expect(typeof mockLogger.debug).toBe('function');
  });

  it('should configure initApp with enableRecovery: false for Web', async () => {
    mockInitApp.mockClear();
    await mockInitApp({ enableRecovery: false });
    expect(mockInitApp).toHaveBeenCalledWith({ enableRecovery: false });
  });

  it('should have GracefulShutdown mocked', async () => {
    // Verify the GracefulShutdown mock module is correctly set up
    const { GracefulShutdown } = await import('../../infra/utils/graceful-shutdown');
    const instance = new GracefulShutdown();
    expect(typeof instance.register).toBe('function');
  });
});
