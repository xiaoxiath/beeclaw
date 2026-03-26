/**
 * Proactive Messaging Utilities
 *
 * Functions for injecting proactive task results into sessions
 * and retrieving recent session history for context.
 *
 * Extracted from session/index.ts to reduce god-object complexity.
 *
 * NOTE: The core sendProactiveMessage / _sendProactiveMessageInternal functions
 * remain in index.ts because they are tightly coupled with session state,
 * agent config, compression logic, and streaming controllers. Extracting them
 * would require passing 8+ module-level variables or creating circular dependencies.
 */

import type { Session, SessionMessage } from './index';
import { logger } from '../../infra/observability/logger';

/**
 * [AUDIT FIX M-02] Inject proactive task result into a user's active session.
 *
 * This enables bidirectional context flow between scheduled tasks and user conversations.
 * When a proactive task completes, its result can be injected into the user's session
 * so the user can reference it in subsequent interactions.
 *
 * @param session The target session object (must already be resolved by caller)
 * @param result The proactive task result to inject
 * @param saveFn Callback to persist the session after mutation
 * @returns true if injection succeeded, false if session was null
 */
export function injectProactiveResult(
  session: Session | undefined,
  result: { source: string; content: string; timestamp?: number },
  saveFn: (session: Session) => void,
): boolean {
  if (!session) {
    logger.warn(`[Session] Cannot inject proactive result: session not found`);
    return false;
  }

  const ts = result.timestamp ? new Date(result.timestamp).toISOString() : new Date().toISOString();

  session.messages.push({
    role: 'system',
    content: `[定时任务结果 - ${result.source}]\n${result.content}`,
    timestamp: ts,
    _meta: {
      source: 'proactive',
    },
  });

  session.updatedAt = ts;
  saveFn(session);

  logger.info(`[Session] 📥 Proactive result injected into session ${session.id} from ${result.source}`);
  return true;
}

/**
 * [AUDIT FIX M-02] Load recent conversation history for a session.
 * Used by proactive task handlers to inherit user context.
 */
export function getRecentSessionHistory(
  session: Session | null | undefined,
  maxMessages: number = 10,
): SessionMessage[] {
  if (!session || session.messages.length === 0) return [];

  return session.messages.slice(-maxMessages);
}
