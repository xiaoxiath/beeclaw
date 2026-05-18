/**
 * Task Decomposition - FastLLMJudge-based task breakdown
 *
 * Uses FastLLMJudge for intelligent task decomposition
 */

import { getFastLLMJudge } from '../agent/fast-llm-judge';
import type { AIProvider } from '../../infra/config/schema';
import type { TaskDecomposition, SubTask } from './orchestration-types';
import { SUBAGENT_TYPE_VALUES } from './types';
import { getLogger } from '../../infra/observability/logger';

const logger = getLogger('subagent.decompose');

/**
 * Decomposition prompt template
 */
const DECOMPOSITION_PROMPT = `You are a task decomposition specialist. Decide whether and how to use constrained Beeclaw subagents.

## Rules

1. **Use subagents only for clear value**:
   - context isolation
   - independent parallel exploration/review/research
   - permission or tool isolation
   - bounded implementation with explicit ownership
   - independent verification
   If the task is simple or tightly coupled, return a single focused subtask.

2. **Subtask roles**:
   - explorer: read-only codebase/data/document exploration
   - reviewer: read-only review with concrete findings and evidence
   - researcher: official docs/external source research
   - triager: logs/tests/incidents/root-cause analysis
   - worker: bounded implementation with explicit file/module ownership
   - verifier: test/build/lint/behavior verification
   - memory: memory operations and knowledge management
   - skill: skill creation, execution, evaluation
   Legacy aliases are accepted but avoid them: research -> researcher, code -> worker, general -> explorer.

3. **Parallelism**:
   - \`parallel: true\` — no dependency on other tasks
   - \`parallel: false\` — must wait for dependent tasks
   Only mark tasks parallel when they are independent and do not edit the same files.

4. **Dependencies**: Use task IDs (0-based). Must form a valid DAG — no cycles, no self-references.

5. **Limits**: Maximum 6 subtasks. Keep each subtask atomic and focused.

6. **Worker ownership**: Any worker subtask must include \`ownership\` and \`successCriteria\`.

7. **Output contract**: Each subtask must define \`expectedOutput\` so the main agent can aggregate and verify it.

8. **Simple Tasks**: If the task needs only 1-2 steps, return just those steps. Do NOT over-decompose.

## Task to Decompose

{task}

{context}

## Output Format

Return ONLY valid JSON (no markdown code blocks):
{{
  "subtasks": [
    {{
      "id": 0,
      "type": "researcher",
      "description": "Search official documentation for current behavior of X",
      "parallel": true,
      "dependsOn": [],
      "estimatedComplexity": 3,
      "expectedOutput": "Source-backed findings with links, version/date, verified/not_verified, next_action"
    }},
    {{
      "id": 1,
      "type": "explorer",
      "description": "Map local implementation of X and collect file/function evidence",
      "parallel": true,
      "dependsOn": [],
      "estimatedComplexity": 3,
      "expectedOutput": "Paths, call chains, and risks with evidence"
    }},
    {{
      "id": 2,
      "type": "worker",
      "description": "Implement the selected fix within the owned files only",
      "parallel": false,
      "dependsOn": [0, 1],
      "estimatedComplexity": 6,
      "ownership": ["src/example/*", "tests/example/*"],
      "successCriteria": ["Relevant tests pass", "No unrelated files changed"],
      "expectedOutput": "Files changed, rationale, verification, not_verified, next_action"
    }}
  ],
  "strategy": "mixed",
  "reasoning": "Research and exploration are independent; implementation depends on both."
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
    expectedOutput: 'Structured result with summary, verified, not_verified, and next_action',
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
    expectedOutput: 'Structured result with summary, verified, not_verified, and next_action',
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
      const subtasks: SubTask[] = output.subtasks.slice(0, 6).map((st: any, idx: number) => {
        if (!st.type || !st.description) {
          throw new Error(`Invalid subtask at index ${idx}: missing type or description`);
        }
        if (!SUBAGENT_TYPE_VALUES.includes(st.type)) {
          throw new Error(`Invalid subtask at index ${idx}: unsupported type ${String(st.type)}`);
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
          successCriteria: st.successCriteria,
          ownership: st.ownership,
          constraints: st.constraints,
        };
      });

      // Validate dependencies
      try {
        validateDependencies(subtasks);
      } catch (error) {
        logger.warn('[Decompose] Dependency validation failed:', error);
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
    logger.warn('[Decompose] LLM decomposition failed, using fallback:', result.error);
  }

  return result.result;
}

/**
 * Export for backward compatibility
 */
export { validateDependencies };
