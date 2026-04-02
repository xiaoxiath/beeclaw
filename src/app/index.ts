/**
 * Beeclaw App - Unified Initialization Module
 *
 * Single entry point for both CLI and Bot.
 * All users (just Keith!) get the same experience.
 *
 * This barrel file re-exports from the split modules:
 * - bootstrap.ts  — Application initialization (initApp)
 * - lifecycle.ts   — Model switching, reset, shutdown
 * - registry.ts    — Global state accessors (getAgent, getProvider, etc.)
 */

// --- Bootstrap ---
export { initApp, type InitOptions } from './bootstrap';

// --- Lifecycle ---
export { switchModel, resetApp } from './lifecycle';

// --- Registry (state accessors) ---
export {
  getTokenStatsConfig,
  getAgent,
  getProvider,
  getModel,
  getExtractionManager,
  getConfig_,
  isInitialized,
} from './registry';

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
