import { describe, it, expect, beforeEach, mock } from 'bun:test';

mock.module('../../../infra/observability/logger', () => ({
  logger: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) },
}));

// Mock fs to avoid real filesystem access
const mockExistsSync = mock(() => true);
const mockMkdirSync = mock(() => {});
const mockReaddirSync = mock(() => []);
const mockReadFileSync = mock(() => '');
const mockWriteFileSync = mock(() => {});
const mockRmSync = mock(() => {});
const mockWatch = mock(() => ({ on: mock(() => {}), close: mock(() => {}) }));

mock.module('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  rmSync: mockRmSync,
  watch: mockWatch,
}));

mock.module('yaml', () => ({
  parse: mock((s: string) => {
    try { return JSON.parse(s); } catch { return {}; }
  }),
  stringify: mock((obj: any) => JSON.stringify(obj)),
}));

import { SkillStore, getSkillStore, resetSkillStore } from '../store';

describe('SkillStore', () => {
  let store: SkillStore;

  beforeEach(() => {
    resetSkillStore();
    store = new SkillStore('/tmp/test-skills', '/tmp/test-builtin');
  });

  describe('constructor', () => {
    it('should create with custom paths', () => {
      expect(store).toBeDefined();
    });
  });

  describe('init', () => {
    it('should initialize without error', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => store.init()).not.toThrow();
    });

    it('should be idempotent', () => {
      store.init();
      store.init(); // second call should be no-op
    });
  });

  describe('list', () => {
    it('should return array', () => {
      store.init();
      const skills = store.list();
      expect(Array.isArray(skills)).toBe(true);
    });
  });

  describe('get', () => {
    it('should return null for nonexistent skill', () => {
      store.init();
      const skill = store.get('nonexistent');
      expect(skill).toBeNull();
    });
  });

  describe('search', () => {
    it('should return array for any query', () => {
      store.init();
      const results = store.search('test query');
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('getSkillStore singleton', () => {
    it('should return the same instance', () => {
      resetSkillStore();
      const a = getSkillStore('/tmp/a');
      const b = getSkillStore('/tmp/b');
      expect(a).toBe(b); // singleton
    });
  });

  describe('resetSkillStore', () => {
    it('should allow creating fresh instance', () => {
      const a = getSkillStore('/tmp/a');
      resetSkillStore();
      const b = getSkillStore('/tmp/b');
      expect(a).not.toBe(b);
    });
  });
});
