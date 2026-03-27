/**
 * Tests for persona/traits.ts
 *
 * Covers: parseMBTI, getMBTIDescription, mbtiToPromptModifier,
 *         OCEAN utilities, linguisticStyleToPromptModifier,
 *         traitsToPromptModifier, validateTraitsProfile
 */
import { describe, it, expect } from 'bun:test';

import {
  parseMBTI,
  getMBTIDescription,
  mbtiToPromptModifier,
  MBTI_DIMENSIONS,
  DEFAULT_OCEAN,
  getOCEANLevel,
  getOCEANDescription,
  oceanToPromptModifier,
  DEFAULT_LINGUISTIC_STYLE,
  linguisticStyleToPromptModifier,
  DEFAULT_TRAITS_PROFILE,
  traitsToPromptModifier,
  validateTraitsProfile,
} from '../traits';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('persona/traits', () => {
  // -----------------------------------------------------------------------
  // MBTI
  // -----------------------------------------------------------------------
  describe('parseMBTI', () => {
    it('parses INTJ correctly', () => {
      const result = parseMBTI('INTJ');
      expect(result.ei).toBe('I');
      expect(result.sn).toBe('N');
      expect(result.tf).toBe('T');
      expect(result.jp).toBe('J');
    });

    it('parses ESFP correctly', () => {
      const result = parseMBTI('ESFP');
      expect(result.ei).toBe('E');
      expect(result.sn).toBe('S');
      expect(result.tf).toBe('F');
      expect(result.jp).toBe('P');
    });
  });

  describe('getMBTIDescription', () => {
    it('returns description for each dimension', () => {
      const desc = getMBTIDescription('INTJ');
      expect(desc).toContain('Introversion');
      expect(desc).toContain('Intuition');
      expect(desc).toContain('Thinking');
      expect(desc).toContain('Judging');
    });

    it('returns different descriptions for opposite types', () => {
      const intj = getMBTIDescription('INTJ');
      const esfp = getMBTIDescription('ESFP');
      expect(intj).not.toBe(esfp);
    });
  });

  describe('mbtiToPromptModifier', () => {
    it('generates modifier for INTJ', () => {
      const mod = mbtiToPromptModifier('INTJ');
      expect(mod).toContain('深思熟虑');
      expect(mod).toContain('大局');
      expect(mod).toContain('逻辑');
      expect(mod).toContain('计划');
    });

    it('generates modifier for ESFP', () => {
      const mod = mbtiToPromptModifier('ESFP');
      expect(mod).toContain('主动交流');
      expect(mod).toContain('具体事实');
      expect(mod).toContain('感受');
      expect(mod).toContain('灵活');
    });

    it('ends with period', () => {
      const mod = mbtiToPromptModifier('INTJ');
      expect(mod.endsWith('。')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // OCEAN
  // -----------------------------------------------------------------------
  describe('getOCEANLevel', () => {
    it('returns high for >= 0.66', () => {
      expect(getOCEANLevel('openness', 0.8)).toBe('high');
      expect(getOCEANLevel('openness', 0.66)).toBe('high');
    });

    it('returns medium for 0.33-0.65', () => {
      expect(getOCEANLevel('openness', 0.5)).toBe('medium');
      expect(getOCEANLevel('openness', 0.33)).toBe('medium');
    });

    it('returns low for < 0.33', () => {
      expect(getOCEANLevel('openness', 0.1)).toBe('low');
      expect(getOCEANLevel('openness', 0.0)).toBe('low');
    });
  });

  describe('getOCEANDescription', () => {
    it('returns high description for high value', () => {
      const desc = getOCEANDescription('openness', 0.9);
      expect(desc).toContain('高度开放');
    });

    it('returns medium description for medium value', () => {
      const desc = getOCEANDescription('openness', 0.5);
      expect(desc).toContain('适度开放');
    });

    it('returns low description for low value', () => {
      const desc = getOCEANDescription('openness', 0.1);
      expect(desc).toContain('较低开放');
    });
  });

  describe('oceanToPromptModifier', () => {
    it('generates modifiers for all five traits', () => {
      const mod = oceanToPromptModifier(DEFAULT_OCEAN);
      // Should contain content for all 5 dimensions
      expect(mod.split('；').length).toBeGreaterThanOrEqual(4);
    });

    it('generates high modifier for high openness', () => {
      const mod = oceanToPromptModifier({ ...DEFAULT_OCEAN, openness: 0.9 });
      expect(mod).toContain('探索新想法');
    });

    it('generates medium modifier for medium extraversion', () => {
      const mod = oceanToPromptModifier({ ...DEFAULT_OCEAN, extraversion: 0.5 });
      expect(mod).toContain('平衡');
    });

    it('generates low modifier for low neuroticism', () => {
      const mod = oceanToPromptModifier({ ...DEFAULT_OCEAN, neuroticism: 0.1 });
      expect(mod).toContain('情绪稳定');
    });

    it('ends with period', () => {
      const mod = oceanToPromptModifier(DEFAULT_OCEAN);
      expect(mod.endsWith('。')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Linguistic Style
  // -----------------------------------------------------------------------
  describe('linguisticStyleToPromptModifier', () => {
    it('generates modifiers for all six dimensions', () => {
      const mod = linguisticStyleToPromptModifier(DEFAULT_LINGUISTIC_STYLE);
      expect(mod.split('；').length).toBeGreaterThanOrEqual(5);
    });

    it('generates high formality modifier', () => {
      const mod = linguisticStyleToPromptModifier({ ...DEFAULT_LINGUISTIC_STYLE, formality: 0.9 });
      expect(mod).toContain('正式');
    });

    it('generates low directness modifier', () => {
      const mod = linguisticStyleToPromptModifier({ ...DEFAULT_LINGUISTIC_STYLE, directness: 0.1 });
      expect(mod).toContain('委婉');
    });

    it('generates medium humor modifier', () => {
      const mod = linguisticStyleToPromptModifier({ ...DEFAULT_LINGUISTIC_STYLE, humor: 0.5 });
      expect(mod).toContain('偶尔');
    });

    it('ends with period', () => {
      const mod = linguisticStyleToPromptModifier(DEFAULT_LINGUISTIC_STYLE);
      expect(mod.endsWith('。')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // traitsToPromptModifier
  // -----------------------------------------------------------------------
  describe('traitsToPromptModifier', () => {
    it('includes all sections', () => {
      const mod = traitsToPromptModifier(DEFAULT_TRAITS_PROFILE);
      expect(mod).toContain('人格类型');
      expect(mod).toContain('性格特质');
      expect(mod).toContain('语言风格');
      expect(mod).toContain('核心动机');
    });

    it('includes MBTI type', () => {
      const mod = traitsToPromptModifier(DEFAULT_TRAITS_PROFILE);
      expect(mod).toContain('INTJ');
    });

    it('includes motivation', () => {
      const mod = traitsToPromptModifier(DEFAULT_TRAITS_PROFILE);
      expect(mod).toContain('帮助用户达成目标');
    });

    it('handles partial traits', () => {
      const mod = traitsToPromptModifier({ mbti: 'ENFP' } as any);
      expect(mod).toContain('ENFP');
      // Should not crash on missing ocean/linguisticStyle
    });
  });

  // -----------------------------------------------------------------------
  // validateTraitsProfile
  // -----------------------------------------------------------------------
  describe('validateTraitsProfile', () => {
    it('validates correct profile', () => {
      const result = validateTraitsProfile(DEFAULT_TRAITS_PROFILE);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('rejects invalid MBTI', () => {
      const result = validateTraitsProfile({ mbti: 'XXXX' as any });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid MBTI');
    });

    it('rejects OCEAN values out of range', () => {
      const result = validateTraitsProfile({
        ocean: { ...DEFAULT_OCEAN, openness: 1.5 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('openness');
    });

    it('rejects negative OCEAN values', () => {
      const result = validateTraitsProfile({
        ocean: { ...DEFAULT_OCEAN, neuroticism: -0.1 },
      });
      expect(result.valid).toBe(false);
    });

    it('rejects linguisticStyle values out of range', () => {
      const result = validateTraitsProfile({
        linguisticStyle: { ...DEFAULT_LINGUISTIC_STYLE, formality: 2 },
      });
      expect(result.valid).toBe(false);
    });

    it('passes for empty partial profile', () => {
      const result = validateTraitsProfile({});
      expect(result.valid).toBe(true);
    });

    it('accepts all valid MBTI types', () => {
      const types = ['INTJ', 'ENTP', 'ISFJ', 'ESFP', 'INFP', 'ESTJ', 'ISTP', 'ENFJ'];
      for (const t of types) {
        const result = validateTraitsProfile({ mbti: t as any });
        expect(result.valid).toBe(true);
      }
    });
  });
});
