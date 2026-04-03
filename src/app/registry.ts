/**
 * App Registry Module
 *
 * Provides access to global app state singletons (agent, provider, model, config).
 * These are populated during bootstrap and consumed by the rest of the app.
 */

import { shouldShowTokenStats } from '../infra/config';
import { createAgent } from '../domain/agent';

import type { ExtractionManager } from '../domain/extraction';

import type { AIProvider, AppConfig } from '../infra/config/schema';
import type { TokenStatsConfig } from '../domain/agent/context';

// Global app state (singleton)
export let appState: {
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
 * Reset app state to initial values (used by resetApp and testing)
 */
export function resetAppState(): void {
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
 * Get token stats config from unified config
 */
export function getTokenStatsConfig(): Partial<TokenStatsConfig> {
  return { showTokenStats: shouldShowTokenStats() };
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
 * Check if app is initialized
 */
export function isInitialized(): boolean {
  return appState.initialized;
}
