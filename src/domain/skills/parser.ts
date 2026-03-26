/**
 * SkillParser — Extracted from SkillStore god-object (Phase 4)
 *
 * Handles SKILL.md frontmatter parsing and formatting.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { SkillFrontmatter } from './types';
import { SkillFrontmatterSchema } from './types';
import { safeJsonParse } from '../../infra/utils';

export class SkillParser {
  /**
   * Parse a SKILL.md file into frontmatter + body.
   */
  parseSkillMd(content: string): { frontmatter: SkillFrontmatter; body: string } {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      return { frontmatter: { name: '', description: '' }, body: content };
    }

    try {
      const yamlContent = frontmatterMatch[1];
      const parsed = parseYaml(yamlContent);
      const frontmatter = SkillFrontmatterSchema.parse(parsed);
      const body = frontmatterMatch[2];
      return { frontmatter, body };
    } catch {
      return { frontmatter: { name: '', description: '' }, body: content };
    }
  }

  /**
   * Format frontmatter + body into a SKILL.md string.
   */
  formatSkillMd(frontmatter: SkillFrontmatter, body: string): string {
    const yamlContent = stringifyYaml(frontmatter as Record<string, unknown>, {
      lineWidth: 0,
    }).trim();
    return `---\n${yamlContent}\n---\n\n${body.trim()}\n`;
  }

  /**
   * B-P1-04: Parse JSON content from LLM responses that may contain markdown
   * code blocks or other surrounding text.
   */
  parseJsonFromLLM<T = unknown>(text: string, fallback?: T): T | undefined {
    return safeJsonParse<T>(text, fallback);
  }
}

/** Shared singleton instance. */
let _instance: SkillParser | null = null;
export function getSkillParser(): SkillParser {
  if (!_instance) _instance = new SkillParser();
  return _instance;
}
