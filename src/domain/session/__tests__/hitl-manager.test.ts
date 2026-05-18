import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('../index', () => ({
  getSession: vi.fn(() => undefined),
  saveSession: vi.fn(() => {}),
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(() => {}),
    error: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  handleHITLResponse,
  parseUserDecision,
  parseUserChoice,
  parseUserConfirmation,
  parseMultiChoice,
  setDecision,
  setUserInput,
  resume,
} from '../hitl-manager';
import { getSession, saveSession } from '../index';

describe('hitl-manager', () => {
  beforeEach(() => {
    (getSession as any).mockReset();
    (saveSession as any).mockReset();
  });

  // ─── parseUserDecision ────────────────────────────────────────────────
  describe('parseUserDecision', () => {
    it('should return APPROVED for approval words', () => {
      expect(parseUserDecision('yes')).toBe('APPROVED');
      expect(parseUserDecision('confirm')).toBe('APPROVED');
      expect(parseUserDecision('approve')).toBe('APPROVED');
    });

    it('should return APPROVED case-insensitively', () => {
      expect(parseUserDecision('YES')).toBe('APPROVED');
      expect(parseUserDecision('  Yes  ')).toBe('APPROVED');
      expect(parseUserDecision('CONFIRM')).toBe('APPROVED');
    });

    it('should return DENIED for denial words', () => {
      expect(parseUserDecision('no')).toBe('DENIED');
      expect(parseUserDecision('deny')).toBe('DENIED');
      expect(parseUserDecision('reject')).toBe('DENIED');
    });

    it('should return DENIED case-insensitively', () => {
      expect(parseUserDecision('NO')).toBe('DENIED');
      expect(parseUserDecision('  Deny  ')).toBe('DENIED');
    });

    it('should return null for unrecognized input', () => {
      expect(parseUserDecision('maybe')).toBeNull();
      expect(parseUserDecision('absolutely')).toBeNull();
      expect(parseUserDecision('yesss')).toBeNull();
      expect(parseUserDecision('')).toBeNull();
    });
  });

  // ─── parseUserChoice ──────────────────────────────────────────────────
  describe('parseUserChoice', () => {
    const options = ['Option A', 'Option B', 'Option C'];

    it('should parse numeric input (1-based)', () => {
      expect(parseUserChoice('1', options)).toBe(0);
      expect(parseUserChoice('2', options)).toBe(1);
      expect(parseUserChoice('3', options)).toBe(2);
    });

    it('should return null for out-of-range numbers', () => {
      expect(parseUserChoice('0', options)).toBeNull();
      expect(parseUserChoice('4', options)).toBeNull();
      expect(parseUserChoice('-1', options)).toBeNull();
    });

    it('should match option text (case-insensitive)', () => {
      expect(parseUserChoice('option a', options)).toBe(0);
      expect(parseUserChoice('Option B', options)).toBe(1);
    });

    it('should return null for no match', () => {
      expect(parseUserChoice('xyz', options)).toBeNull();
    });
  });

  // ─── parseUserConfirmation ────────────────────────────────────────────
  describe('parseUserConfirmation', () => {
    it('should return true for confirmation words', () => {
      expect(parseUserConfirmation('yes')).toBe(true);
      expect(parseUserConfirmation('confirm')).toBe(true);
      expect(parseUserConfirmation('approve')).toBe(true);
    });

    it('should return false for other words', () => {
      expect(parseUserConfirmation('no')).toBe(false);
      expect(parseUserConfirmation('deny')).toBe(false);
      expect(parseUserConfirmation('maybe')).toBe(false);
    });

    it('should handle whitespace and case', () => {
      expect(parseUserConfirmation('  YES  ')).toBe(true);
      expect(parseUserConfirmation('  NO  ')).toBe(false);
    });
  });

  // ─── parseMultiChoice ─────────────────────────────────────────────────
  describe('parseMultiChoice', () => {
    const options = ['A', 'B', 'C', 'D'];

    it('should parse comma-separated numbers', () => {
      expect(parseMultiChoice('1,2,3', options)).toEqual([0, 1, 2]);
    });

    it('should parse space-separated numbers', () => {
      expect(parseMultiChoice('1 3 4', options)).toEqual([0, 2, 3]);
    });

    it('should deduplicate selections', () => {
      expect(parseMultiChoice('1,1,2', options)).toEqual([0, 1]);
    });

    it('should ignore out-of-range numbers', () => {
      expect(parseMultiChoice('1,5,2', options)).toEqual([0, 1]);
    });

    it('should return empty array for no valid input', () => {
      expect(parseMultiChoice('abc', options)).toEqual([]);
    });
  });

  // ─── handleHITLResponse ───────────────────────────────────────────────
  describe('handleHITLResponse', () => {
    it('should return "Session not found" when session does not exist', async () => {
      (getSession as any).mockReturnValue(undefined);
      const result = await handleHITLResponse('unknown-session', 'yes');
      expect(result).toBe('Session not found');
    });

    it('should return null when no pending HITL state', async () => {
      (getSession as any).mockReturnValue({
        id: 'test-session',
        metadata: {},
        messages: [],
      });
      const result = await handleHITLResponse('test-session', 'hello');
      expect(result).toBeNull();
    });

    it('should handle tool confirmation APPROVED', async () => {
      const session = {
        id: 'test-session',
        metadata: {
          pendingConfirmation: {
            toolCall: { name: 'shell', params: { command: 'ls' } },
            riskLevel: 'high',
            requestedAt: Date.now(),
          },
        },
        messages: [],
      };
      (getSession as any).mockReturnValue(session);
      const result = await handleHITLResponse('test-session', 'yes');
      expect(result).toContain('APPROVED');
      expect(result).toContain('shell');
      expect(saveSession).toHaveBeenCalled();
    });

    it('should handle tool confirmation DENIED', async () => {
      const session = {
        id: 'test-session',
        metadata: {
          pendingConfirmation: {
            toolCall: { name: 'file_delete', params: { path: '/tmp/x' } },
            riskLevel: 'critical',
            requestedAt: Date.now(),
          },
        },
        messages: [],
      };
      (getSession as any).mockReturnValue(session);
      const result = await handleHITLResponse('test-session', 'no');
      expect(result).toContain('DENIED');
      expect(result).toContain('file_delete');
    });

    it('should pass through unrecognized response for pending confirmation', async () => {
      const session = {
        id: 'test-session',
        metadata: {
          pendingConfirmation: {
            toolCall: { name: 'shell', params: {} },
            riskLevel: 'high',
            requestedAt: Date.now(),
          },
        },
        messages: [],
      };
      (getSession as any).mockReturnValue(session);
      const result = await handleHITLResponse('test-session', 'maybe later');
      expect(result).toBe('maybe later');
    });

    it('should handle pending question with choice input', async () => {
      const session = {
        id: 'test-session',
        metadata: {
          pendingQuestion: {
            question: 'Pick one',
            options: ['Red', 'Blue', 'Green'],
            inputType: 'choice',
            toolCallId: 'tc-1',
            askedAt: Date.now(),
          },
        },
        messages: [],
      };
      (getSession as any).mockReturnValue(session);
      const result = await handleHITLResponse('test-session', '2');
      expect(result).toContain('Blue');
      expect(saveSession).toHaveBeenCalled();
    });

    it('should handle pending question with confirmation input', async () => {
      const session = {
        id: 'test-session',
        metadata: {
          pendingQuestion: {
            question: 'Continue?',
            inputType: 'confirmation',
            toolCallId: 'tc-2',
            askedAt: Date.now(),
          },
        },
        messages: [],
      };
      (getSession as any).mockReturnValue(session);
      const result = await handleHITLResponse('test-session', 'yes');
      expect(result).toContain('YES');
    });

    it('should handle pending question with text input', async () => {
      const session = {
        id: 'test-session',
        metadata: {
          pendingQuestion: {
            question: 'What is your name?',
            inputType: 'text',
            toolCallId: 'tc-3',
            askedAt: Date.now(),
          },
        },
        messages: [],
      };
      (getSession as any).mockReturnValue(session);
      const result = await handleHITLResponse('test-session', 'Alice');
      expect(result).toContain('Alice');
    });

    it('should handle pending question with multi_choice input', async () => {
      const session = {
        id: 'test-session',
        metadata: {
          pendingQuestion: {
            question: 'Select items',
            options: ['A', 'B', 'C'],
            inputType: 'multi_choice',
            toolCallId: 'tc-4',
            askedAt: Date.now(),
          },
        },
        messages: [],
      };
      (getSession as any).mockReturnValue(session);
      const result = await handleHITLResponse('test-session', '1,3');
      expect(result).toContain('A');
      expect(result).toContain('C');
    });
  });

  // ─── setDecision ──────────────────────────────────────────────────────
  describe('setDecision', () => {
    it('should do nothing if session not found', () => {
      (getSession as any).mockReturnValue(undefined);
      setDecision('no-session', 'tc-1', 'APPROVED');
      expect(saveSession).not.toHaveBeenCalled();
    });

    it('should do nothing if no pending confirmation', () => {
      (getSession as any).mockReturnValue({
        id: 's1',
        metadata: {},
        messages: [],
      });
      setDecision('s1', 'tc-1', 'APPROVED');
      expect(saveSession).not.toHaveBeenCalled();
    });

    it('should set button decision and save', () => {
      const metadata: any = {
        pendingConfirmation: {
          toolCall: { name: 'shell', params: {} },
          riskLevel: 'high',
          requestedAt: Date.now(),
        },
      };
      const session = { id: 's1', metadata, messages: [] };
      (getSession as any).mockReturnValue(session);

      setDecision('s1', 'tc-1', 'APPROVED');

      expect(metadata.buttonDecision).toBeDefined();
      expect(metadata.buttonDecision.decision).toBe('APPROVED');
      expect(metadata.buttonDecision.toolCallId).toBe('tc-1');
      expect(metadata.buttonDecision.finalized).toBe(true);
      expect(saveSession).toHaveBeenCalled();
    });

    it('should reject duplicate decision for same toolCallId', () => {
      const metadata: any = {
        pendingConfirmation: {
          toolCall: { name: 'shell', params: {} },
          riskLevel: 'high',
          requestedAt: Date.now(),
        },
        buttonDecision: {
          toolCallId: 'tc-1',
          decision: 'APPROVED',
          timestamp: Date.now(),
          finalized: true,
        },
      };
      const session = { id: 's1', metadata, messages: [] };
      (getSession as any).mockReturnValue(session);

      setDecision('s1', 'tc-1', 'DENIED');
      // Should not overwrite
      expect(metadata.buttonDecision.decision).toBe('APPROVED');
    });
  });

  // ─── setUserInput ─────────────────────────────────────────────────────
  describe('setUserInput', () => {
    it('should do nothing if session not found', () => {
      (getSession as any).mockReturnValue(undefined);
      setUserInput('no-session', 'req-1', 'hello');
      expect(saveSession).not.toHaveBeenCalled();
    });

    it('should store user input and save', () => {
      const metadata: any = {};
      const session = { id: 's1', metadata, messages: [] };
      (getSession as any).mockReturnValue(session);

      setUserInput('s1', 'req-1', 'my answer');

      expect(metadata.buttonUserInput).toBeDefined();
      expect(metadata.buttonUserInput.value).toBe('my answer');
      expect(metadata.buttonUserInput.requestId).toBe('req-1');
      expect(metadata.buttonUserInput.finalized).toBe(true);
      expect(saveSession).toHaveBeenCalled();
    });

    it('should reject duplicate input for same requestId', () => {
      const metadata: any = {
        buttonUserInput: {
          requestId: 'req-1',
          value: 'first answer',
          timestamp: Date.now(),
          finalized: true,
        },
      };
      const session = { id: 's1', metadata, messages: [] };
      (getSession as any).mockReturnValue(session);

      setUserInput('s1', 'req-1', 'second answer');
      expect(metadata.buttonUserInput.value).toBe('first answer');
    });
  });

  // ─── resume ───────────────────────────────────────────────────────────
  describe('resume', () => {
    it('should do nothing if session not found', () => {
      (getSession as any).mockReturnValue(undefined);
      resume('no-session');
      expect(saveSession).not.toHaveBeenCalled();
    });

    it('should set hitlResumeReady and save', () => {
      const metadata: any = {};
      const session = { id: 's1', metadata, messages: [] };
      (getSession as any).mockReturnValue(session);

      resume('s1');

      expect(metadata.hitlResumeReady).toBe(true);
      expect(metadata.hitlResumeAt).toBeDefined();
      expect(saveSession).toHaveBeenCalled();
    });

    it('should reject duplicate resume within 30s', () => {
      const metadata: any = {
        hitlResumeReady: true,
        hitlResumeAt: Date.now() - 5000, // 5 seconds ago
      };
      const session = { id: 's1', metadata, messages: [] };
      (getSession as any).mockReturnValue(session);

      resume('s1');
      // Should not save again
      expect(saveSession).not.toHaveBeenCalled();
    });

    it('should allow re-resume after 30s', () => {
      const metadata: any = {
        hitlResumeReady: true,
        hitlResumeAt: Date.now() - 35000, // 35 seconds ago
      };
      const session = { id: 's1', metadata, messages: [] };
      (getSession as any).mockReturnValue(session);

      resume('s1');
      expect(saveSession).toHaveBeenCalled();
    });
  });
});
