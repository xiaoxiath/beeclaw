/**
 * Skill Loader — Extracted from SkillStore (Task 2)
 *
 * Standalone helper functions for skill metadata I/O, maturity calculation,
 * and security checking. These are pure functions or simple I/O helpers
 * that do not require SkillStore instance state.
 *
 * NOTE: `loadSkillsFromDir` and `load` remain as SkillStore private methods
 * because they depend on instance state (basePath, builtinPath, cacheInvalidated).
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../infra/observability/logger';

// ============================================================================
// Metadata Types
// ============================================================================

export interface SkillMetadata {
  usageCount: number;
  successCount: number;
  failureCount: number;
  lastUsed?: string;
  lastFailure?: string;
  maturityScore: number;
  performance?: SkillPerformanceData;
}

export interface SkillPerformanceData {
  executionTimes: number[];
  totalExecutions: number;
  avgExecutionTime: number;
  minExecutionTime: number;
  maxExecutionTime: number;
}

// ============================================================================
// Metadata I/O
// ============================================================================

const EMPTY_PERFORMANCE: SkillPerformanceData = {
  executionTimes: [],
  totalExecutions: 0,
  avgExecutionTime: 0,
  minExecutionTime: 0,
  maxExecutionTime: 0,
};

/**
 * Read .metadata.json from a skill directory.
 * Returns sensible defaults if the file doesn't exist or is corrupt.
 */
export function readMetadata(skillPath: string): SkillMetadata {
  const metadataPath = join(skillPath, '.metadata.json');

  if (!existsSync(metadataPath)) {
    return {
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      maturityScore: 0,
      performance: { ...EMPTY_PERFORMANCE },
    };
  }

  try {
    const content = readFileSync(metadataPath, 'utf-8');
    const data = JSON.parse(content);
    // Ensure performance field exists
    if (!data.performance) {
      data.performance = { ...EMPTY_PERFORMANCE };
    }
    return data;
  } catch {
    return {
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      maturityScore: 0,
      performance: { ...EMPTY_PERFORMANCE },
    };
  }
}

/**
 * Write .metadata.json to a skill directory.
 */
export function writeMetadata(skillPath: string, metadata: SkillMetadata): void {
  const metadataPath = join(skillPath, '.metadata.json');
  const skillName = skillPath.split('/').pop() || 'unknown';

  logger.debug(`[SkillStore] 📊 Metadata updated for ${skillName}:`, {
    usage: metadata.usageCount,
    success: metadata.successCount,
    maturity: metadata.maturityScore,
    avgTime: metadata.performance?.avgExecutionTime,
  });

  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

/**
 * Return empty metadata for builtin skills (considered mature by default).
 */
export function emptyMetadata(): SkillMetadata {
  return {
    usageCount: 0,
    successCount: 0,
    failureCount: 0,
    maturityScore: 100, // Builtin skills are considered mature
  };
}

// ============================================================================
// Maturity Calculation
// ============================================================================

/**
 * Calculate maturity score from metadata and optional quality checks.
 */
export function calculateMaturity(
  metadata: { usageCount: number; successCount: number; failureCount: number },
  checks?: { productionTested: boolean; stable: boolean; wellStructured: boolean; clean: boolean },
): number {
  if (checks) {
    const checkScore = Object.values(checks).filter(Boolean).length * 20;
    const usageScore = Math.min(20, metadata.usageCount * 2);
    return Math.min(100, checkScore + usageScore);
  }

  // Simple calculation based on usage
  if (metadata.usageCount === 0) return 0;

  const successRate = metadata.successCount / metadata.usageCount;
  const usageBonus = Math.min(30, metadata.usageCount * 3);

  return Math.min(100, Math.round(successRate * 70 + usageBonus));
}

// ============================================================================
// Security Checks
// ============================================================================

/**
 * Check SKILL.md content for hardcoded secrets or sensitive patterns.
 */
export function hasSecurityIssues(content: string): boolean {
  const patterns = [
    /api[_-]?key\s*[=:]\s*['"][^'"]+['"]/i,
    /secret\s*[=:]\s*['"][^'"]+['"]/i,
    /password\s*[=:]\s*['"][^'"]+['"]/i,
    /token\s*[=:]\s*['"][^'"]+['"]/i,
    /sk-[a-zA-Z0-9]{20,}/,
    /\$\{[A-Z_]+_API_KEY\}/,
  ];

  return patterns.some(p => p.test(content));
}
