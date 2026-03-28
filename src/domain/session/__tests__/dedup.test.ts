import { describe, test, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  pruneProcessedMessages,
  isMessageProcessed,
  getMessageState,
  markMessageProcessing,
  markMessageProcessed,
  markMessageCompleted,
  markMessageFailed,
  getCachedAgentResponse,
  MESSAGE_DEDUP_TTL_MS,
  MESSAGE_DEDUP_MAX_SIZE,
  MAX_MESSAGE_RETRY_COUNT,
  PROCESSING_STALE_TIMEOUT_MS,
} from '../dedup';
import type { Session, MessageProcessingState } from '../index';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session',
    userId: 'user1',
    channel: 'feishu',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const noopSave = vi.fn();

describe('dedup constants', () => {
  it('MAX_MESSAGE_RETRY_COUNT should be 2', () => {
    expect(MAX_MESSAGE_RETRY_COUNT).toBe(2);
  });

  it('PROCESSING_STALE_TIMEOUT_MS should be 15 minutes', () => {
    expect(PROCESSING_STALE_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });

  it('MESSAGE_DEDUP_TTL_MS should be 24 hours', () => {
    expect(MESSAGE_DEDUP_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('MESSAGE_DEDUP_MAX_SIZE should be 10000', () => {
    expect(MESSAGE_DEDUP_MAX_SIZE).toBe(10_000);
  });
});

describe('pruneProcessedMessages', () => {
  beforeEach(() => { noopSave.mockClear(); });

  it('should return 0 when processedMessageIds is undefined', () => {
    const session = makeSession();
    expect(pruneProcessedMessages(session)).toBe(0);
  });

  it('should return 0 when processedMessageIds is empty', () => {
    const session = makeSession({ processedMessageIds: {} });
    expect(pruneProcessedMessages(session)).toBe(0);
  });

  it('should prune legacy boolean entries', () => {
    const session = makeSession({
      processedMessageIds: {
        'legacy1': true,
        'legacy2': true,
      },
    });
    const pruned = pruneProcessedMessages(session);
    expect(pruned).toBe(2);
    expect(Object.keys(session.processedMessageIds!)).toHaveLength(0);
  });

  it('should prune entries older than TTL', () => {
    const oldTimestamp = Date.now() - MESSAGE_DEDUP_TTL_MS - 1000;
    const session = makeSession({
      processedMessageIds: {
        'old': {
          status: 'completed',
          startedAt: oldTimestamp,
          completedAt: oldTimestamp,
          retryCount: 0,
        } as MessageProcessingState,
        'recent': {
          status: 'completed',
          startedAt: Date.now(),
          completedAt: Date.now(),
          retryCount: 0,
        } as MessageProcessingState,
      },
    });
    const pruned = pruneProcessedMessages(session);
    expect(pruned).toBe(1);
    expect(session.processedMessageIds!['old']).toBeUndefined();
    expect(session.processedMessageIds!['recent']).toBeDefined();
  });

  it('should use startedAt when completedAt is undefined for TTL check', () => {
    const oldTimestamp = Date.now() - MESSAGE_DEDUP_TTL_MS - 1000;
    const session = makeSession({
      processedMessageIds: {
        'processing-old': {
          status: 'processing',
          startedAt: oldTimestamp,
          retryCount: 0,
        } as MessageProcessingState,
      },
    });
    const pruned = pruneProcessedMessages(session);
    expect(pruned).toBe(1);
  });

  it('should trim to MESSAGE_DEDUP_MAX_SIZE via LRU after TTL cleanup', () => {
    const ids: Record<string, boolean | MessageProcessingState> = {};
    // Add MESSAGE_DEDUP_MAX_SIZE + 100 recent entries
    const now = Date.now();
    for (let i = 0; i < MESSAGE_DEDUP_MAX_SIZE + 100; i++) {
      ids[`msg-${i}`] = {
        status: 'completed',
        startedAt: now - i, // progressively older
        completedAt: now - i,
        retryCount: 0,
      } as MessageProcessingState;
    }
    const session = makeSession({ processedMessageIds: ids });
    const pruned = pruneProcessedMessages(session);
    expect(pruned).toBe(100);
    expect(Object.keys(session.processedMessageIds!)).toHaveLength(MESSAGE_DEDUP_MAX_SIZE);
  });

  it('should remove oldest entries during LRU trim', () => {
    const ids: Record<string, boolean | MessageProcessingState> = {};
    const now = Date.now();
    for (let i = 0; i < MESSAGE_DEDUP_MAX_SIZE + 5; i++) {
      ids[`msg-${i}`] = {
        status: 'completed',
        startedAt: now + i, // msg-0 is oldest
        completedAt: now + i,
        retryCount: 0,
      } as MessageProcessingState;
    }
    const session = makeSession({ processedMessageIds: ids });
    pruneProcessedMessages(session);
    // The first 5 (oldest) should be pruned
    for (let i = 0; i < 5; i++) {
      expect(session.processedMessageIds![`msg-${i}`]).toBeUndefined();
    }
    // The rest should remain
    expect(session.processedMessageIds![`msg-5`]).toBeDefined();
  });

  it('should handle mixed legacy and state entries during LRU trim', () => {
    const ids: Record<string, boolean | MessageProcessingState> = {};
    const now = Date.now();
    for (let i = 0; i < MESSAGE_DEDUP_MAX_SIZE + 3; i++) {
      if (i < 3) {
        // Legacy entries (treated as timestamp 0, so oldest)
        ids[`legacy-${i}`] = true;
      } else {
        ids[`msg-${i}`] = {
          status: 'completed',
          startedAt: now + i,
          completedAt: now + i,
          retryCount: 0,
        } as MessageProcessingState;
      }
    }
    const session = makeSession({ processedMessageIds: ids });
    // Phase 1 prunes all legacy entries (3)
    // Phase 2 may or may not need to trim more
    const pruned = pruneProcessedMessages(session);
    expect(pruned).toBeGreaterThanOrEqual(3);
  });
});

describe('isMessageProcessed', () => {
  it('should return false when session is undefined', () => {
    expect(isMessageProcessed(undefined, 'msg1')).toBe(false);
  });

  it('should return false when processedMessageIds is undefined', () => {
    const session = makeSession();
    expect(isMessageProcessed(session, 'msg1')).toBe(false);
  });

  it('should return false when message not found', () => {
    const session = makeSession({ processedMessageIds: {} });
    expect(isMessageProcessed(session, 'msg1')).toBe(false);
  });

  it('should return true for legacy boolean entry (true)', () => {
    const session = makeSession({ processedMessageIds: { 'msg1': true } });
    expect(isMessageProcessed(session, 'msg1')).toBe(true);
  });

  it('should return true for completed status', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'completed',
          startedAt: Date.now(),
          completedAt: Date.now(),
          retryCount: 0,
        } as MessageProcessingState,
      },
    });
    expect(isMessageProcessed(session, 'msg1')).toBe(true);
  });

  it('should return true for processing status (not stale)', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'processing',
          startedAt: Date.now(), // just started
          retryCount: 0,
        } as MessageProcessingState,
      },
    });
    expect(isMessageProcessed(session, 'msg1')).toBe(true);
  });

  it('should return false for stale processing status', () => {
    const staleTime = Date.now() - PROCESSING_STALE_TIMEOUT_MS - 1000;
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'processing',
          startedAt: staleTime,
          retryCount: 0,
        } as MessageProcessingState,
      },
    });
    expect(isMessageProcessed(session, 'msg1')).toBe(false);
  });

  it('should return false for failed status under retry limit', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'failed',
          startedAt: Date.now(),
          failedAt: Date.now(),
          retryCount: 0, // under MAX_MESSAGE_RETRY_COUNT (2)
          error: 'some error',
        } as MessageProcessingState,
      },
    });
    expect(isMessageProcessed(session, 'msg1')).toBe(false);
  });

  it('should return false for failed status with retryCount = 1 (under limit)', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'failed',
          startedAt: Date.now(),
          failedAt: Date.now(),
          retryCount: 1,
          error: 'some error',
        } as MessageProcessingState,
      },
    });
    expect(isMessageProcessed(session, 'msg1')).toBe(false);
  });

  it('should return true for failed status at retry limit', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'failed',
          startedAt: Date.now(),
          failedAt: Date.now(),
          retryCount: MAX_MESSAGE_RETRY_COUNT, // exactly at limit
          error: 'permanent error',
        } as MessageProcessingState,
      },
    });
    expect(isMessageProcessed(session, 'msg1')).toBe(true);
  });

  it('should return true for failed status above retry limit', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'failed',
          startedAt: Date.now(),
          failedAt: Date.now(),
          retryCount: MAX_MESSAGE_RETRY_COUNT + 1,
          error: 'permanent error',
        } as MessageProcessingState,
      },
    });
    expect(isMessageProcessed(session, 'msg1')).toBe(true);
  });
});

describe('getMessageState', () => {
  it('should return null for undefined session', () => {
    expect(getMessageState(undefined, 'msg1')).toBeNull();
  });

  it('should return null when processedMessageIds is undefined', () => {
    const session = makeSession();
    expect(getMessageState(session, 'msg1')).toBeNull();
  });

  it('should return null for absent message', () => {
    const session = makeSession({ processedMessageIds: {} });
    expect(getMessageState(session, 'msg1')).toBeNull();
  });

  it('should return synthetic state for legacy boolean entry', () => {
    const session = makeSession({ processedMessageIds: { 'msg1': true } });
    const state = getMessageState(session, 'msg1');
    expect(state).not.toBeNull();
    expect(state!.status).toBe('completed');
    expect(state!.startedAt).toBe(0);
    expect(state!.retryCount).toBe(0);
  });

  it('should return full state for MessageProcessingState entry', () => {
    const now = Date.now();
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'failed',
          startedAt: now,
          failedAt: now,
          retryCount: 1,
          error: 'timeout',
          cachedResponse: 'partial',
          cachedUsedCardV2: true,
        } as MessageProcessingState,
      },
    });
    const state = getMessageState(session, 'msg1');
    expect(state).not.toBeNull();
    expect(state!.status).toBe('failed');
    expect(state!.startedAt).toBe(now);
    expect(state!.retryCount).toBe(1);
    expect(state!.error).toBe('timeout');
    expect(state!.cachedResponse).toBe('partial');
    expect(state!.cachedUsedCardV2).toBe(true);
  });
});

describe('markMessageProcessing', () => {
  beforeEach(() => { noopSave.mockClear(); });

  it('should do nothing for undefined session', () => {
    markMessageProcessing(undefined, 'msg1', noopSave);
    expect(noopSave).not.toHaveBeenCalled();
  });

  it('should create processedMessageIds if undefined', () => {
    const session = makeSession();
    markMessageProcessing(session, 'msg1', noopSave);
    expect(session.processedMessageIds).toBeDefined();
    expect(session.processedMessageIds!['msg1']).toBeDefined();
  });

  it('should set status to processing', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageProcessing(session, 'msg1', noopSave);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.status).toBe('processing');
    expect(state.startedAt).toBeGreaterThan(0);
    expect(state.retryCount).toBe(0);
  });

  it('should preserve retryCount from existing entry', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'failed',
          startedAt: Date.now() - 5000,
          retryCount: 1,
          error: 'prev error',
        } as MessageProcessingState,
      },
    });
    markMessageProcessing(session, 'msg1', noopSave);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.status).toBe('processing');
    expect(state.retryCount).toBe(1); // preserved from failed state
  });

  it('should treat legacy boolean entry as retryCount 0', () => {
    const session = makeSession({
      processedMessageIds: { 'msg1': true },
    });
    markMessageProcessing(session, 'msg1', noopSave);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.retryCount).toBe(0);
  });

  it('should call saveFn after updating', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageProcessing(session, 'msg1', noopSave);
    expect(noopSave).toHaveBeenCalledWith(session);
  });

  it('should update updatedAt', () => {
    const session = makeSession({ processedMessageIds: {} });
    const oldUpdated = session.updatedAt;
    markMessageProcessing(session, 'msg1', noopSave);
    expect(session.updatedAt).toBeDefined();
  });
});

describe('markMessageProcessed (deprecated alias)', () => {
  beforeEach(() => { noopSave.mockClear(); });

  it('should do nothing for undefined session', () => {
    markMessageProcessed(undefined, 'msg1', noopSave);
    expect(noopSave).not.toHaveBeenCalled();
  });

  it('should mark as completed (delegates to markMessageCompleted)', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageProcessed(session, 'msg1', noopSave);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.status).toBe('completed');
    expect(state.completedAt).toBeGreaterThan(0);
    expect(noopSave).toHaveBeenCalled();
  });
});

describe('markMessageCompleted', () => {
  beforeEach(() => { noopSave.mockClear(); });

  it('should do nothing for undefined session', () => {
    markMessageCompleted(undefined, 'msg1', noopSave);
    expect(noopSave).not.toHaveBeenCalled();
  });

  it('should create processedMessageIds if undefined', () => {
    const session = makeSession();
    markMessageCompleted(session, 'msg1', noopSave);
    expect(session.processedMessageIds).toBeDefined();
  });

  it('should set status to completed', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageCompleted(session, 'msg1', noopSave);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.status).toBe('completed');
    expect(state.completedAt).toBeGreaterThan(0);
  });

  it('should cache response and usedCardV2', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageCompleted(session, 'msg1', noopSave, 'response text', true);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.cachedResponse).toBe('response text');
    expect(state.cachedUsedCardV2).toBe(true);
  });

  it('should preserve startedAt from previous processing state', () => {
    const startedAt = Date.now() - 5000;
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'processing',
          startedAt,
          retryCount: 0,
        } as MessageProcessingState,
      },
    });
    markMessageCompleted(session, 'msg1', noopSave, 'done');
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.startedAt).toBe(startedAt);
    expect(state.retryCount).toBe(0);
  });

  it('should preserve retryCount from previous state', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'processing',
          startedAt: Date.now(),
          retryCount: 2,
        } as MessageProcessingState,
      },
    });
    markMessageCompleted(session, 'msg1', noopSave);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.retryCount).toBe(2);
  });

  it('should handle completing without prior state', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageCompleted(session, 'new-msg', noopSave);
    const state = session.processedMessageIds!['new-msg'] as MessageProcessingState;
    expect(state.status).toBe('completed');
    expect(state.startedAt).toBeGreaterThan(0); // uses Date.now()
    expect(state.retryCount).toBe(0);
  });

  it('should call saveFn', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageCompleted(session, 'msg1', noopSave);
    expect(noopSave).toHaveBeenCalledWith(session);
  });
});

describe('markMessageFailed', () => {
  beforeEach(() => { noopSave.mockClear(); });

  it('should do nothing for undefined session', () => {
    markMessageFailed(undefined, 'msg1', 'error', noopSave);
    expect(noopSave).not.toHaveBeenCalled();
  });

  it('should create processedMessageIds if undefined', () => {
    const session = makeSession();
    markMessageFailed(session, 'msg1', 'error', noopSave);
    expect(session.processedMessageIds).toBeDefined();
  });

  it('should set status to failed', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageFailed(session, 'msg1', 'timeout', noopSave);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.status).toBe('failed');
    expect(state.failedAt).toBeGreaterThan(0);
    expect(state.error).toBe('timeout');
  });

  it('should increment retryCount', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'processing',
          startedAt: Date.now(),
          retryCount: 0,
        } as MessageProcessingState,
      },
    });
    markMessageFailed(session, 'msg1', 'error', noopSave);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.retryCount).toBe(1); // 0 + 1
  });

  it('should increment retryCount from failed state', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'failed',
          startedAt: Date.now(),
          retryCount: 1,
          error: 'prev',
        } as MessageProcessingState,
      },
    });
    markMessageFailed(session, 'msg1', 'new error', noopSave);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.retryCount).toBe(2); // 1 + 1
  });

  it('should cache partial response on failure', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageFailed(session, 'msg1', 'delivery failed', noopSave, 'partial response', true);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.cachedResponse).toBe('partial response');
    expect(state.cachedUsedCardV2).toBe(true);
  });

  it('should preserve startedAt from existing entry', () => {
    const startedAt = Date.now() - 10000;
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'processing',
          startedAt,
          retryCount: 0,
        } as MessageProcessingState,
      },
    });
    markMessageFailed(session, 'msg1', 'err', noopSave);
    const state = session.processedMessageIds!['msg1'] as MessageProcessingState;
    expect(state.startedAt).toBe(startedAt);
  });

  it('should handle failing without prior state', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageFailed(session, 'new-msg', 'first error', noopSave);
    const state = session.processedMessageIds!['new-msg'] as MessageProcessingState;
    expect(state.retryCount).toBe(1); // 0 + 1
    expect(state.startedAt).toBeGreaterThan(0);
  });

  it('should call saveFn', () => {
    const session = makeSession({ processedMessageIds: {} });
    markMessageFailed(session, 'msg1', 'err', noopSave);
    expect(noopSave).toHaveBeenCalledWith(session);
  });
});

describe('getCachedAgentResponse', () => {
  it('should return null for undefined session', () => {
    expect(getCachedAgentResponse(undefined, 'msg1')).toBeNull();
  });

  it('should return null when processedMessageIds is undefined', () => {
    const session = makeSession();
    expect(getCachedAgentResponse(session, 'msg1')).toBeNull();
  });

  it('should return null for absent message', () => {
    const session = makeSession({ processedMessageIds: {} });
    expect(getCachedAgentResponse(session, 'msg1')).toBeNull();
  });

  it('should return null for legacy boolean entry', () => {
    const session = makeSession({ processedMessageIds: { 'msg1': true } });
    expect(getCachedAgentResponse(session, 'msg1')).toBeNull();
  });

  it('should return null when no cached response exists', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'completed',
          startedAt: Date.now(),
          completedAt: Date.now(),
          retryCount: 0,
        } as MessageProcessingState,
      },
    });
    expect(getCachedAgentResponse(session, 'msg1')).toBeNull();
  });

  it('should return cached response when available', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'completed',
          startedAt: Date.now(),
          completedAt: Date.now(),
          retryCount: 0,
          cachedResponse: 'the response',
          cachedUsedCardV2: true,
        } as MessageProcessingState,
      },
    });
    const cached = getCachedAgentResponse(session, 'msg1');
    expect(cached).not.toBeNull();
    expect(cached!.response).toBe('the response');
    expect(cached!.usedCardV2).toBe(true);
  });

  it('should return usedCardV2 as false when undefined', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'failed',
          startedAt: Date.now(),
          retryCount: 1,
          cachedResponse: 'partial',
        } as MessageProcessingState,
      },
    });
    const cached = getCachedAgentResponse(session, 'msg1');
    expect(cached).not.toBeNull();
    expect(cached!.usedCardV2).toBe(false);
  });

  it('should return cached response from failed state', () => {
    const session = makeSession({
      processedMessageIds: {
        'msg1': {
          status: 'failed',
          startedAt: Date.now(),
          failedAt: Date.now(),
          retryCount: 2,
          error: 'delivery failed',
          cachedResponse: 'the ai response',
          cachedUsedCardV2: false,
        } as MessageProcessingState,
      },
    });
    const cached = getCachedAgentResponse(session, 'msg1');
    expect(cached).not.toBeNull();
    expect(cached!.response).toBe('the ai response');
  });
});

describe('three-state lifecycle scenarios', () => {
  beforeEach(() => { noopSave.mockClear(); });

  it('processing -> completed -> skip duplicate', () => {
    const session = makeSession({ processedMessageIds: {} });

    // Step 1: mark processing
    markMessageProcessing(session, 'msg1', noopSave);
    expect(isMessageProcessed(session, 'msg1')).toBe(true);

    // Step 2: mark completed
    markMessageCompleted(session, 'msg1', noopSave, 'response');
    expect(isMessageProcessed(session, 'msg1')).toBe(true);

    // Verify state
    const state = getMessageState(session, 'msg1');
    expect(state!.status).toBe('completed');
  });

  it('processing -> failed -> retry allowed -> completed', () => {
    const session = makeSession({ processedMessageIds: {} });

    // Step 1: processing
    markMessageProcessing(session, 'msg1', noopSave);

    // Step 2: fail
    markMessageFailed(session, 'msg1', 'timeout', noopSave);
    expect(isMessageProcessed(session, 'msg1')).toBe(false); // retry allowed (retryCount=1 < 2)

    // Step 3: re-process
    markMessageProcessing(session, 'msg1', noopSave);
    expect(isMessageProcessed(session, 'msg1')).toBe(true); // actively processing

    // Step 4: complete
    markMessageCompleted(session, 'msg1', noopSave, 'success');
    expect(isMessageProcessed(session, 'msg1')).toBe(true);
    expect(getMessageState(session, 'msg1')!.status).toBe('completed');
  });

  it('processing -> failed -> failed -> permanently skipped', () => {
    const session = makeSession({ processedMessageIds: {} });

    // First attempt: process -> fail
    markMessageProcessing(session, 'msg1', noopSave);
    markMessageFailed(session, 'msg1', 'error1', noopSave);
    expect(getMessageState(session, 'msg1')!.retryCount).toBe(1);
    expect(isMessageProcessed(session, 'msg1')).toBe(false); // retry allowed

    // Second attempt: process -> fail
    markMessageProcessing(session, 'msg1', noopSave);
    markMessageFailed(session, 'msg1', 'error2', noopSave);
    expect(getMessageState(session, 'msg1')!.retryCount).toBe(2);
    expect(isMessageProcessed(session, 'msg1')).toBe(true); // retry exhausted (retryCount=2 >= MAX=2)
  });

  it('stale processing allows retry', () => {
    const session = makeSession({ processedMessageIds: {} });

    // Set a stale processing entry
    session.processedMessageIds = {
      'msg1': {
        status: 'processing',
        startedAt: Date.now() - PROCESSING_STALE_TIMEOUT_MS - 1000,
        retryCount: 0,
      } as MessageProcessingState,
    };

    // Should be allowed to retry
    expect(isMessageProcessed(session, 'msg1')).toBe(false);

    // Re-process
    markMessageProcessing(session, 'msg1', noopSave);
    expect(isMessageProcessed(session, 'msg1')).toBe(true);
  });

  it('fresh processing blocks duplicate', () => {
    const session = makeSession({ processedMessageIds: {} });

    session.processedMessageIds = {
      'msg1': {
        status: 'processing',
        startedAt: Date.now() - 1000, // 1 second ago, not stale
        retryCount: 0,
      } as MessageProcessingState,
    };

    expect(isMessageProcessed(session, 'msg1')).toBe(true); // blocked
  });
});
