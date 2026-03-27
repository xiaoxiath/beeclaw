import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('fs', () => ({
  watch: vi.fn((_path: string, _opts: any, cb: Function) => {
    const watcher = {
      close: vi.fn(),
      on: vi.fn(),
    };
    // Store the callback for testing
    (globalThis as any).__fsWatchCallback = cb;
    (globalThis as any).__fsWatcher = watcher;
    return watcher;
  }),
  existsSync: vi.fn(() => true),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(() => Promise.resolve(JSON.stringify({
    server: { port: 4000, host: '0.0.0.0' },
    logging: { level: 'debug', format: 'pretty' },
  }))),
}));

vi.mock('../../observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./schema', () => ({
  AppConfigSchema: {
    safeParse: vi.fn((data: any) => ({ success: true, data })),
    parse: vi.fn((data: any) => data),
  },
}));

import { ConfigWatcher, ConfigManager, setHookNotifier, getConfigManager, resetConfigManager } from '../hot-reload';
import type { AppConfig, ConfigChange } from '../hot-reload';

// Minimal config for testing
const makeConfig = (overrides: Record<string, any> = {}): AppConfig => ({
  server: { port: 3000, host: '0.0.0.0' },
  auth: { enabled: false, tokens: [] },
  cors: { enabled: true, origins: ['localhost'], methods: ['GET'], allowHeaders: [], credentials: true, maxAge: 86400 },
  providers: [],
  roles: {},
  agent: { name: 'test', description: '', role: 'chat', visionRole: 'vision', systemPrompt: '', tools: [] },
  agents: [],
  sessionStorage: { type: 'jsonl', path: '' },
  memory: { type: 'filesystem', path: '', tools: { enabled: [], autoRecord: true }, retention: { conversations: '90d', facts: 'forever', decisions: 'forever' }, search: { vector: { enabled: true, provider: 'auto' }, fts: { enabled: true }, hybrid: { vectorWeight: 0.7, textWeight: 0.3 } } },
  skills: { userPath: '', builtinPath: '', autoLoad: true },
  plugins: { enabled: true, disabledPlugins: [] },
  channels: {},
  tools: {},
  logging: { level: 'info', format: 'pretty' },
  feishu: { enabled: false, logLevel: 'error', useCardV2: true },
  user: { location: 'Beijing', locale: 'zh-CN' },
  weather: { apiHost: '', defaultLocation: '' },
  search: {},
  finance: { defaultSource: 'auto', cacheEnabled: true },
  agentDisplay: { showTokenStats: false, tokenStatsFormat: 'inline' },
  compression: { enabled: true, role: 'fast', threshold: 0.8, keepRecent: 8, maxSummaryTokens: 1000, strategy: 'hybrid' },
  extraction: { enabled: true, triggerPhrases: [], periodicInterval: 10, confidenceThreshold: 0.9, lowConfidenceThreshold: 0.7, maxExtractionsPerRun: 20, notifyOnHighConfidence: true, sensitivePatterns: [] },
  toolSelector: { strategy: 'hybrid', maxTools: 30, cache: { enabled: true, maxSize: 1000, ttl: 3600000 }, rules: { enabled: true }, semantic: { enabled: true, fallbackToCore: true } },
  mcp: { enabled: true, servers: [] },
  hooks: { enabled: true, directories: [] },
  sandbox: { enabled: false, provider: 'auto', workspaceBase: '', local: { enabled: true, defaultTimeout: 30000, maxOutputSize: 1048576, blockedCommands: [] }, docker: { enabled: false, image: '', memoryLimitMb: 512, cpuLimit: 1, networkEnabled: false, defaultTimeout: 60000 }, pool: { enabled: false, minIdle: 1, maxTotal: 5 } },
  web: { enabled: false, port: 3000, host: '0.0.0.0', auth: { level: 'none' } },
  llmRouter: { enabled: true, fallbackEnabled: true, costTracking: true },
  ...overrides,
} as any);

describe('hot-reload', () => {
  describe('ConfigWatcher', () => {
    let watcher: ConfigWatcher;

    beforeEach(() => {
      watcher = new ConfigWatcher({ debounceMs: 10, validateBeforeApply: false, notifyHooks: false });
    });

    afterEach(() => {
      watcher.stop();
    });

    it('should start watching a file', () => {
      const config = makeConfig();
      watcher.start('/tmp/test-config.json', config);
      expect(watcher.getCurrentConfig()).toEqual(config);
    });

    it('should stop watching', () => {
      const config = makeConfig();
      watcher.start('/tmp/test-config.json', config);
      watcher.stop();
      // After stop, configPath should be null internally
      // getCurrentConfig still returns last known config
    });

    it('should register and unregister change listeners', () => {
      const listener = vi.fn();
      const unsubscribe = watcher.onChange(listener);
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('should return null config before start', () => {
      expect(watcher.getCurrentConfig()).toBeNull();
    });

    describe('rollback', () => {
      it('should return false when no snapshots available', () => {
        expect(watcher.rollback()).toBe(false);
      });

      it('should return empty snapshots initially', () => {
        expect(watcher.getSnapshots()).toEqual([]);
      });
    });
  });

  describe('ConfigManager', () => {
    let manager: ConfigManager;

    beforeEach(() => {
      manager = new ConfigManager();
    });

    afterEach(() => {
      manager.destroy();
    });

    it('should throw if get() called before load()', () => {
      expect(() => manager.get()).toThrow('Config not loaded');
    });

    it('should allow registering change listeners', () => {
      const listener = vi.fn();
      const unsub = manager.onChange(listener);
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('should destroy cleanly', () => {
      manager.destroy();
      // Should not throw even when called multiple times
      manager.destroy();
    });
  });

  describe('setHookNotifier', () => {
    it('should accept a notifier function', () => {
      const notifier = vi.fn(() => Promise.resolve());
      expect(() => setHookNotifier(notifier)).not.toThrow();
    });
  });

  describe('getConfigManager / resetConfigManager', () => {
    afterEach(() => {
      resetConfigManager();
    });

    it('should return the same instance on subsequent calls', () => {
      const a = getConfigManager();
      const b = getConfigManager();
      expect(a).toBe(b);
    });

    it('should return new instance after reset', () => {
      const a = getConfigManager();
      resetConfigManager();
      const b = getConfigManager();
      expect(a).not.toBe(b);
    });
  });
});
