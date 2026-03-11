/**
 * Provider Access Module
 *
 * Provides global access to the current provider and model.
 * This module decouples domain/tools from app layer.
 */

import type { AIProvider } from '../../infra/config/schema';

// Global state for provider and model access
let currentProvider: AIProvider | null = null;
let currentModel: string = '';

/**
 * Set the current provider (called during app initialization)
 */
export function setCurrentProvider(provider: AIProvider): void {
  currentProvider = provider;
}

/**
 * Set the current model (called during app initialization)
 */
export function setCurrentModel(model: string): void {
  currentModel = model;
}

/**
 * Get the current provider
 */
export function getProvider(): AIProvider {
  if (!currentProvider) {
    throw new Error('Provider not initialized. Call setCurrentProvider() first.');
  }
  return currentProvider;
}

/**
 * Get the current model
 */
export function getModel(): string {
  return currentModel;
}

/**
 * Reset provider state (for testing)
 */
export function resetProviderState(): void {
  currentProvider = null;
  currentModel = '';
}
