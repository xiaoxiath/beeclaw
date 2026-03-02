/**
 * Subagent Tools
 *
 * Tools for LLM to spawn and manage subagents
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
    timeout?: number;
  }>;

  /** Maximum parallelism (default: 3) */
  maxParallelism?: number;
}

/**
 * Tool definition for spawn_subagent
 */
export const spawnSubagentTool = {
  name: 'spawn_subagent',
  description: `Spawn a specialized subagent to handle a specific task.

Use this tool when you need to delegate a focused task to a specialized agent.
The subagent will have access to a limited set of tools appropriate for its type.

Available subagent types:
- research: Information gathering, web search, reading documents
- memory: Memory operations, knowledge management
- skill: Skill creation, execution, evaluation
- code: Code generation, file operations
- general: General-purpose tasks with full tool access

Best practices:
1. Choose the appropriate subagent type
2. Provide a clear, focused task description
3. Include relevant context
4. Set reasonable timeout for complex tasks

Example:
  spawn_subagent({
    type: "research",
    task: "Search for React 19 new features",
    context: "Focus on hooks and server components",
    timeout: 30000
  })`,

  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['research', 'memory', 'skill', 'code', 'general'],
        description: 'Type of subagent (determines available tools)',
      },
      task: {
        type: 'string',
        description: 'Clear description of the task to accomplish',
      },
      context: {
        type: 'string',
        description: 'Additional context or requirements',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 180000 = 3 minutes)',
      },
      maxTokens: {
        type: 'number',
        description: 'Maximum tokens for response',
      },
    },
    required: ['type', 'task'],
  },
};

/**
 * Tool definition for spawn_parallel
 */
export const spawnParallelTool = {
  name: 'spawn_parallel',
  description: `Spawn multiple subagents in parallel to handle independent tasks.

Use this tool when you have multiple independent tasks that can be executed simultaneously.
This is more efficient than spawning subagents one by one.

Best practices:
1. Only include truly independent tasks (no dependencies)
2. Keep the number reasonable (2-5 tasks)
3. Use appropriate subagent types for each task
4. Set maxParallelism based on task complexity

Example:
  spawn_parallel({
    tasks: [
      {
        type: "research",
        task: "Search for React 19 features"
      },
      {
        type: "memory",
        task: "Read existing React knowledge"
      },
      {
        type: "skill",
        task: "Get skill-creator skill definition"
      }
    ],
    maxParallelism: 3
  })`,

  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'List of subagent tasks to execute in parallel',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['research', 'memory', 'skill', 'code', 'general'],
            },
            task: {
              type: 'string',
            },
            context: {
              type: 'string',
            },
            timeout: {
              type: 'number',
            },
          },
          required: ['type', 'task'],
        },
      },
      maxParallelism: {
        type: 'number',
        description: 'Maximum number of parallel executions (default: 3)',
      },
    },
    required: ['tasks'],
  },
};

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

  if (result.tokensUsed > 0) {
    lines.push(`**Tokens Used**: ${result.tokensUsed}`);
  }

  lines.push(`\n### Output\n`);
  lines.push(result.output);

  if (result.error) {
    lines.push(`\n### Error\n`);
    lines.push(result.error);
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
      lines.push(`**Error**: ${result.error || 'Unknown error'}`);
    }

    lines.push(`\n---\n`);
  }

  return lines.join('\n');
}
