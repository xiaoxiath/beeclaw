/**
 * Task Decomposition - LLM-assisted task breakdown (Optimized)
 *
 * Changes from original:
 * 1. Removed duplicate validateDependencies export (was defined twice)
 * 2. Added simple-task bypass: tasks with ≤2 steps skip LLM decomposition
 * 3. Improved prompt with few-shot example and edge case handling
 * 4. Unified language to English in prompt (was mixed)
 * 5. Lowered temperature to 0.3 for more deterministic decomposition
 */

import { callAI } from '../agent/api';
import type { AIProvider } from '../../infra/config/schema';
import type { TaskDecomposition, SubTask } from './orchestration-types';

/**
 * Decomposition prompt template
 */
const DECOMPOSITION_PROMPT = `You are a task decomposition specialist. Break down the given task into smaller, manageable subtasks.

## Rules

1. **Subtask Types**: Classify each subtask:
   - research: Information gathering, web search, reading
   - memory: Memory operations, knowledge management
   - skill: Skill creation, execution, evaluation
   - code: Code generation, file operations, shell commands
   - general: General-purpose or multi-category tasks

2. **Parallelism**:
   - \`parallel: true\` — no dependency on other tasks
   - \`parallel: false\` — must wait for dependent tasks

3. **Dependencies**: Use task IDs (0-based). Must form a valid DAG — no cycles, no self-references.

4. **Limits**: Maximum 10 subtasks. Keep each subtask atomic and focused.

5. **Simple Tasks**: If the task needs only 1-2 steps, return just those steps. Do NOT over-decompose.

## Output Format

Return ONLY a JSON object:

\`\`\`json
{
  "subtasks": [
    {
      "id": 0,
      "type": "research",
      "description": "Search for current best practices on X",
      "parallel": true,
      "dependsOn": [],
      "estimatedComplexity": 3
    },
    {
      "id": 1,
      "type": "memory",
      "description": "Read existing knowledge about X from user memory",
      "parallel": true,
      "dependsOn": [],
      "estimatedComplexity": 2
    },
    {
      "id": 2,
      "type": "code",
      "description": "Generate implementation based on research and existing knowledge",
      "parallel": false,
      "dependsOn": [0, 1],
      "estimatedComplexity": 6
    }
  ],
  "strategy": "mixed",
  "reasoning": "Research and memory lookup are independent; code generation needs both."
}
\`\`\`

## Task to Decompose

{{TASK}}

{{CONTEXT}}`;

/**
 * Check if a task is simple enough to skip LLM decomposition
 */
function isSimpleTask(task: string): boolean {
  // Heuristics: short task description, single-verb commands, no "and"/"then" chaining
  const wordCount = task.split(/\s+/).length;
  const hasChaining = /\b(and|then|after that|followed by|接着|然后|之后)\b/i.test(task);
  return wordCount < 15 && !hasChaining;
}

/**
 * Decompose a complex task using LLM.
 * Simple tasks (≤2 inferred steps) bypass LLM and use a direct sequential plan.
 */
export async function decomposeTask(options: {
  provider: AIProvider;
  model: string;
  task: string;
  context?: string;
}): Promise<TaskDecomposition> {
  const { provider, model, task, context } = options;

  // Fast path: skip LLM for simple tasks
  if (isSimpleTask(task)) {
    return createSequentialDecomposition(task, [task]);
  }

  // Build prompt
  let prompt = DECOMPOSITION_PROMPT.replace('{{TASK}}', task);

  if (context) {
    prompt = prompt.replace('{{CONTEXT}}', `\n\n## Additional Context\n\n${context}`);
  } else {
    prompt = prompt.replace('{{CONTEXT}}', '');
  }

  // Call LLM with lower temperature for deterministic decomposition
  const response = await callAI({
    provider,
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a task decomposition expert. Always respond with valid JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.3,
    maxTokens: 2000,
  });

  // Parse response
  const content = response.choices[0].message.content || '';

  try {
    // Extract JSON from response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    const parsed = JSON.parse(jsonStr);

    // Validate structure
    if (!parsed.subtasks || !Array.isArray(parsed.subtasks)) {
      throw new Error('Invalid decomposition: missing subtasks array');
    }

    // Validate subtasks
    const subtasks: SubTask[] = parsed.subtasks.map((st: any, idx: number) => {
      if (!st.type || !st.description) {
        throw new Error(`Invalid subtask at index ${idx}: missing type or description`);
      }

      return {
        id: st.id !== undefined ? st.id : idx,
        type: st.type,
        description: st.description,
        parallel: st.parallel !== undefined ? st.parallel : true,
        dependsOn: st.dependsOn || [],
        estimatedComplexity: st.estimatedComplexity || 5,
        priority: st.priority,
        expectedOutput: st.expectedOutput,
        context: st.context,
      };
    });

    // Validate dependencies (no circular references, no self-deps, no invalid refs)
    validateDependencies(subtasks);

    // Calculate metrics
    const strategy = parsed.strategy || determineStrategy(subtasks);
    const totalComplexity = subtasks.reduce((sum, st) => sum + (st.estimatedComplexity || 5), 0);
    const maxParallelism = calculateMaxParallelism(subtasks);

    return {
      originalTask: task,
      subtasks,
      strategy,
      reasoning: parsed.reasoning || 'Task decomposed into parallel and sequential phases',
      totalComplexity,
      maxParallelism,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse decomposition: ${errorMessage}\n\nResponse: ${content}`);
  }
}

/**
 * Validate that dependencies form a valid DAG:
 * - No self-dependencies
 * - No references to non-existent tasks
 * - No circular dependencies
 */
export function validateDependencies(subtasks: SubTask[]): void {
  const taskIds = new Set(subtasks.map(st => st.id));

  // Check for self-dependencies
  for (const task of subtasks) {
    if (task.dependsOn.includes(task.id)) {
      throw new Error(`Self-dependency detected in task ${task.id}`);
    }
  }

  // Check for invalid references
  for (const task of subtasks) {
    for (const depId of task.dependsOn) {
      if (!taskIds.has(depId)) {
        throw new Error(`Invalid dependency reference: task ${task.id} depends on non-existent task ${depId}`);
      }
    }
  }

  // Check for circular dependencies using DFS
  const visited = new Set<number>();
  const recursionStack = new Set<number>();

  const hasCycle = (taskId: number): boolean => {
    if (recursionStack.has(taskId)) return true;
    if (visited.has(taskId)) return false;

    visited.add(taskId);
    recursionStack.add(taskId);

    const task = subtasks.find(st => st.id === taskId);
    if (task) {
      for (const depId of task.dependsOn) {
        if (hasCycle(depId)) return true;
      }
    }

    recursionStack.delete(taskId);
    return false;
  };

  for (const task of subtasks) {
    if (hasCycle(task.id)) {
      throw new Error(`circular dependency detected in task graph`);
    }
  }
}

/**
 * Determine the overall strategy based on subtasks
 */
function determineStrategy(subtasks: SubTask[]): 'sequential' | 'parallel' | 'mixed' {
  const parallelCount = subtasks.filter(st => st.parallel).length;
  const totalCount = subtasks.length;

  if (parallelCount === totalCount) return 'parallel';
  if (parallelCount === 0) return 'sequential';
  return 'mixed';
}

/**
 * Calculate maximum possible parallelism
 */
function calculateMaxParallelism(subtasks: SubTask[]): number {
  const independent = subtasks.filter(st => st.dependsOn.length === 0);
  return Math.max(1, independent.length);
}

/**
 * Create a simple sequential decomposition (fallback)
 */
export function createSequentialDecomposition(
  task: string,
  steps: string[]
): TaskDecomposition {
  const subtasks: SubTask[] = steps.map((step, idx) => ({
    id: idx,
    type: 'general' as const,
    description: step,
    parallel: false,
    dependsOn: idx > 0 ? [idx - 1] : [],
    estimatedComplexity: 5,
  }));

  return {
    originalTask: task,
    subtasks,
    strategy: 'sequential',
    reasoning: 'Simple task — sequential execution',
    totalComplexity: steps.length * 5,
    maxParallelism: 1,
  };
}

/**
 * Create a simple parallel decomposition (fallback)
 */
export function createParallelDecomposition(
  task: string,
  subtasksDescriptions: Array<{ type: SubTask['type']; description: string }>
): TaskDecomposition {
  const subtasks: SubTask[] = subtasksDescriptions.map((st, idx) => ({
    id: idx,
    type: st.type,
    description: st.description,
    parallel: true,
    dependsOn: [],
    estimatedComplexity: 5,
  }));

  return {
    originalTask: task,
    subtasks,
    strategy: 'parallel',
    reasoning: 'Parallel execution of independent tasks',
    totalComplexity: subtasksDescriptions.length * 5,
    maxParallelism: subtasksDescriptions.length,
  };
}
