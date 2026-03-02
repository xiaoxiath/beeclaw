/**
 * Memory Scoring
 *
 * Importance scoring for memory compression
 */

import { z } from 'zod';

// Importance score schema
export const ImportanceScoreSchema = z.object({
  score: z.number().min(0).max(100),
  factors: z.object({
    recency: z.number().describe('How recent the content is (0-100)'),
    frequency: z.number().describe('How often referenced (0-100)'),
    relevance: z.number().describe('Relevance to active goals (0-100)'),
    uniqueness: z.number().describe('Information uniqueness (0-100)'),
    userMarked: z.number().describe('User-marked importance (0-100)'),
  }),
  recommendation: z.enum(['keep', 'summarize', 'archive', 'delete']),
  reason: z.string().optional(),
});

export type ImportanceScore = z.infer<typeof ImportanceScoreSchema>;

// Scoring weights
const SCORING_WEIGHTS = {
  recency: 0.25,
  frequency: 0.20,
  relevance: 0.25,
  uniqueness: 0.20,
  userMarked: 0.10,
};

// Thresholds for recommendations
const THRESHOLDS = {
  keep: 60,
  summarize: 40,
  archive: 20,
};

/**
 * Score the importance of a memory entry
 */
export function scoreImportance(options: {
  content: string;
  timestamp: string;
  referenceCount?: number;
  relatedGoals?: string[];
  isUserMarked?: boolean;
  existingFacts?: string[];
}): ImportanceScore {
  const { content, timestamp, referenceCount = 0, relatedGoals = [], isUserMarked = false, existingFacts = [] } = options;

  // Calculate individual factors
  const recency = calculateRecencyScore(timestamp);
  const frequency = calculateFrequencyScore(referenceCount);
  const relevance = calculateRelevanceScore(content, relatedGoals);
  const uniqueness = calculateUniquenessScore(content, existingFacts);
  const userMarked = isUserMarked ? 100 : 50;

  // Calculate weighted score
  const score = Math.round(
    recency * SCORING_WEIGHTS.recency +
    frequency * SCORING_WEIGHTS.frequency +
    relevance * SCORING_WEIGHTS.relevance +
    uniqueness * SCORING_WEIGHTS.uniqueness +
    userMarked * SCORING_WEIGHTS.userMarked
  );

  // Determine recommendation
  const recommendation = determineRecommendation(score, recency, relevance);
  const reason = generateReason(recommendation, { recency, frequency, relevance, uniqueness, userMarked });

  return {
    score,
    factors: { recency, frequency, relevance, uniqueness, userMarked },
    recommendation,
    reason,
  };
}

/**
 * Calculate recency score (0-100)
 * Newer content scores higher
 */
export function calculateRecencyScore(timestamp: string): number {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const ageDays = (now - then) / (1000 * 60 * 60 * 24);

  // Score decays over time
  // 0 days = 100, 7 days = 80, 30 days = 50, 90 days = 20, 180+ days = 0
  if (ageDays <= 0) return 100;
  if (ageDays <= 1) return 95;
  if (ageDays <= 7) return 80;
  if (ageDays <= 30) return 60;
  if (ageDays <= 90) return 40;
  if (ageDays <= 180) return 20;
  return 0;
}

/**
 * Calculate frequency score (0-100)
 * More references = higher score
 */
export function calculateFrequencyScore(referenceCount: number): number {
  // 0 refs = 20, 1-2 = 40, 3-5 = 60, 6-10 = 80, 10+ = 100
  if (referenceCount === 0) return 20;
  if (referenceCount <= 2) return 40;
  if (referenceCount <= 5) return 60;
  if (referenceCount <= 10) return 80;
  return 100;
}

/**
 * Calculate relevance score (0-100)
 * Related to active goals = higher score
 */
export function calculateRelevanceScore(content: string, relatedGoals: string[]): number {
  if (relatedGoals.length === 0) return 50;

  // Check for goal-related keywords
  const goalKeywords = ['goal', 'objective', 'target', 'milestone', 'progress', 'complete'];
  const lowerContent = content.toLowerCase();
  const keywordMatches = goalKeywords.filter(k => lowerContent.includes(k)).length;

  const goalScore = Math.min(100, 50 + relatedGoals.length * 15);
  const keywordScore = Math.min(100, 50 + keywordMatches * 10);

  return Math.round((goalScore + keywordScore) / 2);
}

/**
 * Calculate uniqueness score (0-100)
 * Unique information = higher score
 */
export function calculateUniquenessScore(content: string, existingFacts: string[]): number {
  if (existingFacts.length === 0) return 100;

  const lowerContent = content.toLowerCase();
  let maxSimilarity = 0;

  for (const fact of existingFacts) {
    const similarity = calculateSimilarity(lowerContent, fact.toLowerCase());
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }

  // Convert similarity to uniqueness (high similarity = low uniqueness)
  return Math.round((1 - maxSimilarity) * 100);
}

/**
 * Calculate text similarity (0-1)
 * Simple Jaccard similarity on words
 */
export function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Determine recommendation based on score and factors
 */
function determineRecommendation(
  score: number,
  recency: number,
  relevance: number
): ImportanceScore['recommendation'] {
  // High score = keep
  if (score >= THRESHOLDS.keep) return 'keep';

  // Recent and relevant = keep even with lower score
  if (recency >= 70 && relevance >= 60) return 'keep';

  // Medium score = summarize
  if (score >= THRESHOLDS.summarize) return 'summarize';

  // Low score but some value = archive
  if (score >= THRESHOLDS.archive) return 'archive';

  // Very low score = delete
  return 'delete';
}

/**
 * Generate human-readable reason for recommendation
 */
function generateReason(
  recommendation: ImportanceScore['recommendation'],
  factors: ImportanceScore['factors']
): string {
  switch (recommendation) {
    case 'keep':
      if (factors.userMarked >= 80) return 'User-marked as important';
      if (factors.recency >= 70 && factors.relevance >= 60) return 'Recent and relevant';
      if (factors.frequency >= 60) return 'Frequently referenced';
      return 'High importance score';

    case 'summarize':
      if (factors.recency < 50) return 'Older content, good candidate for summarization';
      if (factors.uniqueness < 50) return 'Contains redundant information';
      return 'Medium importance, can be summarized';

    case 'archive':
      if (factors.recency < 30) return 'Old content, can be archived';
      if (factors.relevance < 40) return 'Low relevance to current goals';
      return 'Lower importance, suitable for archiving';

    case 'delete':
      return 'Very low importance, safe to delete';
  }
}

/**
 * Score multiple memory entries
 */
export function scoreMultiple(entries: Array<{
  content: string;
  timestamp: string;
  referenceCount?: number;
  relatedGoals?: string[];
  isUserMarked?: boolean;
}>, existingFacts?: string[]): ImportanceScore[] {
  const facts = existingFacts || [];

  return entries.map(entry => scoreImportance({
    ...entry,
    existingFacts: facts,
  }));
}

/**
 * Find duplicate/similar entries
 */
export function findDuplicates(entries: string[], threshold: number = 0.7): Array<{ index1: number; index2: number; similarity: number }> {
  const duplicates: Array<{ index1: number; index2: number; similarity: number }> = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const similarity = calculateSimilarity(entries[i], entries[j]);
      if (similarity >= threshold) {
        duplicates.push({ index1: i, index2: j, similarity });
      }
    }
  }

  return duplicates.sort((a, b) => b.similarity - a.similarity);
}
