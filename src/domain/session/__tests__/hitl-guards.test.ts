/**
 * Tests for Fix 4: HITLManager Finalization Guards
 *
 * Covers:
 * - setDecision() rejects duplicate calls
 * - setUserInput() rejects duplicate calls
 * - resume() rejects double-resume within 30s
 * - resume() allows re-resume after 30s
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Minimal session store mock
const sessions = new Map<string, any>();

function getSession(id: string) { return sessions.get(id) || null; }
function saveSession(session: any) { sessions.set(session.id, session); }

const logMessages: string[] = [];
const logger = {
  info: (...args: any[]) => logMessages.push(args.join(' ')),
  warn: (...args: any[]) => logMessages.push('WARN: ' + args.join(' ')),
  error: (...args: any[]) => logMessages.push('ERROR: ' + args.join(' ')),
};

// Re-implement patched functions for testing
function setDecision(sessionId: string, toolCallId: string, decision: 'APPROVED' | 'DENIED'): void {
  const session = getSession(sessionId);
  if (!session) return;
  const metadata = session.metadata || {};
  const pendingConfirmation = metadata.pendingConfirmation;
  if (!pendingConfirmation) return;

  const existingDecision = metadata.buttonDecision;
  if (existingDecision && existingDecision.toolCallId === toolCallId) {
    logger.warn(`[HITL] Decision already set for toolCallId ${toolCallId}`);
    return;
  }

  metadata.buttonDecision = { toolCallId, decision, timestamp: Date.now(), finalized: true };
  saveSession(session);
}

function setUserInput(sessionId: string, requestId: string, value: string | string[]): void {
  const session = getSession(sessionId);
  if (!session) return;
  const metadata = session.metadata || {};

  const existingInput = metadata.buttonUserInput;
  if (existingInput && existingInput.requestId === requestId && existingInput.finalized) {
    logger.warn(`[HITL] User input already set for requestId ${requestId}`);
    return;
  }

  metadata.buttonUserInput = { requestId, value, timestamp: Date.now(), finalized: true };
  saveSession(session);
}

function resume(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) return;
  const metadata = session.metadata || {};

  if (metadata.hitlResumeReady === true) {
    const resumeAt = metadata.hitlResumeAt || 0;
    const elapsed = Date.now() - resumeAt;
    if (elapsed < 30_000) {
      logger.warn(`[HITL] Session ${sessionId} already resumed`);
      return;
    }
  }

  metadata.hitlResumeReady = true;
  metadata.hitlResumeAt = Date.now();
  saveSession(session);
}

describe('HITLManager Finalization Guards (Fix 4)', () => {
  const SID = 'session-hitl';

  beforeEach(() => {
    sessions.clear();
    logMessages.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('setDecision', () => {
    it('accepts first decision', () => {
      sessions.set(SID, {
        id: SID,
        metadata: {
          pendingConfirmation: { toolCall: { name: 'shell', params: {} }, riskLevel: 'high' },
        },
      });

      setDecision(SID, 'tc_001', 'APPROVED');
      const session = sessions.get(SID)!;
      expect(session.metadata.buttonDecision).toBeDefined();
      expect(session.metadata.buttonDecision.decision).toBe('APPROVED');
      expect(session.metadata.buttonDecision.finalized).toBe(true);
    });

    it('rejects duplicate decision for same toolCallId', () => {
      sessions.set(SID, {
        id: SID,
        metadata: {
          pendingConfirmation: { toolCall: { name: 'shell', params: {} }, riskLevel: 'high' },
        },
      });

      setDecision(SID, 'tc_001', 'APPROVED');
      setDecision(SID, 'tc_001', 'DENIED'); // Duplicate — should be ignored

      const session = sessions.get(SID)!;
      expect(session.metadata.buttonDecision.decision).toBe('APPROVED'); // First decision wins
      expect(logMessages.some(m => m.includes('already set'))).toBe(true);
    });

    it('allows decision for different toolCallId', () => {
      sessions.set(SID, {
        id: SID,
        metadata: {
          pendingConfirmation: { toolCall: { name: 'shell', params: {} }, riskLevel: 'high' },
        },
      });

      setDecision(SID, 'tc_001', 'APPROVED');
      setDecision(SID, 'tc_002', 'DENIED'); // Different tool call — allowed

      const session = sessions.get(SID)!;
      expect(session.metadata.buttonDecision.toolCallId).toBe('tc_002');
      expect(session.metadata.buttonDecision.decision).toBe('DENIED');
    });

    it('does nothing without pendingConfirmation', () => {
      sessions.set(SID, { id: SID, metadata: {} });
      setDecision(SID, 'tc_001', 'APPROVED');
      const session = sessions.get(SID)!;
      expect(session.metadata.buttonDecision).toBeUndefined();
    });
  });

  describe('setUserInput', () => {
    it('accepts first input', () => {
      sessions.set(SID, { id: SID, metadata: {} });
      setUserInput(SID, 'req_001', 'user choice');
      const session = sessions.get(SID)!;
      expect(session.metadata.buttonUserInput.value).toBe('user choice');
      expect(session.metadata.buttonUserInput.finalized).toBe(true);
    });

    it('rejects duplicate input for same requestId', () => {
      sessions.set(SID, { id: SID, metadata: {} });
      setUserInput(SID, 'req_001', 'first input');
      setUserInput(SID, 'req_001', 'second input'); // Duplicate

      const session = sessions.get(SID)!;
      expect(session.metadata.buttonUserInput.value).toBe('first input');
      expect(logMessages.some(m => m.includes('already set'))).toBe(true);
    });

    it('allows input for different requestId', () => {
      sessions.set(SID, { id: SID, metadata: {} });
      setUserInput(SID, 'req_001', 'first');
      setUserInput(SID, 'req_002', 'second');

      const session = sessions.get(SID)!;
      expect(session.metadata.buttonUserInput.requestId).toBe('req_002');
      expect(session.metadata.buttonUserInput.value).toBe('second');
    });
  });

  describe('resume', () => {
    it('allows first resume', () => {
      sessions.set(SID, { id: SID, metadata: {} });
      resume(SID);

      const session = sessions.get(SID)!;
      expect(session.metadata.hitlResumeReady).toBe(true);
      expect(session.metadata.hitlResumeAt).toBeGreaterThan(0);
    });

    it('rejects double-resume within 30 seconds', () => {
      sessions.set(SID, { id: SID, metadata: {} });
      resume(SID);

      vi.advanceTimersByTime(5000); // 5s later
      resume(SID); // Should be rejected

      expect(logMessages.some(m => m.includes('already resumed'))).toBe(true);
    });

    it('allows re-resume after 30 seconds', () => {
      sessions.set(SID, { id: SID, metadata: {} });
      resume(SID);
      const firstResumeAt = sessions.get(SID)!.metadata.hitlResumeAt;

      vi.advanceTimersByTime(31_000); // 31s later
      logMessages.length = 0;
      resume(SID);

      const secondResumeAt = sessions.get(SID)!.metadata.hitlResumeAt;
      expect(secondResumeAt).toBeGreaterThan(firstResumeAt);
      expect(logMessages.some(m => m.includes('already resumed'))).toBe(false);
    });

    it('does nothing for unknown session', () => {
      resume('nonexistent');
      // Should not throw
      expect(sessions.has('nonexistent')).toBe(false);
    });
  });
});
