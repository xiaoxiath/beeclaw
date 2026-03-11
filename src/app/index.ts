/**
 * Beeclaw App - Unified Initialization Module
 *
 * Single entry point for both CLI and Bot.
 * All users (just Keith!) get the same experience.
 */

import { join } from 'path';

// Infra layer
import { loadConfig, getConfig, shouldShowTokenStats } from '../infra/config';
import { initStores } from '../infra/db/store';
import { initDataConnection } from '../infra/db/connection';
import { logger } from '../infra/observability/logger';

// Domain layer
import { getMemoryStore } from '../domain/memory';
import { createAgent, getAllToolsForAI, SYSTEM_PROMPTS, buildSystemPrompt } from '../domain/agent';
import { callAI } from '../domain/agent/api';
import { sessionService } from '../domain/session/service';
import { initSessionManager, loadAllSessions, getOrCreateSession, type Session } from '../domain/session';
import { initSubagentRuntime, initTaskOrchestrator, initSharedState } from '../domain/subagent';
import { initializeTimezoneCache, resolveUserLocation, resolveUserTimezone } from '../domain/tools/timezone';
import { setSimilarityProvider } from '../domain/memory/scoring';
import { setCompressionLLMProvider } from '../domain/memory/compression';
import { setEmbeddingProvider, getVectorStore } from '../domain/memory/vector-store';
import { setSummaryLLMProvider } from '../domain/memory/summary-engine';
import { getLifecycleManager } from '../domain/memory/lifecycle-manager';
import { getReflectionEngine } from '../domain/agent/reflection-engine';
import { getSkillDiscoveryEngine } from '../domain/agent/skill-discovery';
import { SandboxManager } from '../domain/sandbox/manager';
import { listSessions, sendProactiveMessage } from '../domain/session';
import { recoverUnansweredSessions } from '../domain/session/recovery';
import { createEmbeddingProvider } from '../domain/memory/embeddings';

// Adapter layer
import { initializeMCP, getMCPManager, shutdownMCP } from '../adapter/mcp';
import { getHookRunner, resetHookRunner } from '../adapter/plugins/hooks';
import { loadPlugins, getPluginRegistry } from '../adapter/plugins';
import { getFeishuWSClient } from '../adapter/feishu';
import { CLIChannel } from '../adapter/cli/channel';
import { FeishuChannel } from '../adapter/feishu/channel';
import { createWebApp } from '../adapter/web/server';

// App layer
import { needsOnboarding, runOnboardingWizard, quickSetup } from './onboarding';
import { getMessageGateway } from './gateway-channel';
import { getTaskDispatcher } from './dispatcher';

// Types
import type { AIProvider, AppConfig } from '../infra/config/schema';
import type { TokenStatsConfig } from '../domain/agent/context';

// Global app state (singleton)
let appState: {
  initialized: boolean;
  config: AppConfig | null;
  provider: AIProvider | null;
  model: string;
  agent: ReturnType<typeof createAgent> | null;
} = {
  initialized: false,
  config: null,
  provider: null,
  model: '',
  agent: null,
};

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

  console.log('🐝 Initializing Beeclaw...');

  // 1. Load configuration
  const config = await loadConfig();
  appState.config = config;

  // 2. Configure logger
  logger.configure({
    level: config.logging.level,
    format: config.logging.format,
  });

  // 3. Configure session service
  sessionService.configure(config.sessionStorage.path);

  // 4. Initialize memory stores
  const memoryPath = options.memoryPath || config.memory.path;
  initStores({ basePath: memoryPath, autoInit: true });
  console.log(`   📁 Memory: ${memoryPath}`);

  // 4.6. Initialize DataConnection (RFC-03: SQLite + Drizzle ORM)
  const dbPath = join(memoryPath, 'beeclaw.db');
  initDataConnection({ path: dbPath, migrate: true });
  console.log(`   🗄️  Database: ${dbPath}`);

  // 4.7. Initialize MessageGateway (RFC-01: MessageChannel/Gateway)
  const gateway = getMessageGateway();

  // Always register CLI channel
  gateway.registerChannel(new CLIChannel());

  // Register Feishu channel if enabled or if Feishu credentials exist
  const shouldRegisterFeishu = config.feishu?.enabled ||
                                (config.feishu?.appId && config.feishu?.appSecret);

  if (shouldRegisterFeishu) {
    try {
      gateway.registerChannel(new FeishuChannel());
      console.log('   📨 Feishu channel registered');
    } catch (error) {
      logger.warn('[App] Failed to register Feishu channel:', error);
    }
  } else {
    console.log('   📨 Feishu channel not registered (no credentials or disabled)');
  }

  const channels = gateway.getRegisteredChannels();
  console.log(`   📨 Gateway: ${channels.join(', ')} channels`);

  // 4.8. Initialize TaskDispatcher (RFC-02: TaskDispatcher)
  const dispatcher = getTaskDispatcher({
    maxConcurrency: 10,
    lockTimeoutMs: 300000, // 5 minutes
    retryAttempts: 3,
    pollIntervalMs: 1000,
  });

  // Start dispatcher
  dispatcher.start();
  console.log(`   ⚡ Dispatcher: Task processing started`);

  // 4.5. Check for onboarding (SOUL.md and USER.md)
  if (needsOnboarding(memoryPath)) {
    console.log('\n🎬 First-time setup detected!');

    // Check if running in interactive mode (TTY)
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

    if (isInteractive) {
      // Run interactive wizard
      await runOnboardingWizard(memoryPath);
    } else {
      // Non-interactive mode (e.g., daemon, bot): use quick setup
      logger.info('Non-interactive mode, using quick setup for onboarding');
      await quickSetup(memoryPath);
      console.log('   📝 Created default SOUL.md and USER.md (quick setup)');
    }
  }

  // 5. Get default provider
  const defaultProvider = config.providers.find(p => p.default);
  if (!defaultProvider) {
    throw new Error('No default AI provider configured');
  }
  appState.provider = defaultProvider;

  // 6. Get model
  const agentConfig = config.agents[0];
  const model = agentConfig?.model || defaultProvider.models[0] || 'glm-4';
  appState.model = model;

  console.log(`   🤖 Provider: ${defaultProvider.name} (${defaultProvider.type})`);
  console.log(`   🎯 Model: ${model}`);

  // 7. Initialize SessionManager for unified session management
  initSessionManager({
    provider: defaultProvider,
    model,
    systemPrompt: agentConfig?.systemPrompt || SYSTEM_PROMPTS.default,
    useTools: true,
    tokenStatsConfig: getTokenStatsConfig(),
  });

  // 8. Load all persisted sessions
  const sessionCount = loadAllSessions();
  if (sessionCount > 0) {
    console.log(`   📬 Sessions: ${sessionCount} loaded from disk`);
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
      console.log(`   🔌 MCP: ${mcpResult.success} server(s) connected`);
    }
    if (mcpResult.errors.length > 0) {
      mcpResult.errors.forEach(e => {
        console.warn(`   ⚠️  MCP ${e.serverId}: ${e.error}`);
      });
    }
  }

  // 9.8. Initialize hook system (built-in hooks)
  const hookRunner = getHookRunner();

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
      console.log(`   🔌 Plugins: ${pluginResult.loaded.length} loaded (${pluginResult.loaded.join(', ')})`);
    }
    if (pluginResult.failed.length > 0) {
      pluginResult.failed.forEach(f => {
        console.warn(`   ⚠️  Plugin ${f.id}: ${f.error}`);
      });
    }
  }

  // 9.10. Initialize timezone cache
  await initializeTimezoneCache();
  const resolvedLocation = resolveUserLocation();
  const resolvedTimezone = resolveUserTimezone();
  console.log(`   📍 Location: ${resolvedLocation} | Timezone: ${resolvedTimezone}`);

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

  // 10.6. [P3 Enhancement] Initialize P3 modules
  // Initialize vector store (optional - requires embedding provider)
  // Create embedding config from default provider
  const embeddingConfig = {
    type: 'auto' as const,
    apiKey: defaultProvider.apiKey,
    baseUrl: defaultProvider.baseUrl,
  };

  const embeddingProvider = createEmbeddingProvider(embeddingConfig);
  if (embeddingProvider) {
    // Adapt embeddings.ts EmbeddingProvider to vector-store.ts EmbeddingProvider
    setEmbeddingProvider({
      embed: (text) => embeddingProvider.embed(text),
      embedBatch: (texts) => embeddingProvider.embedBatch(texts),
      dimensions: embeddingProvider.dims,
      name: embeddingProvider.id,
    });

    // Initialize vector store with memory path
    const vectorStore = getVectorStore({
      basePath: memoryPath,
      autoPersist: true,
    });

    // Load existing index if available
    await vectorStore.load();
  }

  // Initialize lifecycle manager (optional)
  getLifecycleManager({
    basePath: memoryPath,
    autoCleanupIntervalMs: 0, // Disabled by default
  });

  // Initialize reflection engine (optional)
  getReflectionEngine({
    maxConversations: 200,
    minPatternFrequency: 3,
    useLLMReflection: false,
  });

  // Initialize skill discovery engine (optional)
  getSkillDiscoveryEngine({
    minSequenceFrequency: 3,
    minSequenceLength: 2,
    maxSequenceLength: 10,
    intentSimilarityThreshold: 0.8,
    autoPropose: false,
  });

  appState.initialized = true;
  console.log('   ✅ Beeclaw initialized\n');

  // 11.5. Start web server if enabled
  if (config.web?.enabled) {
    const { app } = createWebApp(config.web);

    const port = config.web.port || 3000;
    const host = config.web.host || '0.0.0.0';

    Bun.serve({
      port,
      hostname: host,
      fetch: app.fetch,
      idleTimeout: 255, // Set idle timeout to 255 seconds (max allowed by Bun) for SSE streaming
    });

    console.log(`   🌐 Web UI: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  }

  // 11. Session recovery (delayed execution)
  if (options.enableRecovery !== false && process.env.ENABLE_RECOVERY !== 'false') {
    const recoveryConfig = config.recovery || {
      enabled: true,
      maxAge: 300000,  // 5 minutes
      minAge: 10000,   // 10 seconds
      channels: ['feishu'],
      batchSize: 5,
      delayMs: 2000,
      startupDelay: 10000,
    };

    if (recoveryConfig.enabled) {
      console.log(`   ⏰ Session recovery enabled (delay: ${recoveryConfig.startupDelay / 1000}s)`);

      setTimeout(async () => {
        await recoverUnansweredSessions(recoveryConfig, {
          getFeishuClient: getFeishuWSClient,
          sendProactiveMessage,
          getAllSessions: () => listSessions(),
        });
      }, recoveryConfig.startupDelay);
    }
  }

  // 10. Initialize sandbox system
  const sandboxConfig = (config as any).sandbox || {};

  if (sandboxConfig.enabled) {
    const sandboxManager = SandboxManager.getInstance();
    await sandboxManager.initialize(sandboxConfig);
    const stats = sandboxManager.getStats();
    console.log(`   🔒 Sandbox: ${stats.providers.join(', ')} provider(s) ready`);
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
  const agentConfig = appState.config.agents[0];
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
