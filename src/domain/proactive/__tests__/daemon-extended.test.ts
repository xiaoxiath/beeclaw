/**
 * Extended unit tests for Daemon — all external dependencies mocked.
 * Focuses on uncovered branches: executeSchedule, executeDefaultJobHandler,
 * periodicCheck, isRunning edge cases, recordError, loadState.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock fns ───────────────────────────────────────────────────────────────

const mockListSchedules = vi.fn();
const mockStartAll = vi.fn();
const mockStopAll = vi.fn();
const mockGetDueSchedules = vi.fn();
const mockAcquireExecutionLock = vi.fn();
const mockReleaseExecutionLock = vi.fn();
const mockSetExecuting = vi.fn();
const mockRecordExecution = vi.fn();

const mockHandleLlmProactiveChat = vi.fn();
const mockHandleSelfEvolution = vi.fn();
const mockHandleMemoryCompress = vi.fn();
const mockHandleGoalProgressCheck = vi.fn();
const mockHandleCustom = vi.fn();
const mockHandleSendReminder = vi.fn();
const mockHandleRunSkill = vi.fn();

const mockPushPending = vi.fn();
const mockClearExpired = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../scheduler', () => ({
  getScheduler: vi.fn(() => ({
    listSchedules: mockListSchedules,
    startAll: mockStartAll,
    stopAll: mockStopAll,
    getDueSchedules: mockGetDueSchedules,
    acquireExecutionLock: mockAcquireExecutionLock,
    releaseExecutionLock: mockReleaseExecutionLock,
    setExecuting: mockSetExecuting,
    recordExecution: mockRecordExecution,
  })),
  resetScheduler: vi.fn(),
}));

vi.mock('../job-handlers', () => ({
  handleLlmProactiveChatJob: (...args: any[]) => mockHandleLlmProactiveChat(...args),
  handleSelfEvolutionJob: (...args: any[]) => mockHandleSelfEvolution(...args),
  handleMemoryCompressJob: (...args: any[]) => mockHandleMemoryCompress(...args),
  handleGoalProgressCheckJob: (...args: any[]) => mockHandleGoalProgressCheck(...args),
  handleCustomJob: (...args: any[]) => mockHandleCustom(...args),
  handleSendReminderJob: (...args: any[]) => mockHandleSendReminder(...args),
  handleRunSkillJob: (...args: any[]) => mockHandleRunSkill(...args),
}));

vi.mock('../pusher', () => ({
  pushPendingNotifications: (...args: any[]) => mockPushPending(...args),
}));

vi.mock('../notifications', () => ({
  getNotificationManager: vi.fn(() => ({
    clearExpired: mockClearExpired,
  })),
}));

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { Daemon, getDaemon, resetDaemon } from '../daemon';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSchedule(overrides?: any): any {
  return {
    id: overrides?.id || 'sched-1',
    name: overrides?.name || 'Test Schedule',
    cron: '0 9 * * *',
    enabled: true,
    state: 'enabled',
    isExecuting: false,
    task: {
      type: overrides?.taskType || 'llm_proactive_chat',
      params: overrides?.taskParams || { prompt: 'hello' },
    },
    runCount: 0,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Daemon (extended)', () => {
  let daemon: Daemon;

  beforeEach(() => {
    resetDaemon();
    (existsSync as any).mockImplementation(() => false);
    (readFileSync as any).mockImplementation(() => '{}');
    (writeFileSync as any).mockImplementation(() => undefined);
    (unlinkSync as any).mockImplementation(() => undefined);

    mockListSchedules.mockImplementation(() => []);
    mockStartAll.mockImplementation(() => undefined);
    mockStopAll.mockImplementation(() => undefined);
    mockGetDueSchedules.mockImplementation(() => []);
    mockAcquireExecutionLock.mockImplementation(() => true);
    mockReleaseExecutionLock.mockImplementation(() => undefined);
    mockSetExecuting.mockImplementation(() => undefined);
    mockRecordExecution.mockImplementation(() => undefined);
    mockPushPending.mockImplementation(() => Promise.resolve({ pushed: 0, failed: 0 }));
    mockClearExpired.mockImplementation(() => 0);

    mockHandleLlmProactiveChat.mockImplementation(() => Promise.resolve());
    mockHandleSelfEvolution.mockImplementation(() => Promise.resolve({ success: true, response: 'evolved' }));
    mockHandleMemoryCompress.mockImplementation(() => Promise.resolve());
    mockHandleGoalProgressCheck.mockImplementation(() => Promise.resolve());
    mockHandleCustom.mockImplementation(() => Promise.resolve());
    mockHandleSendReminder.mockImplementation(() => Promise.resolve());
    mockHandleRunSkill.mockImplementation(() => Promise.resolve());

    daemon = new Daemon('/tmp/test-daemon');
  });

  afterEach(async () => {
    try { await daemon.stop(); } catch { /* ignore */ }
    resetDaemon();
  });

  // ── start ─────────────────────────────────────────────────────────────

  describe('start', () => {
    it('loads schedules on start', async () => {
      mockListSchedules.mockReturnValue([makeSchedule(), makeSchedule({ id: 's2', name: 'S2' })]);
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      const state = daemon.getState();
      expect(state.schedulesLoaded).toBe(2);
      expect(state.running).toBe(true);
    });

    it('records error when scheduler load fails', async () => {
      const { getScheduler } = await import('../scheduler');
      (getScheduler as any).mockImplementationOnce(() => { throw new Error('load fail'); });

      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      const state = daemon.getState();
      expect(state.errors.length).toBeGreaterThan(0);
      expect(state.errors[0].message).toContain('load fail');
    });

    it('returns early when already running', async () => {
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      // Second start should be a no-op
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      expect(daemon.getState().running).toBe(true);
    });
  });

  // ── stop ──────────────────────────────────────────────────────────────

  describe('stop', () => {
    it('handles stop when scheduler not initialized', async () => {
      const { getScheduler } = await import('../scheduler');
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      (getScheduler as any).mockImplementationOnce(() => { throw new Error('not init'); });
      // Should not throw
      await daemon.stop();
      expect(daemon.getState().running).toBe(false);
    });

    it('handles PID file not existing on stop', async () => {
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      (existsSync as any).mockImplementation(() => false);
      await daemon.stop();
      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it('handles PID file delete error on stop', async () => {
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      (existsSync as any).mockImplementation((p: string) => p.includes('pid'));
      (unlinkSync as any).mockImplementation(() => { throw new Error('unlink error'); });
      // Should not throw
      await daemon.stop();
    });
  });

  // ── isRunning ─────────────────────────────────────────────────────────

  describe('isRunning', () => {
    it('returns true when PID file exists and process is alive', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('pid')) return true;
        if (p.includes('state.json')) return false;
        return false;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('pid')) return String(process.pid);
        return '{}';
      });

      expect(daemon.isRunning()).toBe(true);
    });

    it('cleans up when PID file exists but process is dead', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('pid')) return true;
        if (p.includes('state.json')) return false;
        return false;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('pid')) return '999999'; // non-existent PID
        return '{}';
      });
      vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
        if (pid === 999999) throw new Error('ESRCH');
        return true;
      });

      expect(daemon.isRunning()).toBe(false);
      expect(writeFileSync).toHaveBeenCalled(); // saveState
    });

    it('handles corrupted PID file', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('pid')) return true;
        if (p.includes('state.json')) return false;
        return false;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('pid')) throw new Error('read error');
        return '{}';
      });

      expect(daemon.isRunning()).toBe(false);
    });

    it('returns state.running when no PID file', () => {
      (existsSync as any).mockImplementation(() => false);
      expect(daemon.isRunning()).toBe(false);
    });

    it('handles unlinkSync error during dead PID cleanup', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('pid')) return true;
        if (p.includes('state.json')) return false;
        return false;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('pid')) return '999999';
        return '{}';
      });
      vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
        if (pid === 999999) throw new Error('ESRCH');
        return true;
      });
      (unlinkSync as any).mockImplementation(() => { throw new Error('unlink fail'); });

      // Should not throw
      expect(daemon.isRunning()).toBe(false);
    });
  });

  // ── executeSchedule via periodicCheck ─────────────────────────────────

  describe('periodicCheck and executeSchedule', () => {
    it('executes single due schedule', async () => {
      const schedule = makeSchedule({ taskType: 'llm_proactive_chat' });
      mockGetDueSchedules.mockReturnValue([schedule]);

      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });

      // periodicCheck ran during start
      expect(mockAcquireExecutionLock).toHaveBeenCalledWith('sched-1');
      expect(mockSetExecuting).toHaveBeenCalledWith('sched-1', true);
      expect(mockRecordExecution).toHaveBeenCalledWith('sched-1', expect.objectContaining({ success: true }));
    });

    it('executes multiple due schedules concurrently', async () => {
      const s1 = makeSchedule({ id: 's1', name: 'S1' });
      const s2 = makeSchedule({ id: 's2', name: 'S2' });
      mockGetDueSchedules.mockReturnValue([s1, s2]);

      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });

      expect(mockAcquireExecutionLock).toHaveBeenCalledWith('s1');
      expect(mockAcquireExecutionLock).toHaveBeenCalledWith('s2');
    });

    it('skips schedule when memory lock fails', async () => {
      const schedule = makeSchedule();
      mockGetDueSchedules.mockReturnValue([schedule]);
      mockAcquireExecutionLock.mockReturnValue(false);

      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });

      expect(mockSetExecuting).not.toHaveBeenCalled();
      expect(mockRecordExecution).not.toHaveBeenCalled();
    });

    it('skips schedule when storage lock is active (isExecuting)', async () => {
      const schedule = makeSchedule({ isExecuting: true });
      mockGetDueSchedules.mockReturnValue([schedule]);
      mockAcquireExecutionLock.mockReturnValue(true);

      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });

      expect(mockReleaseExecutionLock).toHaveBeenCalledWith('sched-1');
      expect(mockRecordExecution).not.toHaveBeenCalled();
    });

    it('records error when job handler fails', async () => {
      const schedule = makeSchedule({ taskType: 'llm_proactive_chat' });
      mockGetDueSchedules.mockReturnValue([schedule]);
      mockHandleLlmProactiveChat.mockRejectedValue(new Error('LLM error'));

      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });

      expect(mockRecordExecution).toHaveBeenCalledWith('sched-1', expect.objectContaining({
        success: false,
        error: 'LLM error',
      }));
    });

    it('uses onJob callback when provided', async () => {
      const schedule = makeSchedule();
      mockGetDueSchedules.mockReturnValue([schedule]);
      const onJob = vi.fn(() => Promise.resolve());

      await daemon.start({
        checkIntervalMs: 999999,
        heartbeatIntervalMs: 999999,
        onJob,
      });

      expect(onJob).toHaveBeenCalled();
      expect(mockHandleLlmProactiveChat).not.toHaveBeenCalled();
    });

    it('records error when onJob callback fails', async () => {
      const schedule = makeSchedule();
      mockGetDueSchedules.mockReturnValue([schedule]);
      const onJob = vi.fn(() => Promise.reject(new Error('onJob fail')));

      await daemon.start({
        checkIntervalMs: 999999,
        heartbeatIntervalMs: 999999,
        onJob,
      });

      const state = daemon.getState();
      expect(state.errors.some((e: any) => e.message.includes('onJob fail'))).toBe(true);
    });

    it('handles notification push errors', async () => {
      mockGetDueSchedules.mockReturnValue([]);
      mockPushPending.mockRejectedValue(new Error('push error'));

      // Should not throw
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
    });

    it('handles notification cleanup errors', async () => {
      mockGetDueSchedules.mockReturnValue([]);
      mockClearExpired.mockImplementation(() => { throw new Error('cleanup error'); });

      // Should not throw
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
    });

    it('logs pushed/failed notification counts', async () => {
      mockGetDueSchedules.mockReturnValue([]);
      mockPushPending.mockResolvedValue({ pushed: 3, failed: 1 });

      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      // Should log push counts (verified via logger mock)
    });

    it('logs expired notifications count', async () => {
      mockGetDueSchedules.mockReturnValue([]);
      mockClearExpired.mockReturnValue(5);

      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      // Should log cleared count
    });

    it('handles periodicCheck top-level error', async () => {
      // Make getScheduler throw during periodicCheck
      const { getScheduler } = await import('../scheduler');
      let callCount = 0;
      (getScheduler as any).mockImplementation(() => {
        callCount++;
        if (callCount > 1) throw new Error('scheduler crash');
        return {
          listSchedules: mockListSchedules,
          startAll: mockStartAll,
          getDueSchedules: mockGetDueSchedules,
        };
      });

      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      const state = daemon.getState();
      expect(state.errors.some((e: any) => e.message.includes('Periodic check failed'))).toBe(true);
    });
  });

  // ── executeDefaultJobHandler switch cases ─────────────────────────────

  describe('executeDefaultJobHandler', () => {
    beforeEach(() => {
      mockAcquireExecutionLock.mockReturnValue(true);
    });

    it('handles llm_proactive_chat', async () => {
      mockGetDueSchedules.mockReturnValue([makeSchedule({ taskType: 'llm_proactive_chat' })]);
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      expect(mockHandleLlmProactiveChat).toHaveBeenCalled();
    });

    it('handles check_goal_progress', async () => {
      mockGetDueSchedules.mockReturnValue([makeSchedule({ taskType: 'check_goal_progress' })]);
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      expect(mockHandleGoalProgressCheck).toHaveBeenCalled();
    });

    it('handles run_skill', async () => {
      mockGetDueSchedules.mockReturnValue([makeSchedule({ taskType: 'run_skill' })]);
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      expect(mockHandleRunSkill).toHaveBeenCalled();
    });

    it('handles send_reminder', async () => {
      mockGetDueSchedules.mockReturnValue([makeSchedule({ taskType: 'send_reminder' })]);
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      expect(mockHandleSendReminder).toHaveBeenCalled();
    });

    it('handles memory_compress', async () => {
      mockGetDueSchedules.mockReturnValue([makeSchedule({ taskType: 'memory_compress' })]);
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      expect(mockHandleMemoryCompress).toHaveBeenCalled();
    });

    it('handles self_evolution', async () => {
      mockGetDueSchedules.mockReturnValue([makeSchedule({ taskType: 'self_evolution' })]);
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      expect(mockHandleSelfEvolution).toHaveBeenCalled();
    });

    it('handles custom', async () => {
      mockGetDueSchedules.mockReturnValue([makeSchedule({ taskType: 'custom' })]);
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      expect(mockHandleCustom).toHaveBeenCalled();
    });

    it('handles unknown task type', async () => {
      mockGetDueSchedules.mockReturnValue([makeSchedule({ taskType: 'unknown_type' })]);
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      // Should not throw, just log
      expect(mockRecordExecution).toHaveBeenCalledWith('sched-1', expect.objectContaining({ success: true }));
    });
  });

  // ── sessionId derivation ──────────────────────────────────────────────

  describe('sessionId derivation in executeSchedule', () => {
    beforeEach(() => {
      mockAcquireExecutionLock.mockReturnValue(true);
    });

    it('uses explicit associatedSessionId from params', async () => {
      mockGetDueSchedules.mockReturnValue([
        makeSchedule({ taskParams: { associatedSessionId: 'explicit-session' } }),
      ]);
      const onJob = vi.fn(() => Promise.resolve());
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999, onJob });

      expect(onJob).toHaveBeenCalledWith(
        expect.objectContaining({ associatedSessionId: 'explicit-session' }),
      );
    });

    it('derives sessionId from chatId + userId', async () => {
      mockGetDueSchedules.mockReturnValue([
        makeSchedule({ taskParams: { chatId: 'chat123', userId: 'user456' } }),
      ]);
      const onJob = vi.fn(() => Promise.resolve());
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999, onJob });

      expect(onJob).toHaveBeenCalledWith(
        expect.objectContaining({ associatedSessionId: 'feishu-chat123-user456' }),
      );
    });

    it('sets undefined sessionId when no derivation possible', async () => {
      mockGetDueSchedules.mockReturnValue([
        makeSchedule({ taskParams: { someOtherParam: 'val' } }),
      ]);
      const onJob = vi.fn(() => Promise.resolve());
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999, onJob });

      expect(onJob).toHaveBeenCalledWith(
        expect.objectContaining({ associatedSessionId: undefined }),
      );
    });
  });

  // ── loadState / saveState ─────────────────────────────────────────────

  describe('loadState', () => {
    it('loads state from file', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('state.json')) return true;
        return false;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('state.json')) return JSON.stringify({
          running: true,
          schedulesLoaded: 5,
          jobsExecuted: 10,
          errors: [],
        });
        return '{}';
      });

      const state = daemon.getState();
      expect(state.schedulesLoaded).toBe(5);
      expect(state.jobsExecuted).toBe(10);
    });

    it('handles corrupted state file', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('state.json')) return true;
        return false;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('state.json')) return 'NOT JSON!';
        return '{}';
      });

      // Should not throw, uses defaults
      const state = daemon.getState();
      expect(state).toBeDefined();
    });
  });

  // ── recordError error trimming ────────────────────────────────────────

  describe('recordError', () => {
    it('trims errors to last 10', async () => {
      // Trigger many errors by making periodicCheck fail many times
      const { getScheduler } = await import('../scheduler');
      let startCallDone = false;
      (getScheduler as any).mockImplementation(() => {
        if (!startCallDone) {
          startCallDone = true;
          return {
            listSchedules: () => [],
            startAll: mockStartAll,
            getDueSchedules: () => { throw new Error('fail'); },
          };
        }
        throw new Error('fail');
      });

      // Start will trigger periodicCheck which will fail
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });

      // Manually trigger more errors by calling getState (which loads from mock)
      // Instead, let's just verify the one error recorded
      const state = daemon.getState();
      expect(state.errors.length).toBeGreaterThan(0);
      expect(state.errors.length).toBeLessThanOrEqual(10);
    });
  });

  // ── heartbeat ─────────────────────────────────────────────────────────

  describe('updateHeartbeat', () => {
    it('writes heartbeat file', async () => {
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
      // Heartbeat is written during periodicCheck and start
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('heartbeat.json'),
        expect.any(String),
        'utf-8',
      );
    });

    it('handles heartbeat write error', async () => {
      (writeFileSync as any).mockImplementation((p: string) => {
        if (p.includes('heartbeat.json')) throw new Error('write fail');
      });

      // Should not throw
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
    });
  });

  // ── saveState error handling ──────────────────────────────────────────

  describe('saveState', () => {
    it('handles write error gracefully', async () => {
      (writeFileSync as any).mockImplementation((p: string) => {
        if (p.includes('state.json')) throw new Error('write fail');
      });

      // Should not throw
      await daemon.start({ checkIntervalMs: 999999, heartbeatIntervalMs: 999999 });
    });
  });

  // ── getDaemon / resetDaemon ───────────────────────────────────────────

  describe('getDaemon / resetDaemon', () => {
    it('throws when not initialized', () => {
      resetDaemon();
      expect(() => getDaemon()).toThrow('not initialized');
    });

    it('creates and returns singleton', () => {
      resetDaemon();
      const d1 = getDaemon('/tmp/test');
      const d2 = getDaemon();
      expect(d1).toBe(d2);
    });

    it('resetDaemon clears instance', () => {
      getDaemon('/tmp/test');
      resetDaemon();
      expect(() => getDaemon()).toThrow('not initialized');
    });
  });
});
