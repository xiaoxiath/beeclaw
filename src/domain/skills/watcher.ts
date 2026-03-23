/**
 * SkillWatcher — Extracted from SkillStore god-object (Phase 4)
 *
 * Watches the skills directory for SKILL.md changes and
 * triggers cache invalidation via a callback.
 */

import { watch, type FSWatcher } from 'fs';
import { logger } from '../../infra/observability/logger';

export class SkillWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private basePath: string,
    private onInvalidate: () => void,
  ) {}

  /** Start watching the skills directory. */
  start(): void {
    if (this.watcher) return;

    try {
      this.watcher = watch(
        this.basePath,
        { recursive: true, persistent: false },
        (eventType, filename) => {
          if (!filename) return;
          if (filename.endsWith('SKILL.md') || filename.includes('SKILL.md')) {
            this.handleChange(eventType, filename);
          }
        },
      );

      this.watcher.on('error', (error) => {
        logger.error(`[SkillWatcher] Watch error:`, error);
      });

      logger.info(`[SkillWatcher] Watching ${this.basePath} for skill changes`);
    } catch (error) {
      logger.warn(`[SkillWatcher] Failed to start watcher:`, error);
    }
  }

  /** Handle a skill file change with 250ms debounce. */
  private handleChange(eventType: string, filename: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      logger.info(`[SkillWatcher] Skill changed: ${filename} (${eventType}), invalidating cache`);
      this.onInvalidate();
    }, 250);
  }

  /** Stop watching and clean up timers. */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('[SkillWatcher] Stopped watching skills directory');
    }
  }
}
