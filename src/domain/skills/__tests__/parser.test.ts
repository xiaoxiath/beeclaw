import { describe, it, expect } from 'bun:test';

import { SkillParser, getSkillParser } from '../parser';

describe('SkillParser', () => {
  const parser = new SkillParser();

  describe('parseSkillMd', () => {
    it('should parse valid frontmatter and body', () => {
      const content = `---
name: my-skill
description: A test skill
---

## Steps
1. Do something`;

      const { frontmatter, body } = parser.parseSkillMd(content);
      expect(frontmatter.name).toBe('my-skill');
      expect(frontmatter.description).toBe('A test skill');
      expect(body).toContain('## Steps');
    });

    it('should handle missing frontmatter', () => {
      const content = '## No Frontmatter\nJust body content';
      const { frontmatter, body } = parser.parseSkillMd(content);
      expect(frontmatter.name).toBe('');
      expect(body).toBe(content);
    });

    it('should handle invalid YAML in frontmatter', () => {
      const content = `---
: invalid yaml [[[
---

Body here`;
      const { frontmatter } = parser.parseSkillMd(content);
      expect(frontmatter.name).toBe('');
    });
  });

  describe('formatSkillMd', () => {
    it('should produce valid SKILL.md format', () => {
      const result = parser.formatSkillMd(
        { name: 'test', description: 'A skill' },
        '## Steps\n1. Do it',
      );
      expect(result).toContain('---');
      expect(result).toContain('name: test');
      expect(result).toContain('## Steps');
    });

    it('should round-trip parse/format', () => {
      const original = `---
name: roundtrip
description: Test roundtrip
---

## Content
Hello world`;
      const { frontmatter, body } = parser.parseSkillMd(original);
      const formatted = parser.formatSkillMd(frontmatter, body);
      expect(formatted).toContain('name: roundtrip');
      expect(formatted).toContain('## Content');
    });
  });

  describe('parseJsonFromLLM', () => {
    it('should parse plain JSON', () => {
      const result = parser.parseJsonFromLLM<{ x: number }>('{"x": 42}');
      expect(result).toEqual({ x: 42 });
    });

    it('should parse JSON from markdown code block', () => {
      const result = parser.parseJsonFromLLM<{ val: string }>('```json\n{"val": "hello"}\n```');
      expect(result).toEqual({ val: 'hello' });
    });

    it('should return fallback for invalid JSON', () => {
      const result = parser.parseJsonFromLLM<number>('not json', 99);
      expect(result).toBe(99);
    });

    it('should return undefined for invalid JSON without fallback', () => {
      const result = parser.parseJsonFromLLM('not json at all');
      expect(result).toBeUndefined();
    });
  });

  describe('getSkillParser', () => {
    it('should return a singleton', () => {
      const a = getSkillParser();
      const b = getSkillParser();
      expect(a).toBe(b);
    });

    it('should be an instance of SkillParser', () => {
      expect(getSkillParser()).toBeInstanceOf(SkillParser);
    });
  });
});
