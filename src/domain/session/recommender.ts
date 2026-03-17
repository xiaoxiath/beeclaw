/**
 * Session Recommender
 *
 * Recommends relevant historical sessions based on current context.
 */

import { readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { listSessions, type Session } from '../session';

export interface SessionRecommendation {
  sessionId: string;
  session: Session;
  relevanceScore: number;
  reasons: string[];
}

export interface RecommenderContext {
  workingDirectory: string;
  recentFiles?: string[];
  currentTime?: Date;
  keywords?: string[];
}

/**
 * Get recent files from a directory
 */
function getRecentFiles(dir: string, limit: number = 10): string[] {
  try {
    const files = readdirSync(dir)
      .map(file => ({
        name: file,
        path: join(dir, file),
        time: statSync(join(dir, file)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
      .map(f => f.name);

    return files;
  } catch {
    return [];
  }
}

/**
 * Extract keywords from a directory path
 */
function extractPathKeywords(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  // Filter out common noise words
  const noiseWords = ['Users', 'home', 'workspace', 'projects', 'src', 'code'];
  return parts.filter(part => !noiseWords.includes(part.toLowerCase()));
}

/**
 * Calculate similarity between two strings (simple keyword matching)
 */
function calculateKeywordSimilarity(keywords1: string[], keywords2: string[]): number {
  if (keywords1.length === 0 || keywords2.length === 0) return 0;

  const set1 = new Set(keywords1.map(k => k.toLowerCase()));
  const set2 = new Set(keywords2.map(k => k.toLowerCase()));

  let matches = 0;
  for (const keyword of set1) {
    if (set2.has(keyword)) matches++;
  }

  return matches / Math.max(set1.size, set2.size);
}

/**
 * Calculate time-based relevance (recent sessions are more relevant)
 */
function calculateTimeRelevance(sessionUpdatedAt: string): number {
  const sessionTime = new Date(sessionUpdatedAt).getTime();
  const now = Date.now();
  const hoursAgo = (now - sessionTime) / (1000 * 60 * 60);

  // Recent sessions (within 24 hours) get high score
  if (hoursAgo < 24) return 1.0;
  // This week
  if (hoursAgo < 24 * 7) return 0.7;
  // This month
  if (hoursAgo < 24 * 30) return 0.4;
  // Older
  return 0.2;
}

/**
 * Check if session content matches keywords
 */
function checkContentMatch(session: Session, keywords: string[]): { score: number; matches: string[] } {
  const matches: string[] = [];
  let totalScore = 0;

  // Check session messages for keyword matches
  const recentMessages = session.messages.slice(-10); // Check last 10 messages

  for (const message of recentMessages) {
    const content = message.content.toLowerCase();
    for (const keyword of keywords) {
      if (content.includes(keyword.toLowerCase())) {
        matches.push(keyword);
        totalScore += 0.1; // Each match adds 0.1 to score
      }
    }
  }

  return {
    score: Math.min(totalScore, 1.0), // Cap at 1.0
    matches: [...new Set(matches)], // Deduplicate
  };
}

/**
 * Recommend relevant sessions based on current context
 */
export function recommendSessions(
  context: RecommenderContext,
  options?: {
    maxRecommendations?: number;
    minRelevanceScore?: number;
  }
): SessionRecommendation[] {
  const maxRecommendations = options?.maxRecommendations || 5;
  const minRelevanceScore = options?.minRelevanceScore || 0.3;

  // Get all sessions
  const allSessions = listSessions();

  // Filter out CLI sessions from today (we're already in that session)
  const today = new Date().toISOString().split('T')[0];
  const candidateSessions = allSessions.filter(s =>
    !(s.channel === 'cli' && s.id.includes(today))
  );

  // Extract keywords from context
  const contextKeywords = [
    ...extractPathKeywords(context.workingDirectory),
    ...(context.keywords || []),
  ];

  // Get recent files as additional context
  const recentFiles = context.recentFiles || getRecentFiles(context.workingDirectory, 5);
  const fileKeywords = recentFiles.map(f => basename(f, '.ts').replace(/[-_]/g, ' '));

  const allKeywords = [...contextKeywords, ...fileKeywords];

  // Score each session
  const recommendations: SessionRecommendation[] = [];

  for (const session of candidateSessions) {
    const reasons: string[] = [];
    let totalScore = 0;

    // 1. Time relevance (weight: 30%)
    const timeRelevance = calculateTimeRelevance(session.updatedAt);
    totalScore += timeRelevance * 0.3;
    if (timeRelevance > 0.7) {
      reasons.push('🕐 Recent session');
    }

    // 2. Path similarity (weight: 40%)
    // Extract keywords from session metadata or ID
    const sessionKeywords = session.id.split('-').filter(Boolean);
    const pathSimilarity = calculateKeywordSimilarity(allKeywords, sessionKeywords);
    totalScore += pathSimilarity * 0.4;
    if (pathSimilarity > 0.3) {
      reasons.push('📁 Related to current directory');
    }

    // 3. Content match (weight: 30%)
    const contentMatch = checkContentMatch(session, allKeywords);
    totalScore += contentMatch.score * 0.3;
    if (contentMatch.matches.length > 0) {
      reasons.push(`💬 Discusses: ${contentMatch.matches.slice(0, 3).join(', ')}`);
    }

    // Normalize score to 0-1 range
    const normalizedScore = Math.min(totalScore, 1.0);

    if (normalizedScore >= minRelevanceScore) {
      recommendations.push({
        sessionId: session.id,
        session,
        relevanceScore: normalizedScore,
        reasons,
      });
    }
  }

  // Sort by relevance score and return top recommendations
  return recommendations
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxRecommendations);
}

/**
 * Format session recommendation for display
 */
export function formatRecommendation(rec: SessionRecommendation, index: number): string {
  const sessionDate = new Date(rec.session.updatedAt).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const messageCount = rec.session.messages.length;
  const score = (rec.relevanceScore * 100).toFixed(0);

  const lines = [
    `${index + 1}. ${rec.session.id}`,
    `   📅 ${sessionDate} | 💬 ${messageCount} messages | 🎯 ${score}% match`,
  ];

  if (rec.reasons.length > 0) {
    lines.push(`   ${rec.reasons.join(' | ')}`);
  }

  return lines.join('\n');
}
