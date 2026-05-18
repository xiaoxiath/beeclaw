import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */
const mocks = vi.hoisted(() => {
  const mockAgent = { chat: vi.fn(), getHistory: vi.fn() };
  const mockLoadConfig = vi.fn();
  const mockShouldShowTokenStats = vi.fn(() => false);
  const mockSetHookNotifier = vi.fn();
  const mockBootstrapStores = vi.fn();
  const mockInitDataConnection = vi.fn();
  const mockCreateAgent = vi.fn(() => mockAgent);
  const mockGetAllToolsForAI = vi.fn(() => []);
  const mockCallAI = vi.fn();
  const mockInitSessionManager = vi.fn();
  const mockLoadAllSessions = vi.fn(() => 0);
  const mockInitSubagentRuntime = vi.fn();
  const mockInitTaskOrchestrator = vi.fn();
  const mockInitSharedState = vi.fn();
  const mockInitializeTimezoneCache = vi.fn().mockResolvedValue(undefined);
  const mockResolveUserLocation = vi.fn(() => 'Unknown');
  const mockResolveUserTimezone = vi.fn(() => 'UTC');
  const mockSetCompressionLLMProvider = vi.fn();
  const mockConfigureTieredCompressor = vi.fn();
  const mockSetEmbeddingProvider = vi.fn();
  const mockGetVectorStore = vi.fn(() => ({ load: vi.fn().mockResolvedValue(undefined) }));
  const mockCosineSimilarity = vi.fn(() => 0.5);
  const mockSetSimilarityProvider = vi.fn();
  const mockGetLifecycleManager = vi.fn();
  const mockGetReflectionEngine = vi.fn();
  const mockGetSkillDiscoveryEngine = vi.fn();
  const mockInitExtractionManager = vi.fn();
  const mockSandboxInit = vi.fn().mockResolvedValue(undefined);
  const mockSandboxShutdown = vi.fn().mockResolvedValue(undefined);
  const mockSandboxGetStats = vi.fn(() => ({ providers: [] }));
  const mockCreateEmbeddingProvider = vi.fn(() => null);
  const mockTieredLLMRouter = vi.fn(() => ({ selectModelForTier: vi.fn(() => 'test-model') }));
  const mockGetLLMConcurrencyLimiter = vi.fn(() => ({ getStats: vi.fn(() => ({ maxConcurrent: 2 })) }));
  const mockGetHybridToolSelector = vi.fn();
  const mockCreateLLMSkillMatcher = vi.fn();
  const mockGetSkillStore = vi.fn(() => ({ setLLMMatcher: vi.fn() }));
  const mockResolveConfig = vi.fn(() => ({}));
  const mockInitializeMCP = vi.fn().mockResolvedValue({ success: 0, errors: [] });
  const mockShutdownMCP = vi.fn().mockResolvedValue(undefined);
  const mockGetMCPManager = vi.fn(() => ({}));
  const mockGetHookRunner = vi.fn(() => ({
    runParallel: vi.fn(),
    register: vi.fn(),
    setBridge: vi.fn(),
  }));
  const mockResetHookRunner = vi.fn();
  const mockRegisterPorts = vi.fn();
  const mockLoadPlugins = vi.fn().mockResolvedValue({ loaded: [], failed: [] });
  const mockGetPluginRegistry = vi.fn(() => ({ typedHooks: new Map() }));
  const mockCreateHookRunner = vi.fn();
  const mockGetFeishuWSClient = vi.fn();
  const mockNeedsOnboarding = vi.fn(() => false);
  const mockRunOnboardingWizard = vi.fn().mockResolvedValue(undefined);
  const mockQuickSetup = vi.fn().mockResolvedValue(undefined);
  const mockGateway = {
    registerChannel: vi.fn(),
    getRegisteredChannels: vi.fn(() => ['cli']),
  };
  const mockGetMessageGateway = vi.fn(() => mockGateway);
  const mockDispatcher = { start: vi.fn(), registerHandler: vi.fn() };
  const mockGetTaskDispatcher = vi.fn(() => mockDispatcher);
  const mockBootstrapHealthCheck = vi.fn();
  const mockCreateObservabilityHooks = vi.fn(() => ({}));

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    configure: vi.fn(),
  };

  return {
    mockAgent,
    mockLoadConfig,
    mockShouldShowTokenStats,
    mockSetHookNotifier,
    mockBootstrapStores,
    mockInitDataConnection,
    mockCreateAgent,
    mockGetAllToolsForAI,
    mockCallAI,
    mockInitSessionManager,
    mockLoadAllSessions,
    mockInitSubagentRuntime,
    mockInitTaskOrchestrator,
    mockInitSharedState,
    mockInitializeTimezoneCache,
    mockResolveUserLocation,
    mockResolveUserTimezone,
    mockSetCompressionLLMProvider,
    mockConfigureTieredCompressor,
    mockSetEmbeddingProvider,
    mockGetVectorStore,
    mockCosineSimilarity,
    mockSetSimilarityProvider,
    mockGetLifecycleManager,
    mockGetReflectionEngine,
    mockGetSkillDiscoveryEngine,
    mockInitExtractionManager,
    mockSandboxInit,
    mockSandboxShutdown,
    mockSandboxGetStats,
    mockCreateEmbeddingProvider,
    mockTieredLLMRouter,
    mockGetLLMConcurrencyLimiter,
    mockGetHybridToolSelector,
    mockCreateLLMSkillMatcher,
    mockGetSkillStore,
    mockResolveConfig,
    mockInitializeMCP,
    mockShutdownMCP,
    mockGetMCPManager,
    mockGetHookRunner,
    mockResetHookRunner,
    mockRegisterPorts,
    mockLoadPlugins,
    mockGetPluginRegistry,
    mockCreateHookRunner,
    mockGetFeishuWSClient,
    mockNeedsOnboarding,
    mockRunOnboardingWizard,
    mockQuickSetup,
    mockGateway,
    mockGetMessageGateway,
    mockDispatcher,
    mockGetTaskDispatcher,
    mockBootstrapHealthCheck,
    mockCreateObservabilityHooks,
    mockLogger,
  };
});

/* ------------------------------------------------------------------ */
/*  vi.mock() declarations                                             */
/* ------------------------------------------------------------------ */
vi.mock('../../infra/config', () => ({
  loadConfig: (...a: any[]) => mocks.mockLoadConfig(...a),
  shouldShowTokenStats: (...a: any[]) => mocks.mockShouldShowTokenStats(...a),
}));
vi.mock('../../infra/config/hot-reload', () => ({
  setHookNotifier: (...a: any[]) => mocks.mockSetHookNotifier(...a),
}));
vi.mock('../bootstrap-stores', () => ({
  bootstrapStores: (...a: any[]) => mocks.mockBootstrapStores(...a),
}));
vi.mock('../../infra/db/connection', () => ({
  initDataConnection: (...a: any[]) => mocks.mockInitDataConnection(...a),
}));
vi.mock('../../infra/observability/logger', () => ({
  logger: mocks.mockLogger,
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));
vi.mock('../../infra/observability/metrics', () => ({
  Observability: { configure: vi.fn() },
  createObservabilityHooks: (...a: any[]) => mocks.mockCreateObservabilityHooks(...a),
}));
vi.mock('../../domain/agent', () => ({
  createAgent: (...a: any[]) => mocks.mockCreateAgent(...a),
  getAllToolsForAI: (...a: any[]) => mocks.mockGetAllToolsForAI(...a),
  SYSTEM_PROMPTS: { default: 'default system prompt' },
}));
vi.mock('../../domain/agent/api', () => ({
  callAI: (...a: any[]) => mocks.mockCallAI(...a),
}));
vi.mock('../../domain/session', () => ({
  initSessionManager: (...a: any[]) => mocks.mockInitSessionManager(...a),
  loadAllSessions: (...a: any[]) => mocks.mockLoadAllSessions(...a),
  getOrCreateSession: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
  deleteSession: vi.fn(),
  getSessionStats: vi.fn(),
  continueConversation: vi.fn(),
}));
vi.mock('../../domain/subagent', () => ({
  initSubagentRuntime: (...a: any[]) => mocks.mockInitSubagentRuntime(...a),
  initTaskOrchestrator: (...a: any[]) => mocks.mockInitTaskOrchestrator(...a),
  initSharedState: (...a: any[]) => mocks.mockInitSharedState(...a),
}));
vi.mock('../../domain/tools/timezone', () => ({
  initializeTimezoneCache: (...a: any[]) => mocks.mockInitializeTimezoneCache(...a),
  resolveUserLocation: (...a: any[]) => mocks.mockResolveUserLocation(...a),
  resolveUserTimezone: (...a: any[]) => mocks.mockResolveUserTimezone(...a),
}));
vi.mock('../../domain/memory/compression', () => ({
  setCompressionLLMProvider: (...a: any[]) => mocks.mockSetCompressionLLMProvider(...a),
}));
vi.mock('../../domain/agent/compression', () => ({
  configureTieredCompressor: (...a: any[]) => mocks.mockConfigureTieredCompressor(...a),
}));
vi.mock('../../domain/memory/vector-store', () => ({
  setEmbeddingProvider: (...a: any[]) => mocks.mockSetEmbeddingProvider(...a),
  getVectorStore: (...a: any[]) => mocks.mockGetVectorStore(...a),
  cosineSimilarity: (...a: any[]) => mocks.mockCosineSimilarity(...a),
}));
vi.mock('../../domain/memory/scoring', () => ({
  setSimilarityProvider: (...a: any[]) => mocks.mockSetSimilarityProvider(...a),
}));
vi.mock('../../domain/memory/lifecycle-manager', () => ({
  getLifecycleManager: (...a: any[]) => mocks.mockGetLifecycleManager(...a),
}));
vi.mock('../../domain/agent/reflection-engine', () => ({
  getReflectionEngine: (...a: any[]) => mocks.mockGetReflectionEngine(...a),
}));
vi.mock('../../domain/agent/skill-discovery', () => ({
  getSkillDiscoveryEngine: (...a: any[]) => mocks.mockGetSkillDiscoveryEngine(...a),
}));
vi.mock('../../domain/extraction', () => ({
  initExtractionManager: (...a: any[]) => mocks.mockInitExtractionManager(...a),
}));
vi.mock('../../domain/sandbox/manager', () => ({
  SandboxManager: {
    getInstance: vi.fn(() => ({
      initialize: mocks.mockSandboxInit,
      shutdown: mocks.mockSandboxShutdown,
      getStats: mocks.mockSandboxGetStats,
    })),
  },
}));
vi.mock('../../domain/memory/embeddings', () => ({
  createEmbeddingProvider: (...a: any[]) => mocks.mockCreateEmbeddingProvider(...a),
}));
vi.mock('../../infra/ai/tiered-router', () => ({
  TieredLLMRouter: class { constructor(o: any) { return mocks.mockTieredLLMRouter(o); } },
}));
vi.mock('../../infra/ai/concurrency-limiter', () => ({
  getLLMConcurrencyLimiter: (...a: any[]) => mocks.mockGetLLMConcurrencyLimiter(...a),
}));
vi.mock('../../domain/agent/hybrid-tool-selector', () => ({
  getHybridToolSelector: (...a: any[]) => mocks.mockGetHybridToolSelector(...a),
}));
vi.mock('../../domain/skills/llm-matcher', () => ({
  createLLMSkillMatcher: (...a: any[]) => mocks.mockCreateLLMSkillMatcher(...a),
}));
vi.mock('../../domain/skills', () => ({
  getSkillStore: (...a: any[]) => mocks.mockGetSkillStore(...a),
}));
vi.mock('../../infra/config/resilience-config', () => ({
  resolveConfig: (...a: any[]) => mocks.mockResolveConfig(...a),
}));
vi.mock('../../adapter/mcp', () => ({
  initializeMCP: (...a: any[]) => mocks.mockInitializeMCP(...a),
  shutdownMCP: (...a: any[]) => mocks.mockShutdownMCP(...a),
  getMCPManager: (...a: any[]) => mocks.mockGetMCPManager(...a),
}));
vi.mock('../../adapter/plugins/hooks', () => ({
  getHookRunner: (...a: any[]) => mocks.mockGetHookRunner(...a),
  resetHookRunner: (...a: any[]) => mocks.mockResetHookRunner(...a),
}));
vi.mock('../../domain/ports', () => ({
  registerPorts: (...a: any[]) => mocks.mockRegisterPorts(...a),
}));
vi.mock('../../adapter/plugins', () => ({
  loadPlugins: (...a: any[]) => mocks.mockLoadPlugins(...a),
  getPluginRegistry: (...a: any[]) => mocks.mockGetPluginRegistry(...a),
  createHookRunner: (...a: any[]) => mocks.mockCreateHookRunner(...a),
}));
vi.mock('../../adapter/feishu', () => ({
  getFeishuWSClient: (...a: any[]) => mocks.mockGetFeishuWSClient(...a),
}));
vi.mock('../../adapter/cli/channel', () => ({
  CLIChannel: class MockCLIChannel {},
}));
vi.mock('../../adapter/feishu/card-v2/streaming-controller', () => ({
  StreamingMessageController: class MockStreamingController {},
}));
vi.mock('../onboarding', () => ({
  needsOnboarding: (...a: any[]) => mocks.mockNeedsOnboarding(...a),
  runOnboardingWizard: (...a: any[]) => mocks.mockRunOnboardingWizard(...a),
  quickSetup: (...a: any[]) => mocks.mockQuickSetup(...a),
}));
vi.mock('../gateway-channel', () => ({
  getMessageGateway: (...a: any[]) => mocks.mockGetMessageGateway(...a),
}));
vi.mock('../dispatcher', () => ({
  getTaskDispatcher: (...a: any[]) => mocks.mockGetTaskDispatcher(...a),
}));
vi.mock('../bootstrap-health', () => ({
  bootstrapHealthCheck: (...a: any[]) => mocks.mockBootstrapHealthCheck(...a),
}));

// These re-exports need to be mocked at the top
vi.mock('bun:sqlite', () => {
  return { Database: vi.fn(), default: vi.fn() };
});
vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Import module under test                                           */
/* ------------------------------------------------------------------ */
import {
  initApp,
  getAgent,
  getProvider,
  getModel,
  getExtractionManager,
  getConfig_,
  switchModel,
  resetApp,
  isInitialized,
  getTokenStatsConfig,
} from '../index';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function makeMinimalConfig(overrides: any = {}) {
  return {
    logging: { level: 'info', format: 'text' },
    memory: { path: '/tmp/test-memory', search: {} },
    agent: {
      role: 'default',
      systemPrompt: 'test prompt',
      temperature: 0.7,
      maxTokens: 4096,
      ...overrides.agent,
    },
    roles: {
      default: { provider: 'test-provider', model: 'test-model', params: {} },
      ...overrides.roles,
    },
    providers: overrides.providers || [
      {
        name: 'test-provider',
        type: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.test.com',
        default: true,
        models: ['test-model', 'test-model-2'],
      },
    ],
    mcp: { enabled: false, servers: [] },
    plugins: { enabled: false },
    feishu: {},
    llmRouter: { enabled: false },
    extraction: { enabled: false },
    toolSelector: undefined,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */
describe('app/index', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset app state before each test
    mocks.mockShutdownMCP.mockResolvedValue(undefined);
    mocks.mockSandboxShutdown.mockResolvedValue(undefined);
    try { await resetApp(); } catch (_) {}
  });

  afterEach(async () => {
    try { await resetApp(); } catch (_) {}
  });

  /* ================================================================ */
  /*  getTokenStatsConfig                                              */
  /* ================================================================ */
  describe('getTokenStatsConfig', () => {
    it('should return showTokenStats based on shouldShowTokenStats()', () => {
      mocks.mockShouldShowTokenStats.mockReturnValue(true);
      expect(getTokenStatsConfig()).toEqual({ showTokenStats: true });
    });

    it('should return false when shouldShowTokenStats returns false', () => {
      mocks.mockShouldShowTokenStats.mockReturnValue(false);
      expect(getTokenStatsConfig()).toEqual({ showTokenStats: false });
    });
  });

  /* ================================================================ */
  /*  Accessor functions before init                                   */
  /* ================================================================ */
  describe('before initialization', () => {
    it('getAgent should throw', () => {
      expect(() => getAgent()).toThrow('App not initialized');
    });

    it('getProvider should throw', () => {
      expect(() => getProvider()).toThrow('App not initialized');
    });

    it('getModel should return empty string', () => {
      expect(getModel()).toBe('');
    });

    it('getExtractionManager should return null', () => {
      expect(getExtractionManager()).toBeNull();
    });

    it('getConfig_ should return null', () => {
      expect(getConfig_()).toBeNull();
    });

    it('isInitialized should return false', () => {
      expect(isInitialized()).toBe(false);
    });
  });

  /* ================================================================ */
  /*  initApp                                                          */
  /* ================================================================ */
  describe('initApp', () => {
    it('should initialize the app with minimal config', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      const result = await initApp();

      expect(result.config).toBe(config);
      expect(result.provider.name).toBe('test-provider');
      expect(result.model).toBe('test-model');
      expect(result.agent).toBe(mocks.mockAgent);
      expect(isInitialized()).toBe(true);
    });

    it('should return cached state if already initialized', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      const result2 = await initApp();

      // loadConfig only called once
      expect(mocks.mockLoadConfig).toHaveBeenCalledTimes(1);
      expect(result2.config).toBe(config);
    });

    it('should throw if no agent configured', async () => {
      const config = makeMinimalConfig({ agent: undefined });
      // Also remove legacy agents array
      delete config.agent;
      mocks.mockLoadConfig.mockResolvedValue(config);

      await expect(initApp()).rejects.toThrow('No agent configured');
    });

    it('should throw if role not found', async () => {
      const config = makeMinimalConfig({
        agent: { role: 'nonexistent' },
        roles: {},
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await expect(initApp()).rejects.toThrow('Role "nonexistent" not found');
    });

    it('should throw if provider not found for role', async () => {
      const config = makeMinimalConfig({
        roles: { default: { provider: 'missing-provider', model: 'x' } },
        providers: [],
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await expect(initApp()).rejects.toThrow('Provider "missing-provider" not found');
    });

    it('should configure logger with config values', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockLogger.configure).toHaveBeenCalledWith({
        level: 'info',
        format: 'text',
      });
    });

    it('should bootstrap stores with memory path', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockBootstrapStores).toHaveBeenCalledWith({
        basePath: '/tmp/test-memory',
        autoInit: true,
      });
    });

    it('should use custom memoryPath from options', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp({ memoryPath: '/custom/path' });
      expect(mocks.mockBootstrapStores).toHaveBeenCalledWith({
        basePath: '/custom/path',
        autoInit: true,
      });
    });

    it('should initialize data connection with db path', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockInitDataConnection).toHaveBeenCalledWith(
        expect.objectContaining({ migrate: true }),
      );
    });

    it('should register CLI channel', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockGateway.registerChannel).toHaveBeenCalled();
    });

    it('should start task dispatcher', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockGetTaskDispatcher).toHaveBeenCalled();
      expect(mocks.mockDispatcher.start).toHaveBeenCalled();
    });

    it('should run interactive onboarding wizard when needed and TTY', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockNeedsOnboarding.mockReturnValue(true);

      // Simulate interactive TTY
      const origStdin = process.stdin.isTTY;
      const origStdout = process.stdout.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await initApp();
      expect(mocks.mockRunOnboardingWizard).toHaveBeenCalled();
      expect(mocks.mockQuickSetup).not.toHaveBeenCalled();

      Object.defineProperty(process.stdin, 'isTTY', { value: origStdin, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: origStdout, configurable: true });
    });

    it('should use quick setup in non-interactive mode', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockNeedsOnboarding.mockReturnValue(true);

      const origStdin = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

      await initApp();
      expect(mocks.mockQuickSetup).toHaveBeenCalled();
      expect(mocks.mockRunOnboardingWizard).not.toHaveBeenCalled();

      Object.defineProperty(process.stdin, 'isTTY', { value: origStdin, configurable: true });
    });

    it('should initialize MCP when enabled with servers', async () => {
      const config = makeMinimalConfig({
        mcp: { enabled: true, servers: [{ id: 'test', command: 'node' }] },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockInitializeMCP.mockResolvedValue({ success: 1, errors: [] });

      await initApp();
      expect(mocks.mockInitializeMCP).toHaveBeenCalled();
    });

    it('should log MCP errors', async () => {
      const config = makeMinimalConfig({
        mcp: { enabled: true, servers: [{ id: 'test' }] },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockInitializeMCP.mockResolvedValue({
        success: 0,
        errors: [{ serverId: 'test', error: 'connection failed' }],
      });

      await initApp();
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('MCP test'),
      );
    });

    it('should skip MCP when disabled', async () => {
      const config = makeMinimalConfig({ mcp: { enabled: false, servers: [] } });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockInitializeMCP).not.toHaveBeenCalled();
    });

    it('should initialize session manager', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockInitSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'test-model',
          useTools: true,
        }),
      );
    });

    it('should load all sessions and log if any found', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockLoadAllSessions.mockReturnValue(5);

      await initApp();
      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('5 loaded'),
      );
    });

    it('should initialize subagent runtime and task orchestrator', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockInitSubagentRuntime).toHaveBeenCalled();
      expect(mocks.mockInitTaskOrchestrator).toHaveBeenCalled();
      expect(mocks.mockInitSharedState).toHaveBeenCalled();
    });

    it('should call bootstrapHealthCheck', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockBootstrapHealthCheck).toHaveBeenCalled();
    });

    it('should set hook notifier', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockSetHookNotifier).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should load plugins when enabled', async () => {
      mocks.mockLoadPlugins.mockResolvedValue({ loaded: ['test-plugin'], failed: [] });
      const config = makeMinimalConfig({ plugins: { enabled: true } });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockLoadPlugins).toHaveBeenCalled();
    });

    it('should create agent with correct params', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockCreateAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'test-model',
          loadCoreMemory: true,
          autoRefreshMemory: true,
        }),
      );
    });

    it('should initialize extraction manager when enabled', async () => {
      const config = makeMinimalConfig({
        extraction: { enabled: true, periodicInterval: 5 },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockInitExtractionManager.mockReturnValue({ run: vi.fn() });

      await initApp();
      expect(mocks.mockInitExtractionManager).toHaveBeenCalled();
    });

    it('should handle extraction manager init failure gracefully', async () => {
      const config = makeMinimalConfig({
        extraction: { enabled: true },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockInitExtractionManager.mockImplementation(() => {
        throw new Error('extraction init error');
      });

      // Should not throw
      await initApp();
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize extraction'),
        expect.any(Error),
      );
    });

    it('should initialize sandbox when enabled', async () => {
      const config = makeMinimalConfig();
      (config as any).sandbox = { enabled: true };
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockSandboxInit).toHaveBeenCalled();
    });

    it('should set up compression LLM provider', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockSetCompressionLLMProvider).toHaveBeenCalled();
      expect(mocks.mockConfigureTieredCompressor).toHaveBeenCalled();
    });

    it('should initialize embedding provider when config is available', async () => {
      const config = makeMinimalConfig();
      // Default provider with default=true triggers buildEmbeddingConfig fallback #3
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockCreateEmbeddingProvider.mockReturnValue({
        id: 'test-embed',
        model: 'test-embed-model',
        dims: 768,
        embed: vi.fn(),
        embedBatch: vi.fn(),
      });

      await initApp();
      expect(mocks.mockCreateEmbeddingProvider).toHaveBeenCalled();
      expect(mocks.mockSetEmbeddingProvider).toHaveBeenCalled();
    });

    it('should handle embedding provider creation failure with fallback', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockCreateEmbeddingProvider
        .mockReturnValueOnce(null)  // first call returns null -> throws
        .mockReturnValueOnce({ id: 'local', dims: 128, embed: vi.fn(), embedBatch: vi.fn() }); // fallback

      await initApp();
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize embedding'),
        expect.any(Error),
      );
    });

    it('should initialize HybridToolSelector when configured', async () => {
      const config = makeMinimalConfig({
        toolSelector: { strategy: 'layered', maxTools: 20 },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockGetHybridToolSelector).toHaveBeenCalled();
    });

    it('should register Feishu channel when feishu is enabled', async () => {
      const config = makeMinimalConfig({
        feishu: { enabled: true, appId: 'id', appSecret: 'secret' },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Feishu channel will be registered'),
      );
    });

    it('should resolve vision config from visionRole', async () => {
      const config = makeMinimalConfig({
        agent: {
          role: 'default',
          visionRole: 'vision',
        },
        roles: {
          default: { provider: 'test-provider', model: 'test-model', params: {} },
          vision: { provider: 'test-provider', model: 'vision-model' },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockInitSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          visionConfig: expect.objectContaining({
            visionModel: 'vision-model',
          }),
        }),
      );
    });

    it('should resolve visionConfig when explicitly set', async () => {
      const config = makeMinimalConfig({
        agent: {
          role: 'default',
          visionConfig: { visionModel: 'explicit-vision', textModel: 'explicit-text' },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockInitSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          visionConfig: { visionModel: 'explicit-vision', textModel: 'explicit-text' },
        }),
      );
    });

    it('should handle registerPorts failure gracefully', async () => {
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockRegisterPorts.mockImplementation(() => {
        throw new Error('ports error');
      });

      await initApp();
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Ports registration failed'),
        expect.any(Error),
      );
    });

    it('should use legacy agents array as fallback', async () => {
      const config = makeMinimalConfig();
      delete config.agent;
      config.agents = [{ role: 'default', systemPrompt: 'legacy' }];
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(isInitialized()).toBe(true);
    });
  });

  /* ================================================================ */
  /*  Accessor functions after init                                    */
  /* ================================================================ */
  describe('after initialization', () => {
    beforeEach(async () => {
      mocks.mockLoadConfig.mockResolvedValue(makeMinimalConfig());
      await initApp();
    });

    it('getAgent should return the agent', () => {
      expect(getAgent()).toBe(mocks.mockAgent);
    });

    it('getProvider should return the provider', () => {
      const provider = getProvider();
      expect(provider.name).toBe('test-provider');
    });

    it('getModel should return the model', () => {
      expect(getModel()).toBe('test-model');
    });

    it('getConfig_ should return the config', () => {
      expect(getConfig_()).not.toBeNull();
    });

    it('isInitialized should return true', () => {
      expect(isInitialized()).toBe(true);
    });
  });

  /* ================================================================ */
  /*  switchModel                                                      */
  /* ================================================================ */
  describe('switchModel', () => {
    beforeEach(async () => {
      mocks.mockLoadConfig.mockResolvedValue(makeMinimalConfig());
      await initApp();
    });

    it('should switch to a different model', () => {
      const newAgent = { chat: vi.fn() };
      mocks.mockCreateAgent.mockReturnValueOnce(newAgent);

      const result = switchModel('new-model');
      expect(result.model).toBe('new-model');
      expect(result.agent).toBe(newAgent);
    });

    it('should switch to a different provider', () => {
      const newAgent = { chat: vi.fn() };
      mocks.mockCreateAgent.mockReturnValueOnce(newAgent);

      const result = switchModel(undefined, 'test-provider');
      expect(result.provider.name).toBe('test-provider');
    });

    it('should throw if provider not found', () => {
      expect(() => switchModel(undefined, 'nonexistent')).toThrow('Provider not found');
    });

    it('should throw if app not initialized', async () => {
      await resetApp();
      expect(() => switchModel('x')).toThrow('App not initialized');
    });

    it('should use first model from provider if no model specified', () => {
      const newAgent = { chat: vi.fn() };
      mocks.mockCreateAgent.mockReturnValueOnce(newAgent);

      const result = switchModel(undefined, 'test-provider');
      // Falls back to provider.models[0]
      expect(result.model).toBe('test-model');
    });

    it('should update global state after switch', () => {
      const newAgent = { chat: vi.fn() };
      mocks.mockCreateAgent.mockReturnValueOnce(newAgent);

      switchModel('switched-model');
      expect(getModel()).toBe('switched-model');
      expect(getAgent()).toBe(newAgent);
    });
  });

  /* ================================================================ */
  /*  resetApp                                                         */
  /* ================================================================ */
  describe('resetApp', () => {
    it('should reset all state', async () => {
      mocks.mockLoadConfig.mockResolvedValue(makeMinimalConfig());
      await initApp();
      expect(isInitialized()).toBe(true);

      await resetApp();
      expect(isInitialized()).toBe(false);
      expect(getModel()).toBe('');
      expect(getConfig_()).toBeNull();
      expect(getExtractionManager()).toBeNull();
    });

    it('should call shutdownMCP and sandbox shutdown', async () => {
      mocks.mockLoadConfig.mockResolvedValue(makeMinimalConfig());
      await initApp();

      await resetApp();
      expect(mocks.mockShutdownMCP).toHaveBeenCalled();
      expect(mocks.mockSandboxShutdown).toHaveBeenCalled();
      expect(mocks.mockResetHookRunner).toHaveBeenCalled();
    });
  });

  /* ================================================================ */
  /*  buildEmbeddingConfig (tested via initApp paths)                  */
  /* ================================================================ */
  describe('buildEmbeddingConfig via initApp', () => {
    it('should use toolSelector.embedding with role reference', async () => {
      const config = makeMinimalConfig({
        toolSelector: {
          strategy: 'hybrid',
          embedding: {
            role: 'embed-role',
            dims: 1024,
          },
        },
        roles: {
          default: { provider: 'test-provider', model: 'test-model', params: {} },
          'embed-role': { provider: 'test-provider', model: 'embed-model' },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockCreateEmbeddingProvider.mockReturnValue({
        id: 'test', model: 'embed-model', dims: 1024,
        embed: vi.fn(), embedBatch: vi.fn(),
      });

      await initApp();
      expect(mocks.mockCreateEmbeddingProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'openai',
          model: 'embed-model',
          dims: 1024,
        }),
      );
    });

    it('should warn if embedding role not found', async () => {
      const config = makeMinimalConfig({
        toolSelector: {
          embedding: { role: 'nonexistent-role' },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Embedding role "nonexistent-role" not found'),
      );
    });

    it('should warn if provider for embedding role not found', async () => {
      const config = makeMinimalConfig({
        toolSelector: {
          embedding: { role: 'embed-role' },
        },
        roles: {
          default: { provider: 'test-provider', model: 'test-model', params: {} },
          'embed-role': { provider: 'missing-provider', model: 'embed-model' },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Provider "missing-provider" for embedding role not found'),
      );
    });

    it('should use toolSelector.embedding with legacy provider lookup', async () => {
      const config = makeMinimalConfig({
        toolSelector: {
          embedding: {
            provider: 'test-provider',
            model: 'embed-model',
          },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockCreateEmbeddingProvider.mockReturnValue({
        id: 'test', model: 'embed-model', dims: 768,
        embed: vi.fn(), embedBatch: vi.fn(),
      });

      await initApp();
      expect(mocks.mockCreateEmbeddingProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'test-provider',
          apiKey: 'sk-test',
        }),
      );
    });

    it('should use toolSelector.embedding with explicit config', async () => {
      const config = makeMinimalConfig({
        toolSelector: {
          embedding: {
            provider: 'custom',
            apiKey: 'sk-custom',
            baseUrl: 'https://custom.api.com',
            model: 'custom-model',
            dims: 512,
          },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockCreateEmbeddingProvider.mockReturnValue({
        id: 'custom', model: 'custom-model', dims: 512,
        embed: vi.fn(), embedBatch: vi.fn(),
      });

      await initApp();
      expect(mocks.mockCreateEmbeddingProvider).toHaveBeenCalledWith({
        type: 'custom',
        apiKey: 'sk-custom',
        baseUrl: 'https://custom.api.com',
        model: 'custom-model',
        dims: 512,
      });
    });

    it('should fallback to memory.search.vector config', async () => {
      const config = makeMinimalConfig({
        memory: {
          path: '/tmp/test-memory',
          search: {
            vector: {
              enabled: true,
              provider: 'test-provider',
              model: 'vec-model',
              dims: 256,
            },
          },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockCreateEmbeddingProvider.mockReturnValue({
        id: 'vec', model: 'vec-model', dims: 256,
        embed: vi.fn(), embedBatch: vi.fn(),
      });

      await initApp();
      expect(mocks.mockCreateEmbeddingProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'test-provider',
          apiKey: 'sk-test',
          model: 'vec-model',
        }),
      );
    });

    it('should throw if embedding required for semantic strategy but fails', async () => {
      const config = makeMinimalConfig({
        toolSelector: {
          strategy: 'semantic',
          embedding: {
            provider: 'auto',
            apiKey: 'key',
          },
        },
        // No default provider, force buildEmbeddingConfig to return config
        // but createEmbeddingProvider to fail
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockCreateEmbeddingProvider.mockReturnValue(null);

      await expect(initApp()).rejects.toThrow('Embedding provider initialization failed');
    });
  });
});
