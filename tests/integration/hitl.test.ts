/**
 * HITL (Human-in-the-Loop) Integration Tests
 *
 * Tests for the complete HITL flow:
 * 1. Tool confirmation (APPROVED/DENIED)
 * 2. User input collection (text/choice/multi_choice)
 *
 * NOTE: parseUserDecision uses a strict whitelist:
 *   APPROVE_WORDS = ['yes', 'confirm', 'approve']
 *   DENY_WORDS = ['no', 'deny', 'reject']
 *   (case-insensitive exact match only)
 *
 * parseUserConfirmation uses strict whitelist:
 *   CONFIRM_WORDS = ['yes', 'confirm', 'approve']
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleHITLResponse, parseUserDecision, parseUserChoice, parseUserConfirmation, parseMultiChoice } from '../../src/domain/session/hitl-manager';
import type { Session } from '../../src/domain/session/types';

// Mock session store
vi.mock('../../src/domain/session', () => ({
  getSession: vi.fn(),
  saveSession: vi.fn(),
}));

import { getSession, saveSession } from '../../src/domain/session';

describe('HITL Integration Tests', () => {
  let testSession: Session;
  const testSessionId = 'test-hitl-session';

  beforeEach(async () => {
    // Create test session
    testSession = {
      id: testSessionId,
      userId: 'test-user',
      channel: 'test',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };

    // Mock getSession to return test session
    (getSession as any).mockReturnValue(testSession);
    (saveSession as any).mockImplementation(() => {});
  });

  describe('parseUserDecision', () => {
    it('should parse approve/yes/confirm as APPROVED (strict whitelist)', () => {
      expect(parseUserDecision('approve')).toBe('APPROVED');
      expect(parseUserDecision('Approve')).toBe('APPROVED');
      expect(parseUserDecision('APPROVE')).toBe('APPROVED');
      expect(parseUserDecision('yes')).toBe('APPROVED');
      expect(parseUserDecision('YES')).toBe('APPROVED');
      expect(parseUserDecision('confirm')).toBe('APPROVED');
      expect(parseUserDecision('CONFIRM')).toBe('APPROVED');
    });

    it('should parse deny/no/reject as DENIED (strict whitelist)', () => {
      expect(parseUserDecision('deny')).toBe('DENIED');
      expect(parseUserDecision('Deny')).toBe('DENIED');
      expect(parseUserDecision('DENY')).toBe('DENIED');
      expect(parseUserDecision('no')).toBe('DENIED');
      expect(parseUserDecision('NO')).toBe('DENIED');
      expect(parseUserDecision('reject')).toBe('DENIED');
      expect(parseUserDecision('REJECT')).toBe('DENIED');
    });

    it('should return null for words not in the strict whitelist', () => {
      // These are intentionally NOT recognized by the strict whitelist
      expect(parseUserDecision('APPROVED')).toBeNull();
      expect(parseUserDecision('DENIED')).toBeNull();
      expect(parseUserDecision('OK')).toBeNull();
      expect(parseUserDecision('CANCEL')).toBeNull();
      expect(parseUserDecision('MAYBE')).toBeNull();
      expect(parseUserDecision('HOLD ON')).toBeNull();
      expect(parseUserDecision('PENDING')).toBeNull();
      // Chinese words not in whitelist
      expect(parseUserDecision('批准')).toBeNull();
      expect(parseUserDecision('同意')).toBeNull();
      expect(parseUserDecision('确认')).toBeNull();
      expect(parseUserDecision('拒绝')).toBeNull();
      expect(parseUserDecision('取消')).toBeNull();
      expect(parseUserDecision('否决')).toBeNull();
    });
  });

  describe('parseUserChoice', () => {
    const options = ['Option A', 'Option B', 'Option C'];

    it('should parse numeric choice', () => {
      expect(parseUserChoice('1', options)).toBe(0);
      expect(parseUserChoice('2', options)).toBe(1);
      expect(parseUserChoice('3', options)).toBe(2);
    });

    it('should parse text choice', () => {
      expect(parseUserChoice('option a', options)).toBe(0);
      expect(parseUserChoice('Option B', options)).toBe(1);
      expect(parseUserChoice('option c', options)).toBe(2);
    });

    it('should return null for invalid choice', () => {
      expect(parseUserChoice('0', options)).toBeNull();
      expect(parseUserChoice('4', options)).toBeNull();
      expect(parseUserChoice('invalid', options)).toBeNull();
    });
  });

  describe('parseUserConfirmation', () => {
    it('should parse yes/confirm/approve as true (strict whitelist)', () => {
      expect(parseUserConfirmation('yes')).toBe(true);
      expect(parseUserConfirmation('YES')).toBe(true);
      expect(parseUserConfirmation('confirm')).toBe(true);
      expect(parseUserConfirmation('CONFIRM')).toBe(true);
      expect(parseUserConfirmation('approve')).toBe(true);
      expect(parseUserConfirmation('APPROVE')).toBe(true);
    });

    it('should return false for anything not in the strict whitelist', () => {
      expect(parseUserConfirmation('no')).toBe(false);
      expect(parseUserConfirmation('NO')).toBe(false);
      expect(parseUserConfirmation('cancel')).toBe(false);
      expect(parseUserConfirmation('CANCEL')).toBe(false);
      expect(parseUserConfirmation('OK')).toBe(false);
      // Chinese words not in whitelist
      expect(parseUserConfirmation('是')).toBe(false);
      expect(parseUserConfirmation('对')).toBe(false);
      expect(parseUserConfirmation('确认')).toBe(false);
      expect(parseUserConfirmation('否')).toBe(false);
      expect(parseUserConfirmation('取消')).toBe(false);
    });
  });

  describe('parseMultiChoice', () => {
    const options = ['Option A', 'Option B', 'Option C', 'Option D'];

    it('should parse comma-separated choices', () => {
      const result = parseMultiChoice('1,2,3', options);
      expect(result).toEqual([0, 1, 2]);
    });

    it('should parse space-separated choices', () => {
      const result = parseMultiChoice('1 2 3', options);
      expect(result).toEqual([0, 1, 2]);
    });

    it('should deduplicate choices', () => {
      const result = parseMultiChoice('1,2,1,3', options);
      expect(result).toEqual([0, 1, 2]);
    });

    it('should ignore invalid choices', () => {
      const result = parseMultiChoice('1,5,2', options);
      expect(result).toEqual([0, 1]);
    });
  });

  describe('handleHITLResponse', () => {
    it('should handle APPROVED tool confirmation', async () => {
      // Setup pending confirmation
      testSession.metadata!.pendingConfirmation = {
        toolCall: {
          name: 'test_tool',
          params: { test: true },
        },
        riskLevel: 'high',
        requestedAt: Date.now(),
      };

      // Handle with 'approve' (in the strict whitelist)
      const result = await handleHITLResponse(testSessionId, 'approve');

      expect(result).toBeDefined();
      expect(result).toContain('APPROVED');
      expect(testSession.metadata?.pendingConfirmation).toBeUndefined();
    });

    it('should handle DENIED tool confirmation', async () => {
      // Setup pending confirmation
      testSession.metadata!.pendingConfirmation = {
        toolCall: {
          name: 'test_tool',
          params: { test: true },
        },
        riskLevel: 'high',
        requestedAt: Date.now(),
      };

      // Handle with 'deny' (in the strict whitelist)
      const result = await handleHITLResponse(testSessionId, 'deny');

      expect(result).toBeDefined();
      expect(result).toContain('DENIED');
      expect(testSession.metadata?.pendingConfirmation).toBeUndefined();
    });

    it('should handle user input response', async () => {
      // Setup pending question
      testSession.metadata!.pendingQuestion = {
        question: 'What is your name?',
        options: undefined,
        context: undefined,
        inputType: 'text',
        toolCallId: 'test_call',
        askedAt: Date.now(),
      };

      // Handle user input
      const result = await handleHITLResponse(testSessionId, 'My name is John');

      expect(result).toBeDefined();
      expect(result).toContain('John');
      expect(testSession.metadata?.pendingQuestion).toBeUndefined();
    });

    it('should handle choice input', async () => {
      // Setup pending question with options
      const options = ['Option A', 'Option B', 'Option C'];
      testSession.metadata!.pendingQuestion = {
        question: 'Choose one option',
        options,
        context: undefined,
        inputType: 'choice',
        toolCallId: 'test_call',
        askedAt: Date.now(),
      };

      // Handle choice
      const result = await handleHITLResponse(testSessionId, '2');
      expect(result).toBeDefined();
      expect(result).toContain('Option B');
      expect(testSession.metadata?.pendingQuestion).toBeUndefined();
    });

    it('should handle multi-choice input', async () => {
      // Setup pending question
      const options = ['Option A', 'Option B', 'Option C'];
      testSession.metadata!.pendingQuestion = {
        question: 'Select multiple options',
        options,
        context: undefined,
        inputType: 'multi_choice',
        toolCallId: 'test_call',
        askedAt: Date.now(),
      };

      // Handle multi-choice
      const result = await handleHITLResponse(testSessionId, '1,3');
      expect(result).toBeDefined();
      expect(result).toContain('Option A');
      expect(result).toContain('Option C');
      expect(testSession.metadata?.pendingQuestion).toBeUndefined();
    });

    it('should return empty string when no pending HITL request', async () => {
      // Clear pending state
      delete testSession.metadata?.pendingConfirmation;
      delete testSession.metadata?.pendingQuestion;

      const result = await handleHITLResponse(testSessionId, 'approve');
      expect(result).toBe('');
    });

    it('should return empty string for non-HITL message', async () => {
      const result = await handleHITLResponse(testSessionId, 'Hello world');
      expect(result).toBe('');
    });
  });
});
