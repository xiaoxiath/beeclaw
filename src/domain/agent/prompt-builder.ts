/**
 * Prompt Builder — System prompt construction and assembly logic.
 *
 * Responsible for:
 * - Loading core memory context
 * - Loading skill metadata
 * - Assembling the final system prompt from components
 *
 * Used by the agent-factory to prepare the system prompt before
 * constructing the Agent instance.
 *
 * Extracted from the createAgent() function in the Agent god-object (index.ts).
 */

import { buildSystemPrompt, formatSkillsForPrompt, SYSTEM_PROMPTS } from './tools';
import { getMemoryStore } from '../memory';
import { getSkillStore } from '../skills/store';
import { logger } from '../../infra/observability/logger';

export interface PromptBuildOptions {
  /** Base system prompt; defaults to SYSTEM_PROMPTS.default */
  systemPrompt?: string;
  /** Whether to load core memory into the prompt. Defaults to true. */
  loadCoreMemory?: boolean;
}

/**
 * Build a fully-assembled system prompt with core memory and skill metadata.
 *
 * Steps:
 * 1. Start from the base prompt (or SYSTEM_PROMPTS.default)
 * 2. Load core memory context from MemoryStore
 * 3. Load skill metadata from SkillStore
 * 4. Merge everything via buildSystemPrompt()
 *
 * If memory or skill stores are not initialized the base prompt is returned
 * unchanged (graceful degradation).
 */
export function assembleSystemPrompt(opts: PromptBuildOptions): string {
  let systemPrompt = opts.systemPrompt || SYSTEM_PROMPTS.default;

  if (opts.loadCoreMemory !== false) {
    try {
      const memoryStore = getMemoryStore();
      const coreContext = memoryStore.getCoreContext();

      let skillsPrompt = '';
      try {
        const skillStore = getSkillStore();
        const skills = skillStore.list();
        if (skills.length > 0) {
          const skillsForPrompt = skills.map(s => ({
            name: s.name,
            description: s.description,
            triggers: s.triggers,
          }));

          // Debug: Log skills metadata being injected
          logger.info('[Agent] 🎯 Injecting skills metadata:', {
            count: skillsForPrompt.length,
            sample: skillsForPrompt.slice(0, 3).map(s => ({
              name: s.name,
              hasDescription: !!s.description,
              triggerCount: s.triggers?.length || 0,
              triggers: s.triggers?.slice(0, 2),
            })),
          });

          skillsPrompt = formatSkillsForPrompt(skillsForPrompt);
        }
      } catch (error) {
        logger.debug('SkillStore not initialized:', error);
      }

      systemPrompt = buildSystemPrompt(systemPrompt, {
        ...coreContext,
        skills: skillsPrompt,
      });
    } catch (error) {
      logger.debug('Memory store not initialized, use base prompt:', error);
    }
  }

  return systemPrompt;
}
