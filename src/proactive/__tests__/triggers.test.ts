import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import {
  evaluateCondition,
  executePatternAction,
  type TriggerContext,
} from '../triggers';
import type { Pattern } from '../types';
import { resetNotificationManager, getNotificationManager } from '../notifications';
import { getGoalStore, resetGoalStore } from '../../goal/store';

const TEST_TRIGGERS_PATH = './test-triggers-data';

describe('Proactive Triggers', () => {
  let baseContext: TriggerContext;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_TRIGGERS_PATH)) {
      rmSync(TEST_TRIGGERS_PATH, { recursive: true });
    }
    mkdirSync(TEST_TRIGGERS_PATH, { recursive: true });

    // Initialize notification manager with test path
    getNotificationManager(TEST_TRIGGERS_PATH);

    // Initialize goal store with test data
    const goalStore = getGoalStore(TEST_TRIGGERS_PATH);
    goalStore.init();

    baseContext = {
      now: new Date('2026-03-02T10:30:00'), // Monday 10:30 AM
      goals: [
        { id: 'goal-1', title: 'Goal 1', progress: 30, state: 'active', updatedAt: '2026-02-15T00:00:00' },
        { id: 'goal-2', title: 'Goal 2', progress: 70, state: 'active', updatedAt: '2026-03-01T00:00:00' },
        { id: 'goal-3', title: 'Goal 3', progress: 100, state: 'completed', updatedAt: '2026-02-20T00:00:00' },
      ],
    };
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_TRIGGERS_PATH)) {
      rmSync(TEST_TRIGGERS_PATH, { recursive: true });
    }
    resetNotificationManager();
    resetGoalStore();
  });

  describe('evaluateCondition', () => {
    describe('time-based conditions', () => {
      test('evaluates time.hour == 10', () => {
        const result = evaluateCondition('time.hour == 10', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates time.hour != 10', () => {
        const result = evaluateCondition('time.hour != 10', baseContext);
        expect(result).toBe(false);
      });

      test('evaluates time.hour >= 9', () => {
        const result = evaluateCondition('time.hour >= 9', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates time.hour < 9', () => {
        const result = evaluateCondition('time.hour < 9', baseContext);
        expect(result).toBe(false);
      });

      test('evaluates time.minute == 30', () => {
        const result = evaluateCondition('time.minute == 30', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates time.minute >= 0', () => {
        const result = evaluateCondition('time.minute >= 0', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates time.dayOfWeek == 1 (Monday)', () => {
        const result = evaluateCondition('time.dayOfWeek == 1', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates time.dayOfWeek != 1', () => {
        const result = evaluateCondition('time.dayOfWeek != 1', baseContext);
        expect(result).toBe(false);
      });

      test('evaluates time.isWeekday on weekday', () => {
        const result = evaluateCondition('time.isWeekday', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates time.isWeekend on weekday', () => {
        const result = evaluateCondition('time.isWeekend', baseContext);
        expect(result).toBe(false);
      });

      test('evaluates time.isWeekend on weekend', () => {
        const weekendContext = {
          ...baseContext,
          now: new Date('2026-03-07T10:30:00'), // Saturday
        };
        const result = evaluateCondition('time.isWeekend', weekendContext);
        expect(result).toBe(true);
      });

      test('evaluates time.isWeekday on weekend', () => {
        const weekendContext = {
          ...baseContext,
          now: new Date('2026-03-07T10:30:00'), // Saturday
        };
        const result = evaluateCondition('time.isWeekday', weekendContext);
        expect(result).toBe(false);
      });
    });

    describe('goal-based conditions', () => {
      test('evaluates goal.count == 3', () => {
        const result = evaluateCondition('goal.count == 3', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates goal.count > 2', () => {
        const result = evaluateCondition('goal.count > 2', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates goal.count < 5', () => {
        const result = evaluateCondition('goal.count < 5', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates goal.any.progress < 50', () => {
        const result = evaluateCondition('goal.any.progress < 50', baseContext);
        expect(result).toBe(true); // goal-1 has progress 30
      });

      test('evaluates goal.any.progress > 80', () => {
        const result = evaluateCondition('goal.any.progress > 80', baseContext);
        expect(result).toBe(true); // goal-3 has progress 100
      });

      test('evaluates goal.all.progress >= 0', () => {
        const result = evaluateCondition('goal.all.progress >= 0', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates goal.all.progress >= 100', () => {
        const result = evaluateCondition('goal.all.progress >= 100', baseContext);
        expect(result).toBe(false);
      });

      test('evaluates goal.active.count >= 2', () => {
        const result = evaluateCondition('goal.active.count >= 2', baseContext);
        expect(result).toBe(true); // goal-1 and goal-2 are active
      });

      test('evaluates goal.active.count == 2', () => {
        const result = evaluateCondition('goal.active.count == 2', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates goal.stalled(7) with stalled goal', () => {
        // goal-1 was updated on 2026-02-15, more than 7 days ago from 2026-03-02
        const result = evaluateCondition('goal.stalled(7)', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates goal.stalled(30) with stalled goal', () => {
        // goal-1 was updated on 2026-02-15, more than 30 days ago? No, about 15 days
        const result = evaluateCondition('goal.stalled(30)', baseContext);
        expect(result).toBe(false);
      });

      test('returns false for empty goals', () => {
        const emptyContext = { ...baseContext, goals: [] };
        expect(evaluateCondition('goal.count > 0', emptyContext)).toBe(false);
        expect(evaluateCondition('goal.any.progress < 50', emptyContext)).toBe(false);
      });
    });

    describe('comparison conditions', () => {
      test('evaluates simple equality', () => {
        const result = evaluateCondition('10 == 10', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates simple inequality', () => {
        const result = evaluateCondition('10 != 5', baseContext);
        expect(result).toBe(true);
      });

      test('evaluates numeric comparison', () => {
        expect(evaluateCondition('5 > 3', baseContext)).toBe(true);
        expect(evaluateCondition('5 < 3', baseContext)).toBe(false);
        expect(evaluateCondition('5 >= 5', baseContext)).toBe(true);
        expect(evaluateCondition('5 <= 4', baseContext)).toBe(false);
      });
    });

    describe('custom data conditions', () => {
      test('evaluates custom data', () => {
        const contextWithCustom = {
          ...baseContext,
          customData: { myFlag: true, myValue: 42 },
        };
        expect(evaluateCondition('myFlag', contextWithCustom)).toBe(true);
        expect(evaluateCondition('myValue', contextWithCustom)).toBe(true);
        expect(evaluateCondition('nonexistent', contextWithCustom)).toBe(false);
      });
    });

    describe('literal conditions', () => {
      test('evaluates "true" as true', () => {
        expect(evaluateCondition('true', baseContext)).toBe(true);
      });

      test('evaluates "false" as false', () => {
        expect(evaluateCondition('false', baseContext)).toBe(false);
      });

      test('evaluates non-empty string as true', () => {
        expect(evaluateCondition('something', baseContext)).toBe(true);
      });
    });

    describe('error handling', () => {
      test('handles invalid conditions gracefully', () => {
        // Should not throw, return false
        expect(evaluateCondition('', baseContext)).toBe(false);
      });
    });
  });

  describe('executePatternAction', () => {
    test('executes send_reminder action', async () => {
      const pattern: Pattern = {
        id: 'pattern-1',
        name: 'Test Pattern',
        description: 'Test description',
        trigger: { type: 'time', condition: 'time.hour == 10' },
        action: { type: 'send_reminder', params: { message: 'Test reminder' } },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await executePatternAction(pattern);
      expect(result.success).toBe(true);
    });

    test('executes check_goal_progress action', async () => {
      const pattern: Pattern = {
        id: 'pattern-2',
        name: 'Goal Check',
        description: 'Check goal progress',
        trigger: { type: 'goal', condition: 'goal.any.progress < 50' },
        action: { type: 'check_goal_progress' },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await executePatternAction(pattern);
      expect(result.success).toBe(true);
    });

    test('executes memory_compress action', async () => {
      const pattern: Pattern = {
        id: 'pattern-3',
        name: 'Memory Compress',
        description: 'Compress memory',
        trigger: { type: 'time', condition: 'time.hour == 3' },
        action: { type: 'memory_compress' },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await executePatternAction(pattern);
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    });

    test('executes run_skill action', async () => {
      const pattern: Pattern = {
        id: 'pattern-4',
        name: 'Run Skill',
        description: 'Run a skill',
        trigger: { type: 'time', condition: 'time.hour == 9' },
        action: { type: 'run_skill', params: { skillName: 'test-skill' } },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await executePatternAction(pattern);
      expect(result.success).toBe(true);
      expect((result.result as any).skillName).toBe('test-skill');
    });

    test('executes custom action', async () => {
      const pattern: Pattern = {
        id: 'pattern-5',
        name: 'Custom Action',
        description: 'Custom action',
        trigger: { type: 'custom', condition: 'true' },
        action: { type: 'custom', params: { customParam: 'value' } },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await executePatternAction(pattern);
      expect(result.success).toBe(true);
      expect((result.result as any).customParam).toBe('value');
    });

    test('returns error for unknown action type', async () => {
      const pattern: Pattern = {
        id: 'pattern-6',
        name: 'Unknown Action',
        description: 'Unknown action',
        trigger: { type: 'time', condition: 'true' },
        action: { type: 'unknown_type' as any },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await executePatternAction(pattern);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action type');
    });
  });
});
