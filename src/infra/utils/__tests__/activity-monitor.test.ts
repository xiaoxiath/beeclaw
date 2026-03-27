import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActivityMonitor, type ActivityType } from '../activity-monitor';

describe('ActivityMonitor', () => {
  let monitor: ActivityMonitor;

  beforeEach(() => {
    monitor = new ActivityMonitor();
  });

  describe('constructor', () => {
    it('should create with default maxEvents', () => {
      const m = new ActivityMonitor();
      expect(m.getStats().totalEvents).toBe(0);
    });

    it('should create with custom maxEvents', () => {
      const m = new ActivityMonitor(50);
      expect(m.getStats().totalEvents).toBe(0);
    });
  });

  describe('record', () => {
    it('should record an activity event', () => {
      monitor.record('llm_chunk');
      expect(monitor.getStats().totalEvents).toBe(1);
    });

    it('should record event with details', () => {
      monitor.record('tool_call', 'web_fetch');
      const events = monitor.getRecentEvents(1);
      expect(events[0].type).toBe('tool_call');
      expect(events[0].details).toBe('web_fetch');
    });

    it('should update last activity time', () => {
      const before = monitor.getInactiveTimeMs();
      monitor.record('progress');
      const after = monitor.getInactiveTimeMs();
      expect(after).toBeLessThanOrEqual(before + 10);
    });

    it('should trim events when exceeding maxEvents', () => {
      const smallMonitor = new ActivityMonitor(5);
      for (let i = 0; i < 10; i++) {
        smallMonitor.record('llm_chunk', `chunk-${i}`);
      }
      expect(smallMonitor.getStats().totalEvents).toBe(5);
      // Should keep the most recent events
      const recent = smallMonitor.getRecentEvents(5);
      expect(recent[0].details).toBe('chunk-5');
      expect(recent[4].details).toBe('chunk-9');
    });

    it('should record all activity types', () => {
      const types: ActivityType[] = ['llm_chunk', 'tool_call', 'subagent', 'progress', 'thinking'];
      for (const type of types) {
        monitor.record(type);
      }
      const stats = monitor.getStats();
      expect(stats.totalEvents).toBe(5);
    });
  });

  describe('isInactive', () => {
    it('should return false when recently active', () => {
      monitor.record('llm_chunk');
      expect(monitor.isInactive(60000)).toBe(false);
    });

    it('should return false with very large timeout', () => {
      expect(monitor.isInactive(999999999)).toBe(false);
    });

    it('should return true with zero timeout (always inactive)', async () => {
      // Ensure at least 1ms has passed since last activity so inactiveMs > 0
      await new Promise(resolve => setTimeout(resolve, 2));
      expect(monitor.isInactive(0)).toBe(true);
    });
  });

  describe('getInactiveTimeMs', () => {
    it('should return time since last activity', () => {
      const ms = monitor.getInactiveTimeMs();
      expect(ms).toBeGreaterThanOrEqual(0);
    });

    it('should reset after recording activity', () => {
      monitor.record('llm_chunk');
      const ms = monitor.getInactiveTimeMs();
      expect(ms).toBeLessThan(100); // should be near zero
    });
  });

  describe('getLastActivityTime', () => {
    it('should return a Date object', () => {
      const time = monitor.getLastActivityTime();
      expect(time).toBeInstanceOf(Date);
    });
  });

  describe('getStats', () => {
    it('should return correct event counts by type', () => {
      monitor.record('llm_chunk');
      monitor.record('llm_chunk');
      monitor.record('tool_call');
      const stats = monitor.getStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.eventsByType.llm_chunk).toBe(2);
      expect(stats.eventsByType.tool_call).toBe(1);
    });

    it('should include inactiveTimeMs', () => {
      const stats = monitor.getStats();
      expect(typeof stats.inactiveTimeMs).toBe('number');
    });
  });

  describe('getRecentEvents', () => {
    it('should return last N events', () => {
      monitor.record('llm_chunk', 'a');
      monitor.record('tool_call', 'b');
      monitor.record('progress', 'c');
      const events = monitor.getRecentEvents(2);
      expect(events).toHaveLength(2);
      expect(events[0].details).toBe('b');
      expect(events[1].details).toBe('c');
    });

    it('should default to 10 events', () => {
      for (let i = 0; i < 15; i++) {
        monitor.record('llm_chunk');
      }
      const events = monitor.getRecentEvents();
      expect(events).toHaveLength(10);
    });

    it('should return empty array when no events', () => {
      const events = monitor.getRecentEvents();
      expect(events).toEqual([]);
    });
  });

  describe('reset', () => {
    it('should clear all events', () => {
      monitor.record('llm_chunk');
      monitor.record('tool_call');
      monitor.reset();
      expect(monitor.getStats().totalEvents).toBe(0);
    });

    it('should reset last activity time', () => {
      monitor.record('llm_chunk');
      monitor.reset();
      const ms = monitor.getInactiveTimeMs();
      expect(ms).toBeLessThan(100);
    });
  });

  describe('formatReport', () => {
    it('should format empty report', () => {
      const report = monitor.formatReport();
      expect(report).toContain('活动报告');
      expect(report).toContain('暂无活动记录');
    });

    it('should format report with events', () => {
      monitor.record('llm_chunk', 'token-1');
      monitor.record('tool_call', 'search');
      const report = monitor.formatReport();
      expect(report).toContain('事件统计');
      expect(report).toContain('最近事件');
      expect(report).toContain('llm_chunk');
      expect(report).toContain('tool_call');
    });
  });
});
