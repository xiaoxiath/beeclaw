/**
 * Task Decomposition - FastLLMJudge-based task breakdown
 *
 * Uses FastLLMJudge for intelligent task decomposition
 */

import { getFastLLMJudge } from '../agent/fast-llm-judge';
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

## Task to Decompose

{task}

{context}

## Output Format

Return ONLY valid JSON (no markdown code blocks):
{{
  "subtasks": [
    {{
      "id": 0,
      "type": "research",
      "description": "Search for current best practices on X",
      "parallel": true,
      "dependsOn": [],
      "estimatedComplexity": 3
    }},
    {{
      "id": 1,
      "type": "memory",
      "description": "Read existing knowledge about X from user memory",
      "parallel": true,
      "dependsOn": [],
      "estimatedComplexity": 2
    }},
    {{
      "id": 2,
      "type": "code",
      "description": "Generate implementation based on research and existing knowledge",
      "parallel": false,
      "dependsOn": [0, 1],
      "estimatedComplexity": 6
    }}
  ],
  "strategy": "mixed",
  "reasoning": "Research and memory lookup are independent; code generation needs both."
}}`;

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
 * Validate subtask dependencies (no circular references, no self-deps, no invalid refs)
 */
function validateDependencies(subtasks: SubTask[]): void {
  const taskIds = new Set(subtasks.map(st => st.id));

  for (const subtask of subtasks) {
    // No self-dependency
    if (subtask.dependsOn.includes(subtask.id)) {
      throw new Error(`Subtask ${subtask.id} depends on itself`);
    }

    // All dependencies must exist
    for (const depId of subtask.dependsOn) {
      if (!taskIds.has(depId)) {
        throw new Error(`Subtask ${subtask.id} depends on non-existent task ${depId}`);
      }
    }
  }

  // Check for circular dependencies using DFS
  const visited = new Set<number>();
  const recursionStack = new Set<number>();

  function hasCycle(taskId: number): boolean {
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
  }

  for (const subtask of subtasks) {
    if (hasCycle(subtask.id)) {
      throw new Error('Circular dependency detected in subtasks');
    }
  }
}

/**
 * Determine execution strategy based on subtasks
 */
function determineStrategy(subtasks: SubTask[]): 'sequential' | 'parallel' | 'mixed' {
  const parallelCount = subtasks.filter(st => st.parallel).length;
  if (parallelCount === subtasks.length) return 'parallel';
  if (parallelCount === 0) return 'sequential';
  return 'mixed';
}

/**
 * Calculate maximum parallelism
 */
function calculateMaxParallelism(subtasks: SubTask[]): number {
  // Simple heuristic: count tasks with no dependencies
  return subtasks.filter(st => st.dependsOn.length === 0).length;
}

/**
 * Create a simple sequential decomposition for simple tasks
 */
export function createSequentialDecomposition(task: string, steps: string[]): TaskDecomposition {
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
    reasoning: 'Simple task, sequential execution',
    totalComplexity: subtasks.length * 5,
    maxParallelism: 1,
  };
}

/**
 * Create a parallel decomposition for independent tasks
 */
export function createParallelDecomposition(
  task: string,
  descriptions: Array<{ type: SubTask['type']; description: string }>
): TaskDecomposition {
  const subtasks: SubTask[] = descriptions.map((desc, idx) => ({
    id: idx,
    type: desc.type,
    description: desc.description,
    parallel: true,
    dependsOn: [],
    estimatedComplexity: 5,
  }));

  return {
    originalTask: task,
    subtasks,
    strategy: 'parallel',
    reasoning: 'Independent tasks, parallel execution',
    totalComplexity: subtasks.length * 5,
    maxParallelism: subtasks.length,
  };
}

/**
 * Decompose a complex task using FastLLMJudge.
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

  // Build context section
  const contextSection = context
    ? `\n\n## Additional Context\n\n${context}`
    : '';

  // Get FastLLMJudge instance
  const judge = getFastLLMJudge(provider, model, {
    cacheEnabled: true,
    cacheSize: 20,
    defaultTimeout: 10000, // 10s for complex decomposition
  });

  // Execute judgment
  const result = await judge.judge<TaskDecomposition>({
    taskName: 'task-decomposition',
    promptTemplate: DECOMPOSITION_PROMPT,
    promptVariables: {
      task,
      context: contextSection,
    },
    validateOutput: (output) => {
      // Validate structure
      if (!output.subtasks || !Array.isArray(output.subtasks)) {
        return null;
      }

      // Validate subtasks
      const subtasks: SubTask[] = output.subtasks.map((st: any, idx: number) => {
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

      // Validate dependencies
      try {
        validateDependencies(subtasks);
      } catch (error) {
        console.warn('[Decompose] Dependency validation failed:', error);
        return null;
      }

      // Calculate metrics
      const strategy = output.strategy || determineStrategy(subtasks);
      const totalComplexity = subtasks.reduce((sum, st) => sum + (st.estimatedComplexity || 5), 0);
      const maxParallelism = calculateMaxParallelism(subtasks);

      return {
        originalTask: task,
        subtasks,
        strategy,
        reasoning: output.reasoning || 'LLM-generated decomposition',
        totalComplexity,
        maxParallelism,
      };
    },
    defaultValue: createSequentialDecomposition(task, [task]),
    cacheTTL: 60000, // 1 minute
  });

  if (result.failed) {
    console.warn('[Decompose] LLM decomposition failed, using fallback:', result.error);
  }

  return result.result;
}

/**
 * Export for backward compatibility
 */
export { validateDependencies };
