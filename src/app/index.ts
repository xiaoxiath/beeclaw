/**
 * Beeclaw App - Unified Initialization Module
 *
 * Single entry point for both CLI and Bot.
 * All users (just Keith!) get the same experience.
 */

import { loadConfig, getConfig, shouldShowTokenStats } from '../config';
import { initStores } from '../store';
import { getMemoryStore } from '../memory';
import { createAgent, getAllToolsForAI, SYSTEM_PROMPTS, buildSystemPrompt } from '../agent';
import { sessionService } from '../services/session';
import { initSessionManager, loadAllSessions, getOrCreateSession, type Session } from '../session';
import { initSubagentRuntime, initTaskOrchestrator, initSharedState } from '../subagent';
import { initializeMCP, getMCPManager, shutdownMCP } from '../mcp';
import { getHookRunner, resetHookRunner } from '../hooks';
import { loadPlugins, getPluginRegistry } from '../plugins';
import { logger } from '../utils/logger';
import { needsOnboarding, runOnboardingWizard, quickSetup } from './onboarding';
import type { AIProvider, AppConfig } from '../config/schema';
import type { TokenStatsConfig } from '../agent/context';

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

  // 4.5. Check for onboarding (SOUL.md and USER.md)
  if (needsOnboarding(memoryPath)) {
    console.log('\n🎬 First-time setup detected!');

    // Check if running in interactive mode (TTY)
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

    if (isInteractive) {
      try {
        // Run interactive wizard
        await runOnboardingWizard(memoryPath);
      } catch (error) {
        logger.warn('Onboarding wizard failed, using quick setup:', error);
        // Fallback to quick setup with defaults
        await quickSetup(memoryPath);
      }
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
  // Note: Custom hooks can be registered via config.hooks later

  // 9.9. Load plugins (OpenClaw-compatible)
  if (config.plugins?.enabled !== false) {
    try {
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
    } catch (error) {
      console.warn('   ⚠️  Plugin system initialization failed:', error);
    }
  }

  // 9.10. Initialize timezone cache (derive timezone from location if needed)
  try {
    const { initializeTimezoneCache, resolveUserLocation, resolveUserTimezone } = await import('../utils/timezone');
    await initializeTimezoneCache();

    // Display resolved location and timezone
    const resolvedLocation = resolveUserLocation();
    const resolvedTimezone = resolveUserTimezone();
    console.log(`   📍 Location: ${resolvedLocation} | Timezone: ${resolvedTimezone}`);
  } catch (error) {
    logger.warn('Failed to initialize timezone cache:', error);
    // Non-fatal error, continue with default timezone
    console.log('   📍 Location: 北京 | Timezone: Asia/Shanghai (default)');
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

  appState.initialized = true;
  console.log('   ✅ Beeclaw initialized\n');

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
        try {
          const { recoverUnansweredSessions } = await import('../session/recovery');
          const { listSessions } = await import('../session');
          const { getFeishuWSClient } = await import('../feishu');
          const { sendProactiveMessage } = await import('../session');

          await recoverUnansweredSessions(recoveryConfig, {
            getFeishuClient: getFeishuWSClient,
            sendProactiveMessage,
            getAllSessions: () => listSessions(),
          });
        } catch (error) {
          console.error('[App] Session recovery failed:', error);
        }
      }, recoveryConfig.startupDelay);
    }
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
  try {
    await shutdownMCP();
  } catch {
    // Ignore errors during shutdown
  }

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
} from '../session';
