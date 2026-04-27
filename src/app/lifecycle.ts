/**
 * App Lifecycle Module
 *
 * Handles model switching, app reset, and shutdown operations.
 */

import { createAgent, getAllToolsForAI, SYSTEM_PROMPTS } from '../domain/agent';
import { SandboxManager } from '../domain/sandbox/manager';
import { shutdownMCP } from '../adapter/mcp';
import { resetHookRunner } from '../adapter/plugins/hooks';

import type { AIProvider } from '../infra/config/schema';

import { appState, resetAppState, getTokenStatsConfig } from './registry';

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

  // Get model - prefer string, fall back to first model definition key
  const modelValue = modelName || newProvider?.models[0] || appState.model;
  const newModel = typeof modelValue === 'string' ? modelValue : Object.keys(modelValue as Record<string, unknown>)[0] || appState.model;

  // Recreate agent
  const agentConfig = appState.config.agent || appState.config.agents?.[0];
  const agent = createAgent({
    provider: newProvider!,
    model: newModel as string,
    systemPrompt: agentConfig?.systemPrompt || SYSTEM_PROMPTS.default,
    temperature: (agentConfig?.params as Record<string, unknown>)?.temperature as number | undefined,
    maxTokens: (agentConfig?.params as Record<string, unknown>)?.max_tokens as number | undefined,
    tools: getAllToolsForAI(),
    loadCoreMemory: true,
    autoRefreshMemory: true,
    tokenStatsConfig: getTokenStatsConfig(),
  });

  // Update state
  appState.provider = newProvider;
  appState.model = newModel as string;
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

  resetAppState();
}
