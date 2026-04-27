/**
 * Subagent Tools — Type Definitions & Formatters
 *
 * Tool definitions for spawn_subagent and spawn_parallel have been moved to
 * `../../domain/tools/builtin.ts` (spawnSubagentToolDef, spawnParallelToolDef).
 * This file retains only the parameter interfaces and result formatting helpers
 * that are consumed by executor.ts and other modules.
 */

import type { SubagentType, SubagentResult } from './types';

/**
 * Parameters for spawn_subagent tool
 */
export interface SpawnSubagentParams {
  /** Type of subagent */
  type: SubagentType;

  /** Task description */
  task: string;

  /** Additional context */
  context?: string;

  /** Expected output shape or deliverable */
  expectedOutput?: string;

  /** Explicit success criteria */
  successCriteria?: string[];

  /** File or module ownership boundary for worker-style tasks */
  ownership?: string[];

  /** Extra task constraints */
  constraints?: string[];

  /** Limit available tools to this subset of the role profile */
  tools?: string[];

  /** Timeout in milliseconds (default: 180000 = 3 minutes) */
  timeout?: number;

  /** Maximum tokens for response */
  maxTokens?: number;
}

/**
 * Parameters for spawn_parallel tool
 */
export interface SpawnParallelParams {
  /** List of subagent tasks to execute in parallel */
  tasks: Array<{
    type: SubagentType;
    task: string;
    context?: string;
    expectedOutput?: string;
    successCriteria?: string[];
    ownership?: string[];
    constraints?: string[];
    tools?: string[];
    timeout?: number;
  }>;

  /** Maximum parallelism (default: 3) */
  maxParallelism?: number;
}

/**
 * Format subagent result for display
 */
export function formatSubagentResult(
  result: SubagentResult,
  taskDescription: string
): string {
  const lines: string[] = [];

  lines.push(`## Subagent Result\n`);
  lines.push(`**Task**: ${taskDescription.substring(0, 100)}...`);
  lines.push(`**Status**: ${result.success ? '✅ Success' : '❌ Failed'}`);
  lines.push(`**Duration**: ${result.duration}ms`);
  if (result.role) {
    lines.push(`**Role**: ${result.role}`);
  }
  if (result.status) {
    lines.push(`**Contract Status**: ${result.status}`);
  }

  if (result.tokensUsed > 0) {
    lines.push(`**Tokens Used**: ${result.tokensUsed}`);
  }

  if (result.summary) {
    lines.push(`\n### Summary\n`);
    lines.push(result.summary);
  }

  lines.push(`\n### Output\n`);
  lines.push(result.output);

  if (result.verified?.length) {
    lines.push(`\n### Verified\n`);
    lines.push(result.verified.map((item) => `- ${item}`).join('\n'));
  }

  if (result.notVerified?.length) {
    lines.push(`\n### Not Verified\n`);
    lines.push(result.notVerified.map((item) => `- ${item}`).join('\n'));
  }

  if (result.nextAction) {
    lines.push(`\n### Next Action\n`);
    lines.push(result.nextAction);
  }

  if (result.error) {
    lines.push(`\n### Error\n`);
    // Ensure error is a string
    const errorStr = typeof result.error === 'string'
      ? result.error
      : JSON.stringify(result.error);
    lines.push(errorStr);
  }

  return lines.join('\n');
}

/**
 * Format parallel results for display
 */
export function formatParallelResults(
  results: SubagentResult[],
  taskDescriptions: string[]
): string {
  const lines: string[] = [];

  const successful = results.filter(r => r.success).length;
  const total = results.length;

  lines.push(`## Parallel Execution Results\n`);
  lines.push(`**Completed**: ${successful}/${total} tasks`);
  lines.push(`**Total Duration**: ${Math.max(...results.map(r => r.duration))}ms (parallel)\n`);

  lines.push(`---\n`);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const desc = taskDescriptions[i] || `Task ${i + 1}`;

    lines.push(`### Task ${i + 1}: ${desc.substring(0, 50)}...`);
    lines.push(`**Status**: ${result.success ? '✅' : '❌'} | **Duration**: ${result.duration}ms\n`);

    if (result.success) {
      lines.push(result.output);
    } else {
      // Ensure error is a string
      const errorStr = typeof result.error === 'string'
        ? result.error
        : (result.error ? JSON.stringify(result.error) : 'Unknown error');
      lines.push(`**Error**: ${errorStr}`);
    }

    lines.push(`\n---\n`);
  }

  return lines.join('\n');
}
