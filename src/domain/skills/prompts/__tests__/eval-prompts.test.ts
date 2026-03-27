import { describe, it, expect } from 'bun:test';

import { TRIGGER_CHECK_PROMPT, OUTPUT_QUALITY_PROMPT } from '../eval-prompts';

describe('eval-prompts', () => {
  describe('TRIGGER_CHECK_PROMPT', () => {
    it('should be a non-empty string', () => {
      expect(typeof TRIGGER_CHECK_PROMPT).toBe('string');
      expect(TRIGGER_CHECK_PROMPT.length).toBeGreaterThan(100);
    });

    it('should contain template variables', () => {
      expect(TRIGGER_CHECK_PROMPT).toContain('{{skillName}}');
      expect(TRIGGER_CHECK_PROMPT).toContain('{{skillDescription}}');
      expect(TRIGGER_CHECK_PROMPT).toContain('{{userMessage}}');
    });

    it('should contain expected output fields', () => {
      expect(TRIGGER_CHECK_PROMPT).toContain('"triggered"');
      expect(TRIGGER_CHECK_PROMPT).toContain('"confidence"');
      expect(TRIGGER_CHECK_PROMPT).toContain('"reason"');
    });
  });

  describe('OUTPUT_QUALITY_PROMPT', () => {
    it('should be a non-empty string', () => {
      expect(typeof OUTPUT_QUALITY_PROMPT).toBe('string');
      expect(OUTPUT_QUALITY_PROMPT.length).toBeGreaterThan(100);
    });

    it('should contain template variables', () => {
      expect(OUTPUT_QUALITY_PROMPT).toContain('{{skillContent}}');
      expect(OUTPUT_QUALITY_PROMPT).toContain('{{userMessage}}');
      expect(OUTPUT_QUALITY_PROMPT).toContain('{{expectedBehavior}}');
      expect(OUTPUT_QUALITY_PROMPT).toContain('{{criteria}}');
    });

    it('should contain expected output fields', () => {
      expect(OUTPUT_QUALITY_PROMPT).toContain('"score"');
      expect(OUTPUT_QUALITY_PROMPT).toContain('"strengths"');
      expect(OUTPUT_QUALITY_PROMPT).toContain('"weaknesses"');
    });
  });
});
