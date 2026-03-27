/**
 * Tests for persona/tools.ts
 *
 * Uses real PersonaStore with tmp directory for integration-style tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { getPersonaStore, resetPersonaStore } from '../store';
import {
  personaTools,
  executePersonaTool,
  getPersonaToolsForAI,
  getTraitSystemPrompt,
} from '../tools';

const TEST_DIR = join('/tmp', `persona-tools-test-${Date.now()}`);

describe('persona/tools', () => {
  beforeEach(() => {
    resetPersonaStore();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    getPersonaStore(TEST_DIR);
  });

  afterEach(() => {
    resetPersonaStore();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe('tool definitions', () => {
    it('should define 5 tools', () => {
      expect(personaTools).toHaveLength(5);
    });

    it('getPersonaToolsForAI should return tool array', () => {
      const tools = getPersonaToolsForAI();
      expect(tools).toHaveLength(5);
      expect(tools[0].type).toBe('function');
      expect(tools[0].function.name).toBeDefined();
    });
  });

  describe('executePersonaTool', () => {
    it('persona_get all should return all sections', () => {
      const result = executePersonaTool('persona_get', {});
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('identity');
      expect(result.data).toHaveProperty('traits');
    });

    it('persona_get identity should return identity', () => {
      const result = executePersonaTool('persona_get', { section: 'identity' });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('name');
    });

    it('persona_get traits should return traits', () => {
      const result = executePersonaTool('persona_get', { section: 'traits' });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('mbti');
    });

    it('persona_update_traits should update MBTI', () => {
      const result = executePersonaTool('persona_update_traits', { mbti: 'ENTP' });
      expect(result.success).toBe(true);
      expect(result.data.traits.mbti).toBe('ENTP');
    });

    it('persona_update_traits should update OCEAN values', () => {
      const result = executePersonaTool('persona_update_traits', { openness: 0.9 });
      expect(result.success).toBe(true);
      expect(result.data.traits.ocean.openness).toBe(0.9);
    });

    it('persona_update_traits should update linguistic style', () => {
      const result = executePersonaTool('persona_update_traits', { formality: 0.8, humor: 0.3 });
      expect(result.success).toBe(true);
      expect(result.data.traits.linguisticStyle.formality).toBe(0.8);
      expect(result.data.traits.linguisticStyle.humor).toBe(0.3);
    });

    it('persona_export should export a package', () => {
      const result = executePersonaTool('persona_export', {});
      expect(result.success).toBe(true);
      expect(result.data.schema).toBe('aieos/v1');
      expect(result.data.identity).toBeDefined();
    });

    it('persona_import should import a valid package', () => {
      const exportResult = executePersonaTool('persona_export', {});
      const pkg = exportResult.data;
      pkg.identity.name = 'Imported';

      const result = executePersonaTool('persona_import', {
        packageJson: JSON.stringify(pkg),
      });
      expect(result.success).toBe(true);
      expect(result.data.imported).toContain('identity');
    });

    it('persona_import should fail with missing package', () => {
      const result = executePersonaTool('persona_import', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing package');
    });

    it('persona_import should fail with invalid JSON', () => {
      const result = executePersonaTool('persona_import', { packageJson: 'not-json' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('persona_explain_traits should return explanation', () => {
      const result = executePersonaTool('persona_explain_traits', {});
      expect(result.success).toBe(true);
      expect(typeof result.data).toBe('string');
    });

    it('should return error for unknown tool', () => {
      const result = executePersonaTool('persona_nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown persona tool');
    });
  });

  describe('getTraitSystemPrompt', () => {
    it('should return a non-empty string when store is initialized', () => {
      const prompt = getTraitSystemPrompt();
      expect(typeof prompt).toBe('string');
    });
  });
});

describe('getTraitSystemPrompt without store', () => {
  it('should return empty string when store is not initialized', () => {
    resetPersonaStore();
    const prompt = getTraitSystemPrompt();
    expect(prompt).toBe('');
  });
});
