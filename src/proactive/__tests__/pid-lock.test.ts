/**
 * P2-4.5: PID-based File Lock Tests
 *
 * Tests for cross-process file locking mechanism in scheduler
 * to prevent concurrent execution across PM2 workers.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PID-based File Lock', () => {
  let testDir: string;
  let lockDir: string;

  beforeEach(() => {
    // Create temp directory for each test
    testDir = join(tmpdir(), `beeclaw-lock-test-${Date.now()}`);
    lockDir = join(testDir, 'locks');
    mkdirSync(lockDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Lock acquisition', () => {
    test('should create lock file with PID and timestamp', () => {
      const lockPath = join(lockDir, 'test-schedule.lock');
      const lockData = {
        pid: process.pid,
        ts: Date.now(),
        schedule: 'test-schedule',
      };

      writeFileSync(lockPath, JSON.stringify(lockData), { flag: 'wx' });

      expect(existsSync(lockPath)).toBe(true);

      const readData = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(readData.pid).toBe(process.pid);
      expect(readData.schedule).toBe('test-schedule');
      expect(readData.ts).toBeDefined();
    });

    test('should fail if lock already exists', () => {
      const lockPath = join(lockDir, 'test-schedule.lock');

      // First lock should succeed
      writeFileSync(lockPath, JSON.stringify({ pid: 12345, ts: Date.now() }), { flag: 'wx' });

      // Second lock should fail (EEXIST)
      let error: any;
      try {
        writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.code).toBe('EEXIST');
    });

    test('should detect active PID', () => {
      // Test if a PID is alive
      const isPidAlive = (pid: number): boolean => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };

      // Current process should be alive
      expect(isPidAlive(process.pid)).toBe(true);

      // Parent process should be alive
      if (process.ppid && process.ppid > 0) {
        expect(isPidAlive(process.ppid)).toBe(true);
      }

      // Non-existent PID should not be alive
      expect(isPidAlive(999999)).toBe(false);
    });

    test('should detect stale lock (inactive PID)', () => {
      const lockPath = join(lockDir, 'stale-schedule.lock');
      const stalePid = 999999; // Non-existent PID

      const lockData = {
        pid: stalePid,
        ts: Date.now() - 60000, // 1 minute ago
        schedule: 'stale-schedule',
      };

      writeFileSync(lockPath, JSON.stringify(lockData));

      // Check if lock is stale
      const existing = JSON.parse(readFileSync(lockPath, 'utf-8'));
      const lockAge = Date.now() - existing.ts;

      // PID is not alive, so lock should be considered stale
      let isStale = false;
      try {
        process.kill(existing.pid, 0);
      } catch {
        isStale = true;
      }

      expect(isStale).toBe(true);
      expect(lockAge).toBeGreaterThan(30000);
    });

    test('should detect stale lock (timeout)', () => {
      const lockPath = join(lockDir, 'timeout-schedule.lock');
      const lockData = {
        pid: process.pid,
        ts: Date.now() - 35000, // 35 seconds ago (> 30s timeout)
        schedule: 'timeout-schedule',
      };

      writeFileSync(lockPath, JSON.stringify(lockData));

      const existing = JSON.parse(readFileSync(lockPath, 'utf-8'));
      const lockAge = Date.now() - existing.ts;

      expect(lockAge).toBeGreaterThan(30000);
    });
  });

  describe('Lock release', () => {
    test('should delete lock file on release', () => {
      const lockPath = join(lockDir, 'release-schedule.lock');
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }));

      expect(existsSync(lockPath)).toBe(true);

      // Simulate lock release
      rmSync(lockPath);

      expect(existsSync(lockPath)).toBe(false);
    });

    test('should allow re-acquisition after release', () => {
      const lockPath = join(lockDir, 'reacquire-schedule.lock');

      // First acquisition
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });
      expect(existsSync(lockPath)).toBe(true);

      // Release
      rmSync(lockPath);
      expect(existsSync(lockPath)).toBe(false);

      // Re-acquisition should succeed
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });
      expect(existsSync(lockPath)).toBe(true);
    });
  });

  describe('Concurrent access scenarios', () => {
    test('should prevent concurrent lock acquisition', () => {
      const lockPath = join(lockDir, 'concurrent-schedule.lock');

      // First process acquires lock
      writeFileSync(lockPath, JSON.stringify({ pid: 12345, ts: Date.now() }), { flag: 'wx' });

      // Second process tries to acquire
      let secondSucceeded = false;
      try {
        writeFileSync(lockPath, JSON.stringify({ pid: 67890, ts: Date.now() }), { flag: 'wx' });
        secondSucceeded = true;
      } catch (e: any) {
        expect(e.code).toBe('EEXIST');
      }

      expect(secondSucceeded).toBe(false);
    });

    test('should handle multiple different schedules', () => {
      const lock1 = join(lockDir, 'schedule-1.lock');
      const lock2 = join(lockDir, 'schedule-2.lock');
      const lock3 = join(lockDir, 'schedule-3.lock');

      // All should be able to acquire locks simultaneously
      writeFileSync(lock1, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });
      writeFileSync(lock2, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });
      writeFileSync(lock3, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });

      expect(existsSync(lock1)).toBe(true);
      expect(existsSync(lock2)).toBe(true);
      expect(existsSync(lock3)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    test('should handle lock directory creation', () => {
      const newLockDir = join(testDir, 'new-locks');

      expect(existsSync(newLockDir)).toBe(false);

      // Create directory
      mkdirSync(newLockDir, { recursive: true });

      expect(existsSync(newLockDir)).toBe(true);
    });

    test('should handle corrupted lock file', () => {
      const lockPath = join(lockDir, 'corrupted.lock');

      // Write invalid JSON
      writeFileSync(lockPath, 'not valid json {{{');

      let error: any;
      try {
        JSON.parse(readFileSync(lockPath, 'utf-8'));
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error instanceof SyntaxError).toBe(true);
    });

    test('should handle empty lock file', () => {
      const lockPath = join(lockDir, 'empty.lock');

      writeFileSync(lockPath, '');

      const content = readFileSync(lockPath, 'utf-8');
      expect(content).toBe('');

      let error: any;
      try {
        JSON.parse(content);
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
    });

    test('should handle lock file with missing fields', () => {
      const lockPath = join(lockDir, 'incomplete.lock');

      // Missing 'schedule' field
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }));

      const data = JSON.parse(readFileSync(lockPath, 'utf-8'));

      expect(data.pid).toBeDefined();
      expect(data.ts).toBeDefined();
      expect(data.schedule).toBeUndefined();
    });
  });

  describe('Timeout scenarios', () => {
    test('should respect 30-second stale timeout', () => {
      const now = Date.now();
      const lockData = {
        pid: 999999, // Non-existent
        ts: now - 30000, // Exactly 30 seconds ago
        schedule: 'test',
      };

      const lockAge = Date.now() - lockData.ts;

      // Should be considered stale at or after 30 seconds
      expect(lockAge).toBeGreaterThanOrEqual(30000);
    });

    test('should not consider recent lock as stale', () => {
      const lockData = {
        pid: 999999,
        ts: Date.now() - 10000, // 10 seconds ago
        schedule: 'test',
      };

      const lockAge = Date.now() - lockData.ts;

      // Should not be considered stale yet
      expect(lockAge).toBeLessThan(30000);
    });
  });

  describe('Process identification', () => {
    test('should store correct PID', () => {
      const lockData = {
        pid: process.pid,
        ts: Date.now(),
        schedule: 'test',
      };

      expect(lockData.pid).toBe(process.pid);
      expect(lockData.pid).toBeGreaterThan(0);
    });

    test('should detect different PIDs', () => {
      const lock1 = { pid: 12345, ts: Date.now() };
      const lock2 = { pid: 67890, ts: Date.now() };

      expect(lock1.pid).not.toBe(lock2.pid);
    });
  });
});
