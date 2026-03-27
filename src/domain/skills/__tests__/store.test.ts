import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), warn: vi.fn(() => {}), error: vi.fn(() => {}), debug: vi.fn(() => {}) },
}));

// Mock fs to avoid real filesystem access
const mockExistsSync = vi.fn(() => true);
const mockMkdirSync = vi.fn(() => {});
const mockReaddirSync = vi.fn(() => []);
const mockReadFileSync = vi.fn(() => '');
const mockWriteFileSync = vi.fn(() => {});
const mockRmSync = vi.fn(() => {});
const mockWatch = vi.fn(() => ({ on: vi.fn(() => {}), close: vi.fn(() => {}) }));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  rmSync: mockRmSync,
  watch: mockWatch,
}));

vi.mock('yaml', () => ({
  parse: vi.fn((s: string) => {
    try { return JSON.parse(s); } catch { return {}; }
  }),
  stringify: vi.fn((obj: any) => JSON.stringify(obj)),
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
