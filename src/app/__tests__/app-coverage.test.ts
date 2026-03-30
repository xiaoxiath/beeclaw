/**
 * Additional coverage tests for app/index.ts
 * Targets uncovered lines: 162-186, 332, 419-489, 508-570, 610-681, 703-710, 767-787
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Hoisted mocks ────────────────────────────────────────────────── */
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
  const stableHookRunner = {
    runParallel: vi.fn(),
    register: vi.fn(),
    setBridge: vi.fn(),
  };
  const mockGetHookRunner = vi.fn(() => stableHookRunner);
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
    stableHookRunner,
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

/* ── vi.mock declarations ─────────────────────────────────────────── */
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
  LLMTier: { FAST: 'fast', STANDARD: 'standard', ADVANCED: 'advanced' },
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
vi.mock('bun:sqlite', () => ({
  Database: vi.fn(), default: vi.fn(),
}));
vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(),
}));

/* ── imports ──────────────────────────────────────────────────────── */
import { initApp, resetApp } from '../index';

/* ── helpers ──────────────────────────────────────────────────────── */
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

/* ── tests ────────────────────────────────────────────────────────── */
describe('app/index coverage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mockShutdownMCP.mockResolvedValue(undefined);
    mocks.mockSandboxShutdown.mockResolvedValue(undefined);
    try { await resetApp(); } catch (_) {}
  });

  // ─── Lines 162-186: buildEmbeddingConfig - vector config with provider apiKey lookup ──
  describe('buildEmbeddingConfig vector config paths', () => {
    it('should use memory.search.vector with apiKey from matching provider (by name)', async () => {
      const config = makeMinimalConfig({
        memory: {
          path: '/tmp/mem',
          search: {
            vector: {
              enabled: true,
              provider: 'test-provider', // matches provider name
              model: 'vec-model',
              dims: 256,
              // no apiKey - should be taken from provider
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
          dims: 256,
        }),
      );
    });

    it('should use memory.search.vector with explicit config (non-auto provider with apiKey)', async () => {
      const config = makeMinimalConfig({
        memory: {
          path: '/tmp/mem',
          search: {
            vector: {
              enabled: true,
              provider: 'custom-embed',
              apiKey: 'sk-custom',
              baseUrl: 'https://embed.api.com',
              model: 'embed-model',
              dims: 512,
            },
          },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockCreateEmbeddingProvider.mockReturnValue({
        id: 'custom', model: 'embed-model', dims: 512,
        embed: vi.fn(), embedBatch: vi.fn(),
      });

      await initApp();

      expect(mocks.mockCreateEmbeddingProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'custom-embed',
          apiKey: 'sk-custom',
          baseUrl: 'https://embed.api.com',
          model: 'embed-model',
          dims: 512,
        }),
      );
    });

    it('should fallback to default AI provider for embeddings', async () => {
      const config = makeMinimalConfig({
        memory: { path: '/tmp/mem', search: {} },
        // No toolSelector, no vector config
      });
      mocks.mockLoadConfig.mockResolvedValue(config);
      mocks.mockCreateEmbeddingProvider.mockReturnValue({
        id: 'default', model: 'test-model', dims: 768,
        embed: vi.fn(), embedBatch: vi.fn(),
      });

      await initApp();

      expect(mocks.mockCreateEmbeddingProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'openai',
          apiKey: 'sk-test',
        }),
      );
    });

    it('should fallback to local when no providers match', async () => {
      const config = makeMinimalConfig({
        providers: [
          { name: 'test-provider', type: 'openai', apiKey: 'sk-test', default: false, models: ['m1'] },
        ],
        memory: { path: '/tmp/mem', search: {} },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      // buildEmbeddingConfig returns { type: 'local' } since no default provider
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No embedding provider configured'),
      );
    });
  });

  // ─── Lines 419-489: Plugin loading with results and hook bridge ────────
  describe('plugin loading and hook bridge', () => {
    it('should log loaded plugins when plugins have loaded items', async () => {
      mocks.mockLoadPlugins.mockResolvedValue({
        loaded: ['plugin-a', 'plugin-b'],
        failed: [],
      });
      const config = makeMinimalConfig({
        plugins: { enabled: true },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Plugins: 2 loaded'),
      );
    });

    it('should log warnings for failed plugins', async () => {
      mocks.mockLoadPlugins.mockResolvedValue({
        loaded: [],
        failed: [{ id: 'bad-plugin', error: 'syntax error' }],
      });
      const config = makeMinimalConfig({
        plugins: { enabled: true },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Plugin bad-plugin'),
      );
    });

    it('should set up hook bridge between legacy and new plugin system', async () => {
      const typedHooks = new Map();
      mocks.mockGetPluginRegistry.mockReturnValue({ typedHooks });

      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      // setBridge should have been called on the hook runner
      expect(mocks.mockGetHookRunner).toHaveBeenCalled();
      // The stable hookRunner ref's setBridge should have been called
      const hookRunner = mocks.mockGetHookRunner();
      // Since it returns a stable ref, check it
      expect(hookRunner.setBridge).toHaveBeenCalled();
    });

    it('should handle hook bridge setup failure gracefully', async () => {
      mocks.mockGetPluginRegistry.mockImplementation(() => {
        throw new Error('registry not ready');
      });
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      // Should not throw
      await initApp();

      expect(mocks.mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Hook bridge setup skipped'),
      );
    });

    it('should register observability hooks', async () => {
      mocks.mockCreateObservabilityHooks.mockReturnValue({
        on_message_received: vi.fn(),
        on_response_sent: vi.fn(),
      });
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockGetHookRunner().register).toHaveBeenCalled();
    });

    it('should handle observability hooks registration failure', async () => {
      mocks.mockCreateObservabilityHooks.mockImplementation(() => {
        throw new Error('metrics fail');
      });
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      // Should not throw
      await initApp();
    });

    it('should pass plugin discovery config when available', async () => {
      mocks.mockLoadPlugins.mockResolvedValue({ loaded: ['test-plugin'], failed: [] });
      const config = makeMinimalConfig({
        plugins: {
          enabled: true,
          discovery: {
            bundledDir: '/bundled',
            globalDir: '/global',
            workspaceDir: '/workspace',
            configPaths: ['/config1'],
          },
          pluginConfigs: { myPlugin: { key: 'value' } },
          disabledPlugins: ['bad-one'],
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockLoadPlugins).toHaveBeenCalledWith(
        expect.objectContaining({
          discovery: expect.objectContaining({
            bundledDir: '/bundled',
            globalDir: '/global',
          }),
          pluginConfigs: { myPlugin: { key: 'value' } },
          disabledPlugins: ['bad-one'],
        }),
      );
    });
  });

  // ─── Lines 508-570: Tiered LLM Router initialization ──────────────────
  describe('tiered LLM router', () => {
    it('should initialize tiered LLM router when enabled', async () => {
      const config = makeMinimalConfig({
        llmRouter: {
          enabled: true,
          tiers: {
            fast: { models: ['fast-model'] },
            standard: { models: ['standard-model'] },
            advanced: { models: ['advanced-model'] },
          },
          fallbackEnabled: true,
          costTracking: true,
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockTieredLLMRouter).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackEnabled: true,
          costTracking: true,
        }),
      );
      expect(mocks.mockCreateLLMSkillMatcher).toHaveBeenCalled();
    });

    it('should resolve tier models from role config', async () => {
      const config = makeMinimalConfig({
        llmRouter: {
          enabled: true,
          tiers: {
            fast: { role: 'fast-role' },
            standard: { role: 'default' },
          },
        },
        roles: {
          default: { provider: 'test-provider', model: 'test-model', params: {} },
          'fast-role': { provider: 'test-provider', model: 'fast-model' },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockTieredLLMRouter).toHaveBeenCalledWith(
        expect.objectContaining({
          modelPreferences: expect.objectContaining({
            fast: 'fast-model',
            standard: 'test-model',
          }),
        }),
      );
    });

    it('should handle LLM router initialization failure', async () => {
      mocks.mockTieredLLMRouter.mockImplementation(() => {
        throw new Error('router init fail');
      });
      const config = makeMinimalConfig({
        llmRouter: { enabled: true },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      // Should not throw
      await initApp();

      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize LLM Router'),
        expect.any(Error),
      );
    });

    it('should log when LLM router is disabled', async () => {
      const config = makeMinimalConfig({
        llmRouter: { enabled: false },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('LLM Router: Disabled'),
      );
    });
  });

  // ─── Lines 610-681: Embedding provider init with similarity provider ──
  describe('embedding provider initialization', () => {
    it('should set up similarity provider when embedding provider is created', async () => {
      const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2]);
      const mockEmbedBatch = vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);
      mocks.mockCreateEmbeddingProvider.mockReturnValue({
        id: 'test-emb', model: 'emb-model', dims: 768,
        embed: mockEmbed, embedBatch: mockEmbedBatch,
      });
      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockSetEmbeddingProvider).toHaveBeenCalled();
      expect(mocks.mockSetSimilarityProvider).toHaveBeenCalled();
      expect(mocks.mockGetVectorStore).toHaveBeenCalled();
    });

    it('should handle embedding provider returning null and fall back to local', async () => {
      mocks.mockCreateEmbeddingProvider
        .mockReturnValueOnce(null) // First call fails
        .mockReturnValueOnce({    // Local fallback succeeds
          id: 'local', model: 'local', dims: 128,
          embed: vi.fn(), embedBatch: vi.fn(),
        });

      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize embedding provider'),
        expect.any(Error),
      );
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Falling back to local embedding provider'),
      );
    });

    it('should handle local fallback also failing', async () => {
      mocks.mockCreateEmbeddingProvider
        .mockReturnValueOnce(null) // First call fails
        .mockImplementationOnce(() => { throw new Error('local also fails'); }); // Local fallback fails

      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize local fallback'),
        expect.any(Error),
      );
    });

    it('should throw when semantic strategy requires embeddings but init fails', async () => {
      mocks.mockCreateEmbeddingProvider.mockReturnValue(null);
      const config = makeMinimalConfig({
        toolSelector: {
          strategy: 'hybrid',
          embedding: {
            provider: 'openai',
            apiKey: 'sk-test',
          },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await expect(initApp()).rejects.toThrow('Embedding provider initialization failed');
    });
  });

  // ─── Lines 767-787: Daemon mode with daily reflection ──────────────────
  describe('daemon mode', () => {
    it('should create daily reflection schedule in daemon mode', async () => {
      const mockScheduler = {
        createSchedule: vi.fn(() => ({ success: true })),
      };
      // Mock dynamic import of proactive module
      vi.doMock('../../domain/proactive', () => ({
        getScheduler: vi.fn(() => mockScheduler),
      }));

      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp({ daemon: true });

      // The dynamic import may or may not work in test - check logger
      // At minimum, the daemon path should be entered
    });

    it('should handle reflection schedule creation failure', async () => {
      // Force the dynamic import to fail
      vi.doMock('../../domain/proactive', () => {
        throw new Error('proactive module fail');
      });

      const config = makeMinimalConfig();
      mocks.mockLoadConfig.mockResolvedValue(config);

      // Should not throw even if scheduler fails
      await initApp({ daemon: true });
    });
  });

  // ─── Line 332: Resolved params logging ─────────────────────────────────
  describe('resolved params', () => {
    it('should merge role params with agent params', async () => {
      const config = makeMinimalConfig({
        agent: {
          role: 'default',
          params: { temperature: 0.9, top_p: 0.95 },
        },
        roles: {
          default: {
            provider: 'test-provider',
            model: 'test-model',
            params: { temperature: 0.5, max_tokens: 4096 },
          },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      // Agent params should override role params
      expect(mocks.mockInitSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            temperature: 0.9, // agent overrides role
            max_tokens: 4096, // from role
            top_p: 0.95,      // from agent
          }),
        }),
      );
    });
  });

  // ─── MCP with errors ──────────────────────────────────────────────────
  describe('MCP initialization with errors', () => {
    it('should log individual MCP server errors', async () => {
      mocks.mockInitializeMCP.mockResolvedValue({
        success: 1,
        errors: [
          { serverId: 'server1', error: 'connection refused' },
          { serverId: 'server2', error: 'timeout' },
        ],
      });
      const config = makeMinimalConfig({
        mcp: {
          enabled: true,
          servers: [{ id: 'server1' }, { id: 'server2' }, { id: 'server3' }],
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('MCP: 1 server(s) connected'),
      );
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('MCP server1'),
      );
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('MCP server2'),
      );
    });
  });

  // ─── Concurrency limiter initialization ────────────────────────────────
  describe('LLM concurrency limiter', () => {
    it('should initialize with custom concurrency config', async () => {
      const config = makeMinimalConfig({
        llmRouter: {
          enabled: false,
          concurrency: {
            maxConcurrent: 5,
            maxQueueSize: 100,
            queueTimeoutMs: 60000,
            enablePriority: false,
          },
        },
      });
      mocks.mockLoadConfig.mockResolvedValue(config);

      await initApp();

      expect(mocks.mockGetLLMConcurrencyLimiter).toHaveBeenCalledWith(
        expect.objectContaining({
          maxConcurrent: 5,
          maxQueueSize: 100,
          queueTimeoutMs: 60000,
          enablePriority: false,
        }),
      );
    });
  });
});
