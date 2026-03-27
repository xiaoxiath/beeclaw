/**
 * Beeclaw App - Unified Initialization Module
 *
 * Single entry point for both CLI and Bot.
 * All users (just Keith!) get the same experience.
 */

import { join } from 'path';

// Infra layer
import { loadConfig, shouldShowTokenStats } from '../infra/config';
import { setHookNotifier } from '../infra/config/hot-reload';
import { bootstrapStores } from './bootstrap-stores';
import { initDataConnection } from '../infra/db/connection';
import { logger } from '../infra/observability/logger';
import { Observability, createObservabilityHooks } from '../infra/observability/metrics';

// Domain layer
import { createAgent, getAllToolsForAI, SYSTEM_PROMPTS } from '../domain/agent';
import { callAI } from '../domain/agent/api';
import { initSessionManager, loadAllSessions } from '../domain/session';
import { initSubagentRuntime, initTaskOrchestrator, initSharedState } from '../domain/subagent';
import { initializeTimezoneCache, resolveUserLocation, resolveUserTimezone } from '../domain/tools/timezone';
import { setCompressionLLMProvider } from '../domain/memory/compression';
import { configureTieredCompressor } from '../domain/agent/compression';
import { setEmbeddingProvider, getVectorStore, cosineSimilarity } from '../domain/memory/vector-store';
import { setSimilarityProvider } from '../domain/memory/scoring';
import { getLifecycleManager } from '../domain/memory/lifecycle-manager';
import { getReflectionEngine } from '../domain/agent/reflection-engine';
import { getSkillDiscoveryEngine } from '../domain/agent/skill-discovery';
import { initExtractionManager, type ExtractionManager } from '../domain/extraction';
import { SandboxManager } from '../domain/sandbox/manager';
import { createEmbeddingProvider } from '../domain/memory/embeddings';
import { TieredLLMRouter } from '../infra/ai/tiered-router';
import { getLLMConcurrencyLimiter } from '../infra/ai/concurrency-limiter';
import { getHybridToolSelector } from '../domain/agent/hybrid-tool-selector';
import { createLLMSkillMatcher } from '../domain/skills/llm-matcher';
import { getSkillStore } from '../domain/skills';
import { resolveConfig } from '../infra/config/resilience-config';

// Adapter layer
import { initializeMCP, shutdownMCP, getMCPManager } from '../adapter/mcp';
import { getHookRunner, resetHookRunner } from '../adapter/plugins/hooks';
import { registerPorts } from '../domain/ports';
import { loadPlugins, getPluginRegistry } from '../adapter/plugins';
import { getFeishuWSClient } from '../adapter/feishu';
import { CLIChannel } from '../adapter/cli/channel';
import { StreamingMessageController } from '../adapter/feishu/card-v2/streaming-controller';

// App layer
import { needsOnboarding, runOnboardingWizard, quickSetup } from './onboarding';
import { getMessageGateway } from './gateway-channel';
import { getTaskDispatcher } from './dispatcher';
import { bootstrapHealthCheck } from './bootstrap-health';

// Types
import type { AIProvider, AppConfig } from '../infra/config/schema';
import type { TokenStatsConfig } from '../domain/agent/context';
import type { EmbeddingProviderConfig } from '../domain/memory/embeddings';

// Global app state (singleton)
let appState: {
  initialized: boolean;
  config: AppConfig | null;
  provider: AIProvider | null;
  model: string;
  agent: ReturnType<typeof createAgent> | null;
  extractionManager: ExtractionManager | null;
} = {
  initialized: false,
  config: null,
  provider: null,
  model: '',
  agent: null,
  extractionManager: null,
};

/**
 * Build Embedding Provider Configuration
 * Priority: toolSelector.embedding > memory.search.vector > default provider > local fallback
 */
function buildEmbeddingConfig(appConfig: AppConfig): EmbeddingProviderConfig | null {
  // 1. Prefer toolSelector.embedding
  if (appConfig.toolSelector?.embedding) {
    const embeddingConfig = appConfig.toolSelector.embedding;

    // v6: Support role reference
    if (embeddingConfig.role) {
      const roleDef = appConfig.roles?.[embeddingConfig.role];
      if (!roleDef) {
        logger.warn(`[App] Embedding role "${embeddingConfig.role}" not found`);
        return null;
      }

      const provider = appConfig.providers?.find((p: any) => p.name === roleDef.provider);
      if (!provider) {
        logger.warn(`[App] Provider "${roleDef.provider}" for embedding role not found`);
        return null;
      }

      logger.info(`[App] Using toolSelector.embedding with role: ${embeddingConfig.role} (provider: ${provider.name})`);
      return {
        type: provider.type,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: roleDef.model,
        dims: embeddingConfig.dims,
      };
    }

    // Legacy: If provider is specified but apiKey is not, try to get from providers
    if (embeddingConfig.provider && embeddingConfig.provider !== 'auto' && !embeddingConfig.apiKey) {
      const provider = appConfig.providers?.find((p: any) =>
        p.name === embeddingConfig.provider || p.type === embeddingConfig.provider
      );

      if (provider) {
        logger.info(`[App] Using toolSelector.embedding with apiKey from provider: ${provider.name}`);
        return {
          type: embeddingConfig.provider,
          apiKey: provider.apiKey,
          baseUrl: embeddingConfig.baseUrl || provider.baseUrl,
          model: embeddingConfig.model,
          dims: embeddingConfig.dims,
        };
      }
    }

    logger.info('[App] Using toolSelector.embedding config');
    return {
      type: embeddingConfig.provider || 'auto',
      apiKey: embeddingConfig.apiKey,
      baseUrl: embeddingConfig.baseUrl,
      model: embeddingConfig.model,
      dims: embeddingConfig.dims,
    };
  }

  // 2. Fallback to memory.search.vector
  if (appConfig.memory?.search?.vector?.enabled !== false) {
    const vectorConfig = appConfig.memory?.search?.vector;

    // If provider is specified but apiKey is not, try to get from providers
    if (vectorConfig?.provider && vectorConfig.provider !== 'auto' && !vectorConfig.apiKey) {
      const provider = appConfig.providers?.find((p: any) =>
        p.name === vectorConfig.provider || p.type === vectorConfig.provider
      );

      if (provider) {
        logger.info(`[App] Using memory.search.vector with apiKey from provider: ${provider.name}`);
        return {
          type: vectorConfig.provider,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          model: vectorConfig.model,
          dims: vectorConfig.dims,
        };
      }
    }

    if (vectorConfig && vectorConfig.provider !== 'auto') {
      logger.info('[App] Using memory.search.vector config for embeddings');
      return {
        type: vectorConfig.provider,
        apiKey: vectorConfig.apiKey,
        baseUrl: vectorConfig.baseUrl,
        model: vectorConfig.model,
        dims: vectorConfig.dims,
      };
    }
  }

  // 3. Fallback to default AI provider
  const defaultProvider = appConfig.providers?.find((p: any) => p.default);
  if (defaultProvider) {
    logger.info(`[App] Using default AI provider (${defaultProvider.type}) for embeddings`);
    return {
      type: defaultProvider.type as any,
      apiKey: defaultProvider.apiKey,
      baseUrl: defaultProvider.baseUrl,
    };
  }

  // 4. Final fallback to local
  logger.warn('[App] No embedding provider configured, using local fallback');
  return { type: 'local' };
}

/**
 * Get token stats config from unified config
 */
export function getTokenStatsConfig(): Partial<TokenStatsConfig> {
  return { showTokenStats: shouldShowTokenStats() };
}

export interface InitOptions {
  /** Enable daemon mode for proactive scheduling */
  daemon?: boolean;
  /** Custom memory path */
  memoryPath?: string;
  /** Enable session recovery on startup */
  enableRecovery?: boolean;
}

/**
 * Initialize Beeclaw app (call once at startup)
 */
export async function initApp(options: InitOptions = {}): Promise<{
  config: AppConfig;
  provider: AIProvider;
  model: string;
  agent: ReturnType<typeof createAgent>;
}> {
  if (appState.initialized) {
    return {
      config: appState.config!,
      provider: appState.provider!,
      model: appState.model,
      agent: appState.agent!,
    };
  }

  logger.debug('🐝 Initializing Beeclaw...');

  // 1. Load configuration
  const config = await loadConfig();
  appState.config = config;

  // 2. Configure logger
  logger.configure({
    level: config.logging.level,
    format: config.logging.format,
  });

  // 2.5. Initialize observability system (D-P0-01)
  Observability.configure({
    level: config.logging.level as any || 'info',
    structured: config.logging.format === 'json',
    tracingEnabled: true,
    metricsEnabled: true,
  });
  logger.debug('   📊 Observability: metrics and tracing initialized');

  // 3. Initialize memory stores
  const memoryPath = options.memoryPath || config.memory.path;
  bootstrapStores({ basePath: memoryPath, autoInit: true });
  logger.debug(`   📁 Memory: ${memoryPath}`);

  // 4.6. Initialize DataConnection (RFC-03: SQLite + Drizzle ORM)
  const dbPath = join(memoryPath, 'beeclaw.db');
  initDataConnection({ path: dbPath, migrate: true });
  logger.debug(`   🗄️  Database: ${dbPath}`);

  // 4.7. Initialize MessageGateway (RFC-01: MessageChannel/Gateway)
  const gateway = getMessageGateway();

  // Always register CLI channel
  gateway.registerChannel(new CLIChannel());

  // Register Feishu channel if enabled or if Feishu credentials exist
  const shouldRegisterFeishu = config.feishu?.enabled ||
                                (config.feishu?.appId && config.feishu?.appSecret);

  if (shouldRegisterFeishu) {
    // FeishuChannel will be registered by FeishuAdapter (avoid duplicate registration)
    logger.debug('   📨 Feishu channel will be registered by adapter');
  } else {
    logger.debug('   📨 Feishu channel not registered (no credentials or disabled)');
  }

  const channels = gateway.getRegisteredChannels();
  logger.debug(`   📨 Gateway: ${channels.join(', ')} channels`);

  // 4.8. Initialize TaskDispatcher (RFC-02: TaskDispatcher)
  const dispatcher = getTaskDispatcher({
    maxConcurrency: 10,
    lockTimeoutMs: 300000, // 5 minutes
    retryAttempts: 3,
    pollIntervalMs: 1000,
  });

  // Start dispatcher
  dispatcher.start();
  logger.info(`   ⚡ Dispatcher: Task processing started`);

  // 4.5. Check for onboarding (SOUL.md and USER.md)
  if (needsOnboarding(memoryPath)) {
    logger.debug('\n🎬 First-time setup detected!');

    // Check if running in interactive mode (TTY)
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

    if (isInteractive) {
      // Run interactive wizard
      await runOnboardingWizard(memoryPath);
    } else {
      // Non-interactive mode (e.g., daemon, bot): use quick setup
      logger.info('Non-interactive mode, using quick setup for onboarding');
      await quickSetup(memoryPath);
      logger.info('   📝 Created default SOUL.md and USER.md (quick setup)');
    }
  }

  // 5. Get agent config (v6: single agent)
  const agentConfig = config.agent || config.agents?.[0];  // Fallback to legacy agents array
  if (!agentConfig) {
    throw new Error('No agent configured');
  }

  // 6. Resolve role reference to get provider and model (v6)
  const roleName = agentConfig.role;
  const roleDef = config.roles[roleName];
  if (!roleDef) {
    throw new Error(`Role "${roleName}" not found in configuration`);
  }

  const defaultProvider = config.providers.find(p => p.name === roleDef.provider);
  if (!defaultProvider) {
    throw new Error(`Provider "${roleDef.provider}" not found`);
  }

  const model = roleDef.model;
  appState.provider = defaultProvider;
  appState.model = model;

  logger.debug(`   🤖 Provider: ${defaultProvider.name} (${defaultProvider.type})`);
  logger.debug(`   🎯 Model: ${model}`);

  // Merge role params with agent params (agent overrides role)
  const resolvedParams = { ...roleDef.params, ...agentConfig.params };
  if (resolvedParams && Object.keys(resolvedParams).length > 0) {
    logger.debug(`   ⚙️  Resolved params:`, resolvedParams);
  }

  // Resolve vision configuration (v6: role reference pattern)
  // Priority: visionConfig > visionRole > agent's model
  let resolvedVisionConfig: any = undefined;

  if (agentConfig.visionConfig) {
    // 1. Explicit visionConfig (highest priority)
    resolvedVisionConfig = agentConfig.visionConfig;
    logger.debug(`   👁️  Vision config: explicit configuration`);
  } else if (agentConfig.visionRole && config.roles[agentConfig.visionRole]) {
    // 2. Vision role reference
    const visionRoleDef = config.roles[agentConfig.visionRole];
    const visionProvider = config.providers.find(p => p.name === visionRoleDef.provider);

    if (visionProvider && visionRoleDef.model) {
      resolvedVisionConfig = {
        visionModel: visionRoleDef.model, // Use vision role's model
        textModel: model, // Use agent's model for intent detection
        visionSystemPrompt: undefined, // Use default
      };
      logger.debug(`   👁️  Vision role: ${agentConfig.visionRole} (${visionRoleDef.model})`);
    }
  }
  // 3. Default: use agent's model for both vision and text (handled in session/index.ts)

  // 7. Initialize SessionManager for unified session management
  // Get resilience config for timeout alignment
  const resilienceConfig = resolveConfig('standard');

  initSessionManager({
    provider: defaultProvider,
    model,
    systemPrompt: agentConfig.systemPrompt || SYSTEM_PROMPTS.default,
    useTools: true,
    tokenStatsConfig: getTokenStatsConfig(),
    visionConfig: resolvedVisionConfig,
    // Pass resolved params from role + agent configuration
    params: resolvedParams,
    // Pass resilience config for timeout alignment
    resilienceConfig,
  });

  // 8. Load all persisted sessions
  const sessionCount = loadAllSessions();
  if (sessionCount > 0) {
    logger.info(`   📬 Sessions: ${sessionCount} loaded from disk`);
  }

  // 9. Initialize subagent runtime
  initSubagentRuntime({
    provider: defaultProvider,
    model,
  });

  // 9.5. Initialize task orchestrator
  initTaskOrchestrator({
    provider: defaultProvider,
    model,
  });

  // 9.6. Initialize shared state for subagent collaboration
  initSharedState({
    enableAutoCleanup: true,
    cleanupInterval: 60000, // Clean up every minute
    defaultTtl: 3600000, // Default TTL: 1 hour
  });

  // 9.7. Initialize MCP connections
  if (config.mcp?.enabled && config.mcp.servers?.length > 0) {
    const mcpResult = await initializeMCP(config.mcp);
    if (mcpResult.success > 0) {
      logger.info(`   🔌 MCP: ${mcpResult.success} server(s) connected`);
    }
    if (mcpResult.errors.length > 0) {
      mcpResult.errors.forEach(e => {
        logger.warn(`   ⚠️  MCP ${e.serverId}: ${e.error}`);
      });
    }
  }

  // 9.8. Initialize hook system (built-in hooks)
  const _hookRunner = getHookRunner();

  // 9.8.1. Wire hot-reload -> hook system via dependency inversion
  setHookNotifier(async (event, data, context) => {
    const hookRunner = getHookRunner();
    await hookRunner.runParallel(event as any, data, context);
  });

  // 9.9. Load plugins (OpenClaw-compatible)
  if (config.plugins?.enabled !== false) {
    const pluginResult = await loadPlugins({
      discovery: config.plugins?.discovery ? {
        bundledDir: config.plugins.discovery.bundledDir,
        globalDir: config.plugins.discovery.globalDir,
        workspaceDir: config.plugins.discovery.workspaceDir,
        configPaths: config.plugins.discovery.configPaths,
      } : undefined,
      pluginConfigs: config.plugins?.pluginConfigs,
      disabledPlugins: config.plugins?.disabledPlugins,
    });

    if (pluginResult.loaded.length > 0) {
      logger.info(`   🔌 Plugins: ${pluginResult.loaded.length} loaded (${pluginResult.loaded.join(', ')})`);
    }
    if (pluginResult.failed.length > 0) {
      pluginResult.failed.forEach(f => {
        logger.warn(`   ⚠️  Plugin ${f.id}: ${f.error}`);
      });
    }
  }


  // 9.9.1. Bridge legacy HookRunner to new plugin-registry-based hook system
  // so that hooks registered via registerHook() are also visible to createHookRunner(registry)
  try {
    const registry = getPluginRegistry();
    _hookRunner.setBridge((hookName: string, handler: Function, priority: number) => {
      if (!registry.typedHooks.has(hookName as any)) {
        registry.typedHooks.set(hookName as any, []);
      }
      const list = registry.typedHooks.get(hookName as any)!;
      list.push({
        pluginId: 'legacy-bridge',
        hookName: hookName as any,
        handler: handler as any,
        priority,
      });
      list.sort((a: any, b: any) => (b.priority ?? 0) - (a.priority ?? 0));
    });
    logger.debug('   🔗 Hook bridge: legacy -> new system connected');
  } catch (e) {
    logger.debug('   ⚠️  Hook bridge setup skipped (registry not ready)');
  }
  // 9.9.1.5. Register observability hooks (D-P0-01)
  try {
    const obsHooks = createObservabilityHooks();
    for (const [hookName, handler] of Object.entries(obsHooks)) {
      _hookRunner.register(hookName as any, handler as any);
    }
    logger.debug('   📊 Observability hooks registered');
  } catch (e) {
    logger.debug('   ⚠️  Observability hooks registration skipped:', e);
  }

  // 9.9.2. Register domain port implementations (dependency inversion)
  try {
    registerPorts({
      mcpManager: () => getMCPManager(),
      pluginRegistry: () => getPluginRegistry(),
      hookRunnerFactory: (registry) => {
        const { createHookRunner } = require('../adapter/plugins/hooks');
        return createHookRunner(registry);
      },
      channelClient: () => getFeishuWSClient(),
      messageControllerFactory: (options) => new StreamingMessageController(options),
    });
    logger.debug('   🔌 Ports: domain port implementations registered');
  } catch (e) {
    logger.warn('   ⚠️  Ports registration failed:', e);
  }

  // 9.10. Initialize timezone cache
  await initializeTimezoneCache();
  const resolvedLocation = resolveUserLocation();
  const resolvedTimezone = resolveUserTimezone();
  logger.debug(`   📍 Location: ${resolvedLocation} | Timezone: ${resolvedTimezone}`);

  // 9.11. [V2 FIX] Bootstrap health check system
  bootstrapHealthCheck();
  logger.info(`   🏥 Health Check: Initialized and monitoring data sources`);

  // 9.12. Initialize Tiered LLM Router
  if (config.llmRouter?.enabled !== false) {
    try {
      // Helper function to resolve model name from tier config
      const resolveTierModel = (tierKey: string): string | undefined => {
        const tierConfig = config.llmRouter?.tiers?.[tierKey];
        if (!tierConfig) return undefined;

        // If models array is specified directly (legacy format)
        if (tierConfig.models && tierConfig.models.length > 0) {
          return tierConfig.models[0];
        }

        // If role is specified (v4 format), resolve from roles config
        if (tierConfig.role && config.roles?.[tierConfig.role]) {
          return config.roles[tierConfig.role].model;
        }

        return undefined;
      };

      // Create tiered router
      const router = new TieredLLMRouter({
        provider: defaultProvider,
        modelPreferences: config.llmRouter?.tiers ? {
          fast: resolveTierModel('fast'),
          standard: resolveTierModel('standard'),
          advanced: resolveTierModel('advanced'),
        } : undefined,
        fallbackEnabled: config.llmRouter?.fallbackEnabled ?? true,
        costTracking: config.llmRouter?.costTracking ?? true,
      });

      // Create LLM skill matcher
      const llmMatcher = createLLMSkillMatcher({
        provider: {
          chat: async (messages, _options) => {
            // Use standard tier for skill matching
            const model = router.selectModelForTier('standard');

            const response = await callAI({
              provider: defaultProvider,
              model,
              messages,
              temperature: 0.3,
              maxTokens: 500,
            });

            return response.choices[0]?.message?.content || '';
          },
        },
      });

      // Set matcher in skill store
      const skillStore = getSkillStore();
      skillStore.setLLMMatcher(llmMatcher);

      // Log configuration
      const fastModel = router.selectModelForTier('fast');
      const standardModel = router.selectModelForTier('standard');
      const advancedModel = router.selectModelForTier('advanced');

      logger.debug(`   🎚️  LLM Router: Tiered system enabled`);
      logger.debug(`      FAST: ${fastModel} | STANDARD: ${standardModel} | ADVANCED: ${advancedModel}`);
      logger.debug(`      Skill matching: LLM-enhanced matching enabled`);
    } catch (error) {
      logger.warn('[App] Failed to initialize LLM Router, falling back to default:', error);
      logger.debug(`   ⚠️  LLM Router: Using default model for all tasks`);
    }
  } else {
    logger.debug(`   ℹ️  LLM Router: Disabled (using default model for all tasks)`);
  }

  // 9.13. Initialize LLM Concurrency Limiter
  {
    const concurrencyConfig = config.llmRouter?.concurrency;
    const limiter = getLLMConcurrencyLimiter({
      maxConcurrent: concurrencyConfig?.maxConcurrent ?? 2,
      maxQueueSize: concurrencyConfig?.maxQueueSize ?? 50,
      queueTimeoutMs: concurrencyConfig?.queueTimeoutMs ?? 30000,
      enablePriority: concurrencyConfig?.enablePriority ?? true,
    });
    const stats = limiter.getStats();
    logger.info(`   🚦 LLM Concurrency: max=${stats.maxConcurrent}, queue=${concurrencyConfig?.maxQueueSize ?? 50}, priority=${concurrencyConfig?.enablePriority ?? true}`);
  }

  // 10. Create agent (singleton)
  const agent = createAgent({
    provider: defaultProvider,
    model,
    systemPrompt: agentConfig?.systemPrompt || SYSTEM_PROMPTS.default,
    temperature: agentConfig?.temperature,
    maxTokens: agentConfig?.maxTokens,
    tools: getAllToolsForAI(),
    loadCoreMemory: true,
    autoRefreshMemory: true,
    tokenStatsConfig: getTokenStatsConfig(),
  });
  appState.agent = agent;

  // 10.5. [P1 Enhancement] Initialize optional providers for enhanced features
  // Configure LLM provider for intelligent memory compression
  setCompressionLLMProvider({
    async chat(messages, maxTokens = 500) {
      const response = await callAI({
        provider: defaultProvider,
        model: 'glm-4-flash', // Use cheap/fast model for compression
        messages: messages as any,
        maxTokens,
      });
      return response.choices[0]?.message?.content || '';
    },
  });

  // [Context Compression] Configure LLM provider for context compression
  configureTieredCompressor({
    async complete(prompt, maxTokens = 500) {
      const response = await callAI({
        provider: defaultProvider,
        model: 'glm-4-flash', // Use cheap/fast model for compression
        messages: [{ role: 'user', content: prompt }],
        maxTokens,
      });
      return response.choices[0]?.message?.content || '';
    },
  });
  logger.info('[App] Context compression system initialized');

  // 10.6. [P3 Enhancement] Initialize P3 modules
  // Initialize embedding provider for tool selector and vector store
  const embeddingConfig = buildEmbeddingConfig(config);
  if (embeddingConfig) {
    try {
      const embeddingProvider = createEmbeddingProvider(embeddingConfig);

      if (!embeddingProvider) {
        throw new Error('Failed to create embedding provider with config: ' + JSON.stringify(embeddingConfig));
      }

      // Adapt embeddings.ts EmbeddingProvider to vector-store.ts EmbeddingProvider
      setEmbeddingProvider({
        embed: (text) => embeddingProvider.embed(text),
        embedBatch: (texts) => embeddingProvider.embedBatch(texts),
        dimensions: embeddingProvider.dims,
        name: embeddingProvider.id,
      });

      logger.info(
        `[App] Embedding provider initialized: ${embeddingProvider.id} ` +
        `(model: ${embeddingProvider.model}, dims: ${embeddingProvider.dims})`
      );

      // Initialize vector store with memory path
      const vectorStore = getVectorStore({
        basePath: memoryPath,
        autoPersist: true,
      });

      // Load existing index if available
      await vectorStore.load();

      // Mount embedding-based similarity provider for memory scoring
      setSimilarityProvider({
        async computeSimilarity(text1: string, text2: string): Promise<number> {
          const [emb1, emb2] = await Promise.all([
            embeddingProvider.embed(text1),
            embeddingProvider.embed(text2),
          ]);
          return cosineSimilarity(emb1, emb2);
        },
        async batchComputeSimilarity(query: string, texts: string[]): Promise<number[]> {
          const [queryEmb, textEmbs] = await Promise.all([
            embeddingProvider.embed(query),
            embeddingProvider.embedBatch(texts),
          ]);
          return textEmbs.map(emb => cosineSimilarity(queryEmb, emb));
        },
      });
      logger.info('[App] Similarity provider mounted for memory scoring');
    } catch (error) {
      logger.error('[App] Failed to initialize embedding provider', error);

      // If semantic matching is enabled, but embedding initialization failed, throw error
      if (config.toolSelector?.strategy === 'semantic' ||
          config.toolSelector?.strategy === 'hybrid') {
        throw new Error(
          'Embedding provider initialization failed but required for tool selector strategy. ' +
          'Please check your embedding configuration or switch to "all"/"layered" strategy.'
        );
      }

      // Otherwise, use local fallback
      logger.warn('[App] Falling back to local embedding provider');
      try {
        const localProvider = createEmbeddingProvider({ type: 'local' });
        if (localProvider) {
          setEmbeddingProvider({
            embed: (text) => localProvider.embed(text),
            embedBatch: (texts) => localProvider.embedBatch(texts),
            dimensions: localProvider.dims,
            name: localProvider.id,
          });
        }
      } catch (fallbackError) {
        logger.error('[App] Failed to initialize local fallback', fallbackError);
      }
    }
  }

  // Initialize lifecycle manager (optional)
  getLifecycleManager({
    basePath: memoryPath,
    autoCleanupIntervalMs: 86400000, // Clean up every 24 hours
  });

  // Initialize HybridToolSelector with config
  if (config.toolSelector) {
    getHybridToolSelector({
      strategy: (config.toolSelector.strategy as any) || 'hybrid',
      maxTools: config.toolSelector.maxTools || 30,
      rulesEnabled: config.toolSelector.rules?.enabled !== false,
      semanticEnabled: config.toolSelector.semantic?.enabled !== false,
      fallbackToCore: config.toolSelector.semantic?.fallbackToCore !== false,
    });
    logger.info(`[App] HybridToolSelector initialized with strategy: ${config.toolSelector.strategy || 'hybrid'}`);
  }

  // Initialize reflection engine (optional)
  getReflectionEngine({
    maxConversations: 200,
    minPatternFrequency: 3,
    useLLMReflection: true, // Enable LLM-based reflection
  });

  // Initialize skill discovery engine (optional)
  getSkillDiscoveryEngine({
    minSequenceFrequency: 3,
    minSequenceLength: 2,
    maxSequenceLength: 10,
    intentSimilarityThreshold: 0.8,
    autoPropose: true, // Enable automatic skill proposal
  });

  // Initialize extraction manager (optional)
  if (config.extraction?.enabled) {
    try {
      const extractionManager = initExtractionManager(
        defaultProvider,
        model,
        memoryPath,
        config.extraction
      );
      appState.extractionManager = extractionManager;
      logger.debug(`   🧠 Extraction: enabled (interval: ${config.extraction.periodicInterval || 10} rounds)`);
    } catch (error) {
      logger.error('[App] Failed to initialize extraction manager', error);
    }
  }

  // Initialize daily reflection task (if daemon mode)
  if (options.daemon || process.env.DAEMON_MODE === 'true') {
    try {
      const { getScheduler } = await import('../domain/proactive');
      const scheduler = getScheduler(join(memoryPath, '../proactive'));

      // Create daily reflection schedule
      const result = scheduler.createSchedule({
        name: 'Daily Reflection',
        description: 'Analyze conversation patterns and suggest improvements daily at 3 AM',
        cron: '0 3 * * *',
        taskType: 'custom',
        taskParams: {
          action: 'daily-reflection',
        },
      });

      if (result.success) {
        logger.info(`   🔍 Daily reflection task created (runs at 3:00 AM)`);
      }
    } catch (error) {
      logger.error('[App] Failed to create reflection schedule', error);
    }
  }

  appState.initialized = true;
  logger.info('   ✅ Beeclaw initialized\n');

  // 11.5. Web server is now started by WebAdapter (not here)
  // See: src/adapter/web/adapter.ts and src/entries/web.ts
  // 10. Initialize sandbox system
  const sandboxConfig = (config as any).sandbox || {};

  if (sandboxConfig.enabled) {
    const sandboxManager = SandboxManager.getInstance();
    await sandboxManager.initialize(sandboxConfig);
    const stats = sandboxManager.getStats();
    logger.debug(`   🔒 Sandbox: ${stats.providers.join(', ')} provider(s) ready`);
  }

  return {
    config,
    provider: defaultProvider,
    model,
    agent,
  };
}

/**
 * Get the global agent instance
 */
export function getAgent(): ReturnType<typeof createAgent> {
  if (!appState.agent) {
    throw new Error('App not initialized. Call initApp() first.');
  }
  return appState.agent;
}

/**
 * Get the current provider
 */
export function getProvider(): AIProvider {
  if (!appState.provider) {
    throw new Error('App not initialized. Call initApp() first.');
  }
  return appState.provider;
}

/**
 * Get the current model
 */
export function getModel(): string {
  return appState.model;
}

/**
 * Get the extraction manager (if enabled)
 */
export function getExtractionManager(): ExtractionManager | null {
  return appState.extractionManager;
}

/**
 * Get the loaded config
 */
export function getConfig_(): AppConfig | null {
  return appState.config;
}

/**
 * Switch to a different model
 */
export function switchModel(modelName?: string, providerName?: string): {
  provider: AIProvider;
  model: string;
  agent: ReturnType<typeof createAgent>;
} {
  if (!appState.config) {
    throw new Error('App not initialized');
  }

  // Find provider
  let newProvider = appState.provider;
  if (providerName) {
    const found = appState.config.providers.find(
      (p: AIProvider) => p.name.toLowerCase() === providerName.toLowerCase()
    );
    if (!found) {
      throw new Error(`Provider not found: ${providerName}`);
    }
    newProvider = found;
  }

  // Get model
  const newModel = modelName || newProvider?.models[0] || appState.model;

  // Recreate agent
  const agentConfig = appState.config.agent || appState.config.agents?.[0];
  const agent = createAgent({
    provider: newProvider!,
    model: newModel,
    systemPrompt: agentConfig?.systemPrompt || SYSTEM_PROMPTS.default,
    temperature: agentConfig?.temperature,
    maxTokens: agentConfig?.maxTokens,
    tools: getAllToolsForAI(),
    loadCoreMemory: true,
    autoRefreshMemory: true,
    tokenStatsConfig: getTokenStatsConfig(),
  });

  // Update state
  appState.provider = newProvider;
  appState.model = newModel;
  appState.agent = agent;

  return { provider: newProvider!, model: newModel, agent };
}

/**
 * Reset app state (for testing)
 */
export async function resetApp(): Promise<void> {
  // Shutdown MCP connections
  await shutdownMCP();

  // Shutdown sandbox
  await SandboxManager.getInstance().shutdown();

  // Reset hook runner
  resetHookRunner();

  appState = {
    initialized: false,
    config: null,
    provider: null,
    model: '',
    agent: null,
    extractionManager: null,
  };
}

/**
 * Check if app is initialized
 */
export function isInitialized(): boolean {
  return appState.initialized;
}

// Re-export session functions for CLI and Bot
export {
  getOrCreateSession,
  getSession,
  listSessions,
  deleteSession,
  getSessionStats,
  continueConversation,
  type Session,
  type SessionOptions,
} from '../domain/session';
