/**
 * Proactive Scheduler
 *
 * Manages scheduled tasks and cron-based execution
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type {
  Schedule,
  Pattern,
  ScheduleStorage,
  CreateScheduleOptions,
  ProactiveToolResult,
} from './types';

export class Scheduler {
  private basePath: string;
  private storagePath: string;
  private storage: ScheduleStorage;
  private initialized: boolean = false;
  private cronTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(basePath: string) {
    this.basePath = basePath;
    this.storagePath = join(basePath, 'schedules.json');
    this.storage = {
      schedules: {},
      patterns: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  // Initialize scheduler storage
  init(): void {
    if (this.initialized) return;

    // Ensure directory exists
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }

    // Load existing storage
    this.loadStorage();

    this.initialized = true;
  }

  // List all schedules
  listSchedules(filter?: { enabled?: boolean }): Schedule[] {
    this.init();
    const schedules = Object.values(this.storage.schedules);

    if (filter?.enabled !== undefined) {
      return schedules.filter(s => s.enabled === filter.enabled);
    }

    return schedules;
  }

  // List all patterns
  listPatterns(filter?: { enabled?: boolean }): Pattern[] {
    this.init();
    const patterns = Object.values(this.storage.patterns);

    if (filter?.enabled !== undefined) {
      return patterns.filter(p => p.enabled === filter.enabled);
    }

    return patterns;
  }

  // Get a specific schedule
  getSchedule(id: string): Schedule | null {
    this.init();
    return this.storage.schedules[id] || null;
  }

  // Get a specific pattern
  getPattern(id: string): Pattern | null {
    this.init();
    return this.storage.patterns[id] || null;
  }

  // Create a new schedule
  createSchedule(options: CreateScheduleOptions): ProactiveToolResult {
    this.init();

    const id = this.generateId('schedule');
    const now = new Date().toISOString();

    // Parse cron and calculate next run
    const nextRun = this.calculateNextRun(options.cron);

    const schedule: Schedule = {
      id,
      name: options.name,
      description: options.description,
      cron: options.cron,
      enabled: options.enabled ?? true,
      state: options.enabled !== false ? 'enabled' : 'disabled',
      task: {
        type: options.taskType,
        params: options.taskParams || {},
      },
      nextRun: nextRun?.toISOString(),
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.storage.schedules[id] = schedule;
    this.saveStorage();

    return { success: true, data: schedule };
  }

  // Update a schedule
  updateSchedule(id: string, updates: Partial<Schedule>): ProactiveToolResult {
    this.init();

    const existing = this.storage.schedules[id];
    if (!existing) {
      return { success: false, error: `Schedule not found: ${id}` };
    }

    const now = new Date().toISOString();
    const updated: Schedule = {
      ...existing,
      ...updates,
      id, // Preserve ID
      updatedAt: now,
    };

    // Recalculate next run if cron changed
    if (updates.cron && updates.cron !== existing.cron) {
      updated.nextRun = this.calculateNextRun(updates.cron)?.toISOString();
    }

    this.storage.schedules[id] = updated;
    this.saveStorage();

    return { success: true, data: updated };
  }

  // Delete a schedule
  deleteSchedule(id: string): ProactiveToolResult {
    this.init();

    if (!this.storage.schedules[id]) {
      return { success: false, error: `Schedule not found: ${id}` };
    }

    // Stop any running timer
    this.stopScheduleTimer(id);

    delete this.storage.schedules[id];
    this.saveStorage();

    return { success: true, data: { deleted: id } };
  }

  // Enable a schedule
  enableSchedule(id: string): ProactiveToolResult {
    return this.updateSchedule(id, { enabled: true, state: 'enabled' });
  }

  // Disable a schedule
  disableSchedule(id: string): ProactiveToolResult {
    this.stopScheduleTimer(id);
    return this.updateSchedule(id, { enabled: false, state: 'disabled' });
  }

  // Record schedule execution
  recordExecution(id: string, result: unknown): void {
    const schedule = this.storage.schedules[id];
    if (!schedule) return;

    const now = new Date().toISOString();
    schedule.lastRun = now;
    schedule.runCount++;
    schedule.lastResult = result;
    schedule.nextRun = this.calculateNextRun(schedule.cron)?.toISOString();
    schedule.updatedAt = now;

    this.saveStorage();
  }

  // Get schedules that should run now
  getDueSchedules(): Schedule[] {
    this.init();
    const now = new Date();

    return Object.values(this.storage.schedules).filter(schedule => {
      if (!schedule.enabled || schedule.state !== 'enabled') return false;
      if (!schedule.nextRun) return true; // No next run, should calculate

      const nextRun = new Date(schedule.nextRun);
      return nextRun <= now;
    });
  }

  // Create a pattern (event-based trigger)
  createPattern(options: {
    name: string;
    description?: string;
    triggerType: 'time_based' | 'event_based' | 'condition_based';
    condition: string;
    actionType: string;
    actionParams?: Record<string, unknown>;
  }): ProactiveToolResult {
    this.init();

    const id = this.generateId('pattern');
    const now = new Date().toISOString();

    const pattern: Pattern = {
      id,
      name: options.name,
      description: options.description,
      trigger: {
        type: options.triggerType,
        condition: options.condition,
      },
      action: {
        type: options.actionType as any,
        params: options.actionParams || {},
      },
      enabled: true,
      triggerCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.storage.patterns[id] = pattern;
    this.saveStorage();

    return { success: true, data: pattern };
  }

  // Delete a pattern
  deletePattern(id: string): ProactiveToolResult {
    this.init();

    if (!this.storage.patterns[id]) {
      return { success: false, error: `Pattern not found: ${id}` };
    }

    delete this.storage.patterns[id];
    this.saveStorage();

    return { success: true, data: { deleted: id } };
  }

  // Update a pattern
  updatePattern(id: string, updates: Partial<Pattern>): ProactiveToolResult {
    this.init();

    const existing = this.storage.patterns[id];
    if (!existing) {
      return { success: false, error: `Pattern not found: ${id}` };
    }

    const now = new Date().toISOString();
    const updated: Pattern = {
      ...existing,
      ...updates,
      id, // Preserve ID
      updatedAt: now,
    };

    this.storage.patterns[id] = updated;
    this.saveStorage();

    return { success: true, data: updated };
  }

  // Start all enabled schedules (for daemon mode)
  startAll(callback: (schedule: Schedule) => Promise<void>): void {
    this.init();

    for (const schedule of Object.values(this.storage.schedules)) {
      if (schedule.enabled) {
        this.startSchedule(schedule, callback);
      }
    }
  }

  // Stop all schedules
  stopAll(): void {
    for (const id of this.cronTimers.keys()) {
      this.stopScheduleTimer(id);
    }
  }

  // Private helper methods

  private startSchedule(schedule: Schedule, callback: (schedule: Schedule) => Promise<void>): void {
    // Stop existing timer if any
    this.stopScheduleTimer(schedule.id);

    // Calculate time until next run
    const nextRun = schedule.nextRun ? new Date(schedule.nextRun) : this.calculateNextRun(schedule.cron);
    if (!nextRun) return;

    const delay = nextRun.getTime() - Date.now();
    if (delay < 0) {
      // Already past due, run immediately
      callback(schedule);
      return;
    }

    // Set timer for next run
    const timer = setTimeout(async () => {
      await callback(schedule);
      // Reschedule
      const updated = this.storage.schedules[schedule.id];
      if (updated?.enabled) {
        this.startSchedule(updated, callback);
      }
    }, delay);

    this.cronTimers.set(schedule.id, timer);
  }

  private stopScheduleTimer(id: string): void {
    const timer = this.cronTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.cronTimers.delete(id);
    }
  }

  private calculateNextRun(cronExpr: string): Date | null {
    // Enhanced cron parser for common patterns
    // Format: minute hour day-of-month month day-of-week
    // NOTE: Uses LOCAL timezone (not UTC) for user-friendly scheduling
    // All cron expressions are interpreted in the system's local timezone
    // Example: "14 0 * * *" means "run at 00:14 local time every day"
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const now = new Date();
    const next = new Date(now);

    // Parse each part
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Helper to parse field (handles *, numbers, */n, and n,m,o lists)
    const parseField = (field: string, min: number, max: number): number[] | null => {
      if (field === '*') {
        return Array.from({ length: max - min + 1 }, (_, i) => min + i);
      }

      // Handle */n (step)
      const stepMatch = field.match(/^\*\/(\d+)$/);
      if (stepMatch) {
        const step = parseInt(stepMatch[1], 10);
        if (step <= 0 || step > max) return null;
        const values: number[] = [];
        for (let i = min; i <= max; i += step) {
          values.push(i);
        }
        return values;
      }

      // Handle lists (e.g., "1,3,5")
      if (field.includes(',')) {
        const values = field.split(',').map(v => parseInt(v, 10));
        if (values.some(isNaN)) return null;
        return values.filter(v => v >= min && v <= max);
      }

      // Handle ranges (e.g., "1-5")
      const rangeMatch = field.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start > end || start < min || end > max) return null;
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      }

      // Handle single number
      const num = parseInt(field, 10);
      if (isNaN(num) || num < min || num > max) return null;
      return [num];
    };

    const minutes = parseField(minute, 0, 59);
    const hours = parseField(hour, 0, 23);
    const daysOfMonth = parseField(dayOfMonth, 1, 31);
    const months = parseField(month, 1, 12);
    const daysOfWeek = parseField(dayOfWeek, 0, 6); // 0 = Sunday

    if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
      // Fallback for unsupported patterns: 1 hour from now
      next.setHours(next.getHours() + 1);
      return next;
    }

    // Find next matching time
    // Start from current time and search forward (max 366 days)
    next.setSeconds(0, 0);
    const maxIterations = 366 * 24 * 60; // Max 1 year of minutes
    for (let i = 0; i < maxIterations; i++) {
      next.setMinutes(next.getMinutes() + 1);

      const m = next.getMinutes();
      const h = next.getHours();
      const dom = next.getDate();
      const mon = next.getMonth() + 1;
      const dow = next.getDay();

      if (
        minutes.includes(m) &&
        hours.includes(h) &&
        daysOfMonth.includes(dom) &&
        months.includes(mon) &&
        daysOfWeek.includes(dow)
      ) {
        return next;
      }
    }

    // If no match found in a year, return null
    return null;
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private loadStorage(): void {
    if (existsSync(this.storagePath)) {
      try {
        const content = readFileSync(this.storagePath, 'utf-8');
        this.storage = JSON.parse(content);
      } catch {
        // Use default storage
      }
    } else {
      // Create empty storage file if it doesn't exist
      this.saveStorage();
    }
  }

  private saveStorage(): void {
    this.storage.lastUpdated = new Date().toISOString();
    writeFileSync(this.storagePath, JSON.stringify(this.storage, null, 2), 'utf-8');
  }
}

// Singleton instance
let scheduler: Scheduler | null = null;

export function getScheduler(basePath?: string): Scheduler {
  if (!scheduler && basePath) {
    scheduler = new Scheduler(basePath);
    scheduler.init();
  }
  if (!scheduler) {
    throw new Error('Scheduler not initialized. Call getScheduler with basePath first.');
  }
  return scheduler;
}

export function resetScheduler(): void {
  scheduler = null;
}
