/**
 * Tests for self-evolution.ts
 *
 * Mocks logger and proactive scheduler to test schedule initialization,
 * status retrieval, and manual trigger.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- Mocks ----

const { mockLogger, mockScheduler } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
  mockScheduler: {
    init: vi.fn(() => {}),
    listSchedules: vi.fn(() => []),
    createSchedule: vi.fn(() => {}),
  },
}));

vi.mock('../../../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

vi.mock('../../../proactive', () => ({
  getScheduler: vi.fn(() => mockScheduler),
}));

import { initSelfEvolution, getSelfEvolutionStatus } from '../self-evolution';

describe('self-evolution', () => {
  beforeEach(() => {
    mockLogger.debug.mockClear();
    mockScheduler.init.mockClear();
    mockScheduler.listSchedules.mockClear();
    mockScheduler.createSchedule.mockClear();
  });

  describe('initSelfEvolution', () => {
    it('should initialize scheduler and create schedule when none exists', () => {
      mockScheduler.listSchedules.mockReturnValue([]);

      initSelfEvolution('/tmp/test-evolution');

      expect(mockScheduler.init).toHaveBeenCalledTimes(1);
      expect(mockScheduler.listSchedules).toHaveBeenCalled();
      expect(mockScheduler.createSchedule).toHaveBeenCalledTimes(1);

      const createCall = mockScheduler.createSchedule.mock.calls[0][0];
      expect(createCall.name).toBe('Daily Self-Evolution');
      expect(createCall.taskType).toBe('self_evolution');
      expect(createCall.enabled).toBe(true);
    });

    it('should not create schedule if one already exists', () => {
      mockScheduler.listSchedules.mockReturnValue([
        { name: 'Daily Self-Evolution', task: { type: 'self_evolution' }, enabled: true },
      ]);

      initSelfEvolution('/tmp/test-evolution');

      expect(mockScheduler.init).toHaveBeenCalledTimes(1);
      expect(mockScheduler.createSchedule).not.toHaveBeenCalled();
    });

    it('should accept custom config', () => {
      mockScheduler.listSchedules.mockReturnValue([]);

      initSelfEvolution('/tmp/test-evolution', {
        cron: '0 6 * * *',
        enabled: true,
      });

      const createCall = mockScheduler.createSchedule.mock.calls[0][0];
      expect(createCall.cron).toBe('0 6 * * *');
      // autoApprove is always false — human must review and apply
      expect(createCall.taskParams.autoApprove).toBe(false);
    });

    it('should use default config when no custom config given', () => {
      mockScheduler.listSchedules.mockReturnValue([]);

      initSelfEvolution('/tmp/test-evolution');

      const createCall = mockScheduler.createSchedule.mock.calls[0][0];
      expect(createCall.cron).toBe('0 4 * * *');
      expect(createCall.taskParams.autoApprove).toBe(false);
    });
  });

  describe('getSelfEvolutionStatus', () => {
    it('should return disabled when no schedule exists', () => {
      mockScheduler.listSchedules.mockReturnValue([]);

      const status = getSelfEvolutionStatus('/tmp/test-evolution');
      expect(status.enabled).toBe(false);
      expect(status.nextRun).toBeUndefined();
    });

    it('should return enabled status with schedule details', () => {
      mockScheduler.listSchedules.mockReturnValue([
        {
          task: { type: 'self_evolution' },
          enabled: true,
          nextRun: '2026-04-01T04:00:00Z',
          lastRun: '2026-03-27T04:00:00Z',
          runCount: 5,
        },
      ]);

      const status = getSelfEvolutionStatus('/tmp/test-evolution');
      expect(status.enabled).toBe(true);
      expect(status.nextRun).toBe('2026-04-01T04:00:00Z');
      expect(status.lastRun).toBe('2026-03-27T04:00:00Z');
      expect(status.runCount).toBe(5);
    });
  });

});
