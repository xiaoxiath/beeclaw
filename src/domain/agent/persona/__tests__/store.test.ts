/**
 * Tests for persona/store.ts
 *
 * Uses real filesystem with tmp directory for store operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { PersonaStore, getPersonaStore, resetPersonaStore } from '../store';

const TEST_DIR = join('/tmp', `persona-store-test-${Date.now()}`);

describe('PersonaStore', () => {
  let store: PersonaStore;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new PersonaStore(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe('init', () => {
    it('should create directory and default identity', () => {
      store.init();
      expect(existsSync(join(TEST_DIR, 'IDENTITY.md'))).toBe(true);
      expect(existsSync(join(TEST_DIR, 'traits.json'))).toBe(true);
    });

    it('should be idempotent', () => {
      store.init();
      store.init();
      expect(existsSync(join(TEST_DIR, 'IDENTITY.md'))).toBe(true);
    });

    it('should load existing files', () => {
      // Write identity file before init
      writeFileSync(join(TEST_DIR, 'IDENTITY.md'), '---\nname: CustomBot\nversion: 1.0.0\ncreated: 2026-01-01\nmodified: 2026-01-01\n---\nA custom bot', 'utf-8');
      store.init();
      const identity = store.getIdentity();
      expect(identity).not.toBeNull();
      expect(identity!.name).toBe('CustomBot');
    });
  });

  describe('getters', () => {
    beforeEach(() => {
      store.init();
    });

    it('getIdentity should return identity', () => {
      const identity = store.getIdentity();
      expect(identity).not.toBeNull();
      expect(identity!.name).toBe('Beeclaw');
    });

    it('getSoul should return null if no SOUL.md', () => {
      expect(store.getSoul()).toBeNull();
    });

    it('getAgents should return null if no AGENTS.md', () => {
      expect(store.getAgents()).toBeNull();
    });

    it('getUser should return null if no USER.md', () => {
      expect(store.getUser()).toBeNull();
    });

    it('getTraits should return default traits', () => {
      const traits = store.getTraits();
      expect(traits).toBeDefined();
      expect(traits.mbti).toBeDefined();
    });
  });

  describe('setIdentity', () => {
    it('should update identity and save', () => {
      store.init();
      store.setIdentity({ name: 'NewName', description: 'New desc' });
      const identity = store.getIdentity();
      expect(identity!.name).toBe('NewName');
      expect(identity!.description).toBe('New desc');
      expect(identity!.modified).toBeDefined();
    });
  });

  describe('setTraits', () => {
    it('should update traits and save', () => {
      store.init();
      store.setTraits({ mbti: 'ENTJ' });
      const traits = store.getTraits();
      expect(traits.mbti).toBe('ENTJ');
    });
  });

  describe('exportPersona', () => {
    it('should export a valid package', () => {
      store.init();
      const pkg = store.exportPersona();
      expect(pkg.schema).toBe('aieos/v1');
      expect(pkg.exportedAt).toBeDefined();
      expect(pkg.sourceSystem).toBe('Beeclaw');
      expect(pkg.identity).toBeDefined();
      expect(pkg.identity.name).toBe('Beeclaw');
    });
  });

  describe('importPersona', () => {
    it('should import a valid package', () => {
      store.init();
      const pkg = store.exportPersona();
      pkg.identity.name = 'Imported';

      const result = store.importPersona(pkg);
      expect(result.success).toBe(true);
      expect(result.imported).toContain('identity');
      expect(store.getIdentity()!.name).toBe('Imported');
    });

    it('should reject invalid package', () => {
      store.init();
      const result = store.importPersona({} as any);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should support validateOnly mode', () => {
      store.init();
      const pkg = store.exportPersona();
      const result = store.importPersona(pkg, { validateOnly: true });
      expect(result.success).toBe(true);
      expect(result.imported).toHaveLength(0);
    });
  });

  describe('getSystemPrompt', () => {
    it('should return prompt string with identity', () => {
      store.init();
      const prompt = store.getSystemPrompt();
      expect(prompt).toContain('Beeclaw');
      expect(prompt).toContain('Identity');
    });
  });
});

describe('PersonaStore singleton', () => {
  const SINGLETON_DIR = join('/tmp', `persona-singleton-test-${Date.now()}`);

  afterEach(() => {
    resetPersonaStore();
    if (existsSync(SINGLETON_DIR)) rmSync(SINGLETON_DIR, { recursive: true });
  });

  it('getPersonaStore should create and return singleton', () => {
    const store1 = getPersonaStore(SINGLETON_DIR);
    const store2 = getPersonaStore();
    expect(store1).toBe(store2);
  });

  it('getPersonaStore should throw without basePath if not initialized', () => {
    expect(() => getPersonaStore()).toThrow('PersonaStore not initialized');
  });

  it('resetPersonaStore should clear singleton', () => {
    getPersonaStore(SINGLETON_DIR);
    resetPersonaStore();
    expect(() => getPersonaStore()).toThrow('PersonaStore not initialized');
  });
});
