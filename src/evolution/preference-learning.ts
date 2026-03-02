/**
 * Preference Learning Types
 *
 * Preference detection is now handled by LLM through System Prompt.
 * This file only exports types for use by other modules.
 *
 * The LLM proactively:
 * - Detects preferences from user messages
 * - Saves preferences via memory_write to facts/preferences.md
 * - No regex pattern matching needed - LLM understands context naturally
 */

import type { ReflectionTrigger } from './reflection-trigger';

export interface PreferenceExpression {
  type: 'correction' | 'positive' | 'identity' | 'habit' | 'negation';
  category: 'style' | 'format' | 'tech' | 'habits' | 'profile';
  key: string;
  value: string | boolean;
  rawExpression: string;
  confidence: number;
}

/**
 * Deprecated: No longer used, kept for backward compatibility
 * LLM now handles preference detection through System Prompt
 */
export function detectPreferenceExpressions(_message: string): PreferenceExpression[] {
  // Always return empty - LLM handles detection now
  return [];
}

/**
 * Deprecated: No longer used, kept for backward compatibility
 */
export function hasPreferenceExpression(_message: string): boolean {
  return false;
}

/**
 * Deprecated: No longer used, kept for backward compatibility
 */
export function getPreferenceLearningContext(_expressions: PreferenceExpression[]): string {
  return '';
}

/**
 * Deprecated: No longer used, kept for backward compatibility
 */
export function checkPreferenceTriggers(
  _userMessage: string,
  _existingTriggers: ReflectionTrigger[]
): { hasPreference: boolean; expressions: PreferenceExpression[]; context: string } {
  return { hasPreference: false, expressions: [], context: '' };
}
