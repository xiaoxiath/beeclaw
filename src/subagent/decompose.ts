/**
 * Task Decomposition - LLM-assisted task breakdown
 *
 * Uses LLM to automatically decompose complex tasks into subtasks
 */

import { callAI } from '../agent/api';
import type { AIProvider } from '../config/schema';
import type { TaskDecomposition, SubTask } from './orchestration-types';

/**
 * Decomposition prompt template
 */
const DECOMPOSITION_PROMPT = `You are a task decomposition specialist. Your job is to break down complex tasks into smaller, manageable subtasks.

## Guidelines

1. **Identify Subtasks**: Break the complex task into logical subtasks
2. **Determine Type**: Classify each subtask by type:
   - research: Information gathering, web search, reading
   - memory: Memory operations, knowledge management
   - skill: Skill creation, execution, evaluation
   - code: Code generation, file operations
   - general: General-purpose tasks

3. **Parallel vs Sequential**:
   - Mark tasks as parallel: true if they don't depend on each other
   - Mark as parallel: false if they must wait for previous tasks

4. **Dependencies**:
   - List task IDs that must complete before this task can start
   - Use task IDs (0, 1, 2, etc.)

5. **Complexity**: Estimate complexity on a scale of 1-10

## Output Format

Return a JSON object with this exact structure:

\`\`\`json
{
  "subtasks": [
    {
      "id": 0,
      "type": "research",
      "description": "Search for X",
      "parallel": true,
      "dependsOn": [],
      "estimatedComplexity": 3
    },
    {
      "id": 1,
      "type": "memory",
      "description": "Read existing knowledge about Y",
      "parallel": true,
      "dependsOn": [],
      "estimatedComplexity": 2
    },
    {
      "id": 2,
      "type": "general",
      "description": "Synthesize findings and create report",
      "parallel": false,
      "dependsOn": [0, 1],
      "estimatedComplexity": 5
    }
  ],
  "strategy": "mixed",
  "reasoning": "Brief explanation of decomposition strategy"
}
\`\`\`

## Important

- Keep subtasks focused and atomic
- Avoid creating too many subtasks (max 10)
- Ensure dependencies form a valid DAG (no circular dependencies)
- Mark independent tasks as parallel
- Consider task types and their appropriate tools

## Task to Decompose

{{TASK}}

{{CONTEXT}}

Return ONLY the JSON object, no additional text.`;

/**
 * Decompose a complex task using LLM
 */
export async function decomposeTask(options: {
  provider: AIProvider;
  model: string;
  task: string;
  context?: string;
}): Promise<TaskDecomposition> {
  const { provider, model, task, context } = options;

  // Build prompt
  let prompt = DECOMPOSITION_PROMPT.replace('{{TASK}}', task);

  if (context) {
    prompt = prompt.replace('{{CONTEXT}}', `\n\n## Additional Context\n\n${context}`);
  } else {
    prompt = prompt.replace('{{CONTEXT}}', '');
  }

  // Call LLM
  const response = await callAI({
    provider,
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a task decomposition expert. Always respond with valid JSON.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.7,
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

    // Validate dependencies (no circular references)
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
 * Validate that dependencies form a valid DAG (no circular dependencies)
 */
function validateDependencies(subtasks: SubTask[]): void {
  const visited = new Set<number>();
  const recursionStack = new Set<number>();

  function hasCycle(taskId: number): boolean {
    if (recursionStack.has(taskId)) {
      return true; // Circular dependency found
    }

    if (visited.has(taskId)) {
      return false; // Already checked
    }

    visited.add(taskId);
    recursionStack.add(taskId);

    const task = subtasks.find(st => st.id === taskId);
    if (task) {
      for (const depId of task.dependsOn) {
        if (hasCycle(depId)) {
          return true;
        }
      }
    }

    recursionStack.delete(taskId);
    return false;
  }

  for (const task of subtasks) {
    if (hasCycle(task.id)) {
      throw new Error(`Circular dependency detected involving task ${task.id}`);
    }
  }
}

/**
 * Determine the overall strategy based on subtasks
 */
function determineStrategy(subtasks: SubTask[]): 'sequential' | 'parallel' | 'mixed' {
  const parallelCount = subtasks.filter(st => st.parallel).length;
  const totalCount = subtasks.length;

  if (parallelCount === totalCount) {
    return 'parallel';
  } else if (parallelCount === 0) {
    return 'sequential';
  } else {
    return 'mixed';
  }
}

/**
 * Calculate maximum possible parallelism
 */
function calculateMaxParallelism(subtasks: SubTask[]): number {
  // Simple heuristic: count tasks with no dependencies
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
    reasoning: 'Sequential execution as fallback',
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

/**
 * Validate task dependencies for cycles and invalid references
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
    if (recursionStack.has(taskId)) {
      return true;
    }
    if (visited.has(taskId)) {
      return false;
    }

    visited.add(taskId);
    recursionStack.add(taskId);

    const task = subtasks.find(st => st.id === taskId);
    if (task) {
      for (const depId of task.dependsOn) {
        if (hasCycle(depId)) {
          return true;
        }
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
