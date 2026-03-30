/**
 * Query Tracking System
 *
 * Records user queries to detect patterns and enable intelligent improvements:
 * - Detect recurring queries (e.g., "weekly briefing", "daily standup")
 * - Identify high-frequency topics for skill creation
 * - Track query preferences for personalization
 *
 * @module evolution/query-tracking
 */

import { logger } from '../../../infra/observability/logger';
import { getMemoryStore } from '../../memory';

/**
 * Query record structure
 */
export interface QueryRecord {
  query: string;
  timestamp: number;
  intent?: string;
  entities?: string[];
  context?: {
    channel?: string;
    userId?: string;
    sessionId?: string;
  };
}

/**
 * Query pattern detected from recurring queries
 */
export interface QueryPattern {
  pattern: string;
  frequency: number;
  firstSeen: number;
  lastSeen: number;
  examples: string[];
  suggestedAction?: string;
}

/**
 * Configuration for query tracking
 */
const QUERY_TRACKING_CONFIG = {
  /** Time window for pattern detection (7 days) */
  patternTimeWindowMs: 7 * 24 * 60 * 60 * 1000,
  /** Minimum frequency to consider a pattern */
  minPatternFrequency: 3,
  /** Maximum examples to store per pattern */
  maxExamplesPerPattern: 5,
  /** Similarity threshold for query clustering */
  similarityThreshold: 0.8,
};

/**
 * Recent query buffer (in-memory for performance)
 */
const recentQueries: QueryRecord[] = [];

/**
 * Record a user query for pattern detection
 *
 * @param query - User's query text
 * @param context - Optional context (channel, user, session)
 */
export function recordQuery(
  query: string,
  context?: {
    channel?: string;
    userId?: string;
    sessionId?: string;
  }
): void {
  // Skip empty queries
  if (!query || query.trim().length === 0) {
    return;
  }

  // Create query record
  const record: QueryRecord = {
    query: query.trim(),
    timestamp: Date.now(),
    intent: extractIntent(query),
    entities: extractEntities(query),
    context,
  };

  // Add to recent buffer
  recentQueries.push(record);

  // Clean up old entries (keep only last 7 days)
  const cutoff = Date.now() - QUERY_TRACKING_CONFIG.patternTimeWindowMs;
  while (recentQueries.length > 0 && recentQueries[0].timestamp < cutoff) {
    recentQueries.shift();
  }

  // Persist to memory store (async, non-blocking)
  persistQueryRecord(record).catch((error) => {
    logger.error('[QueryTracking] Failed to persist query record:', error);
  });

  // Check for patterns (async, non-blocking)
  detectPatternsAsync().catch((error) => {
    logger.error('[QueryTracking] Pattern detection failed:', error);
  });
}

/**
 * Extract intent from query (simple heuristic-based)
 */
function extractIntent(query: string): string | undefined {
  const queryLower = query.toLowerCase();

  // Common intent patterns
  const intents: Record<string, RegExp> = {
    schedule: /(?:schedule|日程|安排|plan|计划)/,
    status: /(?:status|状态|进度|progress)/,
    help: /(?:help|帮助|如何|怎么|how to)/,
    create: /(?:create|创建|新建|add|添加)/,
    update: /(?:update|更新|修改|change|更改)/,
    delete: /(?:delete|删除|remove|移除)/,
    query: /(?:query|查询|search|搜索|find|查找)/,
    report: /(?:report|报告|summary|总结|briefing)/,
  };

  for (const [intent, pattern] of Object.entries(intents)) {
    if (pattern.test(queryLower)) {
      return intent;
    }
  }

  return undefined;
}

/**
 * Extract entities from query (simple keyword extraction)
 */
function extractEntities(query: string): string[] {
  // Simple keyword extraction (could be enhanced with NLP)
  const keywords: string[] = [];

  // Extract quoted strings
  const quotes = query.match(/"([^"]+)"|'([^']+)'/g);
  if (quotes) {
    keywords.push(...quotes.map((q) => q.replace(/["']/g, '')));
  }

  // Extract capitalized words and CamelCase (potential proper nouns)
  // Match: Word, ProjectName, ProjectX, etc.
  const capitalized = query.match(/\b[A-Z][a-zA-Z]*\b/g);
  if (capitalized) {
    keywords.push(...capitalized.filter(w => w.length > 1)); // Skip single letters
  }

  // Extract numbers with units
  const numbers = query.match(/\d+\s*(?:days?|hours?|weeks?|months?|次|个|天|小时|周|月)/gi);
  if (numbers) {
    keywords.push(...numbers);
  }

  return [...new Set(keywords)]; // Remove duplicates
}

/**
 * Persist query record to memory store
 */
async function persistQueryRecord(record: QueryRecord): Promise<void> {
  try {
    const memoryStore = getMemoryStore();
    if (!memoryStore) {
      return;
    }

    await memoryStore.record('lessons', `Query: ${record.query} (intent: ${record.intent || 'unknown'})`);
    if (record.entities && record.entities.length > 0) {
      await memoryStore.write(
        'facts/query_tracking.md',
        `\n- [${new Date(record.timestamp).toISOString()}] ${record.query} | intent=${record.intent || 'unknown'} | entities=${record.entities.join(',')}`,
        'append',
      );
    }
  } catch (_error) {
    // Memory store might not be initialized
    console.debug('[QueryTracking] Memory store not available for persistence');
  }
}

/**
 * Detect patterns asynchronously (non-blocking)
 */
async function detectPatternsAsync(): Promise<void> {
  // Run pattern detection in next tick to avoid blocking
  setTimeout(() => {
    const patterns = detectPatterns();

    if (patterns.length > 0) {
      logger.debug(`[QueryTracking] Detected ${patterns.length} query patterns`);

      // Store patterns as facts
      storePatterns(patterns).catch((error) => {
        logger.error('[QueryTracking] Failed to store patterns:', error);
      });
    }
  }, 100);
}

/**
 * Detect recurring query patterns
 */
export function detectPatterns(): QueryPattern[] {
  if (recentQueries.length < QUERY_TRACKING_CONFIG.minPatternFrequency) {
    return [];
  }

  const patterns: Map<string, QueryPattern> = new Map();
  const now = Date.now();
  const cutoff = now - QUERY_TRACKING_CONFIG.patternTimeWindowMs;

  // Group similar queries
  for (const record of recentQueries) {
    if (record.timestamp < cutoff) {
      continue;
    }

    // Create pattern key using intent + first significant word
    // Extract first meaningful word (skip common words)
    const words = record.query.toLowerCase().split(/\s+/);
    const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'what', 'how', 'when', 'where', 'why']);
    const significantWords = words.filter(w => !stopWords.has(w) && w.length > 2);
    const firstSignificantWord = significantWords[0] || words[0];

    const patternKey = record.intent
      ? `${record.intent}:${firstSignificantWord}`
      : firstSignificantWord;

    const existing = patterns.get(patternKey);
    if (existing) {
      existing.frequency++;
      existing.lastSeen = record.timestamp;
      if (existing.examples.length < QUERY_TRACKING_CONFIG.maxExamplesPerPattern) {
        existing.examples.push(record.query);
      }
    } else {
      patterns.set(patternKey, {
        pattern: patternKey,
        frequency: 1,
        firstSeen: record.timestamp,
        lastSeen: record.timestamp,
        examples: [record.query],
      });
    }
  }

  // Filter patterns by minimum frequency
  const detectedPatterns = Array.from(patterns.values())
    .filter((p) => p.frequency >= QUERY_TRACKING_CONFIG.minPatternFrequency)
    .sort((a, b) => b.frequency - a.frequency);

  // Add suggested actions
  for (const pattern of detectedPatterns) {
    pattern.suggestedAction = suggestAction(pattern);
  }

  return detectedPatterns;
}

/**
 * Suggest action based on query pattern
 */
function suggestAction(pattern: QueryPattern): string {
  const examples = pattern.examples.join(', ');

  if (pattern.frequency >= 5) {
    return `Consider creating a skill for high-frequency query: "${examples}"`;
  }

  if (pattern.pattern.includes('schedule') || pattern.pattern.includes('日程')) {
    return `Consider creating a scheduled task for recurring schedule queries`;
  }

  if (pattern.pattern.includes('status') || pattern.pattern.includes('状态')) {
    return `Consider creating a status dashboard or periodic status updates`;
  }

  return `Pattern detected (${pattern.frequency} times): "${examples}"`;
}

/**
 * Store detected patterns as facts in memory
 */
async function storePatterns(patterns: QueryPattern[]): Promise<void> {
  try {
    const memoryStore = getMemoryStore();
    if (!memoryStore) {
      return;
    }

    for (const pattern of patterns) {
      // Check if pattern already exists by reading the facts file
      const existingContent = memoryStore.read('facts/query_patterns.md');
      const patternKey = `pattern:${pattern.pattern}`;
      const alreadyStored = existingContent.success
        ? String(existingContent.data || '').includes(patternKey)
        : false;

      if (!alreadyStored) {
        await memoryStore.write(
          'facts/query_patterns.md',
          `\n- ${patternKey} | frequency=${pattern.frequency} | examples=${pattern.examples.slice(0, 2).join(', ')} | firstSeen=${new Date(pattern.firstSeen).toISOString()} | lastSeen=${new Date(pattern.lastSeen).toISOString()} | suggestedAction=${pattern.suggestedAction || 'none'}`,
          'append',
        );

        logger.debug(`[QueryTracking] Stored pattern: ${pattern.pattern} (${pattern.frequency}x)`);
      }
    }
  } catch (error) {
    logger.error('[QueryTracking] Failed to store patterns:', error);
  }
}

/**
 * Get recent queries (for debugging)
 */
export function getRecentQueries(limit?: number): QueryRecord[] {
  if (limit) {
    return recentQueries.slice(-limit);
  }
  return [...recentQueries];
}

/**
 * Clear query tracking data (for testing)
 */
export function clearQueryTracking(): void {
  recentQueries.length = 0;
}

/**
 * Get query tracking statistics
 */
export function getQueryTrackingStats(): {
  totalQueries: number;
  uniqueIntents: number;
  topIntents: Array<{ intent: string; count: number }>;
  patternsDetected: number;
} {
  const intentCounts = new Map<string, number>();

  for (const record of recentQueries) {
    if (record.intent) {
      intentCounts.set(record.intent, (intentCounts.get(record.intent) || 0) + 1);
    }
  }

  const topIntents = Array.from(intentCounts.entries())
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const patterns = detectPatterns();

  return {
    totalQueries: recentQueries.length,
    uniqueIntents: intentCounts.size,
    topIntents,
    patternsDetected: patterns.length,
  };
}
