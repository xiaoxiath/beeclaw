/**
 * Store Manager
 *
 * Unified initialization for all Beeclaw stores
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DEFAULT_MEMORY_BASE_PATH } from '../../types';
import { MemoryStore, getMemoryStore, resetMemoryStore } from '../../domain/memory/store';
import { GoalStore, getGoalStore, resetGoalStore } from '../../domain/agent/goal/store';
import { Scheduler, getScheduler, resetScheduler } from '../../domain/proactive/scheduler';
import { NotificationManager, getNotificationManager, resetNotificationManager } from '../../domain/proactive/notifications';
import { getCompressionEngine, resetCompressionEngine } from '../../domain/memory/compression';
import { PersonaStore, getPersonaStore, resetPersonaStore } from '../../domain/agent/persona/store';
import { SkillStore, getSkillStore, resetSkillStore } from '../../domain/skills/store';
import type { MemoryConfig } from '../../domain/memory/types';

export interface StoreManagerConfig {
  basePath: string;
  autoInit?: boolean;
}

export interface Stores {
  memory: MemoryStore;
  goal: GoalStore;
  scheduler: Scheduler;
  notifications: NotificationManager;
  persona: PersonaStore;
  skill: SkillStore;
}

let stores: Stores | null = null;
let config: StoreManagerConfig | null = null;

/**
 * Initialize all stores with unified configuration
 */
export function initStores(storeConfig?: StoreManagerConfig): Stores {
  if (stores) {
    return stores;
  }

  config = storeConfig || { basePath: DEFAULT_MEMORY_BASE_PATH, autoInit: true };

  const { basePath, autoInit = true } = config;

  // Ensure base directory exists
  if (autoInit && !existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true });
  }

  // Initialize memory config
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

  // Initialize all stores in correct order
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
 * Get all stores (must call initStores first)
 */
export function getStores(): Stores {
  if (!stores) {
    throw new Error('Stores not initialized. Call initStores() first.');
  }
  return stores;
}

/**
 * Get store configuration
 */
export function getStoreConfig(): StoreManagerConfig | null {
  return config;
}

/**
 * Get base path for all stores
 */
export function getBasePath(): string {
  return config?.basePath || DEFAULT_MEMORY_BASE_PATH;
}

/**
 * Reset all stores (for testing)
 */
export function resetStores(): void {
  resetMemoryStore();
  resetGoalStore();
  resetScheduler();
  resetNotificationManager();
  resetCompressionEngine();
  resetPersonaStore();
  resetSkillStore();
  stores = null;
  config = null;
}

/**
 * Check if stores are initialized
 */
export function isStoresInitialized(): boolean {
  return stores !== null;
}

/**
 * Get individual stores with lazy initialization
 */
export function getMemoryStoreLazy(): MemoryStore {
  if (!stores) {
    initStores();
  }
  return stores!.memory;
}

export function getGoalStoreLazy(): GoalStore {
  if (!stores) {
    initStores();
  }
  return stores!.goal;
}

export function getSchedulerLazy(): Scheduler {
  if (!stores) {
    initStores();
  }
  return stores!.scheduler;
}

export function getNotificationsLazy(): NotificationManager {
  if (!stores) {
    initStores();
  }
  return stores!.notifications;
}

export function getPersonaStoreLazy(): PersonaStore {
  if (!stores) {
    initStores();
  }
  return stores!.persona;
}

export function getSkillStoreLazy(): SkillStore {
  if (!stores) {
    initStores();
  }
  return stores!.skill;
}
