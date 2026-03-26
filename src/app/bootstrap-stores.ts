/**
 * Bootstrap Stores — App-layer orchestration
 *
 * Moved domain-object creation out of infra/db/store.ts so the infra layer
 * no longer imports domain modules.  This file lives in the app layer which
 * is allowed to depend on both infra and domain.
 *
 * Call `bootstrapStores()` once during app initialization (after config is loaded).
 */

import { join } from 'path';
import { initStoreManager, type StoreManagerConfig } from '../infra/db/store';
import { MemoryStore, getMemoryStore, resetMemoryStore } from '../domain/memory/store';
import { GoalStore, getGoalStore, resetGoalStore } from '../domain/agent/goal/store';
import { Scheduler, getScheduler, resetScheduler } from '../domain/proactive/scheduler';
import { NotificationManager, getNotificationManager, resetNotificationManager } from '../domain/proactive/notifications';
import { getCompressionEngine, resetCompressionEngine } from '../domain/memory/compression';
import { PersonaStore, getPersonaStore, resetPersonaStore } from '../domain/agent/persona/store';
import { SkillStore, getSkillStore, resetSkillStore } from '../domain/skills/store';
import type { MemoryConfig } from '../domain/memory/types';

export interface Stores {
  memory: MemoryStore;
  goal: GoalStore;
  scheduler: Scheduler;
  notifications: NotificationManager;
  persona: PersonaStore;
  skill: SkillStore;
}

let stores: Stores | null = null;

/**
 * Initialize all domain stores with unified configuration.
 *
 * Delegates directory-creation to the infra StoreManager, then creates
 * each domain store in the correct order.
 */
export function bootstrapStores(storeConfig?: StoreManagerConfig): Stores {
  if (stores) return stores;

  // 1. Let infra create the base directory
  const mgr = initStoreManager(storeConfig);
  const basePath = mgr.basePath;

  // 2. Create domain stores
  const memoryConfig: MemoryConfig = {
    type: 'filesystem',
    path: basePath,
    tools: {
      enabled: ['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record'],
      autoRecord: true,
    },
    retention: {
      conversations: '90d',
      facts: 'forever',
      decisions: 'forever',
    },
  };

  const memory = getMemoryStore(memoryConfig);
  const goal = getGoalStore(join(basePath, 'goals'));
  const scheduler = getScheduler(join(basePath, 'proactive'));
  const notifications = getNotificationManager(join(basePath, 'proactive'));
  const persona = getPersonaStore(basePath);
  const skill = getSkillStore(join(basePath, 'skills'));

  // Initialize compression engine
  getCompressionEngine(basePath);

  stores = { memory, goal, scheduler, notifications, persona, skill };
  return stores;
}

/**
 * Get all stores (must call bootstrapStores first).
 */
export function getStores(): Stores {
  if (!stores) {
    throw new Error('Stores not bootstrapped. Call bootstrapStores() first.');
  }
  return stores;
}

/**
 * Reset all stores (for testing).
 */
export function resetAllStores(): void {
  resetMemoryStore();
  resetGoalStore();
  resetScheduler();
  resetNotificationManager();
  resetCompressionEngine();
  resetPersonaStore();
  resetSkillStore();
  stores = null;
}

/**
 * Check if stores are bootstrapped.
 */
export function isStoresBootstrapped(): boolean {
  return stores !== null;
}
