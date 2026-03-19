#!/usr/bin/env bun
/**
 * Cleanup Script: Remove Duplicate Scheduled Tasks
 *
 * Problem: After refactoring, proactive_schedule was creating duplicate tasks on each startup.
 * Solution: This script removes duplicate tasks with the same name, keeping only the first one.
 *
 * Usage:
 *   bun run scripts/cleanup-duplicate-schedules.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_PATH = join(process.cwd(), 'data');
const SCHEDULES_PATH = join(DATA_PATH, 'schedules.json');

interface Schedule {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  task: {
    type: string;
    params: Record<string, unknown>;
  };
  createdAt: string;
  runCount: number;
}

interface ScheduleStorage {
  schedules: Record<string, Schedule>;
  patterns: Record<string, unknown>;
  lastUpdated: string;
}

function cleanupDuplicates() {
  if (!existsSync(SCHEDULES_PATH)) {
    console.log('✅ No schedules file found, nothing to clean up');
    return;
  }

  // Load schedules
  const content = readFileSync(SCHEDULES_PATH, 'utf-8');
  const storage: ScheduleStorage = JSON.parse(content);

  const schedules = Object.values(storage.schedules);
  console.log(`📊 Found ${schedules.length} total schedules`);

  // Group by name
  const byName: Record<string, Schedule[]> = {};
  for (const schedule of schedules) {
    if (!byName[schedule.name]) {
      byName[schedule.name] = [];
    }
    byName[schedule.name].push(schedule);
  }

  // Find duplicates
  const duplicates: Array<{ name: string; count: number; toRemove: string[] }> = [];
  for (const [name, group] of Object.entries(byName)) {
    if (group.length > 1) {
      // Keep the first one, remove the rest
      const toRemove = group.slice(1).map(s => s.id);
      duplicates.push({
        name,
        count: group.length,
        toRemove,
      });
    }
  }

  if (duplicates.length === 0) {
    console.log('✅ No duplicate schedules found');
    return;
  }

  // Display duplicates
  console.log(`\n🔍 Found ${duplicates.length} duplicate schedule(s):\n`);
  for (const dup of duplicates) {
    console.log(`  • "${dup.name}": ${dup.count} instances`);
    console.log(`    Keeping first, removing ${dup.toRemove.length} duplicates`);
  }

  // Remove duplicates
  const toRemoveSet = new Set(duplicates.flatMap(d => d.toRemove));
  const newSchedules: Record<string, Schedule> = {};

  for (const [id, schedule] of Object.entries(storage.schedules)) {
    if (!toRemoveSet.has(id)) {
      newSchedules[id] = schedule;
    }
  }

  // Save cleaned storage
  const cleanedStorage: ScheduleStorage = {
    ...storage,
    schedules: newSchedules,
    lastUpdated: new Date().toISOString(),
  };

  // Backup original
  const backupPath = join(DATA_PATH, `schedules.json.backup-${Date.now()}`);
  writeFileSync(backupPath, content, 'utf-8');
  console.log(`\n💾 Backup saved to: ${backupPath}`);

  // Write cleaned schedules
  writeFileSync(SCHEDULES_PATH, JSON.stringify(cleanedStorage, null, 2), 'utf-8');

  console.log(`\n✅ Cleaned up ${toRemoveSet.size} duplicate schedule(s)`);
  console.log(`📊 Remaining: ${Object.keys(newSchedules).length} unique schedules\n`);
}

// Run cleanup
console.log('🧹 Cleaning up duplicate schedules...\n');
cleanupDuplicates();
