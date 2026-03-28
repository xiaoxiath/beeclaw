/**
 * Extended unit tests for SandboxManager — all external dependencies mocked.
 * Complements the integration-style manager.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Module-level mock fns (survive restoreMocks because re-set in beforeEach) ──

const mockLocalIsAvailable = vi.fn();
const mockLocalCreate = vi.fn();
const mockLocalShutdown = vi.fn();

const mockDockerIsAvailable = vi.fn();
const mockDockerCreate = vi.fn();
const mockDockerShutdown = vi.fn();

// ── vi.mock() factories ────────────────────────────────────────────────────

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    ...actual,
    resolve: vi.fn((...args: string[]) => actual.resolve(...args)),
    join: vi.fn((...args: string[]) => actual.join(...args)),
  };
});

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Use 'function' keyword (NOT arrow) so `new` works correctly in vitest 4.x
vi.mock('../providers/local', () => ({
  LocalSandboxProvider: vi.fn().mockImplementation(function (this: any) {
    this.type = 'local';
    this.isAvailable = mockLocalIsAvailable;
    this.create = mockLocalCreate;
    this.shutdown = mockLocalShutdown;
  }),
}));

vi.mock('../providers/docker', () => ({
  DockerSandboxProvider: vi.fn().mockImplementation(function (this: any) {
    this.type = 'docker';
    this.isAvailable = mockDockerIsAvailable;
    this.create = mockDockerCreate;
    this.shutdown = mockDockerShutdown;
  }),
}));

vi.mock('../path-mapper', () => ({
  VirtualPathMapper: vi.fn().mockImplementation(function (this: any, workspaceDir: string) {
    this.workspaceDir = workspaceDir;
    this.resolve = vi.fn((p: string) => `${workspaceDir}/${p}`);
  }),
}));

// ── Imports (after vi.mock) ────────────────────────────────────────────────

import { existsSync, mkdirSync } from 'fs';
import { SandboxManager } from '../manager';
import { LocalSandboxProvider } from '../providers/local';
import { DockerSandboxProvider } from '../providers/docker';
import { VirtualPathMapper } from '../path-mapper';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: any): any {
  return {
    enabled: true,
    provider: 'auto',
    workspaceBase: '/tmp/test-sandboxes',
    local: {
      enabled: true,
      defaultTimeout: 5000,
      maxOutputSize: 1024,
      blockedCommands: [],
      ...overrides?.local,
    },
    docker: {
      enabled: false,
      memoryLimitMb: 512,
      cpuLimit: 1,
      networkEnabled: false,
      defaultTimeout: 10000,
      maxOutputSize: 2048,
      idleTimeout: 300000,
      ...overrides?.docker,
    },
    pool: {
      enabled: false,
      minIdle: 1,
      maxTotal: 5,
      healthCheckInterval: 60000,
      ...overrides?.pool,
    },
    // DO NOT spread ...overrides here — it would overwrite the merged nested objects
  };
}

function createMockSandbox(overrides?: Partial<any>): any {
  return {
    id: overrides?.id || `sb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: overrides?.provider || 'local',
    alive: overrides?.alive ?? true,
    destroy: vi.fn(() => Promise.resolve()),
    exec: vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 10 })),
    writeFile: vi.fn(() => Promise.resolve()),
    readFile: vi.fn(() => Promise.resolve('')),
    listFiles: vi.fn(() => Promise.resolve([])),
    ...overrides,
  };
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('SandboxManager (mocked)', () => {
  beforeEach(() => {
    SandboxManager.resetInstance();

    // Re-set constructor mock implementations (restoreMocks: true wipes them)
    (LocalSandboxProvider as any).mockImplementation(function (this: any) {
      this.type = 'local';
      this.isAvailable = mockLocalIsAvailable;
      this.create = mockLocalCreate;
      this.shutdown = mockLocalShutdown;
    });
    (DockerSandboxProvider as any).mockImplementation(function (this: any) {
      this.type = 'docker';
      this.isAvailable = mockDockerIsAvailable;
      this.create = mockDockerCreate;
      this.shutdown = mockDockerShutdown;
    });
    (VirtualPathMapper as any).mockImplementation(function (this: any, workspaceDir: string) {
      this.workspaceDir = workspaceDir;
      this.resolve = vi.fn((p: string) => `${workspaceDir}/${p}`);
    });

    // Re-set module-level mock fn implementations
    mockLocalIsAvailable.mockImplementation(() => Promise.resolve(true));
    mockLocalCreate.mockImplementation((_opts: any) => Promise.resolve(createMockSandbox({ provider: 'local' })));
    mockLocalShutdown.mockImplementation(() => Promise.resolve());
    mockDockerIsAvailable.mockImplementation(() => Promise.resolve(false));
    mockDockerCreate.mockImplementation((_opts: any) => Promise.resolve(createMockSandbox({ provider: 'docker' })));
    mockDockerShutdown.mockImplementation(() => Promise.resolve());

    (existsSync as any).mockImplementation(() => true);
    (mkdirSync as any).mockImplementation(() => undefined);
  });

  afterEach(async () => {
    try {
      const mgr = SandboxManager.getInstance();
      await mgr.shutdown();
    } catch {
      // ignore
    }
    SandboxManager.resetInstance();
  });

  // ── Singleton ──────────────────────────────────────────────────────────

  describe('singleton', () => {
    it('returns the same instance', () => {
      const a = SandboxManager.getInstance();
      const b = SandboxManager.getInstance();
      expect(a).toBe(b);
    });

    it('resetInstance creates a new instance', () => {
      const a = SandboxManager.getInstance();
      SandboxManager.resetInstance();
      const b = SandboxManager.getInstance();
      expect(a).not.toBe(b);
    });
  });

  // ── initialize ──────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('registers local provider when available', async () => {
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      const stats = mgr.getStats();
      expect(stats.providers).toContain('local');
    });

    it('creates workspace directory when it does not exist', async () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('test-sandboxes')) return false;
        return true;
      });
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      expect(mkdirSync).toHaveBeenCalled();
    });

    it('skips when already initialized', async () => {
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.initialize(makeConfig());
      const stats = mgr.getStats();
      expect(stats.providers.length).toBeGreaterThan(0);
    });

    it('registers docker provider when enabled and available', async () => {
      mockDockerIsAvailable.mockImplementation(() => Promise.resolve(true));
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig({ docker: { enabled: true } }));
      const stats = mgr.getStats();
      expect(stats.providers).toContain('docker');
      expect(stats.providers).toContain('local');
    });

    it('skips docker when enabled but not available', async () => {
      mockDockerIsAvailable.mockImplementation(() => Promise.resolve(false));
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig({ docker: { enabled: true } }));
      const stats = mgr.getStats();
      expect(stats.providers).not.toContain('docker');
    });

    it('handles docker provider initialization error', async () => {
      mockDockerIsAvailable.mockImplementation(() => { throw new Error('Docker init failed'); });
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig({ docker: { enabled: true } }));
      const stats = mgr.getStats();
      expect(stats.providers).not.toContain('docker');
    });

    it('handles local provider initialization error', async () => {
      mockLocalIsAvailable.mockImplementation(() => { throw new Error('local init fail'); });
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      const stats = mgr.getStats();
      expect(stats.providers).not.toContain('local');
    });

    it('warns when no providers are available', async () => {
      mockLocalIsAvailable.mockImplementation(() => Promise.resolve(false));
      mockDockerIsAvailable.mockImplementation(() => Promise.resolve(false));
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig({ docker: { enabled: true } }));
      const stats = mgr.getStats();
      expect(stats.providers).toEqual([]);
    });

    it('skips local provider when disabled', async () => {
      mockDockerIsAvailable.mockImplementation(() => Promise.resolve(true));
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig({ local: { enabled: false }, docker: { enabled: true } }));
      const stats = mgr.getStats();
      expect(stats.providers).not.toContain('local');
      expect(stats.providers).toContain('docker');
    });
  });

  // ── resolveProvider (tested via acquire) ────────────────────────────────

  describe('resolveProvider', () => {
    it('auto selects docker over local', async () => {
      mockDockerIsAvailable.mockImplementation(() => Promise.resolve(true));
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig({ docker: { enabled: true } }));

      await mgr.acquire();
      expect(mockDockerCreate).toHaveBeenCalled();
    });

    it('uses explicit provider preference', async () => {
      mockDockerIsAvailable.mockImplementation(() => Promise.resolve(true));
      const mgr = SandboxManager.getInstance();
      const cfg = makeConfig({ docker: { enabled: true } });
      cfg.provider = 'local';
      await mgr.initialize(cfg);

      await mgr.acquire();
      expect(mockLocalCreate).toHaveBeenCalled();
    });

    it('falls back when preferred provider not available', async () => {
      const mgr = SandboxManager.getInstance();
      const cfg = makeConfig();
      cfg.provider = 'docker';
      await mgr.initialize(cfg);

      await mgr.acquire();
      expect(mockLocalCreate).toHaveBeenCalled();
    });

    it('throws when no providers available', async () => {
      mockLocalIsAvailable.mockImplementation(() => Promise.resolve(false));
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      await expect(mgr.acquire()).rejects.toThrow('No sandbox providers available');
    });
  });

  // ── acquire ──────────────────────────────────────────────────────────────

  describe('acquire', () => {
    it('throws when not initialized', async () => {
      const mgr = SandboxManager.getInstance();
      await expect(mgr.acquire()).rejects.toThrow('Not initialized');
    });

    it('creates sandbox and tracks it', async () => {
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      const { sandbox, pathMapper } = await mgr.acquire({ sessionId: 'session1' });
      expect(sandbox).toBeDefined();
      expect(pathMapper).toBeDefined();
      expect(mgr.getStats().activeSandboxes).toBe(1);
      expect(mgr.getStats().activeSessions).toBe(1);
    });

    it('reuses existing sandbox for same session', async () => {
      const mockSb = createMockSandbox({ id: 'sb_reuse', alive: true });
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      const first = await mgr.acquire({ sessionId: 'session1' });
      const second = await mgr.acquire({ sessionId: 'session1' });
      expect(first.sandbox.id).toBe(second.sandbox.id);
      expect(mockLocalCreate).toHaveBeenCalledTimes(1);
    });

    it('cleans up stale sandbox when existing one is dead', async () => {
      let callCount = 0;
      mockLocalCreate.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(createMockSandbox({ id: 'sb_dead', alive: false }));
        }
        return Promise.resolve(createMockSandbox({ id: 'sb_new', alive: true }));
      });

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      const first = await mgr.acquire({ sessionId: 'session1' });
      expect(first.sandbox.id).toBe('sb_dead');

      first.sandbox.alive = false;

      const second = await mgr.acquire({ sessionId: 'session1' });
      expect(second.sandbox.id).toBe('sb_new');
    });

    it('creates sandbox without sessionId', async () => {
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      const { sandbox } = await mgr.acquire();
      expect(sandbox).toBeDefined();
      expect(mgr.getStats().activeSandboxes).toBe(1);
      expect(mgr.getStats().activeSessions).toBe(0);
    });

    it('creates workspace directory when it does not exist', async () => {
      (existsSync as any).mockImplementation(() => false);
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      await mgr.acquire({ sessionId: 'session1' });
      expect(mkdirSync).toHaveBeenCalled();
    });

    it('uses provided workspacePath', async () => {
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      await mgr.acquire({ sessionId: 'sess', workspacePath: '/custom/path' });
      expect(mockLocalCreate).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: '/custom/path' }),
      );
    });
  });

  // ── release ──────────────────────────────────────────────────────────────

  describe('release', () => {
    it('destroys and removes sandbox', async () => {
      const mockSb = createMockSandbox({ id: 'sb_release' });
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.acquire({ sessionId: 'session1' });

      await mgr.release('sb_release');
      expect(mockSb.destroy).toHaveBeenCalled();
      expect(mgr.getStats().activeSandboxes).toBe(0);
      expect(mgr.getStats().activeSessions).toBe(0);
    });

    it('handles release of non-existent sandbox', async () => {
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.release('non-existent');
      expect(mgr.getStats().activeSandboxes).toBe(0);
    });

    it('handles destroy error gracefully', async () => {
      const mockSb = createMockSandbox({ id: 'sb_err' });
      mockSb.destroy.mockRejectedValue(new Error('destroy failed'));
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.acquire({ sessionId: 'session1' });

      await mgr.release('sb_err');
      expect(mgr.getStats().activeSandboxes).toBe(0);
    });
  });

  // ── releaseBySession ────────────────────────────────────────────────────

  describe('releaseBySession', () => {
    it('releases sandbox by session id', async () => {
      const mockSb = createMockSandbox({ id: 'sb_sess' });
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.acquire({ sessionId: 'session1' });

      await mgr.releaseBySession('session1');
      expect(mockSb.destroy).toHaveBeenCalled();
      expect(mgr.getStats().activeSandboxes).toBe(0);
    });

    it('does nothing for unknown session', async () => {
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.releaseBySession('unknown');
      expect(mgr.getStats().activeSandboxes).toBe(0);
    });
  });

  // ── getBySession ────────────────────────────────────────────────────────

  describe('getBySession', () => {
    it('returns sandbox and mapper for valid session', async () => {
      const mockSb = createMockSandbox({ id: 'sb_get' });
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.acquire({ sessionId: 'session1' });

      const result = mgr.getBySession('session1');
      expect(result).not.toBeNull();
      expect(result!.sandbox.id).toBe('sb_get');
      expect(result!.pathMapper).toBeDefined();
    });

    it('returns null for unknown session', async () => {
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      expect(mgr.getBySession('unknown')).toBeNull();
    });

    it('returns null when sandbox is dead', async () => {
      const mockSb = createMockSandbox({ id: 'sb_dead_get', alive: true });
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.acquire({ sessionId: 'session1' });

      mockSb.alive = false;
      expect(mgr.getBySession('session1')).toBeNull();
    });
  });

  // ── getPathMapper ──────────────────────────────────────────────────────

  describe('getPathMapper', () => {
    it('returns path mapper for existing sandbox', async () => {
      const mockSb = createMockSandbox({ id: 'sb_mapper' });
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.acquire({ sessionId: 'session1' });

      const mapper = mgr.getPathMapper('sb_mapper');
      expect(mapper).not.toBeNull();
    });

    it('returns null for non-existent sandbox', async () => {
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      expect(mgr.getPathMapper('non-existent')).toBeNull();
    });
  });

  // ── shutdown ────────────────────────────────────────────────────────────

  describe('shutdown', () => {
    it('destroys all sandboxes and providers', async () => {
      const mockSb1 = createMockSandbox({ id: 'sb1' });
      const mockSb2 = createMockSandbox({ id: 'sb2' });
      let callIdx = 0;
      mockLocalCreate.mockImplementation(() => {
        callIdx++;
        return Promise.resolve(callIdx === 1 ? mockSb1 : mockSb2);
      });

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.acquire({ sessionId: 's1' });
      await mgr.acquire({ sessionId: 's2' });

      await mgr.shutdown();
      expect(mockSb1.destroy).toHaveBeenCalled();
      expect(mockSb2.destroy).toHaveBeenCalled();
      expect(mockLocalShutdown).toHaveBeenCalled();
      expect(mgr.getStats().activeSandboxes).toBe(0);
      expect(mgr.getStats().providers).toEqual([]);
    });

    it('handles sandbox destroy error during shutdown', async () => {
      const mockSb = createMockSandbox({ id: 'sb_err_shut' });
      mockSb.destroy.mockRejectedValue(new Error('destroy error'));
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.acquire({ sessionId: 'session1' });

      await mgr.shutdown();
      expect(mgr.getStats().activeSandboxes).toBe(0);
    });

    it('handles provider shutdown error', async () => {
      mockLocalShutdown.mockRejectedValue(new Error('provider shutdown error'));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      await mgr.shutdown();
      expect(mgr.getStats().providers).toEqual([]);
    });
  });

  // ── events ──────────────────────────────────────────────────────────────

  describe('events', () => {
    it('emits sandbox:created event on acquire', async () => {
      const mockSb = createMockSandbox({ id: 'sb_evt', provider: 'local' });
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      const events: any[] = [];
      mgr.on((event) => events.push(event));

      await mgr.acquire({ sessionId: 'session1' });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('sandbox:created');
      expect(events[0].sandboxId).toBe('sb_evt');
      expect(events[0].provider).toBe('local');
    });

    it('emits sandbox:destroyed event on release', async () => {
      const mockSb = createMockSandbox({ id: 'sb_evt2', provider: 'local' });
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());
      await mgr.acquire({ sessionId: 'session1' });

      const events: any[] = [];
      mgr.on((event) => events.push(event));

      await mgr.release('sb_evt2');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('sandbox:destroyed');
      expect(events[0].sandboxId).toBe('sb_evt2');
    });

    it('unsubscribe function removes handler', async () => {
      const mockSb = createMockSandbox({ id: 'sb_unsub' });
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      const events: any[] = [];
      const unsub = mgr.on((event) => events.push(event));

      await mgr.acquire({ sessionId: 'session1' });
      expect(events).toHaveLength(1);

      unsub();
      await mgr.release('sb_unsub');
      expect(events).toHaveLength(1);
    });

    it('handles event handler error gracefully', async () => {
      const mockSb = createMockSandbox({ id: 'sb_err_evt' });
      mockLocalCreate.mockImplementation(() => Promise.resolve(mockSb));

      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      mgr.on(() => { throw new Error('handler error'); });

      const goodEvents: any[] = [];
      mgr.on((event) => goodEvents.push(event));

      await mgr.acquire({ sessionId: 'session1' });
      expect(goodEvents).toHaveLength(1);
    });
  });

  // ── getStats ────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns correct counts', async () => {
      const mgr = SandboxManager.getInstance();
      await mgr.initialize(makeConfig());

      expect(mgr.getStats()).toEqual({
        providers: ['local'],
        activeSandboxes: 0,
        activeSessions: 0,
      });

      await mgr.acquire({ sessionId: 's1' });
      await mgr.acquire({ sessionId: 's2' });
      await mgr.acquire();

      expect(mgr.getStats().activeSandboxes).toBe(3);
      expect(mgr.getStats().activeSessions).toBe(2);
    });
  });
});
