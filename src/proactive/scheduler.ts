/**
 * Proactive Scheduler
 *
 * Manages scheduled tasks and cron-based execution
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getConfig } from '../config';
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

    // Check if delay exceeds setTimeout max (2147483647 ms ≈ 24.8 days)
    const MAX_SET_TIMEOUT = 2147483647;

    if (delay <= 0) {
      // Already past due, run immediately
      callback(schedule);
      return;
    }

    if (delay > MAX_SET_TIMEOUT) {
      // Delay too large for setTimeout, use a check interval instead
      // Check every hour until we're within the safe range
      const checkInterval = setInterval(() => {
        const remainingTime = nextRun.getTime() - Date.now();
        if (remainingTime <= 0) {
          clearInterval(checkInterval);
          this.cronTimers.delete(schedule.id);
          callback(schedule);
        } else if (remainingTime <= MAX_SET_TIMEOUT) {
          // Now we can use setTimeout safely
          clearInterval(checkInterval);
          this.startSchedule(schedule, callback);
        }
      }, 60 * 60 * 1000); // Check every hour

      // Store the interval as if it were a timer (for cleanup)
      this.cronTimers.set(schedule.id, checkInterval as unknown as NodeJS.Timeout);
      console.log(`[Scheduler] Schedule "${schedule.name}" next run is far in the future (${nextRun.toISOString()}), using interval check`);
      return;
    }

    // Set timer for next run (delay is within safe range)
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
    // NOTE: Uses configured timezone (default: Asia/Shanghai)
    // The timezone can be set in config.json under user.timezone
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    // Get timezone from config (fallback to Asia/Shanghai)
    let TZ = 'Asia/Shanghai';
    try {
      const { getConfig } = require('../config');
      const config = getConfig();
      if (config?.user?.timezone) {
        TZ = config.user.timezone;
      }
    } catch {
      // Config not loaded, use default
    }

    const now = new Date();

    // Get current time in Beijing timezone
    const beijingFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

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

    // Parse each part
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    const minutes = parseField(minute, 0, 59);
    const hours = parseField(hour, 0, 23);
    const daysOfMonth = parseField(dayOfMonth, 1, 31);
    const months = parseField(month, 1, 12);
    const daysOfWeek = parseField(dayOfWeek, 0, 6); // 0 = Sunday

    if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
      // Fallback for unsupported patterns: 1 hour from now
      return new Date(now.getTime() + 60 * 60 * 1000);
    }

    // Helper to get time components in configured timezone from a Date
    const getTzComponents = (date: Date) => {
      const parts = beijingFormatter.formatToParts(date);
      const get = (type: string) => {
        const part = parts.find(p => p.type === type);
        return part ? parseInt(part.value, 10) : 0;
      };
      return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
        minute: get('minute'),
      };
    };

    // Helper to get timezone offset for a specific date in the configured timezone
    const getTzOffset = (year: number, month: number, day: number): number => {
      // Create a reference date and get the offset
      const testDate = new Date(Date.UTC(year, month - 1, day));
      const utcDate = new Date(testDate.toLocaleString('en-US', { timeZone: 'UTC' }));
      const tzDate = new Date(testDate.toLocaleString('en-US', { timeZone: TZ }));
      return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
    };

    // Helper to create a Date from timezone-specific components
    const createFromTzTime = (year: number, month: number, day: number, hour: number, minute: number): Date => {
      // Get the timezone offset for this specific date
      const offsetMinutes = getTzOffset(year, month, day);
      const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
      const offsetMins = Math.abs(offsetMinutes) % 60;
      const offsetSign = offsetMinutes >= 0 ? '+' : '-';

      // Create ISO string with timezone offset
      const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offsetStr}`;
      return new Date(dateStr);
    };

    // Get current time in configured timezone
    const currentTz = getTzComponents(now);

    // Start searching from the next minute
    let searchYear = currentTz.year;
    let searchMonth = currentTz.month;
    let searchDay = currentTz.day;
    let searchHour = currentTz.hour;
    let searchMinute = currentTz.minute;

    // Increment by one minute to start search
    searchMinute++;
    if (searchMinute >= 60) {
      searchMinute = 0;
      searchHour++;
      if (searchHour >= 24) {
        searchHour = 0;
        searchDay++;
        // Handle month overflow
        const daysInMonth = new Date(searchYear, searchMonth, 0).getDate();
        if (searchDay > daysInMonth) {
          searchDay = 1;
          searchMonth++;
          if (searchMonth > 12) {
            searchMonth = 1;
            searchYear++;
          }
        }
      }
    }

    // Find next matching time (max 366 days)
    const maxIterations = 366 * 24 * 60;
    for (let i = 0; i < maxIterations; i++) {
      // Check if current search time matches cron expression
      const dow = new Date(searchYear, searchMonth - 1, searchDay).getDay();

      if (
        minutes.includes(searchMinute) &&
        hours.includes(searchHour) &&
        daysOfMonth.includes(searchDay) &&
        months.includes(searchMonth) &&
        daysOfWeek.includes(dow)
      ) {
        // Found a match! Create the Date object
        return createFromTzTime(searchYear, searchMonth, searchDay, searchHour, searchMinute);
      }

      // Increment by one minute
      searchMinute++;
      if (searchMinute >= 60) {
        searchMinute = 0;
        searchHour++;
        if (searchHour >= 24) {
          searchHour = 0;
          searchDay++;
          // Get days in current month
          const daysInMonth = new Date(searchYear, searchMonth, 0).getDate();
          if (searchDay > daysInMonth) {
            searchDay = 1;
            searchMonth++;
            if (searchMonth > 12) {
              searchMonth = 1;
              searchYear++;
            }
          }
        }
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
