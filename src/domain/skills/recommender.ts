/**
 * Skill Recommender — Extracted from SkillStore (Task 2)
 *
 * Standalone functions for skill recommendation (keyword-based and LLM-enhanced).
 * These accept a SkillStore instance as a parameter instead of living as class methods,
 * following dependency-inversion: the recommender logic is decoupled from the store.
 */

import type { Skill } from './types';
import type { SkillStore } from './store';
import type { LLMSkillMatcher } from './llm-matcher';
import { logger } from '../../infra/observability/logger';

// ============================================================================
// Types (re-export from ./types for convenience)
// ============================================================================

export type {
  SkillRecommendation,
  SkillRecommendResult,
} from './types';

// ============================================================================
// Recommendation Score Calculation
// ============================================================================

/**
 * Calculate recommendation score for a skill given a lowercased context string.
 * Pure function — no side effects.
 */
export function calculateRecommendationScore(
  skill: Skill,
  contextLower: string,
): {
  confidence: number;
  reason: string;
  matchedTriggers: string[];
  matchedTags: string[];
} {
  let score = 0;
  const matchedTriggers: string[] = [];
  const matchedTags: string[] = [];
  const reasons: string[] = [];

  // Check triggers (highest weight)
  for (const trigger of skill.triggers) {
    if (contextLower.includes(trigger.toLowerCase())) {
      score += 0.4;
      matchedTriggers.push(trigger);
    }
  }

  // Check tags (medium weight)
  for (const tag of skill.tags) {
    if (contextLower.includes(tag.toLowerCase())) {
      score += 0.2;
      matchedTags.push(tag);
    }
  }

  // Check description keywords (lower weight)
  const descWords = skill.description.toLowerCase().split(/\s+/);
  const contextWords = contextLower.split(/\s+/);
  const matchingWords = descWords.filter(word =>
    word.length > 3 && contextWords.includes(word),
  );
  score += matchingWords.length * 0.05;

  // Bonus for high success rate
  if (skill.usageCount > 0) {
    const successRate = skill.successCount / skill.usageCount;
    if (successRate > 0.9) {
      score += 0.1;
      reasons.push('High success rate');
    }
  }

  // Bonus for maturity
  if (skill.maturityScore >= 80) {
    score += 0.1;
    reasons.push('Mature skill');
  }

  // Cap confidence at 1.0
  const confidence = Math.min(score, 1.0);

  // Generate reason
  if (matchedTriggers.length > 0) {
    reasons.push(`Matched triggers: ${matchedTriggers.join(', ')}`);
  }
  if (matchedTags.length > 0) {
    reasons.push(`Matched tags: ${matchedTags.join(', ')}`);
  }

  const reason = reasons.length > 0
    ? reasons.join('; ')
    : 'Contextually relevant';

  return {
    confidence,
    reason,
    matchedTriggers,
    matchedTags,
  };
}

// ============================================================================
// Keyword-based Recommendation (sync)
// ============================================================================

/**
 * Recommend skills based on keyword matching against context.
 * Standalone function that takes a SkillStore instance.
 */
export function recommendSkills(
  store: SkillStore,
  context: string,
): import('./types').SkillRecommendResult {
  const allSkills = store.list();
  const recommendations: import('./types').SkillRecommendation[] = [];
  const contextLower = context.toLowerCase();

  for (const skill of allSkills) {
    const score = calculateRecommendationScore(skill, contextLower);

    if (score.confidence > 0.3) { // Only include if confidence > 30%
      recommendations.push({
        name: skill.name,
        description: skill.description,
        confidence: score.confidence,
        reason: score.reason,
        matched_triggers: score.matchedTriggers,
        matched_tags: score.matchedTags,
      });
    }
  }

  // Sort by confidence (descending)
  recommendations.sort((a, b) => b.confidence - a.confidence);

  // Return top 5 recommendations
  const topRecommendations = recommendations.slice(0, 5);

  return {
    context,
    recommendations: topRecommendations,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// LLM-enhanced Recommendation (async)
// ============================================================================

/**
 * Recommend skills with LLM semantic matching.
 * Hybrid strategy: keyword filtering → LLM precise matching → keyword fallback.
 *
 * Standalone async function that takes a SkillStore instance and an optional
 * LLM matcher. When the matcher is unavailable or fails, falls back gracefully
 * to keyword-only matching.
 */
export async function recommendSkillsWithLLM(
  store: SkillStore,
  context: string,
  llmMatcher: LLMSkillMatcher | null,
  options?: {
    maxCandidates?: number;
    topK?: number;
    skipLLM?: boolean;
  },
): Promise<import('./types').SkillRecommendResult> {
  const maxCandidates = options?.maxCandidates ?? 15;
  const topK = options?.topK ?? 5;

  // Step 1: Keyword fast filter (lenient threshold)
  const allSkills = store.list();
  const keywordCandidates: Array<{ skill: Skill; score: number }> = [];
  const contextLower = context.toLowerCase();

  for (const skill of allSkills) {
    const score = calculateRecommendationScore(skill, contextLower);
    if (score.confidence > 0.1) {
      keywordCandidates.push({ skill, score: score.confidence });
    }
  }

  // Sort by score, take top N candidates
  keywordCandidates.sort((a, b) => b.score - a.score);
  const candidates = keywordCandidates.slice(0, maxCandidates).map(c => c.skill);

  // Step 2: LLM semantic matching (if enabled and matcher available)
  if (!options?.skipLLM && llmMatcher && candidates.length > 0) {
    try {
      const llmMatches = await llmMatcher.match(context, candidates);

      if (llmMatches.length > 0) {
        const recommendations: import('./types').SkillRecommendation[] = llmMatches.map(match => {
          const skill = candidates.find(s => s.name === match.skill);
          if (!skill) return null;

          return {
            name: skill.name,
            description: skill.description,
            confidence: match.confidence,
            reason: match.reason,
            matched_triggers: skill.triggers.slice(0, 3),
            matched_tags: skill.tags.slice(0, 3),
          };
        }).filter((r): r is NonNullable<typeof r> => r !== null);

        return {
          context,
          recommendations,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      logger.error('[SkillStore] LLM matching failed, falling back to keyword matching:', error);
      // Degrade: continue with keyword matching
    }
  }

  // Step 3: Fallback to keyword matching
  const recommendations: import('./types').SkillRecommendation[] = candidates
    .slice(0, topK)
    .map(skill => {
      const score = calculateRecommendationScore(skill, contextLower);
      return {
        name: skill.name,
        description: skill.description,
        confidence: score.confidence,
        reason: score.reason,
        matched_triggers: score.matchedTriggers,
        matched_tags: score.matchedTags,
      };
    });

  return {
    context,
    recommendations,
    timestamp: new Date().toISOString(),
  };
}
