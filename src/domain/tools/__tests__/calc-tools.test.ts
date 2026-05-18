import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), error: vi.fn(() => {}), debug: vi.fn(() => {}), warn: vi.fn(() => {}) },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Mock fs to prevent actual file writes
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
  };
});

import {
  calcTool, CalcSchema, executeCalc,
  codeExecuteTool, CodeExecuteSchema, executeCode, safeCodeExecute,
  claudeCodeTool, ClaudeCodeSchema, executeClaudeCode,
} from '../calc-tools';

// Helper to mock Bun.spawn
function mockBunSpawn(overrides: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  throwError?: Error;
} = {}) {
  const stdoutText = overrides.stdout ?? '';
  const stderrText = overrides.stderr ?? '';
  const exitCode = overrides.exitCode ?? 0;

  const mockProc = {
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stdoutText));
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stderrText));
        controller.close();
      },
    }),
    exited: Promise.resolve(exitCode),
  };

  if (overrides.throwError) {
    (globalThis as any).Bun = {
      spawn: vi.fn(() => { throw overrides.throwError; }),
    };
  } else {
    (globalThis as any).Bun = {
      spawn: vi.fn(() => mockProc),
    };
  }

  return mockProc;
}

beforeEach(() => {
  mockWriteFileSync.mockClear();
  mockUnlinkSync.mockClear();
});

afterEach(() => {
  delete (globalThis as any).Bun;
});

describe('calc-tools', () => {
  // ── CalcSchema ───────────────────────────────────────────────────────────
  describe('CalcSchema', () => {
    it('validates expression string', () => {
      expect(CalcSchema.safeParse({ expression: '1+1' }).success).toBe(true);
    });

    it('rejects missing expression', () => {
      expect(CalcSchema.safeParse({}).success).toBe(false);
    });

    it('rejects non-string expression', () => {
      expect(CalcSchema.safeParse({ expression: 42 }).success).toBe(false);
    });
  });

  // ── calcTool ─────────────────────────────────────────────────────────────
  describe('calcTool', () => {
    it('has correct name', () => {
      expect(calcTool.name).toBe('calc');
    });

    it('requires expression parameter', () => {
      expect(calcTool.parameters.required).toContain('expression');
    });
  });

  // ── executeCalc ──────────────────────────────────────────────────────────
  describe('executeCalc', () => {
    it('evaluates simple addition', async () => {
      const result = await executeCalc({ expression: '2 + 2' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('4');
    });

    it('evaluates multiplication', async () => {
      const result = await executeCalc({ expression: '3 * 7' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('21');
    });

    it('evaluates sqrt', async () => {
      const result = await executeCalc({ expression: 'sqrt(16)' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('4');
    });

    it('uses pi constant', async () => {
      const result = await executeCalc({ expression: 'pi' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('3.14');
    });

    it('uses e constant', async () => {
      const result = await executeCalc({ expression: 'e' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('2.71');
    });

    it('evaluates complex expression', async () => {
      const result = await executeCalc({ expression: '(10 + 5) * 2 / 3' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('10');
    });

    it('evaluates trigonometric functions', async () => {
      const result = await executeCalc({ expression: 'sin(pi/2)' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('1');
    });

    it('returns error for invalid expression', async () => {
      const result = await executeCalc({ expression: 'invalid((' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Calculation error');
    });

    it('returns error for missing expression', async () => {
      const result = await executeCalc({});
      expect(result.success).toBe(false);
    });

    it('returns error for division by zero (Infinity)', async () => {
      const result = await executeCalc({ expression: '1 / 0' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid result');
    });

    it('returns error for NaN result', async () => {
      const result = await executeCalc({ expression: '0 / 0' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid result');
    });

    it('formats result with expression = value', async () => {
      const result = await executeCalc({ expression: '2 + 3' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('2 + 3 = 5');
    });
  });

  // ── CodeExecuteSchema ────────────────────────────────────────────────────
  describe('CodeExecuteSchema', () => {
    it('validates code string', () => {
      expect(CodeExecuteSchema.safeParse({ code: 'return 1' }).success).toBe(true);
    });

    it('defaults language to javascript', () => {
      const parsed = CodeExecuteSchema.parse({ code: 'return 1' });
      expect(parsed.language).toBe('javascript');
    });

    it('accepts typescript language', () => {
      const parsed = CodeExecuteSchema.parse({ code: 'return 1', language: 'typescript' });
      expect(parsed.language).toBe('typescript');
    });

    it('defaults timeout to 5000', () => {
      const parsed = CodeExecuteSchema.parse({ code: 'return 1' });
      expect(parsed.timeout).toBe(5000);
    });

    it('rejects timeout below 100', () => {
      expect(CodeExecuteSchema.safeParse({ code: 'return 1', timeout: 50 }).success).toBe(false);
    });

    it('rejects timeout above 10000', () => {
      expect(CodeExecuteSchema.safeParse({ code: 'return 1', timeout: 20000 }).success).toBe(false);
    });

    it('rejects missing code', () => {
      expect(CodeExecuteSchema.safeParse({}).success).toBe(false);
    });
  });

  // ── codeExecuteTool ──────────────────────────────────────────────────────
  describe('codeExecuteTool', () => {
    it('has correct name', () => {
      expect(codeExecuteTool.name).toBe('code_execute');
    });

    it('requires code parameter', () => {
      expect(codeExecuteTool.parameters.required).toContain('code');
    });
  });

  // ── executeCode ──────────────────────────────────────────────────────────
  describe('executeCode', () => {
    it('returns error for invalid params', async () => {
      const result = await executeCode({});
      expect(result.success).toBe(false);
    });

    it('calls safeCodeExecute with correct params on valid input', async () => {
      // Mock Bun.spawn for successful execution
      mockBunSpawn({
        stdout: JSON.stringify({ output: ['hello'], result: 42 }),
        exitCode: 0,
      });

      const result = await executeCode({ code: 'console.log("hello"); return 42;' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('hello');
      expect(result.data).toContain('42');
    });

    it('handles execution error from safeCodeExecute', async () => {
      mockBunSpawn({
        stdout: '',
        stderr: 'SyntaxError: unexpected token',
        exitCode: 1,
      });

      const result = await executeCode({ code: 'invalid{{{' });
      expect(result.success).toBe(false);
    });
  });

  // ── safeCodeExecute ──────────────────────────────────────────────────────
  describe('safeCodeExecute', () => {
    it('writes temp file and spawns Bun process', async () => {
      mockBunSpawn({
        stdout: JSON.stringify({ output: [], result: 'ok' }),
        exitCode: 0,
      });

      const result = await safeCodeExecute('return "ok"');
      expect(result.success).toBe(true);
      expect(result.data).toContain('ok');
      expect(mockWriteFileSync).toHaveBeenCalled();
      // Verify temp file path ends with .js (default javascript)
      const writePath = mockWriteFileSync.mock.calls[0][0] as string;
      expect(writePath).toMatch(/\.js$/);
    });

    it('uses .ts extension for typescript', async () => {
      mockBunSpawn({
        stdout: JSON.stringify({ output: [], result: 'ok' }),
        exitCode: 0,
      });

      await safeCodeExecute('return "ok"', 'typescript');
      const writePath = mockWriteFileSync.mock.calls[0][0] as string;
      expect(writePath).toMatch(/\.ts$/);
    });

    it('cleans up temp file after execution', async () => {
      mockBunSpawn({
        stdout: JSON.stringify({ output: [], result: 'ok' }),
        exitCode: 0,
      });

      await safeCodeExecute('return "ok"');
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('returns error when process fails with no stdout', async () => {
      mockBunSpawn({
        stdout: '',
        stderr: 'Fatal error occurred',
        exitCode: 1,
      });

      const result = await safeCodeExecute('broken code');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Fatal error occurred');
    });

    it('returns error when process fails with exit code and no output', async () => {
      mockBunSpawn({
        stdout: '',
        stderr: '',
        exitCode: 2,
      });

      const result = await safeCodeExecute('broken');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Process exited with code 2');
    });

    it('parses structured JSON output with output array', async () => {
      mockBunSpawn({
        stdout: JSON.stringify({ output: ['line1', 'line2'], result: null }),
        exitCode: 0,
      });

      const result = await safeCodeExecute('console.log("line1"); console.log("line2")');
      expect(result.success).toBe(true);
      expect(result.data).toContain('line1');
      expect(result.data).toContain('line2');
    });

    it('returns runtime error from payload', async () => {
      mockBunSpawn({
        stdout: JSON.stringify({ output: ['partial'], error: 'ReferenceError: x is not defined' }),
        exitCode: 1,
      });

      const result = await safeCodeExecute('x.foo()');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Runtime error');
      expect(result.error).toContain('ReferenceError');
    });

    it('handles no output and no result (success)', async () => {
      mockBunSpawn({
        stdout: JSON.stringify({ output: [], result: undefined }),
        exitCode: 0,
      });

      const result = await safeCodeExecute('// no-op');
      expect(result.success).toBe(true);
      expect(result.data).toContain('no output');
    });

    it('handles object result', async () => {
      mockBunSpawn({
        stdout: JSON.stringify({ output: [], result: { key: 'val' } }),
        exitCode: 0,
      });

      const result = await safeCodeExecute('return { key: "val" }');
      expect(result.success).toBe(true);
      expect(result.data).toContain('key');
      expect(result.data).toContain('val');
    });

    it('falls back to raw output when JSON parse fails', async () => {
      mockBunSpawn({
        stdout: 'raw text output',
        exitCode: 0,
      });

      const result = await safeCodeExecute('something');
      expect(result.success).toBe(true);
      expect(result.data).toBe('raw text output');
    });

    it('falls back to raw stderr when JSON parse fails and exit code nonzero', async () => {
      mockBunSpawn({
        stdout: '',
        stderr: 'some error text',
        exitCode: 1,
      });

      const result = await safeCodeExecute('bad');
      expect(result.success).toBe(false);
      expect(result.error).toContain('some error text');
    });

    it('handles timeout error from Bun.spawn', async () => {
      (globalThis as any).Bun = {
        spawn: vi.fn(() => {
          throw new Error('Process timed out');
        }),
      };

      const result = await safeCodeExecute('while(true){}', 'javascript', 100);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('re-throws non-timeout errors', async () => {
      (globalThis as any).Bun = {
        spawn: vi.fn(() => {
          throw new Error('Some other spawn error');
        }),
      };

      await expect(safeCodeExecute('code')).rejects.toThrow('Some other spawn error');
    });

    it('cleans up temp file on error path', async () => {
      (globalThis as any).Bun = {
        spawn: vi.fn(() => {
          throw new Error('timed out in Bun');
        }),
      };

      await safeCodeExecute('code', 'javascript', 100);
      expect(mockUnlinkSync).toHaveBeenCalled();
    });
  });

  // ── ClaudeCodeSchema ─────────────────────────────────────────────────────
  describe('ClaudeCodeSchema', () => {
    it('validates prompt string', () => {
      expect(ClaudeCodeSchema.safeParse({ prompt: 'hello' }).success).toBe(true);
    });

    it('defaults timeout to 120000', () => {
      const parsed = ClaudeCodeSchema.parse({ prompt: 'hello' });
      expect(parsed.timeout).toBe(120000);
    });

    it('rejects timeout below 10000', () => {
      expect(ClaudeCodeSchema.safeParse({ prompt: 'hi', timeout: 5000 }).success).toBe(false);
    });

    it('rejects timeout above 900000', () => {
      expect(ClaudeCodeSchema.safeParse({ prompt: 'hi', timeout: 1000000 }).success).toBe(false);
    });

    it('accepts optional model', () => {
      const parsed = ClaudeCodeSchema.parse({ prompt: 'hi', model: 'claude-sonnet-4-20250514' });
      expect(parsed.model).toBe('claude-sonnet-4-20250514');
    });

    it('accepts optional working_dir', () => {
      const parsed = ClaudeCodeSchema.parse({ prompt: 'hi', working_dir: '/tmp' });
      expect(parsed.working_dir).toBe('/tmp');
    });

    it('rejects missing prompt', () => {
      expect(ClaudeCodeSchema.safeParse({}).success).toBe(false);
    });
  });

  // ── claudeCodeTool ───────────────────────────────────────────────────────
  describe('claudeCodeTool', () => {
    it('has correct name', () => {
      expect(claudeCodeTool.name).toBe('claude_code');
    });

    it('requires prompt parameter', () => {
      expect(claudeCodeTool.parameters.required).toContain('prompt');
    });
  });

  // ── executeClaudeCode ────────────────────────────────────────────────────
  describe('executeClaudeCode', () => {
    it('returns error for invalid params', async () => {
      const result = await executeClaudeCode({});
      expect(result.success).toBe(false);
    });

    it('returns success with output', async () => {
      mockBunSpawn({
        stdout: 'Claude output here',
        stderr: '',
        exitCode: 0,
      });

      const result = await executeClaudeCode({ prompt: 'test task' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('Claude output here');
    });

    it('passes model argument to claude CLI', async () => {
      mockBunSpawn({
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
      });

      await executeClaudeCode({ prompt: 'task', model: 'claude-sonnet-4-20250514' });
      const spawnCall = (globalThis as any).Bun.spawn.mock.calls[0];
      expect(spawnCall[0]).toContain('--model');
      expect(spawnCall[0]).toContain('claude-sonnet-4-20250514');
    });

    it('returns error on non-zero exit code', async () => {
      mockBunSpawn({
        stdout: 'some output',
        stderr: 'error detail',
        exitCode: 1,
      });

      const result = await executeClaudeCode({ prompt: 'failing task' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('exited with code 1');
    });

    it('returns error on timeout (exit code 124)', async () => {
      // This tests the manual timeout mechanism in executeClaudeCode
      // We need to simulate the timeout path - exit code 124 with stderr 'Timeout reached'
      mockBunSpawn({
        stdout: '',
        stderr: 'Timeout reached',
        exitCode: 124,
      });

      const result = await executeClaudeCode({ prompt: 'slow task', timeout: 10000 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });

    it('returns success with empty output message', async () => {
      mockBunSpawn({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await executeClaudeCode({ prompt: 'quiet task' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('no output');
    });

    it('truncates long output', async () => {
      const longOutput = 'x'.repeat(15000);
      mockBunSpawn({
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
      });

      const result = await executeClaudeCode({ prompt: 'long output task' });
      expect(result.success).toBe(true);
      expect(result.data!.length).toBeLessThan(longOutput.length);
      expect(result.data).toContain('truncated');
    });


    it('handles ENOENT error from spawn (inner catch path)', async () => {
      (globalThis as any).Bun = {
        spawn: vi.fn(() => {
          throw new Error('ENOENT: no such file or directory');
        }),
      };

      const result = await executeClaudeCode({ prompt: 'task' });
      expect(result.success).toBe(false);
      // Inner catch converts to exitCode 1 with stderr = error message
      expect(result.error).toContain('ENOENT');
    });

    it('handles generic Error from spawn (inner catch path)', async () => {
      (globalThis as any).Bun = {
        spawn: vi.fn(() => {
          throw new Error('Some generic error');
        }),
      };

      const result = await executeClaudeCode({ prompt: 'task' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Some generic error');
    });

    it('handles non-Error throw from spawn (inner catch path)', async () => {
      (globalThis as any).Bun = {
        spawn: vi.fn(() => {
          throw 'string error';
        }),
      };

      const result = await executeClaudeCode({ prompt: 'task' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown error');
    });

    it('uses working_dir when provided', async () => {
      mockBunSpawn({
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
      });

      await executeClaudeCode({ prompt: 'task', working_dir: '/tmp/mydir' });
      const spawnCall = (globalThis as any).Bun.spawn.mock.calls[0];
      expect(spawnCall[1].cwd).toBe('/tmp/mydir');
    });
  });
});
