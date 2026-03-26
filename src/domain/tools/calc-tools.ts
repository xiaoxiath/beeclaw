/**
 * Calc & Code Tools — Calculator, Code Execute, Claude Code
 *
 * Extracted from builtin.ts for modular organization.
 */

import { z } from 'zod';
import { writeFileSync, unlinkSync } from 'fs';
import { create, all } from 'mathjs';
import { logger } from '../../infra/observability/logger';
import type { BuiltinToolResult } from './builtin';

// ============================================================================
// Calculator Tool
// ============================================================================

export const CalcSchema = z.object({
  expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "sin(pi/4)")'),
});

export const calcTool = {
  name: 'calc',
  description: 'Evaluate mathematical expressions. Supports basic math, trigonometry, logarithms, etc.',
  parameters: {
    type: 'object' as const,
    properties: {
      expression: {
        type: 'string',
        description: 'Mathematical expression (e.g., "2 + 2", "sqrt(16)", "sin(pi/4)")',
      },
    },
    required: ['expression'],
  },
};

export async function executeCalc(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = CalcSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { expression } = parsed.data;

  try {
    // Create a safe math.js instance with limited scope
    const math = create(all, {
      number: 'number',
    });

    // Create a safe scope with only mathematical constants and functions
    const safeScope = {
      pi: Math.PI,
      e: Math.E,
    };

    // Evaluate expression using math.js (safe, no code execution)
    const result = math.evaluate(expression, safeScope);

    if (typeof result !== 'number' || !isFinite(result)) {
      return { success: false, error: `Invalid result: ${result}` };
    }

    return {
      success: true,
      data: `${expression} = ${result}`
    };
  } catch (error) {
    return {
      success: false,
      error: `Calculation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Code Execute Tool (safe sandboxed execution)
// ============================================================================

export const CodeExecuteSchema = z.object({
  code: z.string().describe('JavaScript/TypeScript code to execute'),
  language: z.enum(['javascript', 'typescript']).optional().default('javascript').describe('Programming language'),
  timeout: z.number().min(100).max(10000).optional().default(5000).describe('Execution timeout in ms'),
});

export const codeExecuteTool = {
  name: 'code_execute',
  description: 'Execute JavaScript code in a sandbox. Useful for data processing, calculations, and quick scripts.',
  parameters: {
    type: 'object' as const,
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute',
      },
      language: {
        type: 'string',
        enum: ['javascript', 'typescript'],
        description: 'Programming language (default: javascript)',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in ms (default: 5000, max: 10000)',
      },
    },
    required: ['code'],
  },
};

export async function executeCode(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = CodeExecuteSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { code, language, timeout } = parsed.data;

  /**
   * SECURITY FIX (P0): Use Bun subprocess for complete process-level isolation.
   *
   * Previous implementation used `new Function()` which is equivalent to eval()
   * and can be escaped by sophisticated attackers despite pattern-based guards.
   *
   * Current approach:
   * 1. Spawns a separate Bun process to execute user code
   * 2. Provides full process-level isolation (separate memory space, no access to parent)
   * 3. Enforces execution timeout via Bun subprocess timeout
   * 4. Strips dangerous environment variables (NODE_ENV set to 'sandbox')
   * 5. Captures stdout/stderr separately for clean output handling
   *
   * This ensures that even if the code attempts to access Node.js/Bun APIs,
   * it runs in an isolated process with no access to the parent's memory or state.
   */

  try {
    return await safeCodeExecute(code, language, timeout);
  } catch (error) {
    return {
      success: false,
      error: `Execution error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Execute code in an isolated Bun subprocess for security.
 *
 * Uses process-level isolation instead of in-process `new Function()` to prevent
 * sandbox escape attacks. The subprocess has no access to the parent process's
 * memory, environment variables, or file descriptors.
 */
export async function safeCodeExecute(
  code: string,
  language: 'javascript' | 'typescript' = 'javascript',
  timeout = 5000,
): Promise<BuiltinToolResult> {
  // Wrap user code to capture output as JSON for structured parsing
  const wrapper = `
"use strict";
const __output = [];
const console = {
  log: (...args) => __output.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
  error: (...args) => __output.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
  warn: (...args) => __output.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
  info: (...args) => __output.push('[INFO] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
};

(async () => {
  try {
    const __result = await (async () => { ${code} })();
    const payload = { output: __output, result: __result };
    process.stdout.write(JSON.stringify(payload));
  } catch (e) {
    const payload = { output: __output, error: e?.message || String(e) };
    process.stdout.write(JSON.stringify(payload));
    process.exit(1);
  }
})();
`;

  const ext = language === 'typescript' ? 'ts' : 'js';
  const tmpFile = `/tmp/beeclaw_exec_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    // Write code to temp file (avoids shell escaping issues with bun eval)
    writeFileSync(tmpFile, wrapper, 'utf-8');

    const proc = Bun.spawn(['bun', 'run', tmpFile], {
      timeout,
      env: {
        // Minimal environment — strip secrets and sensitive vars
        HOME: process.env.HOME || '/tmp',
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        NODE_ENV: 'sandbox',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Clean up temp file
    try { unlinkSync(tmpFile); } catch { /* ignore */ }

    if (exitCode !== 0 && !stdoutText.trim()) {
      // Process failed without structured output — likely a syntax error or crash
      const errorMsg = stderrText.trim() || `Process exited with code ${exitCode}`;
      return { success: false, error: `Execution error: ${errorMsg}` };
    }

    // Parse structured output
    try {
      const payload = JSON.parse(stdoutText.trim());
      let response = '';

      if (payload.output && payload.output.length > 0) {
        response += 'Output:\n' + payload.output.join('\n') + '\n';
      }
      if (payload.error) {
        return { success: false, error: `Runtime error: ${payload.error}` };
      }
      if (payload.result !== undefined && payload.result !== null) {
        response += 'Result: ' + (typeof payload.result === 'object'
          ? JSON.stringify(payload.result, null, 2)
          : String(payload.result));
      }
      if (!response) {
        response = 'Code executed successfully (no output)';
      }

      return { success: true, data: response };
    } catch {
      // If JSON parsing fails, return raw output
      const raw = stdoutText.trim() || stderrText.trim() || 'Code executed (no output)';
      return { success: exitCode === 0, data: raw };
    }
  } catch (error) {
    // Clean up temp file on error
    try { unlinkSync(tmpFile); } catch { /* ignore */ }

    if (error instanceof Error && error.message?.includes('timed out')) {
      return { success: false, error: `Execution timeout: code exceeded ${timeout}ms limit` };
    }
    throw error;
  }
}

// ============================================================================
// Claude Code Tool
// ============================================================================
export const ClaudeCodeSchema = z.object({
  prompt: z.string().describe('The task or prompt to send to Claude Code'),
  working_dir: z.string().optional().describe('Working directory for the task (default: current directory)'),
  timeout: z.number().min(10000).max(900000).optional().default(120000).describe('Timeout in ms (default: 120000, max: 900000)'),
  model: z.string().optional().describe('Model to use (e.g., "claude-sonnet-4-20250514", "claude-opus-4-6")'),
});

export const claudeCodeTool = {
  name: 'claude_code',
  description: `Execute a task using Claude Code SDK. Use this for complex tasks that require file operations, code analysis, or multi-step reasoning. Claude Code has access to file system, bash commands, and can work autonomously on tasks.

**Recommended Usage:**
For most tasks, use spawn_subagent with type="code" instead. It runs in background and won't block our conversation.

**Timeout guidance:**
- Simple tasks (file read/write): default 120s is sufficient
- Medium tasks (code generation, analysis): 120-180s
- Complex tasks (multi-file projects, extensive reasoning): 180-300s
- Very complex tasks (large projects, deep analysis): 300-600s
- Extremely complex tasks (comprehensive research): 600-900s
- For tasks expected to take longer, explicitly set timeout parameter

**Note:** This tool is synchronous and will block until completion. For background execution, use spawn_subagent instead.`,
  parameters: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string',
        description: 'The task or question to send to Claude Code',
      },
      working_dir: {
        type: 'string',
        description: 'Working directory (default: current directory)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in ms (default: 120000, max: 900000)',
      },
      model: {
        type: 'string',
        description: 'Model to use (optional)',
      },
    },
    required: ['prompt'],
  },
};

export async function executeClaudeCode(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = ClaudeCodeSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { prompt, working_dir, timeout, model } = parsed.data;

  try {
    // Build command args safely (no shell interpolation)
    const args = ['claude', '-p'];
    if (model) {
      args.push('--model', model);
    }
    args.push(prompt);

    // Execute using Bun's spawn (array form, no shell)
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      const timer = setTimeout(() => {
        resolve({ stdout: '', stderr: 'Timeout reached', exitCode: 124 });
      }, timeout);

      (async () => {
        try {
          const proc = Bun.spawn(args, {
            cwd: working_dir || process.cwd(),
            env: { ...process.env, CLAUDECODE: undefined },
          });

          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();
          const exitCode = await proc.exited;

          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode });
        } catch (err) {
          clearTimeout(timer);
          resolve({ stdout: '', stderr: err instanceof Error ? err.message : 'Unknown error', exitCode: 1 });
        }
      })();
    });

    if (result.exitCode === 124) {
      return { success: false, error: 'Timeout reached' };
    }

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `Claude Code exited with code ${result.exitCode}: ${result.stderr || result.stdout.slice(0, 500)}`,
      };
    }

    // Format the output
    const output = result.stdout.trim();

    if (!output) {
      return { success: true, data: 'Claude Code completed successfully (no output)' };
    }

    // Truncate if too long
    const maxLength = 10000;
    const truncated = output.length > maxLength
      ? output.slice(0, maxLength) + '\n\n... (output truncated)'
      : output;

    return { success: true, data: truncated };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ENOENT')) {
        return { success: false, error: 'Claude CLI not found. Please install Claude Code CLI first.' };
      }
      return { success: false, error: `Claude Code error: ${error.message}` };
    }
    return { success: false, error: 'Unknown error executing Claude Code' };
  }
}
