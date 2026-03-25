/**
 * Proactive Message Steps — Extracted from session/index.ts (Phase 4)
 *
 * The ~600-line `_sendProactiveMessageInternal` function is broken into
 * five focused steps that are called sequentially. Each step receives
 * and returns a shared `ProactiveContext` object.
 */

import type { ChatMessage, MultimodalContent, UserContext } from '../agent/types';
import { createAgent, SYSTEM_PROMPTS, getAllToolsForAI, buildSystemPrompt, formatSkillsForPrompt, type TokenStatsConfig } from '../agent';
import type { AIProvider } from '../../infra/config/schema';
import { StreamingMessageController } from '../../adapter/feishu/card-v2';
import { getFeishuWSClient } from '../../adapter/feishu';
import { getConfig_ } from '../../app';
import { logger } from '../../infra/observability/logger';

// ============================================================================
// Shared context object passed through all steps
// ============================================================================
export interface ProactiveContext {
  sessionId: string;
  channel: string;
  userId: string;
  message: string | MultimodalContent[];
  context?: Record<string, unknown>;
  agentOptions?: { blockedTools?: string[] };

  // Populated by steps
  streamingController?: StreamingMessageController | null;
  systemPrompt?: string;
  selectedModel?: string;
  selectedProvider?: AIProvider;
  imageDescription?: string;
  originalMultimodal?: MultimodalContent[];
  isRecovery?: boolean;
  userContentString?: string;
  response?: string;
}

// ============================================================================
// Step 1: Prepare streaming controller and early "Thinking..." placeholder
// ============================================================================

/**
 * Creates Card V2 streaming controller and sends initial placeholder.
 * Returns the controller (or null if not applicable).
 */
export async function prepareProactiveContext(
  ctx: ProactiveContext,
): Promise<StreamingMessageController | null> {
  let controller: StreamingMessageController | null = null;

  try {
    const config = getConfig_();
    const feishuConfig = config?.feishu;
    const useCardV2 = feishuConfig?.useCardV2 ?? false;

    if (
      ctx.channel === 'feishu' &&
      useCardV2 &&
      ctx.context?.parentMessageId
    ) {
      const feishuClient = getFeishuWSClient();
      if (feishuClient) {
        controller = new StreamingMessageController({
          client: feishuClient,
          parentMessageId: ctx.context.parentMessageId as string,
          chatId: (ctx.context.chatId as string) || '',
          debounceMs: 500,
        });

        await controller.pushContent({ type: 'thinking', thinking: 'Thinking...' });
        logger.info('[ProactiveSteps] Card V2 initialized with Thinking placeholder');
      }
    }
  } catch (error) {
    logger.warn('[ProactiveSteps] Failed to create streaming controller:', error);
  }

  return controller;
}

// ============================================================================
// Step 2: Resolve recipients — session, deep-analysis context, compression
// ============================================================================

/**
 * Resolves session, sets deep-analysis context, handles background compression.
 * Mutates `ctx` to set `systemPrompt`, `selectedModel`, `selectedProvider`, etc.
 *
 * TODO: [Phase 4] Move session-lookup, compression, and prompt-building logic
 * from session/index.ts to this function by injecting dependencies.
 * Currently depends on module-level state (sessions map, agentConfig, compressionLocks).
 */
export function resolveProactiveRecipients(ctx: ProactiveContext): void {
  // Currently a no-op placeholder — logic remains in _sendProactiveMessageInternal.
  // Callers should use this as a documentation anchor.
  logger.debug('[ProactiveSteps] resolveProactiveRecipients (placeholder)');
}

// ============================================================================
// Step 3: Format the user message (multimodal → text, recovery handling)
// ============================================================================

/**
 * Normalises the user message into a plain string.
 */
export function formatProactiveMessage(
  message: string | MultimodalContent[],
  imageDescription?: string,
  originalMultimodal?: MultimodalContent[],
  isRecovery?: boolean,
  existingContent?: string,
): string {
  if (isRecovery && existingContent) {
    return existingContent;
  }

  if (originalMultimodal && imageDescription) {
    const textPart = originalMultimodal.find(p => p.type === 'text');
    const userText = textPart && 'text' in textPart ? textPart.text : '';
    return `[图片] ${userText || '(图片)'} [处理中...]`;
  }

  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message)) {
    const textPart = message.find(p => p.type === 'text');
    const userText = textPart && 'text' in textPart ? textPart.text : '';
    return userText || '[Multimodal message]';
  }

  return 'unknown';
}

// ============================================================================
// Step 4: Deliver the message via agent.chat and streaming
// ============================================================================

/**
 * Calls agent.chat with streaming and smart-timeout support.
 *
 * NOTE: This is a declaration-only stub. The actual chat invocation, timeout
 * handling, and streaming finish logic remains in session/index.ts. Exported
 * for documentation and future dependency-injection refactors.
 */
export async function deliverProactiveMessage(
  ctx: ProactiveContext,
): Promise<string | undefined> {
  logger.debug('[ProactiveSteps] deliverProactiveMessage (placeholder)');
  return ctx.response;
}

// ============================================================================
// Step 5: Handle the result — save messages, trigger extraction, notify channel
// ============================================================================

/**
 * Persists the assistant response, triggers background extraction,
 * notifies channel handlers, and clears deep-analysis context.
 *
 * NOTE: Stub — actual logic remains in session/index.ts.
 */
export async function handleProactiveResult(
  ctx: ProactiveContext,
): Promise<{ success: boolean; response?: string; error?: string }> {
  logger.debug('[ProactiveSteps] handleProactiveResult (placeholder)');
  return { success: true, response: ctx.response };
}
