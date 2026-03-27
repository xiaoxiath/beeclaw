import { describe, it, expect, afterEach, mock } from 'bun:test';

// Mock all domain store dependencies
mock.module('../../infra/db/store', () => ({
  initStoreManager: mock((config?: any) => ({
    basePath: config?.basePath || './data/memory',
  })),
}));

mock.module('../../domain/memory/store', () => ({
  MemoryStore: class {},
  getMemoryStore: mock(() => ({})),
  resetMemoryStore: mock(),
}));

mock.module('../../domain/agent/goal/store', () => ({
  GoalStore: class {},
  getGoalStore: mock(() => ({})),
  resetGoalStore: mock(),
}));

mock.module('../../domain/proactive/scheduler', () => ({
  Scheduler: class {},
  getScheduler: mock(() => ({})),
  resetScheduler: mock(),
}));

mock.module('../../domain/proactive/notifications', () => ({
  NotificationManager: class {},
  getNotificationManager: mock(() => ({})),
  resetNotificationManager: mock(),
}));

mock.module('../../domain/memory/compression', () => ({
  getCompressionEngine: mock(() => ({})),
  resetCompressionEngine: mock(),
}));

mock.module('../../domain/agent/persona/store', () => ({
  PersonaStore: class {},
  getPersonaStore: mock(() => ({})),
  resetPersonaStore: mock(),
}));

mock.module('../../domain/skills/store', () => ({
  SkillStore: class {},
  getSkillStore: mock(() => ({})),
  resetSkillStore: mock(),
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
