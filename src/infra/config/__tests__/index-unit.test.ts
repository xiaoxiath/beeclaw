/**
 * Unit tests for src/infra/config/index.ts
 * Targets uncovered branches: resolveConfig paths, accessor functions,
 * YAML warning, env substitution with defaults, error handling.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */
const mocks = vi.hoisted(() => ({
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
  mockDeepMerge: vi.fn(),
  mockProviderResolver: {
    getRole: vi.fn(),
    getProvider: vi.fn(),
  },
  MockProviderResolverSpy: vi.fn(),
  MockParamsMerger: {
    mergeParams: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: (...a: any[]) => mocks.mockExistsSync(...a),
}));

vi.mock('fs/promises', () => ({
  readFile: (...a: any[]) => mocks.mockReadFile(...a),
}));

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { ...actual };
});

vi.mock('../../observability/logger', () => ({
  logger: mocks.mockLogger,
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../schema', () => ({
  AppConfigSchema: {
    safeParse: (...a: any[]) => mocks.mockSafeParse(...a),
    parse: (...a: any[]) => mocks.mockParse(...a),
  },
}));

vi.mock('../defaults', () => ({
  DEFAULT_CONFIG: {
    server: { port: 3000, host: '0.0.0.0' },
    auth: { enabled: false, tokens: [] },
    providers: [],
    agents: [],
    roles: {},
    agent: undefined,
    logging: { level: 'info', format: 'json' },
    weather: { apiHost: '', apiKey: '' },
    search: {},
    finance: {},
    agentDisplay: { showTokenStats: false },
    cors: { enabled: true, origins: [] },
    llmRouter: undefined,
    compression: undefined,
  },
}));

vi.mock('../../utils', () => ({
  deepMerge: (...a: any[]) => mocks.mockDeepMerge(...a),
}));

// Use a class-style mock so `new ProviderResolver(...)` works
vi.mock('../provider-resolver', () => {
  // This function can be called with `new` (ES5 constructor style)
  function FakeResolver(this: any, ...args: any[]) {
    mocks.MockProviderResolverSpy(...args);
    this.getRole = (...a: any[]) => mocks.mockProviderResolver.getRole(...a);
    this.getProvider = (...a: any[]) => mocks.mockProviderResolver.getProvider(...a);
  }
  return { ProviderResolver: FakeResolver };
});

vi.mock('../params-merger', () => ({
  ParamsMerger: mocks.MockParamsMerger,
}));

/* ------------------------------------------------------------------ */
/*  Import after mocks                                                 */
/* ------------------------------------------------------------------ */
import {
  loadConfig,
  getConfig,
  reloadConfig,
  resetConfig,
  getWeatherConfig,
  getSearchConfig,
  getFinanceConfig,
  getAgentDisplayConfig,
  shouldShowTokenStats,
} from '../index';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function makeBaseConfig(overrides: any = {}): any {
  return {
    server: { port: 3000, host: '0.0.0.0' },
    auth: { enabled: false, tokens: [] },
    providers: [],
    agents: [],
    roles: {},
    logging: { level: 'info', format: 'json' },
    weather: { apiHost: 'api.test.com', apiKey: 'key' },
    search: { provider: 'test' },
    finance: { enabled: false },
    agentDisplay: { showTokenStats: true },
    cors: { enabled: true, origins: [] },
    ...overrides,
  };
}

function resetMockImplementations() {
  mocks.mockExistsSync.mockReturnValue(false);
  mocks.mockReadFile.mockResolvedValue('{}');
  mocks.mockDeepMerge.mockImplementation((_a: any, b: any) => ({ ..._a, ...b }));

  const baseConfig = makeBaseConfig();
  mocks.mockSafeParse.mockImplementation((data: any) => ({
    success: true,
    data: { ...baseConfig, ...data },
  }));
  mocks.mockParse.mockImplementation((_data: any) => baseConfig);

  mocks.mockProviderResolver.getRole.mockReturnValue(undefined);
  mocks.mockProviderResolver.getProvider.mockReturnValue(undefined);
  mocks.MockParamsMerger.mergeParams.mockImplementation(
    (a: any, b: any) => ({ ...a, ...b }),
  );
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */
describe('config/index unit tests', () => {
  beforeEach(() => {
    resetConfig();
    resetMockImplementations();
  });

  afterEach(() => {
    resetConfig();
  });

  /* ================================================================ */
  /*  loadConfig basics                                                */
  /* ================================================================ */
  describe('loadConfig', () => {
    it('should load with defaults when no config file exists', async () => {
      mocks.mockExistsSync.mockReturnValue(false);

      const config = await loadConfig('/tmp');
      expect(config).toBeDefined();
      expect(mocks.mockSafeParse).toHaveBeenCalled();
    });

    it('should load from beeclaw.json when it exists', async () => {
      mocks.mockExistsSync.mockImplementation((path: string) =>
        path.endsWith('beeclaw.json'),
      );
      const fileConfig = { server: { port: 9999 } };
      mocks.mockReadFile.mockResolvedValue(JSON.stringify(fileConfig));

      await loadConfig('/tmp');
      expect(mocks.mockReadFile).toHaveBeenCalled();
      expect(mocks.mockDeepMerge).toHaveBeenCalled();
    });

    it('should handle safeParse failure and use parse defaults', async () => {
      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: false,
        error: { flatten: () => ({ formErrors: [], fieldErrors: {} }) },
      });
      const defaultConfig = makeBaseConfig();
      mocks.mockParse.mockReturnValue(defaultConfig);

      const config = await loadConfig('/tmp');
      expect(config).toBeDefined();
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        'Config validation warnings:',
        expect.anything(),
      );
    });

    it('should merge env config with highest priority', async () => {
      process.env.BEECLAW_PORT = '4444';
      mocks.mockExistsSync.mockReturnValue(false);

      await loadConfig('/tmp');
      // deepMerge should have been called for env config
      expect(mocks.mockDeepMerge).toHaveBeenCalled();

      delete process.env.BEECLAW_PORT;
    });

    it('should log configuration sources (file + env + defaults)', async () => {
      process.env.BEECLAW_PORT = '4444';
      mocks.mockExistsSync.mockImplementation((path: string) =>
        path.endsWith('beeclaw.json'),
      );
      mocks.mockReadFile.mockResolvedValue('{"server":{"port":3000}}');

      await loadConfig('/tmp');

      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Configuration loaded'),
      );

      delete process.env.BEECLAW_PORT;
    });

    it('should handle env var substitution with defaults ${VAR:-default}', async () => {
      delete process.env.MISSING_VAR_FOR_TEST;
      mocks.mockExistsSync.mockImplementation((p: string) =>
        p.endsWith('beeclaw.json'),
      );
      mocks.mockReadFile.mockResolvedValue('{"key":"${MISSING_VAR_FOR_TEST:-fallback_val}"}');

      await loadConfig('/tmp');

      // The readFile content is parsed after env var substitution
      // Since MISSING_VAR_FOR_TEST is undefined, it uses 'fallback_val'
      expect(mocks.mockDeepMerge).toHaveBeenCalled();
    });

    it('should warn about YAML config files', async () => {
      mocks.mockExistsSync.mockImplementation((path: string) =>
        path.endsWith('beeclaw.yaml'),
      );

      await loadConfig('/tmp');
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('YAML config files require a YAML parser'),
      );
    });

    it('should handle file read error gracefully', async () => {
      mocks.mockExistsSync.mockImplementation((path: string) =>
        path.endsWith('beeclaw.json'),
      );
      mocks.mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const config = await loadConfig('/tmp');
      expect(config).toBeDefined();
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load config file'),
        expect.any(Error),
      );
    });

    it('should warn when environment variable is not set (no default)', async () => {
      delete process.env.TOTALLY_MISSING_ENV_VAR;
      mocks.mockExistsSync.mockImplementation((p: string) =>
        p.endsWith('beeclaw.json'),
      );
      mocks.mockReadFile.mockResolvedValue('{"k":"${TOTALLY_MISSING_ENV_VAR}"}');

      await loadConfig('/tmp');
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('TOTALLY_MISSING_ENV_VAR is not set'),
      );
    });
  });

  /* ================================================================ */
  /*  resolveConfig                                                    */
  /* ================================================================ */
  describe('resolveConfig (via loadConfig)', () => {
    it('should skip resolution when no providers configured', async () => {
      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers: [], agents: [] }),
      });

      const config = await loadConfig('/tmp');
      expect(config.providers).toEqual([]);
    });

    it('should resolve agent role when agent has a role', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const roles = { chat: { provider: 'openai', model: 'gpt-4', params: { temperature: 0.7 } } };
      const agent = { role: 'chat', id: 'main' };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles, agents: [], agent }),
      });
      mocks.mockProviderResolver.getRole.mockImplementation((name: string) =>
        name === 'chat' ? roles.chat : undefined,
      );
      mocks.mockProviderResolver.getProvider.mockImplementation((name: string) =>
        name === 'openai' ? providers[0] : undefined,
      );

      const config = await loadConfig('/tmp');
      expect(config.agent.provider).toBe('openai');
      expect(config.agent.model).toBe('gpt-4');
    });

    it('should handle agent role not found', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const agent = { role: 'missing_role', id: 'main' };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles: {}, agents: [], agent }),
      });
      mocks.mockProviderResolver.getRole.mockReturnValue(undefined);

      await loadConfig('/tmp');
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve agent role'),
        expect.any(Error),
      );
    });

    it('should handle agent provider not found', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const roles = { chat: { provider: 'missing_provider', model: 'gpt-4', params: {} } };
      const agent = { role: 'chat', id: 'main' };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles, agents: [], agent }),
      });
      mocks.mockProviderResolver.getRole.mockReturnValue(roles.chat);
      mocks.mockProviderResolver.getProvider.mockReturnValue(undefined);

      await loadConfig('/tmp');
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve agent role'),
        expect.any(Error),
      );
    });

    it('should resolve legacy agents array with roles', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const roles = { chat: { provider: 'openai', model: 'gpt-4', params: { temperature: 0.5 } } };
      const agents = [{ id: 'a1', role: 'chat' }];

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles, agents }),
      });
      mocks.mockProviderResolver.getRole.mockImplementation((name: string) =>
        name === 'chat' ? roles.chat : undefined,
      );
      mocks.mockProviderResolver.getProvider.mockImplementation((name: string) =>
        name === 'openai' ? providers[0] : undefined,
      );

      const config = await loadConfig('/tmp');
      expect(config.agents[0].provider).toBe('openai');
      expect(config.agents[0].model).toBe('gpt-4');
    });

    it('should handle legacy agent with missing role', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const agents = [{ id: 'a1', role: 'nonexistent' }];

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles: {}, agents }),
      });
      mocks.mockProviderResolver.getRole.mockReturnValue(undefined);

      await loadConfig('/tmp');
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve agent'),
        expect.any(Error),
      );
    });

    it('should handle legacy agent with missing provider', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const roles = { chat: { provider: 'missing', model: 'gpt-4', params: {} } };
      const agents = [{ id: 'a1', role: 'chat' }];

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles, agents }),
      });
      mocks.mockProviderResolver.getRole.mockReturnValue(roles.chat);
      mocks.mockProviderResolver.getProvider.mockReturnValue(undefined);

      await loadConfig('/tmp');
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve agent'),
        expect.any(Error),
      );
    });

    it('should pass through legacy agents without role', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const agents = [{ id: 'a1', provider: 'openai', model: 'gpt-4' }];

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, agents }),
      });

      const config = await loadConfig('/tmp');
      expect(config.agents[0].id).toBe('a1');
      expect(config.agents[0].provider).toBe('openai');
    });

    it('should resolve LLM router tiers with roles', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const roles = { fast: { provider: 'openai', model: 'gpt-3.5', params: { max_tokens: 100, temperature: 0.3 } } };
      const llmRouter = {
        enabled: true,
        tiers: {
          fast: { role: 'fast', maxTokens: 500, temperature: 0.5 },
        },
      };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles, agents: [], llmRouter }),
      });
      mocks.mockProviderResolver.getRole.mockReturnValue(roles.fast);
      mocks.mockProviderResolver.getProvider.mockReturnValue(providers[0]);

      const config = await loadConfig('/tmp');
      expect(config.llmRouter.tiers.fast.provider).toBe('openai');
      expect(config.llmRouter.tiers.fast.models).toEqual(['gpt-3.5']);
    });

    it('should handle LLM tier role not found', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const llmRouter = {
        enabled: true,
        tiers: {
          fast: { role: 'nonexistent' },
        },
      };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles: {}, agents: [], llmRouter }),
      });
      mocks.mockProviderResolver.getRole.mockReturnValue(undefined);

      await loadConfig('/tmp');
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve LLM tier'),
        expect.any(Error),
      );
    });

    it('should handle LLM tier provider not found', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const roles = { fast: { provider: 'missing', model: 'gpt-3.5', params: {} } };
      const llmRouter = {
        enabled: true,
        tiers: { fast: { role: 'fast' } },
      };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles, agents: [], llmRouter }),
      });
      mocks.mockProviderResolver.getRole.mockReturnValue(roles.fast);
      mocks.mockProviderResolver.getProvider.mockReturnValue(undefined);

      await loadConfig('/tmp');
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve LLM tier'),
        expect.any(Error),
      );
    });

    it('should resolve compression config with role', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const roles = { compress: { provider: 'openai', model: 'gpt-3.5', params: {} } };
      const compression = { enabled: true, role: 'compress', params: {} };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles, agents: [], compression }),
      });
      mocks.mockProviderResolver.getRole.mockReturnValue(roles.compress);
      mocks.mockProviderResolver.getProvider.mockReturnValue(providers[0]);

      const config = await loadConfig('/tmp');
      expect(config.compression.provider).toBe('openai');
      expect(config.compression.model).toBe('gpt-3.5');
    });

    it('should handle compression role not found', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const compression = { enabled: true, role: 'missing', params: {} };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles: {}, agents: [], compression }),
      });
      mocks.mockProviderResolver.getRole.mockReturnValue(undefined);

      await loadConfig('/tmp');
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve compression'),
        expect.any(Error),
      );
    });

    it('should handle compression provider not found', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const roles = { compress: { provider: 'missing', model: 'gpt-3.5', params: {} } };
      const compression = { enabled: true, role: 'compress', params: {} };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, roles, agents: [], compression }),
      });
      mocks.mockProviderResolver.getRole.mockReturnValue(roles.compress);
      mocks.mockProviderResolver.getProvider.mockReturnValue(undefined);

      await loadConfig('/tmp');
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve compression'),
        expect.any(Error),
      );
    });

    it('should skip compression resolution when not enabled', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const compression = { enabled: false };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, agents: [], compression }),
      });

      const config = await loadConfig('/tmp');
      expect(config.compression.enabled).toBe(false);
    });

    it('should skip LLM router resolution when not enabled', async () => {
      const providers = [{ name: 'openai', apiKey: 'k', models: {} }];
      const llmRouter = { enabled: false };

      mocks.mockExistsSync.mockReturnValue(false);
      mocks.mockSafeParse.mockReturnValue({
        success: true,
        data: makeBaseConfig({ providers, agents: [], llmRouter }),
      });

      const config = await loadConfig('/tmp');
      expect(config.llmRouter.enabled).toBe(false);
    });
  });

  /* ================================================================ */
  /*  Accessor functions                                               */
  /* ================================================================ */
  describe('accessor functions', () => {
    it('getConfig should throw when not loaded', () => {
      expect(() => getConfig()).toThrow('Config not loaded');
    });

    it('getConfig should return cached config after load', async () => {
      await loadConfig('/tmp');
      const config = getConfig();
      expect(config).toBeDefined();
    });

    it('getWeatherConfig should return weather config', async () => {
      await loadConfig('/tmp');
      const weather = getWeatherConfig();
      expect(weather).toBeDefined();
    });

    it('getSearchConfig should return search config', async () => {
      await loadConfig('/tmp');
      const search = getSearchConfig();
      expect(search).toBeDefined();
    });

    it('getFinanceConfig should return finance config', async () => {
      await loadConfig('/tmp');
      const finance = getFinanceConfig();
      expect(finance).toBeDefined();
    });

    it('getAgentDisplayConfig should return agent display config', async () => {
      await loadConfig('/tmp');
      const display = getAgentDisplayConfig();
      expect(display).toBeDefined();
    });

    it('shouldShowTokenStats should return boolean', async () => {
      await loadConfig('/tmp');
      const result = shouldShowTokenStats();
      expect(typeof result).toBe('boolean');
    });
  });

  /* ================================================================ */
  /*  reloadConfig                                                     */
  /* ================================================================ */
  describe('reloadConfig', () => {
    it('should clear cache and reload', async () => {
      await loadConfig('/tmp');
      expect(getConfig()).toBeDefined();

      // Reload should clear and reload
      const config = await reloadConfig('/tmp');
      expect(config).toBeDefined();
    });
  });

  /* ================================================================ */
  /*  resetConfig                                                      */
  /* ================================================================ */
  describe('resetConfig', () => {
    it('should clear cached config', async () => {
      await loadConfig('/tmp');
      expect(getConfig()).toBeDefined();

      resetConfig();
      expect(() => getConfig()).toThrow('Config not loaded');
    });
  });

  /* ================================================================ */
  /*  parseEnvValue                                                    */
  /* ================================================================ */
  describe('env variable parsing', () => {
    it('should parse boolean true from env', async () => {
      process.env.BEECLAW_AUTH_ENABLED = 'true';
      mocks.mockExistsSync.mockReturnValue(false);

      await loadConfig('/tmp');
      // deepMerge is called with env config containing the parsed boolean
      const envMergeCall = mocks.mockDeepMerge.mock.calls.find(
        (c: any) => c[1]?.auth?.enabled === true,
      );
      expect(envMergeCall).toBeDefined();

      delete process.env.BEECLAW_AUTH_ENABLED;
    });

    it('should parse boolean false from env', async () => {
      process.env.BEECLAW_AUTH_ENABLED = 'false';
      mocks.mockExistsSync.mockReturnValue(false);

      await loadConfig('/tmp');
      const envMergeCall = mocks.mockDeepMerge.mock.calls.find(
        (c: any) => c[1]?.auth?.enabled === false,
      );
      expect(envMergeCall).toBeDefined();

      delete process.env.BEECLAW_AUTH_ENABLED;
    });

    it('should parse number from env', async () => {
      process.env.BEECLAW_PORT = '8080';
      mocks.mockExistsSync.mockReturnValue(false);

      await loadConfig('/tmp');
      const envMergeCall = mocks.mockDeepMerge.mock.calls.find(
        (c: any) => c[1]?.server?.port === 8080,
      );
      expect(envMergeCall).toBeDefined();

      delete process.env.BEECLAW_PORT;
    });

    it('should keep string values from env', async () => {
      process.env.BEECLAW_HOST = 'myhost.com';
      mocks.mockExistsSync.mockReturnValue(false);

      await loadConfig('/tmp');
      const envMergeCall = mocks.mockDeepMerge.mock.calls.find(
        (c: any) => c[1]?.server?.host === 'myhost.com',
      );
      expect(envMergeCall).toBeDefined();

      delete process.env.BEECLAW_HOST;
    });
  });
});
