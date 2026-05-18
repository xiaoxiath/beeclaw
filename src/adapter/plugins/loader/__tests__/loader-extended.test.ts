import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ─────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  discoverPlugins: vi.fn(),
  loadPluginManifest: vi.fn(),
  validatePluginConfig: vi.fn(),
  getOrCreatePluginRegistry: vi.fn(),
  createPluginRuntimeShim: vi.fn(),
  createHookRunner: vi.fn(),
  createJiti: vi.fn(),
  fileURLToPath: vi.fn(),
}));

vi.mock('@infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../../discovery', () => ({
  discoverPlugins: (...args: any[]) => mocks.discoverPlugins(...args),
}));

vi.mock('../../manifest', () => ({
  loadPluginManifest: (...args: any[]) => mocks.loadPluginManifest(...args),
  validatePluginConfig: (...args: any[]) => mocks.validatePluginConfig(...args),
}));

vi.mock('../../registry', () => ({
  getOrCreatePluginRegistry: (...args: any[]) => mocks.getOrCreatePluginRegistry(...args),
}));

vi.mock('../../runtime-shim', () => ({
  createPluginRuntimeShim: (...args: any[]) => mocks.createPluginRuntimeShim(...args),
}));

vi.mock('../../hook-runner', () => ({
  createHookRunner: (...args: any[]) => mocks.createHookRunner(...args),
}));

vi.mock('jiti', () => ({
  createJiti: (...args: any[]) => mocks.createJiti(...args),
}));

vi.mock('url', () => ({
  fileURLToPath: (...args: any[]) => mocks.fileURLToPath(...args),
}));

import { loadPlugins } from '../index';
import { logger } from '@infra/observability/logger';

describe('loadPlugins - extended coverage', () => {
  let mockRegistry: any;
  let mockCreateApi: any;
  let mockApi: any;
  let mockJitiInstance: any;
  let mockHookRunner: any;

  beforeEach(() => {
    mockApi = {
      id: 'test',
      registerTool: vi.fn(),
    };
    mockCreateApi = vi.fn().mockReturnValue(mockApi);
    mockRegistry = {
      plugins: new Map(),
      pluginRootDirs: new Map(),
      tools: new Map(),
      hooks: new Map(),
      typedHooks: new Map(),
      channels: new Map(),
      providers: new Map(),
      gatewayHandlers: new Map(),
      httpRoutes: new Map(),
      cliRegistrars: [],
      services: new Map(),
      commands: new Map(),
      diagnostics: [],
    };
    mocks.getOrCreatePluginRegistry.mockReturnValue({
      registry: mockRegistry,
      createApi: mockCreateApi,
    });

    mockJitiInstance = {
      import: vi.fn(),
    };
    mocks.createJiti.mockReturnValue(mockJitiInstance);
    mocks.fileURLToPath.mockReturnValue('/fake/path/index.ts');

    mocks.createPluginRuntimeShim.mockReturnValue({ type: 'runtime' });

    mockHookRunner = { run: vi.fn() };
    mocks.createHookRunner.mockReturnValue(mockHookRunner);

    mocks.discoverPlugins.mockReturnValue([]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'test', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });
  });

  // ─── No plugins discovered ─────────────────────────────────
  it('returns empty results when no plugins discovered', async () => {
    mocks.discoverPlugins.mockReturnValue([]);
    const result = await loadPlugins();
    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(result.registry).toBe(mockRegistry);
    expect(result.hookRunner).toBe(mockHookRunner);
  });

  // ─── Successful function export (Mode B) ───────────────────
  it('loads a plugin with function export (mode B)', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'fn-plugin', rootDir: '/plugins/fn-plugin' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'fn-plugin', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });

    const pluginFn = vi.fn();
    mockJitiInstance.import.mockResolvedValue({ default: pluginFn });

    const result = await loadPlugins();

    expect(pluginFn).toHaveBeenCalledWith(mockApi, { type: 'runtime' });
    expect(result.loaded).toEqual(['fn-plugin']);
    expect(result.failed).toHaveLength(0);
    expect(mockRegistry.pluginRootDirs.get('fn-plugin')).toBe('/plugins/fn-plugin');
  });

  // ─── Successful object export (Mode A) ─────────────────────
  it('loads a plugin with object export (mode A) and calls register', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'obj-plugin', rootDir: '/plugins/obj' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'obj-plugin', kind: 'tool' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });

    const pluginObj = { register: vi.fn(), activate: vi.fn() };
    mockJitiInstance.import.mockResolvedValue({ default: pluginObj });

    const result = await loadPlugins();

    expect(pluginObj.register).toHaveBeenCalledWith(mockApi, { type: 'runtime' });
    expect(pluginObj.activate).toHaveBeenCalled();
    expect(mockRegistry.plugins.get('obj-plugin')).toBe(pluginObj);
    expect(result.loaded).toEqual(['obj-plugin']);
  });

  // ─── Object export without activate ────────────────────────
  it('does not call activate if not a function', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'no-activate', rootDir: '/plugins/na' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'no-activate', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });

    const pluginObj = { register: vi.fn() }; // no activate
    mockJitiInstance.import.mockResolvedValue({ default: pluginObj });

    const result = await loadPlugins();
    expect(result.loaded).toEqual(['no-activate']);
  });

  // ─── Module without default uses mod directly ──────────────
  it('uses mod directly if no default export (fallback to mod)', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'raw-mod', rootDir: '/plugins/raw' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'raw-mod', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });

    const pluginFn = vi.fn();
    // No .default — the module IS the function
    mockJitiInstance.import.mockResolvedValue(pluginFn);

    const result = await loadPlugins();
    expect(pluginFn).toHaveBeenCalledWith(mockApi, { type: 'runtime' });
    expect(result.loaded).toEqual(['raw-mod']);
  });

  // ─── Invalid export (no register, not function) ────────────
  it('fails if plugin has no valid export', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'bad-export', rootDir: '/plugins/bad' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'bad-export', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });

    mockJitiInstance.import.mockResolvedValue({ default: { noRegister: true } });

    const result = await loadPlugins();
    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toEqual([
      { id: 'bad-export', error: 'No valid export (expected default object with register() or function)' },
    ]);
    expect(mockRegistry.diagnostics).toHaveLength(1);
  });

  // ─── Manifest load failure ─────────────────────────────────
  it('fails if manifest load returns not ok', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'no-manifest', rootDir: '/plugins/nm' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: false, error: 'File not found' });

    const result = await loadPlugins();
    expect(result.failed).toEqual([{ id: 'no-manifest', error: 'File not found' }]);
    expect(result.loaded).toHaveLength(0);
  });

  // ─── Config validation failure ─────────────────────────────
  it('fails if config validation fails', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'bad-config', rootDir: '/plugins/bc' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'bad-config', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: false, errors: 'missing required field "apiKey"' });

    const result = await loadPlugins();
    expect(result.failed).toEqual([
      { id: 'bad-config', error: 'Config validation failed: missing required field "apiKey"' },
    ]);
  });

  // ─── Memory slot occupied ──────────────────────────────────
  it('skips second memory plugin when slot is already occupied', async () => {
    mocks.discoverPlugins.mockReturnValue([
      { id: 'mem-1', rootDir: '/plugins/mem1' },
      { id: 'mem-2', rootDir: '/plugins/mem2' },
    ]);
    mocks.loadPluginManifest
      .mockReturnValueOnce({ ok: true, manifest: { id: 'mem-1', kind: 'memory' } })
      .mockReturnValueOnce({ ok: true, manifest: { id: 'mem-2', kind: 'memory' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });

    const pluginFn = vi.fn();
    mockJitiInstance.import.mockResolvedValue({ default: pluginFn });

    const result = await loadPlugins();
    expect(result.loaded).toEqual(['mem-1']);
    expect(result.failed).toEqual([
      { id: 'mem-2', error: 'Memory slot occupied by "mem-1"' },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping memory plugin "mem-2"')
    );
  });

  // ─── Disabled plugins are filtered out ─────────────────────
  it('filters out disabled plugins', async () => {
    mocks.discoverPlugins.mockReturnValue([
      { id: 'enabled', rootDir: '/plugins/en' },
      { id: 'disabled', rootDir: '/plugins/dis' },
    ]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'enabled', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });

    const pluginFn = vi.fn();
    mockJitiInstance.import.mockResolvedValue({ default: pluginFn });

    const result = await loadPlugins({ disabledPlugins: ['disabled'] });
    // Only 'enabled' gets processed
    expect(mocks.loadPluginManifest).toHaveBeenCalledTimes(1);
    expect(result.loaded).toEqual(['enabled']);
  });

  // ─── Plugin config passed to validatePluginConfig ──────────
  it('passes plugin-specific config from options', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'cfg-plugin', rootDir: '/plugins/cfg' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'cfg-plugin', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });
    mockJitiInstance.import.mockResolvedValue({ default: vi.fn() });

    await loadPlugins({ pluginConfigs: { 'cfg-plugin': { apiKey: '123' } } });

    expect(mocks.validatePluginConfig).toHaveBeenCalledWith(
      { id: 'cfg-plugin', kind: 'general' },
      { apiKey: '123' }
    );
  });

  // ─── Empty pluginConfig defaults to {} ─────────────────────
  it('defaults plugin config to {} if not provided', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'no-cfg', rootDir: '/plugins/nc' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'no-cfg', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });
    mockJitiInstance.import.mockResolvedValue({ default: vi.fn() });

    await loadPlugins();
    expect(mocks.validatePluginConfig).toHaveBeenCalledWith(
      { id: 'no-cfg', kind: 'general' },
      {}
    );
  });

  // ─── Jiti import error ─────────────────────────────────────
  it('catches jiti import errors', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'import-err', rootDir: '/plugins/ie' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'import-err', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });
    mockJitiInstance.import.mockRejectedValue(new Error('Module not found'));

    const result = await loadPlugins();
    expect(result.failed).toEqual([{ id: 'import-err', error: 'Module not found' }]);
    expect(mockRegistry.diagnostics[0]).toEqual({
      pluginId: 'import-err',
      level: 'error',
      message: 'Module not found',
    });
  });

  // ─── Register throws error ─────────────────────────────────
  it('catches errors thrown by register()', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'reg-err', rootDir: '/plugins/re' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'reg-err', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });

    const pluginObj = { register: vi.fn().mockRejectedValue(new Error('Register boom')) };
    mockJitiInstance.import.mockResolvedValue({ default: pluginObj });

    const result = await loadPlugins();
    expect(result.failed).toEqual([{ id: 'reg-err', error: 'Register boom' }]);
  });

  // ─── Activate throws error ─────────────────────────────────
  it('catches errors thrown by activate()', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'act-err', rootDir: '/plugins/ae' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'act-err', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });

    const pluginObj = {
      register: vi.fn(),
      activate: vi.fn().mockRejectedValue(new Error('Activate boom')),
    };
    mockJitiInstance.import.mockResolvedValue({ default: pluginObj });

    const result = await loadPlugins();
    expect(result.failed).toEqual([{ id: 'act-err', error: 'Activate boom' }]);
  });

  // ─── Non-Error thrown value ────────────────────────────────
  it('handles non-Error thrown values', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'str-err', rootDir: '/plugins/se' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'str-err', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });
    mockJitiInstance.import.mockRejectedValue('string error thrown');

    const result = await loadPlugins();
    expect(result.failed).toEqual([{ id: 'str-err', error: 'string error thrown' }]);
  });

  // ─── Multiple plugins: mix of success and failure ──────────
  it('handles mix of successful and failed plugins', async () => {
    mocks.discoverPlugins.mockReturnValue([
      { id: 'good-1', rootDir: '/plugins/g1' },
      { id: 'bad-1', rootDir: '/plugins/b1' },
      { id: 'good-2', rootDir: '/plugins/g2' },
    ]);
    mocks.loadPluginManifest
      .mockReturnValueOnce({ ok: true, manifest: { id: 'good-1', kind: 'general' } })
      .mockReturnValueOnce({ ok: false, error: 'corrupt manifest' })
      .mockReturnValueOnce({ ok: true, manifest: { id: 'good-2', kind: 'general' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });

    const pluginFn = vi.fn();
    mockJitiInstance.import.mockResolvedValue({ default: pluginFn });

    const result = await loadPlugins();
    expect(result.loaded).toEqual(['good-1', 'good-2']);
    expect(result.failed).toEqual([{ id: 'bad-1', error: 'corrupt manifest' }]);
  });

  // ─── Options passed through correctly ──────────────────────
  it('passes discovery options to discoverPlugins', async () => {
    const discoveryOpts = { bundledDir: '/custom/bundled', globalDir: '/custom/global' };
    await loadPlugins({ discovery: discoveryOpts });
    expect(mocks.discoverPlugins).toHaveBeenCalledWith(discoveryOpts);
  });

  it('passes runtimeOptions to createPluginRuntimeShim', async () => {
    await loadPlugins({ runtimeOptions: { env: 'test' } });
    expect(mocks.createPluginRuntimeShim).toHaveBeenCalledWith({ env: 'test' });
  });

  it('defaults runtimeOptions to {} if not provided', async () => {
    await loadPlugins();
    expect(mocks.createPluginRuntimeShim).toHaveBeenCalledWith({});
  });

  it('defaults discovery options to {} if not provided', async () => {
    await loadPlugins();
    expect(mocks.discoverPlugins).toHaveBeenCalledWith({});
  });

  // ─── Hook runner created from registry ─────────────────────
  it('creates hook runner from registry', async () => {
    await loadPlugins();
    expect(mocks.createHookRunner).toHaveBeenCalledWith(mockRegistry);
  });

  // ─── Logging ───────────────────────────────────────────────
  it('logs discovered count and final summary', async () => {
    mocks.discoverPlugins.mockReturnValue([
      { id: 'a', rootDir: '/a' },
      { id: 'b', rootDir: '/b' },
    ]);
    mocks.loadPluginManifest
      .mockReturnValueOnce({ ok: true, manifest: { id: 'a', kind: 'general' } })
      .mockReturnValueOnce({ ok: false, error: 'bad' });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });
    mockJitiInstance.import.mockResolvedValue({ default: vi.fn() });

    await loadPlugins();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Discovered 2 plugins'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Done. Loaded: 1, Failed: 1'));
  });

  it('logs success for each loaded plugin', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'ok-plug', rootDir: '/plugins/ok' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'ok-plug', kind: 'tool' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });
    mockJitiInstance.import.mockResolvedValue({ default: vi.fn() });

    await loadPlugins();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Loaded: ok-plug (tool)')
    );
  });

  it('logs error for each failed plugin', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'fail-plug', rootDir: '/plugins/fail' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: false, error: 'parse error' });

    await loadPlugins();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed: "fail-plug"')
    );
  });

  // ─── Memory plugin succeeds alone ──────────────────────────
  it('allows a single memory plugin to load', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'mem-only', rootDir: '/plugins/mem' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'mem-only', kind: 'memory' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });
    mockJitiInstance.import.mockResolvedValue({ default: vi.fn() });

    const result = await loadPlugins();
    expect(result.loaded).toEqual(['mem-only']);
    expect(result.failed).toHaveLength(0);
  });

  // ─── manifest.kind is undefined (general fallback) ─────────
  it('handles manifest with no kind (defaults to general in log)', async () => {
    mocks.discoverPlugins.mockReturnValue([{ id: 'no-kind', rootDir: '/plugins/nk' }]);
    mocks.loadPluginManifest.mockReturnValue({ ok: true, manifest: { id: 'no-kind' } });
    mocks.validatePluginConfig.mockReturnValue({ valid: true });
    mockJitiInstance.import.mockResolvedValue({ default: vi.fn() });

    const result = await loadPlugins();
    expect(result.loaded).toEqual(['no-kind']);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no-kind (general)')
    );
  });
});
