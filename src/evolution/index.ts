/**
 * Evolution Module
 *
 * Self-improvement capabilities including reflection triggers and skill evolution
 */

export {
  analyzeForTriggers,
  recordSkillFailure,
  recordQuery,
  checkRepetitivePattern,
  checkConsecutiveFailures,
  generateReflectionContext,
  checkReflectionTriggers,
  clearReflectionTracking,
  getReflectionStats,
  type ReflectionTrigger,
} from './reflection-trigger';

export {
  detectPreferenceExpressions,
  hasPreferenceExpression,
  getPreferenceLearningContext,
  checkPreferenceTriggers,
  type PreferenceExpression,
} from './preference-learning';
