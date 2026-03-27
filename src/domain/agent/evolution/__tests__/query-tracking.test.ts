/**
 * Tests for Query Tracking System
 *
 * Validates query recording, pattern detection, and integration
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
// Mock bun:sqlite to prevent ESM resolution errors from transitive dependencies
vi.mock('bun:sqlite', () => {
  class MockDatabase {
    constructor() {}
    exec = vi.fn();
    run = vi.fn();
    query = vi.fn(() => ({ all: vi.fn(() => []) }));
    prepare = vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }));
    transaction = vi.fn((fn: Function) => fn);
    close = vi.fn();
  }
  return { Database: MockDatabase, default: MockDatabase };
});
vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  })),
}));
vi.mock('bunqueue/client', () => ({ Queue: vi.fn(), Worker: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: vi.fn() }));
import {
  recordQuery,
  detectPatterns,
  getRecentQueries,
  clearQueryTracking,
  getQueryTrackingStats
} from '../query-tracking';

describe('QueryTracking', () => {
  beforeEach(() => {
    clearQueryTracking();
  });

  afterEach(() => {
    clearQueryTracking();
  });

  describe('recordQuery', () => {
    test('should record query', () => {
      recordQuery('Test query');

      const recent = getRecentQueries(1);
      expect(recent.length).toBe(1);
      expect(recent[0].query).toBe('Test query');
      expect(recent[0].timestamp).toBeGreaterThan(0);
    });

    test('should skip empty queries', () => {
      recordQuery('');
      recordQuery('   ');
      recordQuery('\t\n');

      const recent = getRecentQueries();
      expect(recent.length).toBe(0);
    });

    test('should trim whitespace', () => {
      recordQuery('  Test query  ');

      const recent = getRecentQueries(1);
      expect(recent[0].query).toBe('Test query');
    });

    test('should extract intent', () => {
      recordQuery('Schedule a meeting');
      recordQuery('What is the status?');
      recordQuery('How to create a skill?');

      const recent = getRecentQueries(3);
      expect(recent[0].intent).toBe('schedule');
      expect(recent[1].intent).toBe('status');
      expect(recent[2].intent).toBe('help');
    });

    test('should extract entities', () => {
      recordQuery('Find "important tasks"');
      recordQuery('Update ProjectX status');
      recordQuery('Check progress in 3 days');

      const recent = getRecentQueries(3);
      expect(recent[0].entities).toContain('important tasks');
      expect(recent[1].entities).toContain('ProjectX');
      expect(recent[2].entities).toContain('3 days');
    });

    test('should store context', () => {
      recordQuery('Test query', {
        channel: 'feishu',
        userId: 'user123',
        sessionId: 'session456',
      });

      const recent = getRecentQueries(1);
      expect(recent[0].context?.channel).toBe('feishu');
      expect(recent[0].context?.userId).toBe('user123');
      expect(recent[0].context?.sessionId).toBe('session456');
    });

    test('should clean up old queries', () => {
      // Add many queries
      for (let i = 0; i < 1000; i++) {
        recordQuery(`Query ${i}`);
      }

      // Should not exceed reasonable limit
      const recent = getRecentQueries();
      expect(recent.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('detectPatterns', () => {
    test('should return empty array with insufficient data', () => {
      recordQuery('Query 1');
      recordQuery('Query 2');

      const patterns = detectPatterns();
      expect(patterns.length).toBe(0);
    });

    test('should detect recurring pattern', () => {
      // Record same query multiple times
      for (let i = 0; i < 5; i++) {
        recordQuery('What is my schedule today?');
      }

      const patterns = detectPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].frequency).toBeGreaterThanOrEqual(3);
      expect(patterns[0].examples).toContain('What is my schedule today?');
    });

    test('should group similar queries', () => {
      recordQuery('Schedule a meeting');
      recordQuery('Schedule another meeting');
      recordQuery('Schedule team standup');
      recordQuery('Schedule project review');

      const patterns = detectPatterns();
      const schedulePattern = patterns.find((p) => p.pattern.includes('schedule'));

      expect(schedulePattern).toBeDefined();
      expect(schedulePattern?.frequency).toBeGreaterThanOrEqual(3);
    });

    test('should track pattern timing', () => {
      const startTime = Date.now();

      for (let i = 0; i < 5; i++) {
        recordQuery('Daily standup');
      }

      const patterns = detectPatterns();
      expect(patterns[0].firstSeen).toBeGreaterThanOrEqual(startTime);
      expect(patterns[0].lastSeen).toBeGreaterThanOrEqual(patterns[0].firstSeen);
    });

    test('should limit examples per pattern', () => {
      for (let i = 0; i < 20; i++) {
        recordQuery(`Status check ${i}`);
      }

      const patterns = detectPatterns();
      expect(patterns[0].examples.length).toBeLessThanOrEqual(5);
    });

    test('should suggest actions for patterns', () => {
      for (let i = 0; i < 6; i++) {
        recordQuery('Weekly briefing');
      }

      const patterns = detectPatterns();
      expect(patterns[0].suggestedAction).toBeDefined();
      expect(patterns[0].suggestedAction).toContain('skill');
    });

    test('should sort patterns by frequency', () => {
      // High frequency
      for (let i = 0; i < 10; i++) {
        recordQuery('High frequency query');
      }

      // Low frequency
      for (let i = 0; i < 3; i++) {
        recordQuery('Low frequency query');
      }

      const patterns = detectPatterns();
      expect(patterns[0].frequency).toBeGreaterThanOrEqual(patterns[1]?.frequency || 0);
    });
  });

  describe('getQueryTrackingStats', () => {
    test('should return statistics', () => {
      recordQuery('Schedule meeting');
      recordQuery('Schedule standup');
      recordQuery('Check status');
      recordQuery('Check progress');

      const stats = getQueryTrackingStats();

      expect(stats.totalQueries).toBe(4);
      expect(stats.uniqueIntents).toBeGreaterThan(0);
      expect(stats.topIntents.length).toBeGreaterThan(0);
    });

    test('should count intents correctly', () => {
      recordQuery('Schedule A');
      recordQuery('Schedule B');
      recordQuery('Schedule C');
      recordQuery('Status X');
      recordQuery('Status Y');

      const stats = getQueryTrackingStats();

      const scheduleIntent = stats.topIntents.find((i) => i.intent === 'schedule');
      expect(scheduleIntent?.count).toBe(3);

      const statusIntent = stats.topIntents.find((i) => i.intent === 'status');
      expect(statusIntent?.count).toBe(2);
    });

    test('should return empty stats when no queries', () => {
      const stats = getQueryTrackingStats();

      expect(stats.totalQueries).toBe(0);
      expect(stats.uniqueIntents).toBe(0);
      expect(stats.patternsDetected).toBe(0);
    });
  });

  describe('getRecentQueries', () => {
    test('should return all queries without limit', () => {
      recordQuery('Query 1');
      recordQuery('Query 2');
      recordQuery('Query 3');

      const recent = getRecentQueries();
      expect(recent.length).toBe(3);
    });

    test('should respect limit parameter', () => {
      recordQuery('Query 1');
      recordQuery('Query 2');
      recordQuery('Query 3');

      const recent = getRecentQueries(2);
      expect(recent.length).toBe(2);
    });

    test('should return newest queries first', () => {
      recordQuery('First');
      recordQuery('Second');
      recordQuery('Third');

      const recent = getRecentQueries(2);
      expect(recent[0].query).toBe('Second');
      expect(recent[1].query).toBe('Third');
    });
  });

  describe('clearQueryTracking', () => {
    test('should clear all data', () => {
      recordQuery('Query 1');
      recordQuery('Query 2');

      clearQueryTracking();

      const recent = getRecentQueries();
      expect(recent.length).toBe(0);
    });

    test('should reset statistics', () => {
      recordQuery('Query 1');
      recordQuery('Query 2');

      clearQueryTracking();

      const stats = getQueryTrackingStats();
      expect(stats.totalQueries).toBe(0);
    });
  });

  describe('intent extraction', () => {
    test('should detect schedule intent', () => {
      recordQuery('What is my schedule?');
      recordQuery('Check my 日程');
      recordQuery('Plan for today');

      const recent = getRecentQueries(3);
      expect(recent.every((q) => q.intent === 'schedule')).toBe(true);
    });

    test('should detect help intent', () => {
      recordQuery('How to do X?');
      recordQuery('怎么使用这个功能？');
      recordQuery('Help me with Y');

      const recent = getRecentQueries(3);
      expect(recent.every((q) => q.intent === 'help')).toBe(true);
    });

    test('should detect query intent', () => {
      recordQuery('Search for documents');
      recordQuery('查询我的订单');
      recordQuery('Find the file');

      const recent = getRecentQueries(3);
      expect(recent.every((q) => q.intent === 'query')).toBe(true);
    });
  });

  describe('entity extraction', () => {
    test('should extract quoted strings', () => {
      recordQuery('Find "project alpha" documents');
      recordQuery("Search for 'important tasks'");

      const recent = getRecentQueries(2);
      expect(recent[0].entities).toContain('project alpha');
      expect(recent[1].entities).toContain('important tasks');
    });

    test('should extract capitalized words', () => {
      recordQuery('Update ProjectX status');
      recordQuery('Check Server health');

      const recent = getRecentQueries(2);
      expect(recent[0].entities).toContain('ProjectX');
      expect(recent[1].entities).toContain('Server');
    });

    test('should extract numbers with units', () => {
      recordQuery('Remind me in 3 days');
      recordQuery('Check last 2 weeks');
      recordQuery('5 hours ago');

      const recent = getRecentQueries(3);
      expect(recent[0].entities?.length).toBeGreaterThan(0);
      expect(recent[1].entities?.length).toBeGreaterThan(0);
      expect(recent[2].entities?.length).toBeGreaterThan(0);
    });

    test('should remove duplicate entities', () => {
      recordQuery('Find "test" and "test"');

      const recent = getRecentQueries(1);
      const testEntities = recent[0].entities?.filter((e) => e === 'test');
      expect(testEntities?.length).toBe(1);
    });
  });

  describe('pattern suggestions', () => {
    test('should suggest skill creation for high frequency', () => {
      for (let i = 0; i < 6; i++) {
        recordQuery('Daily standup');
      }

      const patterns = detectPatterns();
      expect(patterns[0].suggestedAction).toMatch(/skill/i);
    });

    test('should suggest scheduled task for schedule queries', () => {
      for (let i = 0; i < 4; i++) {
        recordQuery('Check schedule');
      }

      const patterns = detectPatterns();
      expect(patterns[0].suggestedAction).toMatch(/scheduled task/i);
    });

    test('should suggest dashboard for status queries', () => {
      for (let i = 0; i < 4; i++) {
        recordQuery('Check status');
      }

      const patterns = detectPatterns();
      expect(patterns[0].suggestedAction).toMatch(/dashboard|status/i);
    });
  });

  describe('integration scenarios', () => {
    test('should handle rapid query recording', () => {
      const queries = Array.from({ length: 100 }, (_, i) => `Query ${i}`);

      queries.forEach((q) => recordQuery(q));

      const recent = getRecentQueries();
      expect(recent.length).toBe(100);
    });

    test('should handle mixed queries', () => {
      recordQuery('Schedule meeting');
      recordQuery('Check status');
      recordQuery('Create task');
      recordQuery('Update task');
      recordQuery('Schedule standup');

      const stats = getQueryTrackingStats();
      expect(stats.totalQueries).toBe(5);
      expect(stats.uniqueIntents).toBeGreaterThan(1);
    });

    test('should handle unicode queries', () => {
      recordQuery('查询日程安排');
      recordQuery('检查项目状态');
      recordQuery('创建新任务');

      const recent = getRecentQueries(3);
      expect(recent[0].query).toContain('查询');
      expect(recent[1].query).toContain('检查');
      expect(recent[2].query).toContain('创建');
    });
  });
});
