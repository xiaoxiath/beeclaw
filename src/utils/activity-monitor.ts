/**
 * Activity Monitor - Track agent activity for smart timeout
 *
 * Records agent activities (LLM chunks, tool calls, subagents) to detect
 * when the agent is truly stuck vs actively working on a complex task.
 */

/**
 * Activity event types
 */
export type ActivityType =
  | 'llm_chunk'      // LLM returned a token
  | 'tool_call'      // Tool execution started/ended
  | 'subagent'       // Subagent started/completed
  | 'progress'       // Progress update
  | 'thinking';      // Agent thinking (internal reasoning)

/**
 * Activity event record
 */
export interface ActivityEvent {
  type: ActivityType;
  timestamp: number;
  details?: string;
}

/**
 * Activity statistics
 */
export interface ActivityStats {
  totalEvents: number;
  lastActivity: Date;
  inactiveTimeMs: number;
  eventsByType: Record<ActivityType, number>;
}

/**
 * Activity Monitor
 *
 * Tracks agent activity to enable smart timeout based on inactivity
 * rather than fixed time limits.
 *
 * @example
 * ```typescript
 * const monitor = new ActivityMonitor();
 *
 * // Record activities
 * monitor.record('llm_chunk');
 * monitor.record('tool_call', 'web_fetch');
 *
 * // Check if timed out
 * if (monitor.isInactive(60000)) {
 *   console.log('Agent inactive for 60s');
 * }
 *
 * // Get stats
 * console.log(monitor.getStats());
 * ```
 */
export class ActivityMonitor {
  private lastActivityTime: number;
  private events: ActivityEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents: number = 100) {
    this.lastActivityTime = Date.now();
    this.maxEvents = maxEvents;
  }

  /**
   * Record an activity event
   */
  record(type: ActivityType, details?: string): void {
    const event: ActivityEvent = {
      type,
      timestamp: Date.now(),
      details,
    };

    this.events.push(event);
    this.lastActivityTime = event.timestamp;

    // Keep only recent events to prevent memory leak
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /**
   * Check if agent has been inactive for the specified duration
   */
  isInactive(timeoutMs: number): boolean {
    const inactiveMs = this.getInactiveTimeMs();
    return inactiveMs > timeoutMs;
  }

  /**
   * Get inactive time in milliseconds
   */
  getInactiveTimeMs(): number {
    return Date.now() - this.lastActivityTime;
  }

  /**
   * Get last activity time
   */
  getLastActivityTime(): Date {
    return new Date(this.lastActivityTime);
  }

  /**
   * Get activity statistics
   */
  getStats(): ActivityStats {
    const eventsByType: Partial<Record<ActivityType, number>> = {};

    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    }

    return {
      totalEvents: this.events.length,
      lastActivity: this.getLastActivityTime(),
      inactiveTimeMs: this.getInactiveTimeMs(),
      eventsByType: eventsByType as Record<ActivityType, number>,
    };
  }

  /**
   * Get recent events
   */
  getRecentEvents(count: number = 10): ActivityEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Reset monitor (clear all events)
   */
  reset(): void {
    this.events = [];
    this.lastActivityTime = Date.now();
  }

  /**
   * Format activity report for display
   */
  formatReport(): string {
    const stats = this.getStats();
    const lines: string[] = [];

    lines.push('## 📊 Agent 活动报告\n');

    // Status
    const inactiveSec = Math.round(stats.inactiveTimeMs / 1000);
    lines.push(`**最后活动**: ${stats.lastActivity.toLocaleTimeString()}`);
    lines.push(`**无活动时间**: ${inactiveSec} 秒\n`);

    // Event counts
    if (stats.totalEvents > 0) {
      lines.push('### 事件统计');
      for (const [type, count] of Object.entries(stats.eventsByType)) {
        lines.push(`- ${type}: ${count} 次`);
      }
      lines.push('');

      // Recent events
      lines.push('### 最近事件');
      const recent = this.getRecentEvents(5);
      for (const event of recent) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const detail = event.details ? `: ${event.details}` : '';
        lines.push(`- [${time}] ${event.type}${detail}`);
      }
    } else {
      lines.push('_暂无活动记录_');
    }

    return lines.join('\n');
  }
}
