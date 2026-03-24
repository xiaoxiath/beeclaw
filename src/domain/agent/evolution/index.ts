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
  shouldTriggerReflection,
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

// [P1] Self-evolution exports
export {
  initSelfEvolution,
  getSelfEvolutionStatus,
  triggerSelfEvolution,
  type SelfEvolutionConfig,
} from './self-evolution';
