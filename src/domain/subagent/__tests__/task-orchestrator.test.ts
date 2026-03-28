/**
 * TaskOrchestrator & singleton tests
 *
 * Tests for the TaskOrchestrator class, computeSubtaskTimeout,
 * initTaskOrchestrator, getTaskOrchestrator, and orchestrateTask.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockDecomposeTask = vi.hoisted(() => vi.fn());
const mockSpawnSubagent = vi.hoisted(() => vi.fn());

// DAGScheduler mock — returns a controllable fake scheduler
const mockSchedulerInstance = vi.hoisted(() => ({
  initialize: vi.fn(),
  start: vi.fn(),
  getParallelizableTasks: vi.fn(() => []),
  startTask: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  retryTask: vi.fn(),
  skipTask: vi.fn(),
  isComplete: vi.fn(() => true),
  isSuccessful: vi.fn(() => true),
  getTaskStates: vi.fn(() => new Map()),
  getTaskState: vi.fn(() => null),
  getRunningTasks: vi.fn(() => []),
  getFailedTasks: vi.fn(() => []),
  getProgress: vi.fn(() => ({
    total: 0, pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, elapsedMs: 0,
  })),
}));

const MockDAGScheduler = vi.hoisted(() =>
  vi.fn().mockImplementation(function() { return mockSchedulerInstance; })
);

vi.mock('../../../infra/observability/logger', () => ({ logger: mockLogger }));
vi.mock('../decompose', () => ({ decomposeTask: mockDecomposeTask }));
vi.mock('../runtime', () => ({ spawnSubagent: mockSpawnSubagent }));
vi.mock('../scheduler', () => ({ DAGScheduler: MockDAGScheduler }));

// Bun-related mocks to prevent import failures
vi.mock('bun:sqlite', () => {
  const MockDatabase = vi.fn(() => ({
    exec: vi.fn(), run: vi.fn(),
    query: vi.fn(() => ({ all: vi.fn(() => []) })),
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })),
    transaction: vi.fn((fn: Function) => fn),
    close: vi.fn(),
  }));
  return { Database: MockDatabase, default: MockDatabase };
});
vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: vi.fn() }));
vi.mock('bunqueue/client', () => ({ Queue: vi.fn(), Worker: vi.fn() }));

/* ------------------------------------------------------------------ */
/*  Import under test                                                  */
/* ------------------------------------------------------------------ */

import {
  TaskOrchestrator,
  initTaskOrchestrator,
  getTaskOrchestrator,
  orchestrateTask,
} from '../orchestrator';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeSubtask(overrides: Record<string, any> = {}) {
  return {
    id: 0,
    type: 'general' as const,
    description: 'Do something',
    parallel: false,
    dependsOn: [] as number[],
    estimatedComplexity: 5,
    ...overrides,
  };
}

function makeDecomposition(overrides: Record<string, any> = {}) {
  return {
    originalTask: 'Test task',
    subtasks: [makeSubtask()],
    strategy: 'sequential' as const,
    reasoning: 'Test',
    totalComplexity: 5,
    maxParallelism: 1,
    ...overrides,
  };
}

function makeSubagentResult(overrides: Record<string, any> = {}) {
  return {
    success: true,
    output: 'Result output',
    tokensUsed: 100,
    duration: 50,
    id: 'agent-1',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('TaskOrchestrator', () => {
  let orchestrator: TaskOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();

    // Restore DAGScheduler constructor mock
    MockDAGScheduler.mockImplementation(function() { return mockSchedulerInstance; });

    // Restore default scheduler mock behaviors
    mockSchedulerInstance.initialize.mockReturnValue(undefined);
    mockSchedulerInstance.start.mockReturnValue(undefined);
    mockSchedulerInstance.getParallelizableTasks.mockReturnValue([]);
    mockSchedulerInstance.isComplete.mockReturnValue(true);
    mockSchedulerInstance.isSuccessful.mockReturnValue(true);
    mockSchedulerInstance.getTaskStates.mockReturnValue(new Map());
    mockSchedulerInstance.getTaskState.mockReturnValue(null);
    mockSchedulerInstance.getRunningTasks.mockReturnValue([]);
    mockSchedulerInstance.getFailedTasks.mockReturnValue([]);
    mockSchedulerInstance.getProgress.mockReturnValue({
      total: 0, pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, elapsedMs: 0,
    });

    orchestrator = new TaskOrchestrator({
      provider: 'anthropic' as any,
      model: 'claude-3',
    });
  });

  /* ================================================================ */
  /*  Constructor                                                      */
  /* ================================================================ */

  describe('constructor', () => {
    test('creates instance with defaults', () => {
      expect(orchestrator).toBeInstanceOf(TaskOrchestrator);
    });

    test('accepts custom default options', () => {
      const o = new TaskOrchestrator({
        provider: 'anthropic' as any,
        model: 'claude-3',
        defaultMaxParallelism: 5,
        defaultMaxRetries: 3,
        defaultTimeout: 600000,
        defaultSubtaskTimeout: 30000,
      });
      expect(o).toBeInstanceOf(TaskOrchestrator);
    });
  });

  /* ================================================================ */
  /*  decompose()                                                      */
  /* ================================================================ */

  describe('decompose()', () => {
    test('delegates to decomposeTask and returns result', async () => {
      const decomp = makeDecomposition();
      mockDecomposeTask.mockResolvedValueOnce(decomp);

      const result = await orchestrator.decompose('Build something');

      expect(mockDecomposeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-3',
          task: 'Build something',
        }),
      );
      expect(result).toBe(decomp);
    });

    test('passes context to decomposeTask', async () => {
      mockDecomposeTask.mockResolvedValueOnce(makeDecomposition());

      await orchestrator.decompose('Task', 'Some context');

      expect(mockDecomposeTask).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'Some context' }),
      );
    });

    test('returns fallback decomposition on error', async () => {
      mockDecomposeTask.mockRejectedValueOnce(new Error('LLM down'));

      const result = await orchestrator.decompose('Complex task');

      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0].description).toBe('Complex task');
      expect(result.strategy).toBe('sequential');
      expect(result.reasoning).toContain('Fallback');
      expect(result.maxParallelism).toBe(1);
    });
  });

  /* ================================================================ */
  /*  execute()                                                        */
  /* ================================================================ */

  describe('execute()', () => {
    test('returns successful result for empty scheduler (already complete)', async () => {
      const decomp = makeDecomposition({ subtasks: [] });

      const result = await orchestrator.execute(decomp);

      expect(result.success).toBe(true);
      expect(result.originalTask).toBe('Test task');
      expect(result.errors).toHaveLength(0);
    });

    test('initializes scheduler and starts it', async () => {
      const decomp = makeDecomposition();

      await orchestrator.execute(decomp);

      expect(MockDAGScheduler).toHaveBeenCalledWith(3); // default maxParallelism
      expect(mockSchedulerInstance.initialize).toHaveBeenCalledWith(decomp.subtasks);
      expect(mockSchedulerInstance.start).toHaveBeenCalled();
    });

    test('launches and completes a single subtask', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete
        .mockImplementation(() => loopCount++ > 0); // false first, true second

      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);

      mockSpawnSubagent.mockResolvedValueOnce(makeSubagentResult());

      const result = await orchestrator.execute(decomp);

      expect(mockSpawnSubagent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'general',
          task: 'Do something',
          signal: expect.any(Object), // AbortSignal
        }),
      );
      expect(mockSchedulerInstance.completeTask).toHaveBeenCalledWith(0, expect.any(Object));
      expect(result.success).toBe(true);
    });

    test('handles failed subtask with continueOnFailure=true', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);
      mockSchedulerInstance.getTaskState.mockReturnValue({ retryCount: 1 });

      mockSpawnSubagent.mockResolvedValueOnce(
        makeSubagentResult({ success: false, error: 'API error', tokensUsed: 50 }),
      );

      const result = await orchestrator.execute(decomp);

      expect(mockSchedulerInstance.failTask).toHaveBeenCalledWith(0, 'API error');
    });

    test('retries subtask when retryCount < maxRetries', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);
      mockSchedulerInstance.getTaskState.mockReturnValue({ retryCount: 0 });

      mockSpawnSubagent.mockResolvedValueOnce(
        makeSubagentResult({ success: false, error: 'Timeout', tokensUsed: 10 }),
      );

      await orchestrator.execute(decomp, { maxRetries: 2 });

      expect(mockSchedulerInstance.retryTask).toHaveBeenCalledWith(0);
    });

    test('handles exception thrown by spawnSubagent', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);
      mockSchedulerInstance.getTaskState.mockReturnValue({ status: 'running' });

      mockSpawnSubagent.mockRejectedValueOnce(new Error('Network failure'));

      const result = await orchestrator.execute(decomp);

      expect(mockSchedulerInstance.failTask).toHaveBeenCalledWith(0, 'Network failure');
    });

    test('handles non-Error exception from spawnSubagent', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);
      mockSchedulerInstance.getTaskState.mockReturnValue({ status: 'running' });

      mockSpawnSubagent.mockRejectedValueOnce('string error');

      const result = await orchestrator.execute(decomp);

      expect(mockSchedulerInstance.failTask).toHaveBeenCalledWith(0, 'Unknown error');
    });

    test('calls onSubtaskComplete callback on success', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });
      const onSubtaskComplete = vi.fn();

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);

      mockSpawnSubagent.mockResolvedValueOnce(makeSubagentResult());

      await orchestrator.execute(decomp, { onSubtaskComplete });

      expect(onSubtaskComplete).toHaveBeenCalledWith(0, expect.any(Object));
    });

    test('calls onProgress callback after each subtask', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });
      const onProgress = vi.fn();

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);

      mockSpawnSubagent.mockResolvedValueOnce(makeSubagentResult());

      await orchestrator.execute(decomp, { onProgress });

      expect(onProgress).toHaveBeenCalled();
    });

    test('respects maxParallelism option', async () => {
      const decomp = makeDecomposition();

      await orchestrator.execute(decomp, { maxParallelism: 5 });

      expect(MockDAGScheduler).toHaveBeenCalledWith(5);
    });

    test('token budget: aborts when budget exceeded', async () => {
      const subtask = makeSubtask({ id: 0 });
      const pendingSubtask = makeSubtask({ id: 1, dependsOn: [0] });
      const decomp = makeDecomposition({ subtasks: [subtask, pendingSubtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);

      // Create a Map with pending task
      const taskStatesMap = new Map();
      taskStatesMap.set(1, { status: 'pending', subtask: pendingSubtask });
      mockSchedulerInstance.getTaskStates.mockReturnValue(taskStatesMap);

      mockSpawnSubagent.mockResolvedValueOnce(
        makeSubagentResult({ success: true, tokensUsed: 5000 }),
      );

      const result = await orchestrator.execute(decomp, { maxTokens: 1000 } as any);

      // Should have skipped the pending task
      expect(mockSchedulerInstance.skipTask).toHaveBeenCalledWith(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Token budget exceeded'),
      );
    });

    test('token budget: does not trigger when budget is 0 (unlimited)', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);

      mockSpawnSubagent.mockResolvedValueOnce(
        makeSubagentResult({ success: true, tokensUsed: 999999 }),
      );

      await orchestrator.execute(decomp, { maxTokens: 0 } as any);

      expect(mockSchedulerInstance.skipTask).not.toHaveBeenCalled();
    });

    test('global timeout aborts all tasks', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      // Make scheduler never complete, but set a very short timeout
      mockSchedulerInstance.isComplete.mockReturnValue(false);
      mockSchedulerInstance.getParallelizableTasks.mockReturnValue([]);
      mockSchedulerInstance.getRunningTasks.mockReturnValue([]);
      mockSchedulerInstance.getFailedTasks.mockReturnValue([]);

      // Create a Map with pending task
      const taskStatesMap = new Map();
      taskStatesMap.set(0, { status: 'pending', subtask });
      mockSchedulerInstance.getTaskStates.mockReturnValue(taskStatesMap);

      const result = await orchestrator.execute(decomp, { timeout: 1 });

      // After 1ms timeout, should have failed the task
      expect(mockSchedulerInstance.failTask).toHaveBeenCalledWith(0, 'Global orchestration timeout');
    });

    test('execution stuck: skips pending when no running and has failed', async () => {
      const subtask0 = makeSubtask({ id: 0 });
      const subtask1 = makeSubtask({ id: 1, dependsOn: [0] });
      const decomp = makeDecomposition({ subtasks: [subtask0, subtask1] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 1);
      mockSchedulerInstance.getParallelizableTasks.mockReturnValue([]);
      mockSchedulerInstance.getRunningTasks.mockReturnValue([]);
      mockSchedulerInstance.getFailedTasks.mockReturnValue([{ subtask: subtask0 }]);

      const taskStatesMap = new Map();
      taskStatesMap.set(1, { status: 'pending', subtask: subtask1 });
      mockSchedulerInstance.getTaskStates.mockReturnValue(taskStatesMap);

      const result = await orchestrator.execute(decomp);

      expect(mockSchedulerInstance.skipTask).toHaveBeenCalledWith(1);
    });

    test('continueOnFailure default (true) records errors without throwing', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);
      mockSchedulerInstance.getTaskState.mockReturnValue({ retryCount: 1 });

      mockSpawnSubagent.mockResolvedValueOnce(
        makeSubagentResult({ success: false, error: 'Fatal error', tokensUsed: 10 }),
      );

      // Default continueOnFailure=true — records error, does not throw
      const result = await orchestrator.execute(decomp);

      expect(mockSchedulerInstance.failTask).toHaveBeenCalledWith(0, 'Fatal error');
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ subtaskId: 0, error: 'Fatal error' })]),
      );
    });

    test('continueOnFailure default (true) records exception errors', async () => {
      const subtask = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);
      mockSchedulerInstance.getTaskState.mockReturnValue({ status: 'running' });

      mockSpawnSubagent.mockRejectedValueOnce(new Error('Crash'));

      const result = await orchestrator.execute(decomp);

      expect(mockSchedulerInstance.failTask).toHaveBeenCalledWith(0, 'Crash');
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ subtaskId: 0, error: 'Crash' })]),
      );
    });
  });

  /* ================================================================ */
  /*  orchestrate()                                                    */
  /* ================================================================ */

  describe('orchestrate()', () => {
    test('calls decompose then execute', async () => {
      const decomp = makeDecomposition();
      mockDecomposeTask.mockResolvedValueOnce(decomp);

      const result = await orchestrator.orchestrate('Build a feature');

      expect(mockDecomposeTask).toHaveBeenCalled();
      expect(result.originalTask).toBe('Test task');
    });

    test('passes context and options through', async () => {
      const decomp = makeDecomposition();
      mockDecomposeTask.mockResolvedValueOnce(decomp);

      await orchestrator.orchestrate('Task', 'Context', { maxParallelism: 5 });

      expect(mockDecomposeTask).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'Context' }),
      );
      expect(MockDAGScheduler).toHaveBeenCalledWith(5);
    });
  });

  /* ================================================================ */
  /*  aggregateOutput() — private, tested via execute()                */
  /* ================================================================ */

  describe('aggregateOutput — via execute()', () => {
    test('returns "No results to aggregate" when no results', async () => {
      const decomp = makeDecomposition({ subtasks: [] });

      const result = await orchestrator.execute(decomp);

      expect(result.output).toBe('No results to aggregate');
    });

    test('groups results by type with capitalized headers', async () => {
      const subtask = makeSubtask({ id: 0, type: 'research' });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);

      mockSpawnSubagent.mockResolvedValueOnce(
        makeSubagentResult({ output: 'Research findings' }),
      );

      const result = await orchestrator.execute(decomp);

      expect(result.output).toContain('Research');
      expect(result.output).toContain('Research findings');
    });

    test('includes failed tasks section', async () => {
      // Subtask 0 is in decomposition but not in results → counts as failed
      const subtask0 = makeSubtask({ id: 0 });
      const decomp = makeDecomposition({ subtasks: [subtask0] });

      const result = await orchestrator.execute(decomp);

      expect(result.output).toContain('Failed Tasks');
    });

    test('handles multiple tasks of same type', async () => {
      const s0 = makeSubtask({ id: 0, type: 'research', description: 'Research A long description here' });
      const s1 = makeSubtask({ id: 1, type: 'research', description: 'Research B long description here' });
      const decomp = makeDecomposition({ subtasks: [s0, s1] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([s0, s1])
        .mockReturnValue([]);

      mockSpawnSubagent
        .mockResolvedValueOnce(makeSubagentResult({ output: 'Result A' }))
        .mockResolvedValueOnce(makeSubagentResult({ output: 'Result B' }));

      const result = await orchestrator.execute(decomp);

      // Multiple items of same type should show count
      expect(result.output).toContain('2 tasks');
    });
  });

  /* ================================================================ */
  /*  calculateStats() — private, tested via execute()                 */
  /* ================================================================ */

  describe('calculateStats — via execute()', () => {
    test('returns correct stats structure', async () => {
      const decomp = makeDecomposition({ subtasks: [] });
      mockSchedulerInstance.getTaskStates.mockReturnValue(new Map([[0, {}]]));

      const result = await orchestrator.execute(decomp);

      expect(result.stats).toEqual(expect.objectContaining({
        totalSubtasks: expect.any(Number),
        completedSubtasks: expect.any(Number),
        failedSubtasks: expect.any(Number),
        totalDurationMs: expect.any(Number),
        totalTokensUsed: expect.any(Number),
        maxParallelism: expect.any(Number),
      }));
    });

    test('counts completed and failed subtasks', async () => {
      const s0 = makeSubtask({ id: 0 });
      const s1 = makeSubtask({ id: 1 });
      const decomp = makeDecomposition({ subtasks: [s0, s1] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([s0, s1])
        .mockReturnValue([]);
      mockSchedulerInstance.getTaskState.mockReturnValue({ retryCount: 1 });

      mockSpawnSubagent
        .mockResolvedValueOnce(makeSubagentResult({ success: true, tokensUsed: 100 }))
        .mockResolvedValueOnce(makeSubagentResult({ success: false, error: 'fail', tokensUsed: 50 }));

      const taskStatesMap = new Map([[0, {}], [1, {}]]);
      mockSchedulerInstance.getTaskStates.mockReturnValue(taskStatesMap);

      const result = await orchestrator.execute(decomp);

      // Only successful results are stored in the results map by execute()
      // The failed subtask's result is NOT added to results, so:
      expect(result.stats.completedSubtasks).toBe(1);
      expect(result.stats.failedSubtasks).toBe(0); // failed results not stored in results map
      expect(result.stats.totalTokensUsed).toBe(100); // only successful subtask's tokens counted
    });
  });

  /* ================================================================ */
  /*  capitalizeType / capitalize — private, tested via output         */
  /* ================================================================ */

  describe('capitalizeType — via output', () => {
    const typeMapping: [string, string][] = [
      ['research', 'Research'],
      ['memory', 'Memory Operations'],
      ['skill', 'Skill Management'],
      ['code', 'Code Tasks'],
      ['general', 'General Tasks'],
    ];

    for (const [type, expected] of typeMapping) {
      test(`maps "${type}" to "${expected}"`, async () => {
        const subtask = makeSubtask({ id: 0, type });
        const decomp = makeDecomposition({ subtasks: [subtask] });

        let loopCount = 0;
        mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
        mockSchedulerInstance.getParallelizableTasks
          .mockReturnValueOnce([subtask])
          .mockReturnValue([]);

        mockSpawnSubagent.mockResolvedValueOnce(makeSubagentResult());

        const result = await orchestrator.execute(decomp);
        expect(result.output).toContain(expected);
      });
    }

    test('capitalizes unknown type', async () => {
      const subtask = makeSubtask({ id: 0, type: 'custom' });
      const decomp = makeDecomposition({ subtasks: [subtask] });

      let loopCount = 0;
      mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
      mockSchedulerInstance.getParallelizableTasks
        .mockReturnValueOnce([subtask])
        .mockReturnValue([]);

      mockSpawnSubagent.mockResolvedValueOnce(makeSubagentResult());

      const result = await orchestrator.execute(decomp);
      expect(result.output).toContain('Custom');
    });
  });
});

/* ==================================================================== */
/*  computeSubtaskTimeout — exported indirectly, tested via execute     */
/* ==================================================================== */

describe('computeSubtaskTimeout — via execute()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSchedulerInstance.initialize.mockReturnValue(undefined);
    MockDAGScheduler.mockImplementation(function() { return mockSchedulerInstance; });
    mockSchedulerInstance.start.mockReturnValue(undefined);
    mockSchedulerInstance.getParallelizableTasks.mockReturnValue([]);
    mockSchedulerInstance.isComplete.mockReturnValue(true);
    mockSchedulerInstance.isSuccessful.mockReturnValue(true);
    mockSchedulerInstance.getTaskStates.mockReturnValue(new Map());
    mockSchedulerInstance.getTaskState.mockReturnValue(null);
    mockSchedulerInstance.getRunningTasks.mockReturnValue([]);
    mockSchedulerInstance.getFailedTasks.mockReturnValue([]);
    mockSchedulerInstance.getProgress.mockReturnValue({
      total: 0, pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, elapsedMs: 0,
    });
  });

  test('uses perSubtaskTimeoutMs when provided', async () => {
    const subtask = makeSubtask({ id: 0, estimatedComplexity: 1 });
    const decomp = makeDecomposition({ subtasks: [subtask] });
    const orchestrator = new TaskOrchestrator({
      provider: 'anthropic' as any,
      model: 'claude-3',
      defaultSubtaskTimeout: 45000,
    });

    let loopCount = 0;
    mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
    mockSchedulerInstance.getParallelizableTasks
      .mockReturnValueOnce([subtask])
      .mockReturnValue([]);

    mockSpawnSubagent.mockResolvedValueOnce(makeSubagentResult());

    await orchestrator.execute(decomp);

    expect(mockSpawnSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 45000 }),
    );
  });

  test('computes timeout from complexity when no perSubtaskTimeout', async () => {
    const subtask = makeSubtask({ id: 0, estimatedComplexity: 10 });
    const decomp = makeDecomposition({ subtasks: [subtask] });
    const orchestrator = new TaskOrchestrator({
      provider: 'anthropic' as any,
      model: 'claude-3',
    });

    let loopCount = 0;
    mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
    mockSchedulerInstance.getParallelizableTasks
      .mockReturnValueOnce([subtask])
      .mockReturnValue([]);

    mockSpawnSubagent.mockResolvedValueOnce(makeSubagentResult());

    await orchestrator.execute(decomp);

    // Complexity 10 → ratio=(10-1)/9=1 → timeout=15000+1*(180000-15000)=180000
    expect(mockSpawnSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 180000 }),
    );
  });

  test('uses DEFAULT_SUBTASK_TIMEOUT when no complexity', async () => {
    const subtask = { ...makeSubtask({ id: 0 }), estimatedComplexity: undefined };
    const decomp = makeDecomposition({ subtasks: [subtask] });
    const orchestrator = new TaskOrchestrator({
      provider: 'anthropic' as any,
      model: 'claude-3',
    });

    let loopCount = 0;
    mockSchedulerInstance.isComplete.mockImplementation(() => loopCount++ > 0);
    mockSchedulerInstance.getParallelizableTasks
      .mockReturnValueOnce([subtask])
      .mockReturnValue([]);

    mockSpawnSubagent.mockResolvedValueOnce(makeSubagentResult());

    await orchestrator.execute(decomp);

    // DEFAULT_SUBTASK_TIMEOUT = 60000
    expect(mockSpawnSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60000 }),
    );
  });
});

/* ==================================================================== */
/*  Singleton functions                                                  */
/* ==================================================================== */

describe('initTaskOrchestrator', () => {
  test('returns a TaskOrchestrator instance', () => {
    const result = initTaskOrchestrator({
      provider: 'anthropic' as any,
      model: 'claude-3',
    });
    expect(result).toBeInstanceOf(TaskOrchestrator);
  });
});

describe('getTaskOrchestrator', () => {
  test('returns initialized instance', () => {
    initTaskOrchestrator({ provider: 'anthropic' as any, model: 'claude-3' });
    const result = getTaskOrchestrator();
    expect(result).toBeInstanceOf(TaskOrchestrator);
  });
});

describe('orchestrateTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockDAGScheduler.mockImplementation(function() { return mockSchedulerInstance; });
    mockSchedulerInstance.initialize.mockReturnValue(undefined);
    mockSchedulerInstance.start.mockReturnValue(undefined);
    mockSchedulerInstance.getParallelizableTasks.mockReturnValue([]);
    mockSchedulerInstance.isComplete.mockReturnValue(true);
    mockSchedulerInstance.isSuccessful.mockReturnValue(true);
    mockSchedulerInstance.getTaskStates.mockReturnValue(new Map());
    mockSchedulerInstance.getRunningTasks.mockReturnValue([]);
    mockSchedulerInstance.getFailedTasks.mockReturnValue([]);
    mockSchedulerInstance.getProgress.mockReturnValue({
      total: 0, pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, elapsedMs: 0,
    });
  });

  test('delegates to the singleton orchestrator', async () => {
    initTaskOrchestrator({ provider: 'anthropic' as any, model: 'claude-3' });
    mockDecomposeTask.mockResolvedValueOnce(makeDecomposition());

    const result = await orchestrateTask('Test task');

    expect(result.originalTask).toBe('Test task');
  });
});
