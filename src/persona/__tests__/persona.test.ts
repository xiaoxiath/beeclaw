import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PersonaStore, getPersonaStore, resetPersonaStore } from '../store';
import { executePersonaTool } from '../tools';
import {
  parseMBTI,
  getMBTIDescription,
  mbtiToPromptModifier,
  getOCEANLevel,
  getOCEANDescription,
  oceanToPromptModifier,
  linguisticStyleToPromptModifier,
  traitsToPromptModifier,
  validateTraitsProfile,
  DEFAULT_OCEAN,
  DEFAULT_LINGUISTIC_STYLE,
  DEFAULT_TRAITS_PROFILE,
} from '../traits';
import type { TraitsProfile, PersonaPackage } from '../types';

const TEST_PERSONA_PATH = './test-persona-data';

describe('PersonaStore', () => {
  let store: PersonaStore;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_PERSONA_PATH)) {
      rmSync(TEST_PERSONA_PATH, { recursive: true });
    }
    resetPersonaStore();
    store = getPersonaStore(TEST_PERSONA_PATH);
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_PERSONA_PATH)) {
      rmSync(TEST_PERSONA_PATH, { recursive: true });
    }
  });

  describe('init', () => {
    test('creates directory structure', () => {
      expect(existsSync(TEST_PERSONA_PATH)).toBe(true);
    });

    test('creates default identity file', () => {
      expect(existsSync(join(TEST_PERSONA_PATH, 'IDENTITY.md'))).toBe(true);
    });

    test('creates default traits file', () => {
      expect(existsSync(join(TEST_PERSONA_PATH, 'traits.json'))).toBe(true);
    });
  });

  describe('getIdentity', () => {
    test('returns identity with default values', () => {
      const identity = store.getIdentity();
      expect(identity).not.toBeNull();
      expect(identity?.name).toBe('Beeclaw');
      expect(identity?.version).toBeDefined();
    });
  });

  describe('setIdentity', () => {
    test('updates identity fields', () => {
      store.setIdentity({
        name: 'Custom AI',
        description: 'A custom assistant',
      });

      const identity = store.getIdentity();
      expect(identity?.name).toBe('Custom AI');
      expect(identity?.description).toBe('A custom assistant');
    });

    test('updates modified timestamp', async () => {
      const before = store.getIdentity()?.modified;

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      store.setIdentity({ description: 'Updated' });
      const after = store.getIdentity()?.modified;

      expect(after).not.toBe(before);
    });

    test('preserves unspecified fields', () => {
      const originalName = store.getIdentity()?.name;
      store.setIdentity({ description: 'New description' });

      const identity = store.getIdentity();
      expect(identity?.name).toBe(originalName);
      expect(identity?.description).toBe('New description');
    });
  });

  describe('getTraits', () => {
    test('returns default traits profile', () => {
      const traits = store.getTraits();
      expect(traits.mbti).toBeDefined();
      expect(traits.ocean).toBeDefined();
      expect(traits.linguisticStyle).toBeDefined();
    });
  });

  describe('setTraits', () => {
    test('updates traits', () => {
      store.setTraits({
        mbti: 'ENFP',
      });

      const traits = store.getTraits();
      expect(traits.mbti).toBe('ENFP');
    });

    test('updates OCEAN values', () => {
      store.setTraits({
        ocean: {
          openness: 0.9,
          conscientiousness: 0.8,
          extraversion: 0.7,
          agreeableness: 0.6,
          neuroticism: 0.1,
        },
      });

      const traits = store.getTraits();
      expect(traits.ocean?.openness).toBe(0.9);
    });

    test('throws on invalid traits', () => {
      expect(() => {
        store.setTraits({
          ocean: {
            openness: 2.0, // Invalid: > 1
          } as TraitsProfile['ocean'],
        });
      }).toThrow();
    });

    test('persists to file', () => {
      store.setTraits({ mbti: 'INTP' });

      const content = readFileSync(join(TEST_PERSONA_PATH, 'traits.json'), 'utf-8');
      const saved = JSON.parse(content);
      expect(saved.mbti).toBe('INTP');
    });
  });

  describe('getSystemPrompt', () => {
    test('returns formatted system prompt', () => {
      const prompt = store.getSystemPrompt();
      expect(prompt).toContain('Identity');
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('exportPersona', () => {
    test('exports persona package', () => {
      const pkg = store.exportPersona();

      expect(pkg.schema).toBe('aieos/v1');
      expect(pkg.identity).toBeDefined();
      expect(pkg.exportedAt).toBeDefined();
    });

    test('includes memories when requested', () => {
      const pkg = store.exportPersona({ includeMemories: true });
      // Memories may be empty if no facts exist
      expect(pkg.memories).toBeDefined();
    });

    test('excludes memories when not requested', () => {
      const pkg = store.exportPersona({ includeMemories: false });
      expect(pkg.memories).toBeUndefined();
    });
  });

  describe('importPersona', () => {
    test('imports valid persona package', () => {
      const pkg: PersonaPackage = {
        schema: 'aieos/v1',
        exportedAt: new Date().toISOString(),
        sourceSystem: 'Test',
        identity: {
          name: 'Imported AI',
          version: '1.0.0',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        },
      };

      const result = store.importPersona(pkg);

      expect(result.success).toBe(true);
      expect(result.imported).toContain('identity');
      expect(store.getIdentity()?.name).toBe('Imported AI');
    });

    test('imports traits when provided', () => {
      const pkg: PersonaPackage = {
        schema: 'aieos/v1',
        exportedAt: new Date().toISOString(),
        sourceSystem: 'Test',
        identity: {
          name: 'Test',
          version: '1.0.0',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        },
        traits: {
          mbti: 'ENTP',
          ocean: DEFAULT_OCEAN,
          linguisticStyle: DEFAULT_LINGUISTIC_STYLE,
          motivation: DEFAULT_TRAITS_PROFILE.motivation,
        },
      };

      const result = store.importPersona(pkg);

      expect(result.imported).toContain('traits');
      expect(store.getTraits().mbti).toBe('ENTP');
    });

    test('validates only when requested', () => {
      const pkg: PersonaPackage = {
        schema: 'aieos/v1',
        exportedAt: new Date().toISOString(),
        sourceSystem: 'Test',
        identity: {
          name: 'Test',
          version: '1.0.0',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        },
      };

      const result = store.importPersona(pkg, { validateOnly: true });

      expect(result.success).toBe(true);
      expect(result.imported.length).toBe(0);
    });

    test('returns errors for invalid package', () => {
      const result = store.importPersona({} as PersonaPackage);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

describe('Persona Tools', () => {
  beforeEach(() => {
    if (existsSync(TEST_PERSONA_PATH)) {
      rmSync(TEST_PERSONA_PATH, { recursive: true });
    }
    resetPersonaStore();
    getPersonaStore(TEST_PERSONA_PATH);
  });

  afterEach(() => {
    if (existsSync(TEST_PERSONA_PATH)) {
      rmSync(TEST_PERSONA_PATH, { recursive: true });
    }
  });

  describe('persona_get', () => {
    test('returns all sections by default', () => {
      const result = executePersonaTool('persona_get', {});

      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).identity).toBeDefined();
      expect((result.data as Record<string, unknown>).traits).toBeDefined();
    });

    test('returns specific section', () => {
      const result = executePersonaTool('persona_get', { section: 'traits' });

      expect(result.success).toBe(true);
      expect((result.data as TraitsProfile).mbti).toBeDefined();
    });

    test('returns identity section', () => {
      const result = executePersonaTool('persona_get', { section: 'identity' });

      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).name).toBeDefined();
    });
  });

  describe('persona_update_traits', () => {
    test('updates MBTI', () => {
      const result = executePersonaTool('persona_update_traits', { mbti: 'INFP' });

      expect(result.success).toBe(true);
      expect(((result.data as { traits: TraitsProfile }).traits).mbti).toBe('INFP');
    });

    test('updates OCEAN values', () => {
      const result = executePersonaTool('persona_update_traits', {
        openness: 0.9,
        conscientiousness: 0.8,
      });

      expect(result.success).toBe(true);
      const traits = (result.data as { traits: TraitsProfile }).traits;
      expect(traits.ocean?.openness).toBe(0.9);
      expect(traits.ocean?.conscientiousness).toBe(0.8);
    });

    test('updates linguistic style', () => {
      const result = executePersonaTool('persona_update_traits', {
        formality: 0.8,
        humor: 0.1,
      });

      expect(result.success).toBe(true);
      const traits = (result.data as { traits: TraitsProfile }).traits;
      expect(traits.linguisticStyle?.formality).toBe(0.8);
      expect(traits.linguisticStyle?.humor).toBe(0.1);
    });
  });

  describe('persona_export', () => {
    test('exports persona package', () => {
      const result = executePersonaTool('persona_export', {});

      expect(result.success).toBe(true);
      const pkg = result.data as PersonaPackage;
      expect(pkg.schema).toBe('aieos/v1');
      expect(pkg.identity).toBeDefined();
    });

    test('respects include options', () => {
      const result = executePersonaTool('persona_export', {
        includeMemories: false,
        includeSkills: false,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('persona_import', () => {
    test('imports valid package', () => {
      const pkg: PersonaPackage = {
        schema: 'aieos/v1',
        exportedAt: new Date().toISOString(),
        sourceSystem: 'Test',
        identity: {
          name: 'Test AI',
          version: '2.0.0',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        },
      };

      const result = executePersonaTool('persona_import', {
        packageJson: JSON.stringify(pkg),
      });

      expect(result.success).toBe(true);
      expect((result.data as { imported: string[] }).imported).toContain('identity');
    });

    test('handles invalid JSON', () => {
      const result = executePersonaTool('persona_import', {
        packageJson: 'not valid json',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    test('handles missing package', () => {
      const result = executePersonaTool('persona_import', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing');
    });
  });

  describe('persona_explain_traits', () => {
    test('explains current traits', () => {
      const result = executePersonaTool('persona_explain_traits', {});

      expect(result.success).toBe(true);
      const explanation = result.data as string;
      expect(explanation.length).toBeGreaterThan(0);
    });
  });

  describe('unknown tool', () => {
    test('returns error for unknown tool', () => {
      const result = executePersonaTool('unknown_persona_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown persona tool');
    });
  });
});

describe('Traits Utilities', () => {
  describe('parseMBTI', () => {
    test('parses INTJ', () => {
      const dims = parseMBTI('INTJ');
      expect(dims.ei).toBe('I');
      expect(dims.sn).toBe('N');
      expect(dims.tf).toBe('T');
      expect(dims.jp).toBe('J');
    });

    test('parses ENFP', () => {
      const dims = parseMBTI('ENFP');
      expect(dims.ei).toBe('E');
      expect(dims.sn).toBe('N');
      expect(dims.tf).toBe('F');
      expect(dims.jp).toBe('P');
    });
  });

  describe('getMBTIDescription', () => {
    test('returns description for valid type', () => {
      const desc = getMBTIDescription('INTJ');
      expect(desc.length).toBeGreaterThan(0);
      expect(desc).toContain('Introversion');
    });
  });

  describe('mbtiToPromptModifier', () => {
    test('generates prompt for INTJ', () => {
      const modifier = mbtiToPromptModifier('INTJ');
      expect(modifier.length).toBeGreaterThan(0);
      expect(modifier).toContain('深思熟虑');
    });

    test('generates different prompts for different types', () => {
      const intj = mbtiToPromptModifier('INTJ');
      const enfp = mbtiToPromptModifier('ENFP');
      expect(intj).not.toBe(enfp);
    });
  });

  describe('getOCEANLevel', () => {
    test('returns high for >= 0.66', () => {
      expect(getOCEANLevel('openness', 0.7)).toBe('high');
      expect(getOCEANLevel('openness', 0.66)).toBe('high');
    });

    test('returns medium for 0.33-0.65', () => {
      expect(getOCEANLevel('openness', 0.5)).toBe('medium');
      expect(getOCEANLevel('openness', 0.33)).toBe('medium');
    });

    test('returns low for < 0.33', () => {
      expect(getOCEANLevel('openness', 0.2)).toBe('low');
    });
  });

  describe('getOCEANDescription', () => {
    test('returns high description', () => {
      const desc = getOCEANDescription('openness', 0.8);
      expect(desc).toContain('高度开放');
    });

    test('returns low description', () => {
      const desc = getOCEANDescription('openness', 0.2);
      expect(desc).toContain('较低开放');
    });

    test('returns medium description', () => {
      const desc = getOCEANDescription('openness', 0.5);
      expect(desc).toContain('适度开放');
    });
  });

  describe('oceanToPromptModifier', () => {
    test('generates modifiers for high traits', () => {
      const modifier = oceanToPromptModifier({
        openness: 0.8,
        conscientiousness: 0.9,
        extraversion: 0.7,
        agreeableness: 0.8,
        neuroticism: 0.1,
      });
      expect(modifier).toContain('积极探索');
      expect(modifier).toContain('严谨细致');
    });

    test('generates modifiers for low traits', () => {
      const modifier = oceanToPromptModifier({
        openness: 0.2,
        conscientiousness: 0.2,
        extraversion: 0.2,
        agreeableness: 0.2,
        neuroticism: 0.8,
      });
      expect(modifier).toContain('专注');
    });
  });

  describe('linguisticStyleToPromptModifier', () => {
    test('generates modifiers for formal style', () => {
      const modifier = linguisticStyleToPromptModifier({
        ...DEFAULT_LINGUISTIC_STYLE,
        formality: 0.8,
      });
      expect(modifier).toContain('正式');
    });

    test('generates modifiers for casual style', () => {
      const modifier = linguisticStyleToPromptModifier({
        ...DEFAULT_LINGUISTIC_STYLE,
        formality: 0.2,
      });
      expect(modifier).toContain('轻松');
    });

    test('generates modifiers for direct style', () => {
      const modifier = linguisticStyleToPromptModifier({
        ...DEFAULT_LINGUISTIC_STYLE,
        directness: 0.8,
      });
      expect(modifier).toContain('直接');
    });
  });

  describe('traitsToPromptModifier', () => {
    test('generates complete prompt', () => {
      const modifier = traitsToPromptModifier(DEFAULT_TRAITS_PROFILE);
      expect(modifier).toContain('心理特质');
      expect(modifier).toContain('INTJ');
      expect(modifier).toContain('性格特质');
      expect(modifier).toContain('语言风格');
    });

    test('includes motivation', () => {
      const modifier = traitsToPromptModifier(DEFAULT_TRAITS_PROFILE);
      expect(modifier).toContain('核心动机');
    });
  });

  describe('validateTraitsProfile', () => {
    test('validates correct profile', () => {
      const result = validateTraitsProfile(DEFAULT_TRAITS_PROFILE);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test('catches invalid OCEAN values', () => {
      const result = validateTraitsProfile({
        ocean: {
          openness: 2.0, // Invalid
          conscientiousness: 0.5,
          extraversion: 0.5,
          agreeableness: 0.5,
          neuroticism: 0.5,
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('catches invalid linguistic style values', () => {
      const result = validateTraitsProfile({
        linguisticStyle: {
          formality: -0.5, // Invalid
          humor: 0.5,
          directness: 0.5,
          verbosity: 0.5,
          empathy: 0.5,
          technicalDepth: 0.5,
        },
      });

      expect(result.valid).toBe(false);
    });

    test('accepts empty partial profile', () => {
      const result = validateTraitsProfile({});
      expect(result.valid).toBe(true);
    });
  });
});
