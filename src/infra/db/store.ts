/**
 * Store Manager — Infrastructure Layer
 *
 * Provides database-directory bootstrapping and base-path management.
 * Does NOT import domain modules; domain-specific store creation is
 * handled by app/bootstrap-stores.ts (dependency inversion).
 */

import { existsSync, mkdirSync } from 'fs';
import { DEFAULT_MEMORY_BASE_PATH } from '../../types';

export interface StoreManagerConfig {
  basePath: string;
  autoInit?: boolean;
}

export interface StoreManager {
  basePath: string;
}

let _manager: StoreManager | null = null;
let _config: StoreManagerConfig | null = null;

/**
 * Initialize the store manager (directory creation only).
 *
 * Domain store instances are created by app/bootstrap-stores.ts.
 */
export function initStoreManager(storeConfig?: StoreManagerConfig): StoreManager {
  if (_manager) return _manager;

  _config = storeConfig || { basePath: DEFAULT_MEMORY_BASE_PATH, autoInit: true };
  const { basePath, autoInit = true } = _config;

  if (autoInit && !existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true });
  }

  _manager = { basePath };
  return _manager;
}

/**
 * Get store configuration.
 */
export function getStoreConfig(): StoreManagerConfig | null {
  return _config;
}

/**
 * Get base path for all stores.
 */
export function getBasePath(): string {
  return _config?.basePath || DEFAULT_MEMORY_BASE_PATH;
}

/**
 * Reset store manager (for testing).
 */
export function resetStoreManager(): void {
  _manager = null;
  _config = null;
}

/**
 * Check if store manager is initialized.
 */
export function isStoreManagerInitialized(): boolean {
  return _manager !== null;
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases
//
// Several modules still import initStores / getStores / resetStores from this
// path.  The real domain-aware implementations now live in
// app/bootstrap-stores.ts, but we re-export thin wrappers here so that
// existing call-sites keep working until they are migrated.
//
// ⚠️ EXCEPTION: Dynamic require() is used here because bootstrap-stores.ts
// imports from this file (infra/db/store.ts), creating a circular dependency.
// A static import would cause module initialization failure.
// ---------------------------------------------------------------------------

type BootstrapStoresModule = typeof import('../../app/bootstrap-stores');
let _bootstrapModule: BootstrapStoresModule | null = null;

function lazyBootstrapStores(): BootstrapStoresModule {
  if (!_bootstrapModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
    _bootstrapModule = require('../../app/bootstrap-stores') as BootstrapStoresModule;
  }
  return _bootstrapModule;
}

/** @deprecated Use bootstrapStores() from app/bootstrap-stores instead. */
export function initStores(storeConfig?: StoreManagerConfig): any {
  return lazyBootstrapStores().bootstrapStores(storeConfig);
}

/** @deprecated Use getStores() from app/bootstrap-stores instead. */
export function getStores(): any {
  return lazyBootstrapStores().getStores();
}

/** @deprecated Use resetAllStores() from app/bootstrap-stores instead. */
export function resetStores(): void {
  lazyBootstrapStores().resetAllStores();
  resetStoreManager();
}

/** @deprecated */
export function isStoresInitialized(): boolean {
  return lazyBootstrapStores().isStoresBootstrapped();
}
