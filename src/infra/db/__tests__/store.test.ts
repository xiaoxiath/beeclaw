import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

// Mock types
vi.mock('../../../types', () => ({
  DEFAULT_MEMORY_BASE_PATH: './data/memory',
}));

// Mock app/bootstrap-stores
vi.mock('../../../app/bootstrap-stores', () => ({
  bootstrapStores: vi.fn(() => ({})),
  getStores: vi.fn(() => ({})),
  resetAllStores: vi.fn(),
  isStoresBootstrapped: vi.fn(() => false),
}));

import {
  initStoreManager,
  getStoreConfig,
  getBasePath,
  resetStoreManager,
  isStoreManagerInitialized,
} from '../store';

describe('db/store', () => {
  afterEach(() => {
    resetStoreManager();
  });

  describe('initStoreManager', () => {
    it('should initialize with default config', () => {
      const manager = initStoreManager();
      expect(manager).toBeDefined();
      expect(manager.basePath).toBe('./data/memory');
    });

    it('should initialize with custom config', () => {
      const manager = initStoreManager({ basePath: '/custom/path' });
      expect(manager.basePath).toBe('/custom/path');
    });

    it('should return existing manager on subsequent calls', () => {
      const a = initStoreManager({ basePath: '/path1' });
      const b = initStoreManager({ basePath: '/path2' });
      expect(a).toBe(b);
      expect(a.basePath).toBe('/path1'); // first call wins
    });
  });

  describe('getStoreConfig', () => {
    it('should return null before init', () => {
      expect(getStoreConfig()).toBeNull();
    });

    it('should return config after init', () => {
      initStoreManager({ basePath: '/test' });
      const config = getStoreConfig();
      expect(config).not.toBeNull();
      expect(config!.basePath).toBe('/test');
    });
  });

  describe('getBasePath', () => {
    it('should return default path before init', () => {
      expect(getBasePath()).toBe('./data/memory');
    });

    it('should return configured path after init', () => {
      initStoreManager({ basePath: '/custom' });
      expect(getBasePath()).toBe('/custom');
    });
  });

  describe('resetStoreManager', () => {
    it('should reset state', () => {
      initStoreManager({ basePath: '/test' });
      expect(isStoreManagerInitialized()).toBe(true);
      resetStoreManager();
      expect(isStoreManagerInitialized()).toBe(false);
    });
  });

  describe('isStoreManagerInitialized', () => {
    it('should return false initially', () => {
      expect(isStoreManagerInitialized()).toBe(false);
    });

    it('should return true after init', () => {
      initStoreManager();
      expect(isStoreManagerInitialized()).toBe(true);
    });
  });
});
