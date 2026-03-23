/**
 * Error Tracker - Error Statistics and Health Monitoring
 *
 * Tracks error occurrences and provides health status checks.
 *
 * @deprecated This module depends on error-handler.ts which is itself deprecated.
 * New code should use the unified error handling in `src/infra/resilience/unified-retry.ts`.
 */

import type { ClassifiedError, ErrorType } from './error-handler';
import { logger } from './logger';

/**
 * Error statistics for a specific error type
 */
export interface ErrorStats {
  type: ErrorType;
  count: number;
  firstOccurrence: Date;
  lastOccurrence: Date;
  sample: ClassifiedError;
}

/**
 * Health status of the system
 */
export interface HealthStatus {
  healthy: boolean;
  issues: string[];
  errorStats: ErrorStats[];
  uptime: number;  // seconds
}

/**
 * Error Tracker - Singleton
 *
 * Tracks errors and provides health monitoring.
 */
export class ErrorTracker {
  private static instance: ErrorTracker;
  private stats: Map<ErrorType, ErrorStats> = new Map();
  private startTime: Date = new Date();
  private readonly maxSamples: number = 100;

  private constructor() {}

  static getInstance(): ErrorTracker {
    if (!ErrorTracker.instance) {
      ErrorTracker.instance = new ErrorTracker();
    }
    return ErrorTracker.instance;
  }

  /**
   * Record an error occurrence
   */
  record(error: ClassifiedError): void {
    const existing = this.stats.get(error.type);

    if (existing) {
      existing.count++;
      existing.lastOccurrence = new Date();
    } else {
      this.stats.set(error.type, {
        type: error.type,
        count: 1,
        firstOccurrence: new Date(),
        lastOccurrence: new Date(),
        sample: error,
      });
    }

    // Log critical errors immediately
    if (
      error.type === 'INSUFFICIENT_BALANCE' ||
      error.type === 'AUTH_ERROR'
    ) {
      logger.error(`[ErrorTracker] Critical error: ${error.type} - ${error.message}`);
    }
  }

  /**
   * Get error statistics
   */
  getStats(): ErrorStats[] {
    return Array.from(this.stats.values())
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get errors by type
   */
  getErrorsByType(type: ErrorType): ErrorStats | undefined {
    return this.stats.get(type);
  }

  /**
   * Get total error count
   */
  getTotalErrors(): number {
    return Array.from(this.stats.values())
      .reduce((sum, stat) => sum + stat.count, 0);
  }

  /**
   * Get system health status
   */
  getHealthStatus(): HealthStatus {
    const issues: string[] = [];
    const now = Date.now();
    const oneHour = 3600000;  // 1 hour in ms

    // Check for recent critical errors (last 1 hour)
    for (const stat of this.stats.values()) {
      const timeSinceLast = now - stat.lastOccurrence.getTime();

      if (timeSinceLast < oneHour) {
        // Critical: balance or auth errors
        if (stat.type === 'INSUFFICIENT_BALANCE') {
          issues.push(`🔴 余额不足（最近 1 小时出现 ${stat.count} 次）`);
        } else if (stat.type === 'AUTH_ERROR') {
          issues.push(`🔴 认证失败（最近 1 小时出现 ${stat.count} 次）`);
        }
        // Warning: high error frequency
        else if (stat.count > 10) {
          issues.push(`⚠️ ${stat.type}: ${stat.count} 次错误`);
        }
      }
    }

    const uptime = Math.floor((now - this.startTime.getTime()) / 1000);

    return {
      healthy: issues.length === 0,
      issues,
      errorStats: this.getStats(),
      uptime,
    };
  }

  /**
   * Clear all statistics
   */
  clear(): void {
    this.stats.clear();
    this.startTime = new Date();
  }

  /**
   * Format health status for display
   */
  formatHealthStatus(): string {
    const health = this.getHealthStatus();
    const lines: string[] = [];

    lines.push('## 📊 系统健康状态\n');

    // Overall status
    if (health.healthy) {
      lines.push('✅ 系统运行正常\n');
    } else {
      lines.push('❌ 发现问题:\n');
      for (const issue of health.issues) {
        lines.push(`  ${issue}`);
      }
      lines.push('');
    }

    // Uptime
    const hours = Math.floor(health.uptime / 3600);
    const minutes = Math.floor((health.uptime % 3600) / 60);
    lines.push(`**运行时间**: ${hours}h ${minutes}m`);
    lines.push(`**总错误数**: ${this.getTotalErrors()}\n`);

    // Error breakdown
    if (health.errorStats.length > 0) {
      lines.push('### 错误统计\n');
      lines.push('| 错误类型 | 次数 | 最近发生 |');
      lines.push('|---------|------|---------|');

      for (const stat of health.errorStats.slice(0, 10)) {
        const timeSince = Date.now() - stat.lastOccurrence.getTime();
        const minutesAgo = Math.floor(timeSince / 60000);
        const timeStr = minutesAgo < 60 ? `${minutesAgo}分钟前` : `${Math.floor(minutesAgo / 60)}小时前`;

        lines.push(`| ${stat.type} | ${stat.count} | ${timeStr} |`);
      }
    }

    return lines.join('\n');
  }
}

// Export singleton instance
export const errorTracker = ErrorTracker.getInstance();
