import { describe, it, expect, afterEach, vi } from 'vitest';

// Mock all domain store dependencies
vi.mock('../../infra/db/store', () => ({
  initStoreManager: vi.fn((config?: any) => ({
    basePath: config?.basePath || './data/memory',
  })),
}));

vi.mock('../../domain/memory/store', () => ({
  MemoryStore: class {},
  getMemoryStore: vi.fn(() => ({})),
  resetMemoryStore: vi.fn(),
}));

vi.mock('../../domain/agent/goal/store', () => ({
  GoalStore: class {},
  getGoalStore: vi.fn(() => ({})),
  resetGoalStore: vi.fn(),
}));

vi.mock('../../domain/proactive/scheduler', () => ({
  Scheduler: class {},
  getScheduler: vi.fn(() => ({})),
  resetScheduler: vi.fn(),
}));

vi.mock('../../domain/proactive/notifications', () => ({
  NotificationManager: class {},
  getNotificationManager: vi.fn(() => ({})),
  resetNotificationManager: vi.fn(),
}));

vi.mock('../../domain/memory/compression', () => ({
  getCompressionEngine: vi.fn(() => ({})),
  resetCompressionEngine: vi.fn(),
}));

vi.mock('../../domain/agent/persona/store', () => ({
  PersonaStore: class {},
  getPersonaStore: vi.fn(() => ({})),
  resetPersonaStore: vi.fn(),
}));

vi.mock('../../domain/skills/store', () => ({
  SkillStore: class {},
  getSkillStore: vi.fn(() => ({})),
  resetSkillStore: vi.fn(),
}));

import {
  bootstrapStores,
  getStores,
  resetAllStores,
  isStoresBootstrapped,
} from '../bootstrap-stores';

describe('bootstrap-stores', () => {
  afterEach(() => {
    resetAllStores();
  });

  describe('bootstrapStores', () => {
    it('should bootstrap all stores', () => {
      const stores = bootstrapStores({ basePath: './test-data' });
      expect(stores).toBeDefined();
      expect(stores.memory).toBeDefined();
      expect(stores.goal).toBeDefined();
      expect(stores.scheduler).toBeDefined();
      expect(stores.notifications).toBeDefined();
      expect(stores.persona).toBeDefined();
      expect(stores.skill).toBeDefined();
    });

    it('should return same instance on subsequent calls', () => {
      const a = bootstrapStores({ basePath: './test-data' });
      const b = bootstrapStores({ basePath: './other' });
      expect(a).toBe(b);
    });
  });

  describe('getStores', () => {
    it('should throw if not bootstrapped', () => {
      expect(() => getStores()).toThrow('not bootstrapped');
    });

    it('should return stores after bootstrap', () => {
      bootstrapStores({ basePath: './test-data' });
      const stores = getStores();
      expect(stores).toBeDefined();
    });
  });

  describe('resetAllStores', () => {
    it('should reset bootstrap state', () => {
      bootstrapStores({ basePath: './test-data' });
      expect(isStoresBootstrapped()).toBe(true);
      resetAllStores();
      expect(isStoresBootstrapped()).toBe(false);
    });
  });

  describe('isStoresBootstrapped', () => {
    it('should return false initially', () => {
      expect(isStoresBootstrapped()).toBe(false);
    });

    it('should return true after bootstrap', () => {
      bootstrapStores({ basePath: './test-data' });
      expect(isStoresBootstrapped()).toBe(true);
    });
  });
});
