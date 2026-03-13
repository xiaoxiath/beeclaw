/**
 * Evolution Module
 *
 * Self-improvement capabilities including reflection triggers and skill evolution
 */

export {
  recordSkillFailure,
  checkConsecutiveFailures,
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

export {
  recordQuery,
  detectPatterns,
  getRecentQueries,
  clearQueryTracking,
  getQueryTrackingStats,
  type QueryRecord,
  type QueryPattern,
} from './query-tracking';
