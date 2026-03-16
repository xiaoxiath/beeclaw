/**
 * HITL (Human-in-the-Loop) Integration Tests
 *
 * Tests for the complete HITL flow:
 * 1. Tool confirmation (APPROVED/DENIED)
 * 2. User input collection (text/choice/multi_choice)
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
    it('should parse APPROVED', () => {
      expect(parseUserDecision('APPROVED')).toBe('APPROVED');
      expect(parseUserDecision('approved')).toBe('APPROVED');
      expect(parseUserDecision('Approved')).toBe('APPROVED');
    });

    it('should parse YES/OK/CONFIRM', () => {
      expect(parseUserDecision('YES')).toBe('APPROVED');
      expect(parseUserDecision('OK')).toBe('APPROVED');
      expect(parseUserDecision('CONFIRM')).toBe('APPROVED');
    });

    it('should parse Chinese approval', () => {
      expect(parseUserDecision('批准')).toBe('APPROVED');
      expect(parseUserDecision('同意')).toBe('APPROVED');
      expect(parseUserDecision('确认')).toBe('APPROVED');
    });

    it('should parse DENIED', () => {
      expect(parseUserDecision('DENIED')).toBe('DENIED');
      expect(parseUserDecision('denied')).toBe('DENIED');
      expect(parseUserDecision('Denied')).toBe('DENIED');
    });

    it('should parse NO/CANCEL/REJECT', () => {
      expect(parseUserDecision('NO')).toBe('DENIED');
      expect(parseUserDecision('CANCEL')).toBe('DENIED');
      expect(parseUserDecision('REJECT')).toBe('DENIED');
    });

    it('should parse Chinese denial', () => {
      expect(parseUserDecision('拒绝')).toBe('DENIED');
      expect(parseUserDecision('取消')).toBe('DENIED');
      expect(parseUserDecision('否决')).toBe('DENIED');
    });

    it('should return null for invalid input', () => {
      expect(parseUserDecision('MAYBE')).toBeNull();
      expect(parseUserDecision('HOLD ON')).toBeNull();
      expect(parseUserDecision('PENDING')).toBeNull();
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
    it('should parse YES/OK/CONFIRM', () => {
      expect(parseUserConfirmation('YES')).toBe(true);
      expect(parseUserConfirmation('OK')).toBe(true);
      expect(parseUserConfirmation('CONFIRM')).toBe(true);
    });

    it('should parse Chinese confirmation', () => {
      expect(parseUserConfirmation('是')).toBe(true);
      expect(parseUserConfirmation('对')).toBe(true);
      expect(parseUserConfirmation('确认')).toBe(true);
    });

    it('should parse NO/CANCEL', () => {
      expect(parseUserConfirmation('NO')).toBe(false);
      expect(parseUserConfirmation('CANCEL')).toBe(false);
    });

    it('should parse Chinese denial', () => {
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

      // Handle APPROVED response
      const result = await handleHITLResponse(testSessionId, 'APPROVED');

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

      // Handle DENIED response
      const result = await handleHITLResponse(testSessionId, 'DENIED');

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

    it('should return null when no pending HITL request', async () => {
      // Clear pending state
      delete testSession.metadata?.pendingConfirmation;
      delete testSession.metadata?.pendingQuestion;

      const result = await handleHITLResponse(testSessionId, 'APPROVED');
      expect(result).toBeNull();
    });

    it('should return null for non-HITL message', async () => {
      const result = await handleHITLResponse(testSessionId, 'Hello world');
      expect(result).toBeNull();
    });
  });
});
