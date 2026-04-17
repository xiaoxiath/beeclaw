/**
 * Memory Manager — Extracted from Agent god-object (A-P1-05)
 *
 * Encapsulates memory refresh, recording, and system-prompt injection logic
 * that was previously scattered across Agent.refreshMemory() and inline
 * recording blocks in Agent.chat() / Agent.chatStream().
 */

import { getMemoryStore } from '../memory';
import { getLifecycleManager } from '../memory/lifecycle-manager';
import { getSkillStore } from '../skills/store';
import { buildSystemPrompt, formatSkillsForPrompt } from './tools';
import { estimateMessageTokens } from './context';
import { logger } from '../../infra/observability/logger';
import type { ChatMessage } from './types';
import type { IHookRunner } from '../ports';

/**
 * Lightweight djb2 hash for dirty-checking prompt stability (KV-Cache).
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export class MemoryManager {
  private _lastStableHash: string = '';

  /**
   * Refresh memory context and rebuild the stable system prompt.
   *
   * Returns the delta in estimated tokens so the caller can update its own
   * `estimatedTokens` counter without reaching into private state.
   *
   * @returns token delta (positive = prompt grew, negative = shrank, 0 = unchanged / error)
   */
  refreshMemory(
    baseSystemPrompt: string,
    messages: ChatMessage[],
    hookRunner?: IHookRunner | null,
  ): number {
    try {
      const memoryStore = getMemoryStore();
      const coreContext = memoryStore.getCoreContext();

      // [Upgrade] Apply memory fence to prevent injection via recalled content.
      // getCoreContext() always returns { user: string; soul: string; facts: string }.
      // We fence each string field to prevent recalled memory from acting as instructions.
      const fencedContext: { user: string; soul: string; facts: string } = { ...coreContext };
      try {
        const { fenceMemoryContent } = require('../../../packages/bee/src/safety/memory-fence');
        fencedContext.user = fenceMemoryContent(coreContext.user);
        fencedContext.soul = fenceMemoryContent(coreContext.soul);
        fencedContext.facts = fenceMemoryContent(coreContext.facts);
      } catch {
        // Memory fence module not available — fencedContext stays as-is (unmodified copy)
      }

      let skillsPrompt = '';
      try {
        const skillStore = getSkillStore();
        const skills = skillStore.list();
        if (skills.length > 0) {
          const skillsForPrompt = skills.map((s: any) => ({
            name: s.name,
            description: s.description,
            triggers: s.triggers,
          }));

          logger.info('[MemoryManager] Injecting skills metadata:', {
            count: skillsForPrompt.length,
            sample: skillsForPrompt.slice(0, 3).map((s: any) => ({
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

      const contextWithSkills = {
        ...fencedContext,
        skills: skillsPrompt,
      };

      if (hookRunner) {
        hookRunner.runBeforePromptBuild({
          basePrompt: baseSystemPrompt,
          context: contextWithSkills,
          timestamp: new Date().toISOString(),
        }).catch((err: unknown) => {
          console.warn('[MemoryManager] before_prompt_build hook error:', err);
        });
      }

      const freshPrompt = buildSystemPrompt(baseSystemPrompt, contextWithSkills);

      // [KV-Cache] Skip rebuild if content hasn't actually changed.
      const promptHash = simpleHash(freshPrompt);
      if (promptHash === this._lastStableHash) {
        logger.debug('[MemoryManager] Memory unchanged — skipping system prompt rebuild (KV Cache preserved)');
        return 0;
      }
      this._lastStableHash = promptHash;

      const systemIndex = messages.findIndex(m => m.role === 'system');
      let tokenDelta = 0;

      if (systemIndex >= 0) {
        const oldTokens = estimateMessageTokens(messages[systemIndex]);
        messages[systemIndex].content = freshPrompt;
        const newTokens = estimateMessageTokens(messages[systemIndex]);
        tokenDelta = newTokens - oldTokens;
      } else {
        const msg: ChatMessage = { role: 'system', content: freshPrompt };
        messages.unshift(msg);
        tokenDelta = estimateMessageTokens(msg);
      }

      logger.info('[MemoryManager] Memory refreshed — stable system prompt updated');
      return tokenDelta;
    } catch (error) {
      console.warn('[MemoryManager] Failed to refresh memory:', error);
      return 0;
    }
  }

  /**
   * Record a conversation turn to the memory store and trigger lifecycle check.
   */
  async recordConversation(userMessage: string, assistantMessage: string): Promise<void> {
    try {
      const memoryStore = getMemoryStore();
      await memoryStore.recordConversation({
        timestamp: new Date().toISOString(),
        source: 'agent',
        user: userMessage,
        assistant: assistantMessage,
      });

      // Trigger lightweight lifecycle check after recording
      try {
        const lifecycleManager = getLifecycleManager();
        await lifecycleManager.checkAfterRecord();
      } catch {
        // Lifecycle check is optional, don't block main flow
      }
    } catch (error) {
      logger.debug('Memory might not be initialized:', error);
    }
  }
}
