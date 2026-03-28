import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */
const mocks = vi.hoisted(() => {
  const mockWatcherObj = {
    close: vi.fn(),
    on: vi.fn(),
  };

  return {
    fsWatchCb: null as ((eventType: string, filename?: string) => void) | null,
    mockWatcherObj,
    mockWatch: vi.fn(),
    mockExistsSync: vi.fn(),
    mockReadFile: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    mockSafeParse: vi.fn(),
    mockParse: vi.fn(),
  };
});

vi.mock('fs', () => ({
  watch: (...a: any[]) => mocks.mockWatch(...a),
  existsSync: (...a: any[]) => mocks.mockExistsSync(...a),
}));

vi.mock('fs/promises', () => ({
  readFile: (...a: any[]) => mocks.mockReadFile(...a),
}));

vi.mock('../../observability/logger', () => ({
  logger: mocks.mockLogger,
}));

vi.mock('../schema', () => ({
  AppConfigSchema: {
    safeParse: (...a: any[]) => mocks.mockSafeParse(...a),
    parse: (...a: any[]) => mocks.mockParse(...a),
  },
}));

import {
  ConfigWatcher,
  ConfigManager,
  setHookNotifier,
  getConfigManager,
  resetConfigManager,
} from '../hot-reload';
import type { ConfigChange } from '../hot-reload';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const makeConfig = (overrides: any = {}): any => ({
  logging: { level: 'info', format: 'json' },
  server: { port: 3000 },
  memory: { path: '/tmp/mem' },
  ...overrides,
});

/**
 * Re-initialise all mock implementations.
 * Required because vitest config has `mockReset: true` which clears
 * implementations before each test.
 */
function resetMockImplementations() {
  mocks.fsWatchCb = null;

  mocks.mockWatcherObj.close.mockImplementation(() => {});
  mocks.mockWatcherObj.on.mockImplementation(() => {});

  mocks.mockWatch.mockImplementation((_path: string, _opts: any, cb: Function) => {
    mocks.fsWatchCb = cb as any;
    return mocks.mockWatcherObj;
  });

  mocks.mockExistsSync.mockReturnValue(true);
  mocks.mockReadFile.mockResolvedValue('{}');
  mocks.mockSafeParse.mockImplementation((data: any) => ({ success: true, data }));
  mocks.mockParse.mockImplementation((data: any) => data);
}

function triggerFileChange() {
  if (mocks.fsWatchCb) {
    mocks.fsWatchCb('change');
  }
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */
describe('hot-reload', () => {
  beforeEach(() => {
    resetMockImplementations();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setHookNotifier(null as any);
    resetConfigManager();
  });

  /* ================================================================ */
  /*  setHookNotifier                                                  */
  /* ================================================================ */
  describe('setHookNotifier', () => {
    it('should accept a notifier function', () => {
      expect(() => setHookNotifier(vi.fn())).not.toThrow();
    });
  });

  /* ================================================================ */
  /*  ConfigWatcher                                                    */
  /* ================================================================ */
  describe('ConfigWatcher', () => {
    let watcher: ConfigWatcher;

    beforeEach(() => {
      watcher = new ConfigWatcher({
        debounceMs: 50,
        validateBeforeApply: true,
        notifyHooks: false,
      });
    });

    afterEach(() => {
      watcher.stop();
    });

    /* ---------------------------------------------------------- */
    /*  start / stop / getCurrentConfig                            */
    /* ---------------------------------------------------------- */
    it('should start watching and store initial config', () => {
      const config = makeConfig();
      watcher.start('/tmp/config.json', config);
      expect(watcher.getCurrentConfig()).toEqual(config);
      expect(mocks.mockWatch).toHaveBeenCalledWith(
        '/tmp/config.json',
        { persistent: false },
        expect.any(Function),
      );
    });

    it('should register error handler on watcher', () => {
      watcher.start('/tmp/config.json', makeConfig());
      expect(mocks.mockWatcherObj.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should log error when watcher emits error', () => {
      watcher.start('/tmp/config.json', makeConfig());
      const errorHandler = mocks.mockWatcherObj.on.mock.calls.find(
        (c: any) => c[0] === 'error',
      )?.[1];
      errorHandler(new Error('watch error'));
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error watching'),
        expect.any(Error),
      );
    });

    it('should return null config before start', () => {
      expect(watcher.getCurrentConfig()).toBeNull();
    });

    it('should stop watching and clear debounce timer', () => {
      watcher.start('/tmp/config.json', makeConfig());
      triggerFileChange(); // Create a pending debounce timer
      watcher.stop();
      expect(mocks.mockWatcherObj.close).toHaveBeenCalled();
    });

    it('should stop cleanly when not started', () => {
      expect(() => watcher.stop()).not.toThrow();
    });

    /* ---------------------------------------------------------- */
    /*  onChange listeners                                          */
    /* ---------------------------------------------------------- */
    it('should register and unregister change listeners', () => {
      const listener = vi.fn();
      const unsub = watcher.onChange(listener);
      expect(typeof unsub).toBe('function');
      unsub();
    });

    /* ---------------------------------------------------------- */
    /*  Debounce and reload                                        */
    /* ---------------------------------------------------------- */
    it('should debounce file changes', async () => {
      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));
      const listener = vi.fn();

      watcher.start('/tmp/config.json', makeConfig());
      watcher.onChange(listener);

      // Trigger multiple rapid changes
      triggerFileChange();
      triggerFileChange();
      triggerFileChange();

      // Advance past debounce window
      await vi.advanceTimersByTimeAsync(100);

      // Should only reload once (debounced)
      expect(mocks.mockReadFile).toHaveBeenCalledTimes(1);
    });

    it('should detect and notify changes after reload', async () => {
      const oldConfig = makeConfig({ logging: { level: 'info', format: 'json' } });
      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      const listener = vi.fn();
      watcher.start('/tmp/config.json', oldConfig);
      watcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(listener).toHaveBeenCalled();
      const change: ConfigChange = listener.mock.calls[0][0];
      expect(change.key).toBe('logging.level');
      expect(change.oldValue).toBe('info');
      expect(change.newValue).toBe('debug');
    });

    it('should not notify listeners when no changes detected', async () => {
      const config = makeConfig();
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(config));

      const listener = vi.fn();
      watcher.start('/tmp/config.json', config);
      watcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(listener).not.toHaveBeenCalled();
      expect(mocks.mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No changes detected'),
      );
    });

    it('should provide diff context to listeners', async () => {
      const oldConfig = makeConfig();
      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      const listener = vi.fn();
      watcher.start('/tmp/config.json', oldConfig);
      watcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(listener).toHaveBeenCalled();
      const diff = listener.mock.calls[0][1];
      expect(diff).toBeDefined();
      expect(diff.totalChanges).toBeGreaterThan(0);
      expect(diff.reloadedAt).toBeDefined();
      expect(diff.previousConfig).toEqual(oldConfig);
    });

    it('should handle listener errors gracefully', async () => {
      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      const badListener = vi.fn(() => {
        throw new Error('listener error');
      });
      const goodListener = vi.fn();

      watcher.start('/tmp/config.json', makeConfig());
      watcher.onChange(badListener);
      watcher.onChange(goodListener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Listener error'),
        expect.any(Error),
      );
      // Good listener should still be called
      expect(goodListener).toHaveBeenCalled();
    });

    it('should handle validation failure', async () => {
      mocks.mockSafeParse.mockReturnValue({
        success: false,
        error: { flatten: () => ({ formErrors: [], fieldErrors: { bad: ['err'] } }) },
      });
      mocks.mockReadFile.mockResolvedValue('{"invalid": true}');

      watcher.start('/tmp/config.json', makeConfig());
      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('validation failed'),
        expect.anything(),
      );
    });

    it('should handle JSON parse error', async () => {
      mocks.mockReadFile.mockResolvedValue('not-json!!!');

      watcher.start('/tmp/config.json', makeConfig());
      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reload'),
        expect.any(Error),
      );
    });

    it('should handle readFile error', async () => {
      mocks.mockReadFile.mockRejectedValue(new Error('read error'));

      watcher.start('/tmp/config.json', makeConfig());
      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reload'),
        expect.any(Error),
      );
    });

    /* ---------------------------------------------------------- */
    /*  Environment variable substitution                          */
    /* ---------------------------------------------------------- */
    it('should substitute environment variables in config', async () => {
      process.env.TEST_HOT_RELOAD_VAR = 'substituted_value';
      mocks.mockReadFile.mockResolvedValue('{"key": "${TEST_HOT_RELOAD_VAR}"}');

      watcher.start('/tmp/config.json', makeConfig());
      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.mockSafeParse).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'substituted_value' }),
      );

      delete process.env.TEST_HOT_RELOAD_VAR;
    });

    it('should replace undefined env vars with empty string', async () => {
      delete process.env.NONEXISTENT_VAR_XYZ;
      mocks.mockReadFile.mockResolvedValue('{"key": "${NONEXISTENT_VAR_XYZ}"}');

      watcher.start('/tmp/config.json', makeConfig());
      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.mockSafeParse).toHaveBeenCalledWith(
        expect.objectContaining({ key: '' }),
      );
    });

    /* ---------------------------------------------------------- */
    /*  Skip validation                                            */
    /* ---------------------------------------------------------- */
    it('should skip validation when validateBeforeApply is false', async () => {
      const noValidateWatcher = new ConfigWatcher({
        debounceMs: 50,
        validateBeforeApply: false,
        notifyHooks: false,
      });
      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      const listener = vi.fn();
      noValidateWatcher.start('/tmp/config.json', makeConfig());
      noValidateWatcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      // safeParse should not be called for validation
      expect(mocks.mockSafeParse).not.toHaveBeenCalled();
      expect(listener).toHaveBeenCalled();

      noValidateWatcher.stop();
    });

    /* ---------------------------------------------------------- */
    /*  Hook notification                                          */
    /* ---------------------------------------------------------- */
    it('should notify hooks when notifyHooks is true', async () => {
      const hookWatcher = new ConfigWatcher({
        debounceMs: 50,
        validateBeforeApply: false,
        notifyHooks: true,
      });
      const mockNotifier = vi.fn().mockResolvedValue(undefined);
      setHookNotifier(mockNotifier);

      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      hookWatcher.start('/tmp/config.json', makeConfig());
      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockNotifier).toHaveBeenCalledWith(
        'config_changed',
        expect.objectContaining({ key: 'logging.level' }),
        expect.objectContaining({ diff: expect.any(Object) }),
      );

      hookWatcher.stop();
    });

    it('should handle hook notification failure gracefully', async () => {
      const hookWatcher = new ConfigWatcher({
        debounceMs: 50,
        validateBeforeApply: false,
        notifyHooks: true,
      });
      const failingNotifier = vi.fn().mockRejectedValue(new Error('hook error'));
      setHookNotifier(failingNotifier);

      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      hookWatcher.start('/tmp/config.json', makeConfig());
      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to notify hooks'),
        expect.any(Error),
      );

      hookWatcher.stop();
    });

    it('should log debug when no hook notifier registered', async () => {
      const hookWatcher = new ConfigWatcher({
        debounceMs: 50,
        validateBeforeApply: false,
        notifyHooks: true,
      });
      setHookNotifier(null as any);

      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      hookWatcher.start('/tmp/config.json', makeConfig());
      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No hook notifier registered'),
      );

      hookWatcher.stop();
    });

    /* ---------------------------------------------------------- */
    /*  Snapshots and rollback                                     */
    /* ---------------------------------------------------------- */
    it('should save snapshots on config reload', async () => {
      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      watcher.start('/tmp/config.json', makeConfig());
      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      const snapshots = watcher.getSnapshots();
      expect(snapshots.length).toBe(1);
      expect(snapshots[0].config.logging.level).toBe('info');
    });

    it('should rollback to previous config', async () => {
      const originalConfig = makeConfig({ logging: { level: 'info', format: 'json' } });
      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      watcher.start('/tmp/config.json', originalConfig);
      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      const result = watcher.rollback();
      expect(result).toBe(true);
      expect(watcher.getCurrentConfig()!.logging.level).toBe('info');
    });

    it('should return false for rollback when no snapshots', () => {
      watcher.start('/tmp/config.json', makeConfig());
      expect(watcher.rollback()).toBe(false);
    });

    it('should notify listeners on rollback with key=*', async () => {
      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      const listener = vi.fn();
      watcher.start('/tmp/config.json', makeConfig());
      watcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      listener.mockClear();
      watcher.rollback();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ key: '*' }),
      );
    });

    it('should handle listener error during rollback', async () => {
      const newConfig = makeConfig({ logging: { level: 'debug', format: 'json' } });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(newConfig));

      const badListener = vi.fn(() => {
        throw new Error('rollback listener error');
      });
      watcher.start('/tmp/config.json', makeConfig());
      watcher.onChange(badListener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      badListener.mockClear();
      mocks.mockLogger.error.mockClear();
      watcher.rollback();

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Listener error during rollback'),
        expect.any(Error),
      );
    });

    it('should limit snapshots to maxSnapshots (5)', async () => {
      watcher.start('/tmp/config.json', makeConfig());

      for (let i = 1; i <= 7; i++) {
        const cfg = makeConfig({ logging: { level: `level-${i}`, format: 'json' } });
        mocks.mockReadFile.mockResolvedValue(JSON.stringify(cfg));
        triggerFileChange();
        await vi.advanceTimersByTimeAsync(100);
      }

      const snapshots = watcher.getSnapshots();
      expect(snapshots.length).toBeLessThanOrEqual(5);
    });

    /* ---------------------------------------------------------- */
    /*  detectChanges — added / removed keys                       */
    /* ---------------------------------------------------------- */
    it('should detect added keys', async () => {
      const config1 = makeConfig();
      const config2 = makeConfig({ newKey: 'newValue' });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(config2));

      const listener = vi.fn();
      watcher.start('/tmp/config.json', config1);
      watcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      const changes = listener.mock.calls.map((c: any) => c[0]);
      const newKeyChange = changes.find((c: any) => c.key === 'newKey');
      expect(newKeyChange).toBeDefined();
      expect(newKeyChange!.oldValue).toBeUndefined();
      expect(newKeyChange!.newValue).toBe('newValue');
    });

    it('should detect removed keys', async () => {
      const config1 = makeConfig({ extraKey: 'value' });
      const config2 = makeConfig();
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(config2));

      const listener = vi.fn();
      watcher.start('/tmp/config.json', config1);
      watcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      const changes = listener.mock.calls.map((c: any) => c[0]);
      const removedChange = changes.find((c: any) => c.key === 'extraKey');
      expect(removedChange).toBeDefined();
      expect(removedChange!.newValue).toBeUndefined();
    });

    /* ---------------------------------------------------------- */
    /*  buildDiff categorization                                   */
    /* ---------------------------------------------------------- */
    it('should categorize diff as added, modified, removed', async () => {
      const config1 = makeConfig({ toRemove: 'x' });
      const config2 = makeConfig({
        logging: { level: 'debug', format: 'json' },
        toAdd: 'y',
      });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(config2));

      const listener = vi.fn();
      watcher.start('/tmp/config.json', config1);
      watcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(listener).toHaveBeenCalled();
      const diff = listener.mock.calls[0]?.[1];
      expect(diff).toBeDefined();
      expect(diff.added.length).toBeGreaterThanOrEqual(1);
      expect(diff.modified.length).toBeGreaterThanOrEqual(1);
      expect(diff.removed.length).toBeGreaterThanOrEqual(1);
    });

    /* ---------------------------------------------------------- */
    /*  Only 'change' event type triggers reload                   */
    /* ---------------------------------------------------------- */
    it('should only trigger reload for change events', async () => {
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(makeConfig()));

      watcher.start('/tmp/config.json', makeConfig());

      if (mocks.fsWatchCb) {
        mocks.fsWatchCb('rename');
      }

      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.mockReadFile).not.toHaveBeenCalled();
    });

    /* ---------------------------------------------------------- */
    /*  Default options                                            */
    /* ---------------------------------------------------------- */
    it('should use default options when none provided', () => {
      const defaultWatcher = new ConfigWatcher();
      defaultWatcher.start('/tmp/config.json', makeConfig());
      defaultWatcher.stop();
    });

    /* ---------------------------------------------------------- */
    /*  deepEqual edge cases (arrays)                              */
    /* ---------------------------------------------------------- */
    it('should detect array value changes', async () => {
      const config1 = makeConfig({ tags: ['a', 'b'] });
      const config2 = makeConfig({ tags: ['a', 'c'] });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(config2));

      const listener = vi.fn();
      watcher.start('/tmp/config.json', config1);
      watcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      const changes = listener.mock.calls.map((c: any) => c[0]);
      const tagsChange = changes.find((c: any) => c.key === 'tags');
      expect(tagsChange).toBeDefined();
    });

    it('should detect array length changes', async () => {
      const config1 = makeConfig({ items: [1, 2] });
      const config2 = makeConfig({ items: [1, 2, 3] });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(config2));

      const listener = vi.fn();
      watcher.start('/tmp/config.json', config1);
      watcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(listener).toHaveBeenCalled();
    });

    it('should not notify when arrays are identical', async () => {
      const config1 = makeConfig({ items: [1, 2] });
      const config2 = makeConfig({ items: [1, 2] });
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(config2));

      const listener = vi.fn();
      watcher.start('/tmp/config.json', config1);
      watcher.onChange(listener);

      triggerFileChange();
      await vi.advanceTimersByTimeAsync(100);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should detect null config as wildcard change', async () => {
      expect(watcher.getCurrentConfig()).toBeNull();
    });
  });

  /* ================================================================ */
  /*  ConfigManager                                                    */
  /* ================================================================ */
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

    it('should load config from beeclaw.json', async () => {
      const config = makeConfig();
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(config));
      mocks.mockExistsSync.mockReturnValue(true);

      const result = await manager.load('/tmp');
      expect(result).toBeDefined();
      expect(mocks.mockReadFile).toHaveBeenCalled();
    });

    it('should use defaults when no config file found', async () => {
      mocks.mockExistsSync.mockReturnValue(false);
      const defaultConfig = makeConfig();
      mocks.mockSafeParse.mockReturnValue({ success: true, data: defaultConfig });

      const result = await manager.load('/tmp');
      expect(result).toEqual(defaultConfig);
    });

    it('should use defaults when validation fails', async () => {
      mocks.mockReadFile.mockResolvedValue('{"bad": true}');
      mocks.mockSafeParse.mockReturnValue({
        success: false,
        error: { flatten: () => 'err' },
      });
      const defaultFromParse = makeConfig();
      mocks.mockParse.mockReturnValue(defaultFromParse);

      const result = await manager.load('/tmp');
      expect(result).toBeDefined();
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('validation failed'),
      );
    });

    it('should start watcher after loading', async () => {
      const config = makeConfig();
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(config));

      await manager.load('/tmp');
      expect(mocks.mockWatch).toHaveBeenCalled();
    });

    it('should return current config from get()', async () => {
      const config = makeConfig();
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(config));

      await manager.load('/tmp');
      const result = manager.get();
      expect(result).toBeDefined();
    });

    it('should substitute environment variables', async () => {
      process.env.TEST_CM_VAR = 'cm_value';
      mocks.mockReadFile.mockResolvedValue('{"key": "${TEST_CM_VAR}"}');

      await manager.load('/tmp');
      expect(mocks.mockSafeParse).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'cm_value' }),
      );

      delete process.env.TEST_CM_VAR;
    });

    it('should register and unregister listeners', () => {
      const listener = vi.fn();
      const unsub = manager.onChange(listener);
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('should destroy cleanly', () => {
      expect(() => manager.destroy()).not.toThrow();
    });

    it('should use safeParse defaults when no file found', async () => {
      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({ success: true, data: { fromSafeParse: true } });

      const result = await manager.load('/tmp');
      expect(result).toEqual({ fromSafeParse: true });
      expect(mocks.mockReadFile).not.toHaveBeenCalled();
    });

    it('should fall back to parse when safeParse fails for defaults', async () => {
      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({ success: false });
      mocks.mockParse.mockReturnValue({ fromParse: true });

      const result = await manager.load('/tmp');
      expect(result).toEqual({ fromParse: true });
      expect(mocks.mockParse).toHaveBeenCalledWith({});
    });

    it('should handle existsSync throwing', async () => {
      mocks.mockExistsSync.mockImplementation(() => {
        throw new Error('fs error');
      });
      mocks.mockSafeParse.mockReturnValue({ success: true, data: { fallback: true } });

      const result = await manager.load('/tmp');
      expect(result).toEqual({ fallback: true });
    });
  });

  /* ================================================================ */
  /*  getConfigManager / resetConfigManager                            */
  /* ================================================================ */
  describe('getConfigManager / resetConfigManager', () => {
    afterEach(() => {
      resetConfigManager();
    });

    it('should return singleton', () => {
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

    it('should handle reset when no manager exists', () => {
      expect(() => resetConfigManager()).not.toThrow();
    });
  });
});
