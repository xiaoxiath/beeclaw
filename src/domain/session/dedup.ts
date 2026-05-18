/**
 * Session Message Deduplication
 *
 * Three-state message processing for Feishu duplicate message protection.
 * Handles: duplicate pushes, process restarts, delivery failures.
 *
 * Extracted from session/index.ts to reduce god-object complexity.
 */

import type { Session, MessageProcessingState } from './index';
import { getLogger } from '../../infra/observability/logger';

const logger = getLogger('session.dedup');

/** Maximum retries for a failed message before permanently giving up */
export const MAX_MESSAGE_RETRY_COUNT = 2;

/** Maximum time (ms) a message can stay in 'processing' state before considered stale */
export const PROCESSING_STALE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/** GC: TTL for processed message entries */
export const MESSAGE_DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** GC: Maximum number of entries to keep */
export const MESSAGE_DEDUP_MAX_SIZE = 10_000;

/**
 * Prune old entries from session.processedMessageIds to bound memory.
 *
 * Phase 1 – TTL cleanup: remove entries older than MESSAGE_DEDUP_TTL_MS.
 * Phase 2 – LRU protection: if still over MESSAGE_DEDUP_MAX_SIZE, sort by
 *           timestamp ascending and delete the oldest entries.
 *
 * @returns number of pruned entries
 */
export function pruneProcessedMessages(session: Session): number {
  if (!session.processedMessageIds) return 0;

  const now = Date.now();
  let pruned = 0;
  const entries = Object.entries(session.processedMessageIds);

  // Phase 1: TTL cleanup
  for (const [msgId, entry] of entries) {
    if (entry === true) {
      // Legacy boolean format – no timestamp available, treat as old
      delete session.processedMessageIds[msgId];
      pruned++;
      continue;
    }
    const state = entry as MessageProcessingState;
    const ts = state.completedAt || state.startedAt;
    if (now - ts > MESSAGE_DEDUP_TTL_MS) {
      delete session.processedMessageIds[msgId];
      pruned++;
    }
  }

  // Phase 2: LRU protection – trim to max size
  const remaining = Object.entries(session.processedMessageIds);
  if (remaining.length > MESSAGE_DEDUP_MAX_SIZE) {
    const sorted = remaining.sort((a, b) => {
      const tsA = a[1] === true ? 0 : ((a[1] as MessageProcessingState).completedAt || (a[1] as MessageProcessingState).startedAt);
      const tsB = b[1] === true ? 0 : ((b[1] as MessageProcessingState).completedAt || (b[1] as MessageProcessingState).startedAt);
      return tsA - tsB; // oldest first
    });
    const toRemove = sorted.length - MESSAGE_DEDUP_MAX_SIZE;
    for (let i = 0; i < toRemove; i++) {
      delete session.processedMessageIds[sorted[i][0]];
      pruned++;
    }
  }

  if (pruned > 0) {
    logger.debug(`[Session] Pruned ${pruned} processed-message entries from session ${session.id}`);
  }
  return pruned;
}

/**
 * Check if a message has already been processed or is currently being processed.
 *
 * Three-state logic:
 * - 'completed' → always skip (already handled)
 * - 'processing' → skip if not stale (someone is handling it)
 * - 'processing' (stale) → allow retry (previous handler likely crashed)
 * - 'failed' → allow retry if retryCount < MAX_MESSAGE_RETRY_COUNT
 * - absent → allow (first time)
 *
 * @param session The session object to check against
 * @param messageId The message ID to check
 * @returns true if message should be SKIPPED, false if it should be processed
 */
export function isMessageProcessed(session: Session | undefined, messageId: string): boolean {
  if (!session || !session.processedMessageIds) {
    return false;
  }

  const entry = session.processedMessageIds[messageId];
  if (!entry) return false;

  // Backward compatibility: old boolean format
  if (entry === true) return true;

  const state = entry as MessageProcessingState;

  // Completed → always skip
  if (state.status === 'completed') return true;

  // Processing → skip unless stale
  if (state.status === 'processing') {
    const elapsed = Date.now() - state.startedAt;
    if (elapsed > PROCESSING_STALE_TIMEOUT_MS) {
      logger.warn(`[Session] Stale processing detected for message ${messageId} (elapsed: ${Math.round(elapsed / 1000)}s). Allowing retry.`);
      return false; // Allow re-processing
    }
    return true; // Still actively processing, skip duplicate
  }

  // Failed → allow retry if under limit
  if (state.status === 'failed') {
    if (state.retryCount >= MAX_MESSAGE_RETRY_COUNT) {
      logger.warn(`[Session] Message ${messageId} permanently failed after ${state.retryCount} retries. Skipping.`);
      return true; // Exhausted retries
    }
    return false; // Allow retry
  }

  return false;
}

/**
 * Get the full processing state for a message.
 * Returns null if no state exists.
 */
export function getMessageState(session: Session | undefined, messageId: string): MessageProcessingState | null {
  if (!session || !session.processedMessageIds) return null;

  const entry = session.processedMessageIds[messageId];
  if (!entry) return null;
  if (entry === true) return { status: 'completed', startedAt: 0, retryCount: 0 };

  return entry as MessageProcessingState;
}

/**
 * Mark a message as 'processing' — called BEFORE agent execution begins.
 * This closes the race window where Feishu re-delivery could bypass dedup.
 *
 * @param session The session object to update
 * @param messageId The message ID to mark
 * @param saveFn Callback to persist the session after mutation
 */
export function markMessageProcessing(
  session: Session | undefined,
  messageId: string,
  saveFn: (session: Session) => void,
): void {
  if (!session) return;

  if (!session.processedMessageIds) {
    session.processedMessageIds = {};
  }

  const existing = session.processedMessageIds[messageId];
  const prevRetryCount = (existing && existing !== true)
    ? (existing as MessageProcessingState).retryCount
    : 0;

  session.processedMessageIds[messageId] = {
    status: 'processing',
    startedAt: Date.now(),
    retryCount: prevRetryCount,
  };
  session.updatedAt = new Date().toISOString();
  saveFn(session);

  logger.debug(`[Session] ⏳ Message marked as processing: ${messageId} (retry #${prevRetryCount})`);
}

/**
 * Mark a message as 'completed' — called AFTER successful reply delivery.
 * Optionally caches the agent response for auditing.
 *
 * @deprecated Use markMessageCompleted() for new code. markMessageProcessed() is kept
 * as an alias for backward compatibility.
 */
export function markMessageProcessed(
  session: Session | undefined,
  messageId: string,
  saveFn: (session: Session) => void,
): void {
  markMessageCompleted(session, messageId, saveFn);
}

/**
 * Mark a message as 'completed' with optional cached response.
 */
export function markMessageCompleted(
  session: Session | undefined,
  messageId: string,
  saveFn: (session: Session) => void,
  response?: string,
  usedCardV2?: boolean,
): void {
  if (!session) return;

  if (!session.processedMessageIds) {
    session.processedMessageIds = {};
  }

  const existing = session.processedMessageIds[messageId];
  const prevRetryCount = (existing && existing !== true)
    ? (existing as MessageProcessingState).retryCount
    : 0;

  session.processedMessageIds[messageId] = {
    status: 'completed',
    startedAt: (existing && existing !== true) ? (existing as MessageProcessingState).startedAt : Date.now(),
    completedAt: Date.now(),
    retryCount: prevRetryCount,
    cachedResponse: response,
    cachedUsedCardV2: usedCardV2,
  };
  session.updatedAt = new Date().toISOString();
  saveFn(session);

  logger.info(`[Session] ✅ Message marked as completed: ${messageId}`);
}

/**
 * Mark a message as 'failed' — called when processing or delivery fails.
 * Increments retry count. Caches partial response if available for delivery-only retry.
 */
export function markMessageFailed(
  session: Session | undefined,
  messageId: string,
  error: string,
  saveFn: (session: Session) => void,
  cachedResponse?: string,
  cachedUsedCardV2?: boolean,
): void {
  if (!session) return;

  if (!session.processedMessageIds) {
    session.processedMessageIds = {};
  }

  const existing = session.processedMessageIds[messageId];
  const prevRetryCount = (existing && existing !== true)
    ? (existing as MessageProcessingState).retryCount
    : 0;

  session.processedMessageIds[messageId] = {
    status: 'failed',
    startedAt: (existing && existing !== true) ? (existing as MessageProcessingState).startedAt : Date.now(),
    failedAt: Date.now(),
    retryCount: prevRetryCount + 1,
    error,
    cachedResponse,
    cachedUsedCardV2,
  };
  session.updatedAt = new Date().toISOString();
  saveFn(session);

  logger.warn(`[Session] ❌ Message marked as failed: ${messageId} (retry #${prevRetryCount + 1}, error: ${error})`);
}

/**
 * Get cached agent response for delivery-only retry.
 * Returns null if no cached response exists.
 */
export function getCachedAgentResponse(session: Session | undefined, messageId: string): { response: string; usedCardV2: boolean } | null {
  if (!session || !session.processedMessageIds) return null;

  const entry = session.processedMessageIds[messageId];
  if (!entry || entry === true) return null;

  const state = entry as MessageProcessingState;
  if (state.cachedResponse) {
    return {
      response: state.cachedResponse,
      usedCardV2: state.cachedUsedCardV2 || false,
    };
  }
  return null;
}
