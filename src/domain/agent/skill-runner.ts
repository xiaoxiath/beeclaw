/**
 * SkillRunner — Extracted from Agent god-object (Phase 4)
 *
 * Wraps SkillEnforcementEngine to provide query matching,
 * output validation, retry prompting, and usage tracking.
 */

import { SkillEnforcementEngine, type SkillMatchResult } from '../skills/enforcement';
import { logger } from '../../infra/observability/logger';

export class SkillRunner {
  private enforcement: SkillEnforcementEngine | null = null;
  private usedSkills: Set<string> = new Set();

  init(engine: SkillEnforcementEngine): void { this.enforcement = engine; }
  get available(): boolean { return this.enforcement !== null; }

  resetTurn(): void { this.usedSkills.clear(); }

  trackSkillUsage(skillName: string): void {
    this.usedSkills.add(skillName);
    logger.info(`[SkillRunner] Tracking skill: ${skillName}`);
  }

  getUsedSkills(): Set<string> { return new Set(this.usedSkills); }

  matchSkillsForQuery(query: string): SkillMatchResult | undefined {
    if (!this.enforcement) return undefined;
    return this.enforcement.matchSkillsForQuery(query);
  }

  validateOutputCompleteness(output: string, matchedSkills: SkillMatchResult['skills']): string[] {
    if (!this.enforcement) return [];
    return this.enforcement.validateOutputCompleteness(output, matchedSkills.map(s => s.skill ?? s) as any[]);
  }

  buildRetryPrompt(issues: string[]): string {
    if (!this.enforcement) return '';
    return this.enforcement.buildRetryPrompt(issues);
  }

  getSkillsPrompt(skills: Array<{ name: string; description: string; triggers?: string[] }>): string {
    if (skills.length === 0) return '';
    return skills.map(s =>
      `- **${s.name}**: ${s.description}` +
      (s.triggers?.length ? ` (triggers: ${s.triggers.join(', ')})` : ''),
    ).join('\n');
  }

  clearTraces(): void { this.enforcement?.clearTraces(); }
}
