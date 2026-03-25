/**
 * Tests for Fix 1: Three-State Message Processing
 *
 * Covers:
 * - MessageProcessingState transitions
 * - markMessageProcessing / markMessageCompleted / markMessageFailed
 * - isMessageProcessed() with all states
 * - getMessageState()
 * - getCachedAgentResponse()
 * - Stale processing detection
 * - Retry count exhaustion
 * - Backward compatibility with old boolean format
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to mock the session store since these are in-memory
// Create a minimal mock that simulates the session map
const sessions = new Map<string, any>();

// Mock saveSession to just update the map
function saveSession(session: any) {
  sessions.set(session.id, session);
}

function getSession(id: string) {
  return sessions.get(id) || null;
}

// Import types (these are just interfaces, safe to re-define for testing)
interface MessageProcessingState {
  status: 'processing' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  failedAt?: number;
  retryCount: number;
  cachedResponse?: string;
  cachedUsedCardV2?: boolean;
  error?: string;
}

const MAX_MESSAGE_RETRY_COUNT = 2;
const PROCESSING_STALE_TIMEOUT_MS = 15 * 60 * 1000;

// Re-implement the functions under test using same logic as patched code
// (This tests the LOGIC, not the integration — integration tests go elsewhere)

function isMessageProcessed(sessionId: string, messageId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || !session.processedMessageIds) return false;

  const entry = session.processedMessageIds[messageId];
  if (!entry) return false;
  if (entry === true) return true;

  const state = entry as MessageProcessingState;
  if (state.status === 'completed') return true;

  if (state.status === 'processing') {
    const elapsed = Date.now() - state.startedAt;
    if (elapsed > PROCESSING_STALE_TIMEOUT_MS) return false;
    return true;
  }

  if (state.status === 'failed') {
    if (state.retryCount >= MAX_MESSAGE_RETRY_COUNT) return true;
    return false;
  }

  return false;
}

function markMessageProcessing(sessionId: string, messageId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (!session.processedMessageIds) session.processedMessageIds = {};

  const existing = session.processedMessageIds[messageId];
  const prevRetryCount = (existing && existing !== true) ? existing.retryCount : 0;

  session.processedMessageIds[messageId] = {
    status: 'processing',
    startedAt: Date.now(),
    retryCount: prevRetryCount,
  };
  saveSession(session);
}

function markMessageCompleted(sessionId: string, messageId: string, response?: string, usedCardV2?: boolean): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (!session.processedMessageIds) session.processedMessageIds = {};

  const existing = session.processedMessageIds[messageId];
  const prevRetryCount = (existing && existing !== true) ? existing.retryCount : 0;

  session.processedMessageIds[messageId] = {
    status: 'completed',
    startedAt: (existing && existing !== true) ? existing.startedAt : Date.now(),
    completedAt: Date.now(),
    retryCount: prevRetryCount,
    cachedResponse: response,
    cachedUsedCardV2: usedCardV2,
  };
  saveSession(session);
}

function markMessageFailed(sessionId: string, messageId: string, error: string, cachedResponse?: string, cachedUsedCardV2?: boolean): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (!session.processedMessageIds) session.processedMessageIds = {};

  const existing = session.processedMessageIds[messageId];
  const prevRetryCount = (existing && existing !== true) ? existing.retryCount : 0;

  session.processedMessageIds[messageId] = {
    status: 'failed',
    startedAt: (existing && existing !== true) ? existing.startedAt : Date.now(),
    failedAt: Date.now(),
    retryCount: prevRetryCount + 1,
    error,
    cachedResponse,
    cachedUsedCardV2,
  };
  saveSession(session);
}

function getMessageState(sessionId: string, messageId: string): MessageProcessingState | null {
  const session = sessions.get(sessionId);
  if (!session || !session.processedMessageIds) return null;
  const entry = session.processedMessageIds[messageId];
  if (!entry) return null;
  if (entry === true) return { status: 'completed', startedAt: 0, retryCount: 0 };
  return entry as MessageProcessingState;
}

function getCachedAgentResponse(sessionId: string, messageId: string): { response: string; usedCardV2: boolean } | null {
  const session = sessions.get(sessionId);
  if (!session || !session.processedMessageIds) return null;
  const entry = session.processedMessageIds[messageId];
  if (!entry || entry === true) return null;
  const state = entry as MessageProcessingState;
  if (state.cachedResponse) return { response: state.cachedResponse, usedCardV2: state.cachedUsedCardV2 || false };
  return null;
}

// =========================================================
// Tests
// =========================================================

describe('Three-State Message Processing', () => {
  const SID = 'test-session';
  const MID = 'msg_001';

  beforeEach(() => {
    sessions.clear();
    sessions.set(SID, { id: SID, processedMessageIds: {} });
  });

  describe('isMessageProcessed', () => {
    it('returns false for unknown message', () => {
      expect(isMessageProcessed(SID, 'unknown')).toBe(false);
    });

    it('returns false for non-existent session', () => {
      expect(isMessageProcessed('no-session', MID)).toBe(false);
    });

    it('returns true for completed message', () => {
      markMessageCompleted(SID, MID, 'response');
      expect(isMessageProcessed(SID, MID)).toBe(true);
    });

    it('returns true for message currently being processed', () => {
      markMessageProcessing(SID, MID);
      expect(isMessageProcessed(SID, MID)).toBe(true);
    });

    it('returns false for stale processing (exceeded timeout)', () => {
      markMessageProcessing(SID, MID);
      // Manually backdate the startedAt
      const session = sessions.get(SID)!;
      (session.processedMessageIds[MID] as any).startedAt = Date.now() - PROCESSING_STALE_TIMEOUT_MS - 1000;
      expect(isMessageProcessed(SID, MID)).toBe(false);
    });

    it('returns false for failed message under retry limit', () => {
      markMessageFailed(SID, MID, 'delivery error');
      expect(isMessageProcessed(SID, MID)).toBe(false);
    });

    it('returns true for failed message that exhausted retries', () => {
      // Fail MAX_MESSAGE_RETRY_COUNT times
      for (let i = 0; i < MAX_MESSAGE_RETRY_COUNT; i++) {
        markMessageProcessing(SID, MID);
        markMessageFailed(SID, MID, `error attempt ${i + 1}`);
      }
      expect(isMessageProcessed(SID, MID)).toBe(true);
    });

    it('backward compatible with old boolean format', () => {
      const session = sessions.get(SID)!;
      session.processedMessageIds[MID] = true;
      expect(isMessageProcessed(SID, MID)).toBe(true);
    });
  });

  describe('State Transitions', () => {
    it('processing → completed', () => {
      markMessageProcessing(SID, MID);
      expect(getMessageState(SID, MID)?.status).toBe('processing');

      markMessageCompleted(SID, MID, 'hello', true);
      const state = getMessageState(SID, MID)!;
      expect(state.status).toBe('completed');
      expect(state.cachedResponse).toBe('hello');
      expect(state.cachedUsedCardV2).toBe(true);
      expect(state.completedAt).toBeGreaterThan(0);
    });

    it('processing → failed', () => {
      markMessageProcessing(SID, MID);
      markMessageFailed(SID, MID, 'timeout', 'partial response', false);

      const state = getMessageState(SID, MID)!;
      expect(state.status).toBe('failed');
      expect(state.retryCount).toBe(1);
      expect(state.error).toBe('timeout');
      expect(state.cachedResponse).toBe('partial response');
    });

    it('failed → processing (retry) → completed', () => {
      markMessageProcessing(SID, MID);
      markMessageFailed(SID, MID, 'network error', 'cached resp');

      // Retry
      markMessageProcessing(SID, MID);
      const processingState = getMessageState(SID, MID)!;
      expect(processingState.status).toBe('processing');
      expect(processingState.retryCount).toBe(1); // Preserved from failure

      markMessageCompleted(SID, MID, 'final response');
      expect(getMessageState(SID, MID)?.status).toBe('completed');
    });

    it('retry count increments on each failure', () => {
      markMessageProcessing(SID, MID);
      markMessageFailed(SID, MID, 'err1');
      expect(getMessageState(SID, MID)?.retryCount).toBe(1);

      markMessageProcessing(SID, MID);
      markMessageFailed(SID, MID, 'err2');
      expect(getMessageState(SID, MID)?.retryCount).toBe(2);
    });

    it('preserves startedAt across transitions', () => {
      markMessageProcessing(SID, MID);
      const originalStart = getMessageState(SID, MID)!.startedAt;

      markMessageFailed(SID, MID, 'err');
      expect(getMessageState(SID, MID)?.startedAt).toBe(originalStart);

      markMessageProcessing(SID, MID);
      // New processing should have new startedAt
      expect(getMessageState(SID, MID)?.startedAt).toBeGreaterThanOrEqual(originalStart);
    });
  });

  describe('getCachedAgentResponse', () => {
    it('returns null for unknown message', () => {
      expect(getCachedAgentResponse(SID, 'unknown')).toBeNull();
    });

    it('returns null for old boolean format', () => {
      const session = sessions.get(SID)!;
      session.processedMessageIds[MID] = true;
      expect(getCachedAgentResponse(SID, MID)).toBeNull();
    });

    it('returns cached response from failed message', () => {
      markMessageFailed(SID, MID, 'delivery timeout', 'the AI response', true);
      const cached = getCachedAgentResponse(SID, MID);
      expect(cached).not.toBeNull();
      expect(cached!.response).toBe('the AI response');
      expect(cached!.usedCardV2).toBe(true);
    });

    it('returns null if no cachedResponse in state', () => {
      markMessageFailed(SID, MID, 'error');
      expect(getCachedAgentResponse(SID, MID)).toBeNull();
    });
  });

  describe('getMessageState', () => {
    it('returns null for unknown', () => {
      expect(getMessageState(SID, 'nope')).toBeNull();
    });

    it('returns synthetic state for old boolean', () => {
      const session = sessions.get(SID)!;
      session.processedMessageIds[MID] = true;
      const state = getMessageState(SID, MID);
      expect(state).not.toBeNull();
      expect(state!.status).toBe('completed');
    });
  });
});
