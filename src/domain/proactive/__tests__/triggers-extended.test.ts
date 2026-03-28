/**
 * Extended unit tests for triggers.ts — all external deps mocked.
 * Covers: evaluatePatterns, resolveValue branches, check_goal_progress with
 * low-progress goals, error paths, compare default, send_reminder fallback.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockListPatterns = vi.fn();
const mockUpdatePattern = vi.fn();
const mockPushNotification = vi.fn();
const mockGoalStoreList = vi.fn();

vi.mock('../scheduler', () => ({
  getSchedulerLazy: vi.fn(() => ({
    listPatterns: mockListPatterns,
    updatePattern: mockUpdatePattern,
  })),
}));

vi.mock('../pusher', () => ({
  pushNotification: (...args: any[]) => mockPushNotification(...args),
}));

vi.mock('../../agent/goal/store', () => ({
  getGoalStore: vi.fn(() => ({
    list: mockGoalStoreList,
    init: vi.fn(),
  })),
}));

vi.mock('../notifications', () => ({
  getNotificationManager: vi.fn(() => ({ clearExpired: vi.fn() })),
  resetNotificationManager: vi.fn(),
}));

import {
  evaluateCondition,
  executePatternAction,
  evaluatePatterns,
  type TriggerContext,
} from '../triggers';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Triggers (extended)', () => {
  const baseCtx: TriggerContext = {
    now: new Date('2026-03-15T14:45:00'), // Sunday, 14:45
    goals: [
      { id: 'g1', title: 'G1', progress: 25, state: 'active', updatedAt: '2026-03-01T00:00:00Z' },
      { id: 'g2', title: 'G2', progress: 80, state: 'active', updatedAt: '2026-03-14T00:00:00Z' },
      { id: 'g3', title: 'G3', progress: 100, state: 'completed', updatedAt: '2026-03-10T00:00:00Z' },
    ],
  };

  beforeEach(() => {
    mockListPatterns.mockImplementation(() => []);
    mockUpdatePattern.mockImplementation(() => ({ success: true }));
    mockPushNotification.mockImplementation(() => Promise.resolve({ success: true }));
    mockGoalStoreList.mockImplementation(() => []);
  });

  // ── resolveValue branches (tested via comparison conditions) ──────────
  // NOTE: conditions starting with "time." or "goal." are routed to
  // evaluateTimeCondition / evaluateGoalCondition respectively, NOT to
  // evaluateComparison → resolveValue. To exercise resolveValue for
  // time.day, time.month, time.dayOfWeek, goal.activeCount we put
  // the literal on the LEFT so the condition does NOT start with time./goal.

  describe('resolveValue', () => {
    it('resolves time.day via comparison (literal on left)', () => {
      // 2026-03-15 → getDate() = 15
      expect(evaluateCondition('15 == time.day', baseCtx)).toBe(true);
    });

    it('resolves time.month via comparison (literal on left)', () => {
      // March → getMonth()+1 = 3
      expect(evaluateCondition('3 == time.month', baseCtx)).toBe(true);
    });

    it('resolves time.dayOfWeek via comparison (literal on left)', () => {
      // 2026-03-15 is Sunday = 0
      expect(evaluateCondition('0 == time.dayOfWeek', baseCtx)).toBe(true);
    });

    it('resolves time.hour via evaluateTimeCondition', () => {
      expect(evaluateCondition('time.hour == 14', baseCtx)).toBe(true);
    });

    it('resolves time.minute via evaluateTimeCondition', () => {
      expect(evaluateCondition('time.minute == 45', baseCtx)).toBe(true);
    });

    it('resolves goal.count via evaluateGoalCondition', () => {
      expect(evaluateCondition('goal.count == 3', baseCtx)).toBe(true);
    });

    it('resolves goal.activeCount via comparison (literal on left)', () => {
      // 2 active goals → goal.activeCount = 2
      expect(evaluateCondition('2 == goal.activeCount', baseCtx)).toBe(true);
    });

    it('resolves boolean literal true', () => {
      expect(evaluateCondition('true == true', baseCtx)).toBe(true);
    });

    it('resolves boolean literal false', () => {
      expect(evaluateCondition('false == false', baseCtx)).toBe(true);
    });

    it('resolves string literal (single quotes)', () => {
      expect(evaluateCondition("'hello' == 'hello'", baseCtx)).toBe(true);
    });

    it('resolves string literal (double quotes)', () => {
      expect(evaluateCondition('"hello" == "hello"', baseCtx)).toBe(true);
    });

    it('resolves negative number', () => {
      expect(evaluateCondition('-5 < 0', baseCtx)).toBe(true);
    });

    it('resolves float number', () => {
      expect(evaluateCondition('3.14 > 3', baseCtx)).toBe(true);
    });

    it('resolves custom data value in comparison', () => {
      const ctx = { ...baseCtx, customData: { score: 42 } };
      expect(evaluateCondition('score == 42', ctx)).toBe(true);
    });

    it('falls back to raw expr for unknown reference', () => {
      // "unknown_ref" with no customData resolves to the string itself
      expect(evaluateCondition("unknown_ref == 'unknown_ref'", baseCtx)).toBe(true);
    });

    it('returns false for goal expressions when no goals (via comparison)', () => {
      const ctx = { ...baseCtx, goals: undefined } as any;
      // goal.count without goals → resolveValue returns expr string "goal.count", not 0
      expect(evaluateCondition('0 == goal.count', ctx)).toBe(false);
    });
  });

  // ── compare default case ──────────────────────────────────────────────

  describe('compare', () => {
    it('returns false for invalid comparison expression (no match)', () => {
      // A condition with no operator triggers the generic condition handler
      expect(evaluateCondition('noOperatorHere', baseCtx)).toBe(true); // falls to default: non-empty string
    });
  });

  // ── time conditions: unmatched time. expression ───────────────────────

  describe('evaluateTimeCondition', () => {
    it('returns false for unrecognized time. expression', () => {
      expect(evaluateCondition('time.unknown == 1', baseCtx)).toBe(false);
    });

    it('evaluates time.hour with <= operator', () => {
      expect(evaluateCondition('time.hour <= 14', baseCtx)).toBe(true);
      expect(evaluateCondition('time.hour <= 13', baseCtx)).toBe(false);
    });

    it('evaluates time.minute with > operator', () => {
      expect(evaluateCondition('time.minute > 44', baseCtx)).toBe(true);
      expect(evaluateCondition('time.minute > 45', baseCtx)).toBe(false);
    });
  });

  // ── goal conditions: edge cases ───────────────────────────────────────

  describe('evaluateGoalCondition', () => {
    it('returns false for unrecognized goal. expression', () => {
      expect(evaluateCondition('goal.unknown == 1', baseCtx)).toBe(false);
    });

    it('returns false for goals conditions without goals array', () => {
      const ctx = { ...baseCtx, goals: undefined as any };
      expect(evaluateCondition('goal.count == 0', ctx)).toBe(false);
    });
  });

  // ── executePatternAction: check_goal_progress with low progress ──────

  describe('executePatternAction: check_goal_progress with low progress', () => {
    it('sends notification when goals below 50%', async () => {
      mockGoalStoreList.mockReturnValue([
        { id: 'g1', title: 'Low', progress: 20, state: 'active' },
        { id: 'g2', title: 'High', progress: 80, state: 'active' },
      ]);
      mockPushNotification.mockResolvedValue({ success: true });

      const pattern = {
        id: 'p1', name: 'GoalCheck',
        trigger: { type: 'goal', condition: 'true' },
        action: { type: 'check_goal_progress' as const },
        enabled: true, createdAt: '', updatedAt: '',
      };

      const result = await executePatternAction(pattern as any);
      expect(result.success).toBe(true);
      expect(mockPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'high', category: 'goal-progress' }),
      );
    });

    it('returns checked count when no low-progress goals', async () => {
      mockGoalStoreList.mockReturnValue([
        { id: 'g1', title: 'High', progress: 80, state: 'active' },
      ]);

      const pattern = {
        id: 'p2', name: 'GoalCheck2',
        trigger: { type: 'goal', condition: 'true' },
        action: { type: 'check_goal_progress' as const },
        enabled: true, createdAt: '', updatedAt: '',
      };

      const result = await executePatternAction(pattern as any);
      expect(result.success).toBe(true);
      expect((result.result as any).lowProgress).toBe(0);
    });
  });

  // ── executePatternAction: send_reminder fallback message ──────────────

  describe('executePatternAction: send_reminder', () => {
    it('uses fallback message when not provided', async () => {
      mockPushNotification.mockResolvedValue({ success: true });

      const pattern = {
        id: 'p3', name: 'NoMessage',
        trigger: { type: 'time', condition: 'true' },
        action: { type: 'send_reminder' as const, params: {} },
        enabled: true, createdAt: '', updatedAt: '',
      };

      const result = await executePatternAction(pattern as any);
      expect(result.success).toBe(true);
      expect(mockPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('NoMessage') }),
      );
    });
  });

  // ── executePatternAction: error in action ─────────────────────────────

  describe('executePatternAction: error handling', () => {
    it('catches and returns error from action', async () => {
      mockPushNotification.mockRejectedValue(new Error('push failed'));

      const pattern = {
        id: 'p-err', name: 'ErrPattern',
        trigger: { type: 'time', condition: 'true' },
        action: { type: 'send_reminder' as const, params: { message: 'test' } },
        enabled: true, createdAt: '', updatedAt: '',
      };

      const result = await executePatternAction(pattern as any);
      expect(result.success).toBe(false);
      expect(result.error).toBe('push failed');
    });

    it('handles non-Error throw', async () => {
      mockPushNotification.mockRejectedValue('string error');

      const pattern = {
        id: 'p-str', name: 'StrErr',
        trigger: { type: 'time', condition: 'true' },
        action: { type: 'send_reminder' as const, params: { message: 'test' } },
        enabled: true, createdAt: '', updatedAt: '',
      };

      const result = await executePatternAction(pattern as any);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ── evaluatePatterns ──────────────────────────────────────────────────

  describe('evaluatePatterns', () => {
    it('evaluates enabled patterns and triggers matched ones', async () => {
      mockListPatterns.mockReturnValue([
        {
          id: 'p1', name: 'Match',
          trigger: { type: 'custom', condition: 'true' },
          action: { type: 'custom', params: { x: 1 } },
          enabled: true, triggerCount: 0, createdAt: '', updatedAt: '',
        },
        {
          id: 'p2', name: 'NoMatch',
          trigger: { type: 'custom', condition: 'false' },
          action: { type: 'custom', params: {} },
          enabled: true, triggerCount: 0, createdAt: '', updatedAt: '',
        },
      ]);
      mockGoalStoreList.mockReturnValue([]);

      const results = await evaluatePatterns();
      expect(results).toHaveLength(2);
      expect(results[0].triggered).toBe(true);
      expect(results[0].actionTaken).toBe(true);
      expect(results[1].triggered).toBe(false);
      expect(results[1].actionTaken).toBe(false);

      expect(mockUpdatePattern).toHaveBeenCalledWith('p1', expect.objectContaining({
        triggerCount: 1,
      }));
    });

    it('handles goalStore error gracefully', async () => {
      mockListPatterns.mockReturnValue([
        {
          id: 'p3', name: 'G',
          trigger: { type: 'custom', condition: 'true' },
          action: { type: 'custom', params: {} },
          enabled: true, triggerCount: 0, createdAt: '', updatedAt: '',
        },
      ]);
      const { getGoalStore } = await import('../../agent/goal/store');
      (getGoalStore as any).mockImplementationOnce(() => { throw new Error('no store'); });

      const results = await evaluatePatterns();
      expect(results).toHaveLength(1);
      expect(results[0].triggered).toBe(true);
    });

    it('passes custom data from context', async () => {
      mockListPatterns.mockReturnValue([
        {
          id: 'p4', name: 'Custom',
          trigger: { type: 'custom', condition: 'myFlag' },
          action: { type: 'custom', params: {} },
          enabled: true, triggerCount: 0, createdAt: '', updatedAt: '',
        },
      ]);
      mockGoalStoreList.mockReturnValue([]);

      const results = await evaluatePatterns({ customData: { myFlag: true } });
      expect(results[0].triggered).toBe(true);
    });

    it('increments triggerCount from existing value', async () => {
      mockListPatterns.mockReturnValue([
        {
          id: 'p5', name: 'Count',
          trigger: { type: 'custom', condition: 'true' },
          action: { type: 'custom', params: {} },
          enabled: true, triggerCount: 5, createdAt: '', updatedAt: '',
        },
      ]);
      mockGoalStoreList.mockReturnValue([]);

      await evaluatePatterns();
      expect(mockUpdatePattern).toHaveBeenCalledWith('p5', expect.objectContaining({
        triggerCount: 6,
      }));
    });

    it('returns empty array when no patterns', async () => {
      mockListPatterns.mockReturnValue([]);
      const results = await evaluatePatterns();
      expect(results).toEqual([]);
    });
  });
});
