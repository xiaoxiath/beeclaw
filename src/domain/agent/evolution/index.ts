/**
 * Evolution Module
 *
 * Self-improvement capabilities including skill evolution and preference learning
 */

export {
  recordSkillFailure,
  checkConsecutiveFailures,
  clearReflectionTracking,
  getReflectionStats,
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
