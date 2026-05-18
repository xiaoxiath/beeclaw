/**
 * Pattern Trigger System
 *
 * Evaluates conditions and triggers actions
 */

import type { Pattern } from './types';
import { getSchedulerLazy } from './scheduler';
import { pushNotification } from './pusher';
import { getGoalStore } from '../agent/goal/store';
import { getLogger } from '../../infra/observability/logger';

const logger = getLogger('proactive.triggers');

export interface TriggerContext {
  now: Date;
  goals?: Array<{
    id: string;
    title: string;
    progress: number;
    state: string;
    updatedAt: string;
  }>;
  customData?: Record<string, unknown>;
}

export interface TriggerResult {
  patternId: string;
  patternName: string;
  triggered: boolean;
  actionTaken: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Evaluate a single pattern's condition
 */
export function evaluateCondition(condition: string, context: TriggerContext): boolean {
  try {
    // Create a safe evaluation context
    const { now, goals, customData } = context;

    // Parse condition based on type
    const trimmedCondition = condition.trim().toLowerCase();

    // Time-based conditions
    if (trimmedCondition.startsWith('time.')) {
      return evaluateTimeCondition(condition, now);
    }

    // Goal-based conditions
    if (trimmedCondition.startsWith('goal.') || trimmedCondition.startsWith('goals.')) {
      return evaluateGoalCondition(condition, goals || []);
    }

    // Simple comparison conditions
    if (trimmedCondition.includes('==') || trimmedCondition.includes('!=') || trimmedCondition.includes('>=') || trimmedCondition.includes('<=') || trimmedCondition.includes('>') || trimmedCondition.includes('<')) {
      return evaluateComparison(condition, context);
    }

    // Custom data conditions
    if (customData) {
      return evaluateCustomCondition(condition, customData);
    }

    // Default: check if condition is "true" or non-empty string
    return trimmedCondition === 'true' || (trimmedCondition !== 'false' && trimmedCondition.length > 0);
  } catch (error) {
    logger.error(`[PatternTrigger] Error evaluating condition "${condition}":`, error);
    return false;
  }
}

/**
 * Evaluate time-based conditions
 */
function evaluateTimeCondition(condition: string, now: Date): boolean {
  const cond = condition.toLowerCase();

  // time.hour == 9
  const hourMatch = cond.match(/time\.hour\s*(==|!=|>=|<=|>|<)\s*(\d+)/);
  if (hourMatch) {
    const operator = hourMatch[1];
    const value = parseInt(hourMatch[2], 10);
    const currentHour = now.getHours();
    return compare(currentHour, operator, value);
  }

  // time.minute >= 30
  const minuteMatch = cond.match(/time\.minute\s*(==|!=|>=|<=|>|<)\s*(\d+)/);
  if (minuteMatch) {
    const operator = minuteMatch[1];
    const value = parseInt(minuteMatch[2], 10);
    const currentMinute = now.getMinutes();
    return compare(currentMinute, operator, value);
  }

  // time.dayOfWeek == 1 (Monday)
  const dayOfWeekMatch = cond.match(/time\.dayofweek\s*(==|!=)\s*(\d+)/);
  if (dayOfWeekMatch) {
    const operator = dayOfWeekMatch[1];
    const value = parseInt(dayOfWeekMatch[2], 10);
    const currentDay = now.getDay();
    return compare(currentDay, operator, value);
  }

  // time.isWeekday
  if (cond.includes('time.isweekday')) {
    const day = now.getDay();
    return day >= 1 && day <= 5;
  }

  // time.isWeekend
  if (cond.includes('time.isweekend')) {
    const day = now.getDay();
    return day === 0 || day === 6;
  }

  return false;
}

/**
 * Evaluate goal-based conditions
 */
function evaluateGoalCondition(condition: string, goals: TriggerContext['goals']): boolean {
  if (!goals || goals.length === 0) return false;

  const cond = condition.toLowerCase();

  // goal.count > 3
  const countMatch = cond.match(/goal\.count\s*(==|!=|>=|<=|>|<)\s*(\d+)/);
  if (countMatch) {
    const operator = countMatch[1];
    const value = parseInt(countMatch[2], 10);
    return compare(goals.length, operator, value);
  }

  // goal.any.progress < 50
  const anyProgressMatch = cond.match(/goal\.any\.progress\s*(==|!=|>=|<=|>|<)\s*(\d+)/);
  if (anyProgressMatch) {
    const operator = anyProgressMatch[1];
    const value = parseInt(anyProgressMatch[2], 10);
    return goals.some(g => compare(g.progress, operator, value));
  }

  // goal.all.progress >= 100
  const allProgressMatch = cond.match(/goal\.all\.progress\s*(==|!=|>=|<=|>|<)\s*(\d+)/);
  if (allProgressMatch) {
    const operator = allProgressMatch[1];
    const value = parseInt(allProgressMatch[2], 10);
    return goals.every(g => compare(g.progress, operator, value));
  }

  // goal.active.count >= 2
  const activeCountMatch = cond.match(/goal\.active\.count\s*(==|!=|>=|<=|>|<)\s*(\d+)/);
  if (activeCountMatch) {
    const operator = activeCountMatch[1];
    const value = parseInt(activeCountMatch[2], 10);
    const activeGoals = goals.filter(g => g.state === 'active');
    return compare(activeGoals.length, operator, value);
  }

  // goal.stalled (no update in X days)
  const stalledMatch = cond.match(/goal\.stalled\s*\(\s*(\d+)\s*\)/);
  if (stalledMatch) {
    const days = parseInt(stalledMatch[1], 10);
    const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
    return goals.some(g => {
      const updatedAt = new Date(g.updatedAt).getTime();
      return g.state === 'active' && updatedAt < threshold;
    });
  }

  return false;
}

/**
 * Evaluate comparison expressions
 */
function evaluateComparison(condition: string, context: TriggerContext): boolean {
  const cond = condition.trim();

  // Extract left side, operator, right side
  const match = cond.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) return false;

  const [, left, operator, right] = match;
  const leftValue = resolveValue(left.trim(), context);
  const rightValue = resolveValue(right.trim(), context);

  return compare(leftValue, operator, rightValue);
}

/**
 * Resolve a value from context
 */
function resolveValue(expr: string, context: TriggerContext): number | string | boolean {
  const { now, goals, customData } = context;

  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(expr)) {
    return parseFloat(expr);
  }

  // String literal
  if ((expr.startsWith("'") && expr.endsWith("'")) || (expr.startsWith('"') && expr.endsWith('"'))) {
    return expr.slice(1, -1);
  }

  // Boolean literals
  if (expr === 'true') return true;
  if (expr === 'false') return false;

  // Time expressions
  if (expr === 'time.hour') return now.getHours();
  if (expr === 'time.minute') return now.getMinutes();
  if (expr === 'time.day') return now.getDate();
  if (expr === 'time.dayOfWeek') return now.getDay();
  if (expr === 'time.month') return now.getMonth() + 1;

  // Goal expressions
  if (expr === 'goal.count' && goals) return goals.length;
  if (expr === 'goal.activeCount' && goals) return goals.filter(g => g.state === 'active').length;

  // Custom data
  if (customData && expr in customData) {
    return customData[expr] as number | string | boolean;
  }

  return expr;
}

/**
 * Compare two values with an operator
 */
function compare(left: number | string | boolean, operator: string, right: number | string | boolean): boolean {
  switch (operator) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '>=': return (left as number) >= (right as number);
    case '<=': return (left as number) <= (right as number);
    case '>': return (left as number) > (right as number);
    case '<': return (left as number) < (right as number);
    default: return false;
  }
}

/**
 * Evaluate custom conditions
 */
function evaluateCustomCondition(condition: string, customData: Record<string, unknown>): boolean {
  try {
    const value = customData[condition];
    return Boolean(value);
  } catch {
    return false;
  }
}

/**
 * Execute action for a pattern
 */
export async function executePatternAction(pattern: Pattern): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const { action } = pattern;

  try {
    switch (action.type) {
      case 'send_reminder': {
        const message = (action.params?.message as string) || `Pattern "${pattern.name}" triggered`;
        const result = await pushNotification({
          message,
          priority: 'normal',
          category: 'pattern-trigger',
          metadata: { patternId: pattern.id, patternName: pattern.name },
        });
        return { success: result.success, result };
      }

      case 'check_goal_progress': {
        const goalStore = getGoalStore();
        const goals = goalStore.list({ state: 'active' });
        const lowProgressGoals = goals.filter(g => g.progress < 50);

        if (lowProgressGoals.length > 0) {
          const result = await pushNotification({
            message: `${lowProgressGoals.length} goal(s) below 50% progress`,
            priority: 'high',
            category: 'goal-progress',
            metadata: { patternId: pattern.id, goals: lowProgressGoals.map(g => g.id) },
          });
          return { success: result.success, result };
        }
        return { success: true, result: { checked: goals.length, lowProgress: 0 } };
      }

      case 'memory_compress': {
        // This would trigger memory compression
        return { success: true, result: { note: 'Memory compression triggered by pattern' } };
      }

      case 'run_skill': {
        const skillName = action.params?.skillName as string;
        return { success: true, result: { skillName, note: 'Skill execution would be triggered' } };
      }

      case 'custom': {
        return { success: true, result: action.params };
      }

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Evaluate all patterns and trigger actions
 */
export async function evaluatePatterns(context?: Partial<TriggerContext>): Promise<TriggerResult[]> {
  const scheduler = getSchedulerLazy();
  const patterns = scheduler.listPatterns({ enabled: true });

  // Build context
  let goals: TriggerContext['goals'];
  try {
    const goalStore = getGoalStore();
    goals = goalStore.list().map(g => ({
      id: g.id,
      title: g.title,
      progress: g.progress,
      state: g.state,
      updatedAt: g.updatedAt,
    }));
  } catch {
    goals = [];
  }

  const fullContext: TriggerContext = {
    now: new Date(),
    goals,
    customData: context?.customData,
    ...context,
  };

  const results: TriggerResult[] = [];

  for (const pattern of patterns) {
    const triggered = evaluateCondition(pattern.trigger.condition, fullContext);

    if (triggered) {
      const actionResult = await executePatternAction(pattern);

      results.push({
        patternId: pattern.id,
        patternName: pattern.name,
        triggered: true,
        actionTaken: actionResult.success,
        result: actionResult.result,
        error: actionResult.error,
      });

      // Update pattern's lastTriggered
      scheduler.updatePattern(pattern.id, { lastTriggered: new Date().toISOString(), triggerCount: (pattern.triggerCount || 0) + 1 });
    } else {
      results.push({
        patternId: pattern.id,
        patternName: pattern.name,
        triggered: false,
        actionTaken: false,
      });
    }
  }

  return results;
}

