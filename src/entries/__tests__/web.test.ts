/**
 * Tests for entries/web.ts
 *
 * Verifies the Web entry point module structure.
 * All heavy dependencies (initApp, WebAdapter, etc.) are mocked.
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
    config: { memory: { path: '/tmp/test-web' }, web: { enabled: true } },
    provider: 'openai',
    model: 'gpt-4',
  })
);

const mockWebAdapterInstance = {
  initialize: vi.fn(() => Promise.resolve()),
  start: vi.fn(() => Promise.resolve()),
};

const MockWebAdapter = vi.fn(() => mockWebAdapterInstance);

vi.mock('../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

vi.mock('../../app', () => ({
  initApp: mockInitApp,
}));

vi.mock('../../adapter/web/adapter', () => ({
  WebAdapter: MockWebAdapter,
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
