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
import { logger } from '../utils/logger';
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
export function resetApp(): void {
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
