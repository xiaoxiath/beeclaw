/**
 * SkillCache — Extracted from SkillStore god-object (Phase 4)
 *
 * Manages in-memory skill caching with invalidation support.
 */

import type { Skill } from './types';

export class SkillCache {
  private skills: Skill[] | null = null;
  private invalidated: boolean = true;

  /** Return cached skills if still valid, or null. */
  get(): Skill[] | null {
    if (this.skills && !this.invalidated) return this.skills;
    return null;
  }

  /** Store skills in cache and mark as valid. */
  set(skills: Skill[]): void {
    this.skills = skills;
    this.invalidated = false;
  }

  /** Mark cache as needing refresh. */
  invalidate(): void {
    this.skills = null;
    this.invalidated = true;
  }

  /** Whether cache is currently invalidated. */
  get isInvalidated(): boolean {
    return this.invalidated;
  }
}
