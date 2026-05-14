/**
 * Coverage-focused tests for decompose.ts
 * Targets: isSimpleTask, determineStrategy, calculateMaxParallelism, decomposeTask
 * (lines 80-82, 138-149, 211-293)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  judgeFn: vi.fn(),
}));

// Mock bun-only modules (same as existing test file)
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
  drizzle: vi.fn(() => ({
    select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  })),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: vi.fn() }));
vi.mock('bunqueue/client', () => ({ Queue: vi.fn(), Worker: vi.fn() }));

vi.mock('../../agent/fast-llm-judge', () => ({
  getFastLLMJudge: vi.fn(() => ({
    judge: mocks.judgeFn,
  })),
}));

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../../infra/observability/logger', () => ({
  logger: loggerMocks,
  getLogger: () => loggerMocks,
}));

import { decomposeTask, createSequentialDecomposition } from '../decompose';
import { getFastLLMJudge } from '../../agent/fast-llm-judge';

// ── Helpers ────────────────────────────────────────────────────────────────

const fakeProvider: any = { type: 'openai', model: 'gpt-4o-mini' };

// ── Tests ──────────────────────────────────────────────────────────────────

describe('decomposeTask coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.judgeFn.mockReset();
  });

  // ── isSimpleTask fast path (lines 80-82, 211-215) ─────────────────

  describe('isSimpleTask fast path', () => {
    it('returns sequential decomposition for short simple task', async () => {
      // "Do something" is < 15 words, no chaining keywords
      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Do something',
      });

      expect(result.strategy).toBe('sequential');
      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0].description).toBe('Do something');
      // LLM should NOT be called
      expect(mocks.judgeFn).not.toHaveBeenCalled();
    });

    it('bypasses fast path when task has chaining keyword "and"', async () => {
      // Short but has "and" -> not simple -> calls LLM
      mocks.judgeFn.mockImplementation(async (opts: any) => ({
        result: opts.defaultValue,
        failed: true,
        error: 'test',
      }));

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Do this and then that',
      });

      expect(mocks.judgeFn).toHaveBeenCalled();
    });

    it('bypasses fast path when task has chaining keyword "then"', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => ({
        result: opts.defaultValue,
        failed: false,
      }));

      await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Do X then do Y',
      });

      expect(mocks.judgeFn).toHaveBeenCalled();
    });

    it('bypasses fast path when task has chaining keyword "after that"', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => ({
        result: opts.defaultValue,
        failed: false,
      }));

      await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Do X after that do Y',
      });

      expect(mocks.judgeFn).toHaveBeenCalled();
    });

    it('bypasses fast path when task has >= 15 words', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => ({
        result: opts.defaultValue,
        failed: false,
      }));

      const longTask = 'Please research the latest developments in artificial intelligence machine learning deep learning natural language processing computer vision and robotics';

      await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: longTask,
      });

      expect(mocks.judgeFn).toHaveBeenCalled();
    });
  });

  // ── decomposeTask with context (line 219-221) ─────────────────────

  describe('context handling', () => {
    it('passes context section when context is provided', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => ({
        result: opts.defaultValue,
        failed: false,
      }));

      await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'A complex task that requires research and then implementation and then testing',
        context: 'We are building a web app',
      });

      expect(mocks.judgeFn).toHaveBeenCalled();
      const callArgs = mocks.judgeFn.mock.calls[0][0];
      expect(callArgs.promptVariables.context).toContain('Additional Context');
      expect(callArgs.promptVariables.context).toContain('We are building a web app');
    });

    it('passes empty string when no context', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => ({
        result: opts.defaultValue,
        failed: false,
      }));

      await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Research best practices and then implement the solution and then test it',
      });

      const callArgs = mocks.judgeFn.mock.calls[0][0];
      expect(callArgs.promptVariables.context).toBe('');
    });
  });

  // ── validateOutput inside decomposeTask (lines 240-283) ──────────

  describe('validateOutput callback', () => {
    it('returns null when output.subtasks is missing', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({ noSubtasks: true });
        return { result: validated ?? opts.defaultValue, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'A long enough task with and then some chaining keywords included here',
      });

      // Falls back to default
      expect(result.strategy).toBe('sequential');
    });

    it('returns null when output.subtasks is not an array', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({ subtasks: 'not-an-array' });
        return { result: validated ?? opts.defaultValue, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Do something complex and then verify and then deploy',
      });

      expect(result.strategy).toBe('sequential');
    });

    it('validates and returns well-formed subtasks', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          subtasks: [
            { id: 0, type: 'research', description: 'Research X', parallel: true, dependsOn: [], estimatedComplexity: 3 },
            { id: 1, type: 'code', description: 'Implement Y', parallel: false, dependsOn: [0], estimatedComplexity: 7 },
          ],
          strategy: 'mixed',
          reasoning: 'Research first, then implement',
        });
        return { result: validated, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Research best practices and then implement the solution and deploy',
      });

      expect(result.subtasks).toHaveLength(2);
      expect(result.strategy).toBe('mixed');
      expect(result.reasoning).toBe('Research first, then implement');
      expect(result.totalComplexity).toBe(10); // 3 + 7
      expect(result.maxParallelism).toBe(1); // only task 0 has no deps
    });

    it('uses idx as id when st.id is undefined', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          subtasks: [
            { type: 'research', description: 'Task A' },
            { type: 'code', description: 'Task B' },
          ],
        });
        return { result: validated, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Do research and then write code and then deploy it',
      });

      expect(result.subtasks[0].id).toBe(0);
      expect(result.subtasks[1].id).toBe(1);
    });

    it('defaults parallel to true when undefined', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          subtasks: [
            { id: 0, type: 'research', description: 'Task A' },
          ],
        });
        return { result: validated, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Do some research and then analyze the results then present',
      });

      expect(result.subtasks[0].parallel).toBe(true);
    });

    it('defaults dependsOn to [] and estimatedComplexity to 5', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          subtasks: [
            { id: 0, type: 'general', description: 'Task' },
          ],
        });
        return { result: validated, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Do something complex and then finalize and then submit the report',
      });

      expect(result.subtasks[0].dependsOn).toEqual([]);
      expect(result.subtasks[0].estimatedComplexity).toBe(5);
    });

    it('throws for subtask missing type or description', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        try {
          opts.validateOutput({
            subtasks: [
              { id: 0, description: 'No type field' }, // missing type
            ],
          });
        } catch (e: any) {
          // validateOutput throws, which should make judge return null/default
          return { result: opts.defaultValue, failed: true, error: e.message };
        }
        return { result: opts.defaultValue, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'A task that needs decomposition and then execution and then verification',
      });

      // Falls back to default since validateOutput threw
      expect(result.strategy).toBe('sequential');
    });

    it('returns null when dependency validation fails', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          subtasks: [
            { id: 0, type: 'general', description: 'A', parallel: false, dependsOn: [0] }, // self-dep
          ],
        });
        return { result: validated ?? opts.defaultValue, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'First research and then implement and then test thoroughly',
      });

      // Falls back to default because validateDependencies threw
      expect(result.strategy).toBe('sequential');
    });

    it('uses determineStrategy when output.strategy is missing', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          subtasks: [
            { id: 0, type: 'research', description: 'A', parallel: true, dependsOn: [] },
            { id: 1, type: 'research', description: 'B', parallel: true, dependsOn: [] },
          ],
          // no strategy field
          reasoning: 'auto-detected',
        });
        return { result: validated, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Research topic A and research topic B and compare them',
      });

      // All parallel -> determineStrategy returns 'parallel'
      expect(result.strategy).toBe('parallel');
    });

    it('determineStrategy returns sequential when no parallel tasks', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          subtasks: [
            { id: 0, type: 'general', description: 'A', parallel: false, dependsOn: [] },
            { id: 1, type: 'general', description: 'B', parallel: false, dependsOn: [0] },
          ],
        });
        return { result: validated, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'First do step A and then do step B and finally verify',
      });

      expect(result.strategy).toBe('sequential');
    });

    it('determineStrategy returns mixed when some parallel some not', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          subtasks: [
            { id: 0, type: 'research', description: 'A', parallel: true, dependsOn: [] },
            { id: 1, type: 'research', description: 'B', parallel: true, dependsOn: [] },
            { id: 2, type: 'code', description: 'C', parallel: false, dependsOn: [0, 1] },
          ],
        });
        return { result: validated, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Research A and research B then combine and implement everything',
      });

      expect(result.strategy).toBe('mixed');
      expect(result.maxParallelism).toBe(2); // tasks 0 and 1 have no deps
    });

    it('uses default reasoning when output.reasoning is missing', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          subtasks: [
            { id: 0, type: 'general', description: 'Task', parallel: true, dependsOn: [] },
          ],
          strategy: 'parallel',
          // no reasoning
        });
        return { result: validated, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'A complex multi-step task and then another thing and then finalize',
      });

      expect(result.reasoning).toBe('LLM-generated decomposition');
    });
  });

  // ── result.failed path (lines 289-290) ────────────────────────────

  describe('result.failed fallback', () => {
    it('logs warning and returns fallback when LLM fails', async () => {
      loggerMocks.warn.mockClear();

      mocks.judgeFn.mockImplementation(async (opts: any) => ({
        result: opts.defaultValue,
        failed: true,
        error: 'LLM timeout',
      }));

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Complex research and then implementation and then deployment of the system',
      });

      expect(result.strategy).toBe('sequential');
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        expect.stringContaining('LLM decomposition failed'),
        'LLM timeout',
      );
    });

    it('returns result when LLM succeeds (failed=false)', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          subtasks: [
            { id: 0, type: 'research', description: 'Research', parallel: true, dependsOn: [] },
          ],
          strategy: 'parallel',
          reasoning: 'Simple research task',
        });
        return { result: validated, failed: false };
      });

      const result = await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o-mini',
        task: 'Research multiple topics and then summarize and then present findings',
      });

      expect(result.subtasks).toHaveLength(1);
      expect(result.strategy).toBe('parallel');
    });
  });

  // ── getFastLLMJudge called with correct params ────────────────────

  describe('getFastLLMJudge configuration', () => {
    it('passes provider, model, and cache config', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => ({
        result: opts.defaultValue,
        failed: false,
      }));

      await decomposeTask({
        provider: fakeProvider,
        model: 'gpt-4o',
        task: 'A complex task with many steps and then more steps and then even more',
      });

      expect(getFastLLMJudge).toHaveBeenCalledWith(
        fakeProvider,
        'gpt-4o',
        expect.objectContaining({
          cacheEnabled: true,
          cacheSize: 20,
          defaultTimeout: 10000,
        }),
      );
    });
  });
});
