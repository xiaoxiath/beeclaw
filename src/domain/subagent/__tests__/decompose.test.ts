import { describe, test, expect } from 'bun:test';
import {
  createSequentialDecomposition,
  createParallelDecomposition,
  validateDependencies,
} from '../decompose';
import type { SubTask } from '../orchestration-types';

describe('Task Decomposition', () => {
  describe('createSequentialDecomposition', () => {
    test('creates sequential decomposition with single step', () => {
      const task = 'Complete a single task';
      const steps = ['Step 1'];

      const decomposition = createSequentialDecomposition(task, steps);

      expect(decomposition.originalTask).toBe(task);
      expect(decomposition.subtasks).toHaveLength(1);
      expect(decomposition.subtasks[0].id).toBe(0);
      expect(decomposition.subtasks[0].description).toBe('Step 1');
      expect(decomposition.subtasks[0].parallel).toBe(false);
      expect(decomposition.subtasks[0].dependsOn).toEqual([]);
      expect(decomposition.strategy).toBe('sequential');
      expect(decomposition.maxParallelism).toBe(1);
    });

    test('creates sequential decomposition with multiple steps', () => {
      const task = 'Complete multiple tasks';
      const steps = ['Step 1', 'Step 2', 'Step 3'];

      const decomposition = createSequentialDecomposition(task, steps);

      expect(decomposition.subtasks).toHaveLength(3);
      expect(decomposition.subtasks[0].dependsOn).toEqual([]);
      expect(decomposition.subtasks[1].dependsOn).toEqual([0]);
      expect(decomposition.subtasks[2].dependsOn).toEqual([1]);
    });

    test('calculates total complexity correctly', () => {
      const task = 'Test task';
      const steps = ['A', 'B', 'C', 'D'];

      const decomposition = createSequentialDecomposition(task, steps);

      expect(decomposition.totalComplexity).toBe(20); // 4 steps * 5
    });

    test('all subtasks are general type', () => {
      const steps = ['Step 1', 'Step 2'];

      const decomposition = createSequentialDecomposition('task', steps);

      for (const subtask of decomposition.subtasks) {
        expect(subtask.type).toBe('general');
      }
    });

    test('handles empty steps array', () => {
      const decomposition = createSequentialDecomposition('task', []);

      expect(decomposition.subtasks).toHaveLength(0);
      expect(decomposition.totalComplexity).toBe(0);
    });
  });

  describe('createParallelDecomposition', () => {
    test('creates parallel decomposition with single task', () => {
        const task = 'Parallel task';
        const descriptions = [{ type: 'research', description: 'Research something' }];

        const decomposition = createParallelDecomposition(task, descriptions);

        expect(decomposition.originalTask).toBe(task);
        expect(decomposition.subtasks).toHaveLength(1);
        expect(decomposition.subtasks[0].parallel).toBe(true);
        expect(decomposition.subtasks[0].dependsOn).toEqual([]);
        expect(decomposition.subtasks[0].type).toBe('research');
        expect(decomposition.strategy).toBe('parallel');
        expect(decomposition.maxParallelism).toBe(1);
      });

    test('creates parallel decomposition with multiple tasks', () => {
        const descriptions = [
          { type: 'research', description: 'Research A' },
          { type: 'memory', description: 'Read memory B' },
          { type: 'skill', description: 'Execute skill C' },
        ];

        const decomposition = createParallelDecomposition('task', descriptions);

        expect(decomposition.subtasks).toHaveLength(3);
        expect(decomposition.maxParallelism).toBe(3);

        for (const subtask of decomposition.subtasks) {
          expect(subtask.parallel).toBe(true);
          expect(subtask.dependsOn).toEqual([]);
        }
      });

    test('assigns correct types to subtasks', () => {
        const descriptions = [
          { type: 'research', description: 'R' },
          { type: 'memory', description: 'M' },
          { type: 'skill', description: 'S' },
          { type: 'code', description: 'C' },
          { type: 'general', description: 'G' },
        ];

        const decomposition = createParallelDecomposition('task', descriptions);

        const types = decomposition.subtasks.map(st => st.type);
        expect(types).toContain('research');
        expect(types).toContain('memory');
        expect(types).toContain('skill');
        expect(types).toContain('code');
        expect(types).toContain('general');
      });

    test('calculates complexity correctly', () => {
        const descriptions = [
          { type: 'research', description: 'A' },
          { type: 'research', description: 'B' },
        ];

        const decomposition = createParallelDecomposition('task', descriptions);

        expect(decomposition.totalComplexity).toBe(10); // 2 tasks * 5
      });

    test('handles empty descriptions array', () => {
        const decomposition = createParallelDecomposition('task', []);

        expect(decomposition.subtasks).toHaveLength(0);
        expect(decomposition.totalComplexity).toBe(0);
        expect(decomposition.maxParallelism).toBe(0);
      });
  });

  describe('validateDependencies', () => {
    test('validates empty subtasks', () => {
      expect(() => validateDependencies([])).not.toThrow();
    });

    test('validates independent subtasks', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'A', parallel: true, dependsOn: [] },
        { id: 1, type: 'research', description: 'B', parallel: true, dependsOn: [] },
      ];

      expect(() => validateDependencies(subtasks)).not.toThrow();
    });

    test('validates sequential dependencies', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'general', description: 'A', parallel: false, dependsOn: [] },
        { id: 1, type: 'general', description: 'B', parallel: false, dependsOn: [0] },
        { id: 2, type: 'general', description: 'C', parallel: false, dependsOn: [1] },
      ];

      expect(() => validateDependencies(subtasks)).not.toThrow();
    });

    test('throws on self-dependency', () => {
        const subtasks: SubTask[] = [
          { id: 0, type: 'general', description: 'A', parallel: false, dependsOn: [0] },
        ];

        expect(() => validateDependencies(subtasks)).toThrow('depends on itself');
      });

    test('throws on invalid reference', () => {
        const subtasks: SubTask[] = [
          { id: 0, type: 'general', description: 'A', parallel: false, dependsOn: [99] },
        ];

        expect(() => validateDependencies(subtasks)).toThrow('non-existent task');
      });

    test('throws on circular dependency (simple)', () => {
        const subtasks: SubTask[] = [
          { id: 0, type: 'general', description: 'A', parallel: false, dependsOn: [1] },
          { id: 1, type: 'general', description: 'B', parallel: false, dependsOn: [0] },
        ];

        expect(() => validateDependencies(subtasks)).toThrow('Circular dependency');
      });

    test('throws on circular dependency (complex)', () => {
        const subtasks: SubTask[] = [
          { id: 0, type: 'general', description: 'A', parallel: false, dependsOn: [2] },
          { id: 1, type: 'general', description: 'B', parallel: false, dependsOn: [0] },
          { id: 2, type: 'general', description: 'C', parallel: false, dependsOn: [1] },
        ];

        expect(() => validateDependencies(subtasks)).toThrow('Circular dependency');
      });

    test('validates complex DAG', () => {
        const subtasks: SubTask[] = [
          { id: 0, type: 'research', description: 'R1', parallel: true, dependsOn: [] },
          { id: 1, type: 'research', description: 'R2', parallel: true, dependsOn: [] },
          { id: 2, type: 'general', description: 'Synthesize', parallel: false, dependsOn: [0, 1] },
          { id: 3, type: 'code', description: 'Generate code', parallel: false, dependsOn: [2] },
        ];

        expect(() => validateDependencies(subtasks)).not.toThrow();
      });

    test('validates subtasks with multiple dependencies', () => {
        const subtasks: SubTask[] = [
          { id: 0, type: 'research', description: 'A', parallel: true, dependsOn: [] },
          { id: 1, type: 'research', description: 'B', parallel: true, dependsOn: [] },
          { id: 2, type: 'research', description: 'C', parallel: true, dependsOn: [] },
          { id: 3, type: 'general', description: 'Final', parallel: false, dependsOn: [0, 1, 2] },
        ];

        expect(() => validateDependencies(subtasks)).not.toThrow();
      });

    test('validates diamond dependency pattern', () => {
        const subtasks: SubTask[] = [
          { id: 0, type: 'general', description: 'Start', parallel: false, dependsOn: [] },
          { id: 1, type: 'research', description: 'Branch A', parallel: true, dependsOn: [0] },
          { id: 2, type: 'research', description: 'Branch B', parallel: true, dependsOn: [0] },
          { id: 3, type: 'general', description: 'Merge', parallel: false, dependsOn: [1, 2] },
        ];

        expect(() => validateDependencies(subtasks)).not.toThrow();
      });
  });

  describe('createSequentialDecomposition additional tests', () => {
    test('includes reasoning in result', () => {
      const decomposition = createSequentialDecomposition('task', ['Step 1']);

      expect(decomposition.reasoning).toBeDefined();
      expect(typeof decomposition.reasoning).toBe('string');
    });

    test('sets estimatedComplexity for each subtask', () => {
      const decomposition = createSequentialDecomposition('task', ['A', 'B']);

      for (const subtask of decomposition.subtasks) {
        expect(subtask.estimatedComplexity).toBe(5);
      }
    });

    test('handles single step correctly', () => {
      const decomposition = createSequentialDecomposition('single', ['Only step']);

      expect(decomposition.subtasks).toHaveLength(1);
      expect(decomposition.subtasks[0].dependsOn).toEqual([]);
      expect(decomposition.maxParallelism).toBe(1);
    });
  });

  describe('createParallelDecomposition additional tests', () => {
    test('includes reasoning in result', () => {
      const decomposition = createParallelDecomposition('task', [
        { type: 'research', description: 'R' },
      ]);

      expect(decomposition.reasoning).toBeDefined();
      expect(typeof decomposition.reasoning).toBe('string');
    });

    test('sets estimatedComplexity for each subtask', () => {
      const decomposition = createParallelDecomposition('task', [
        { type: 'research', description: 'A' },
        { type: 'memory', description: 'B' },
      ]);

      for (const subtask of decomposition.subtasks) {
        expect(subtask.estimatedComplexity).toBe(5);
      }
    });

    test('handles code type subtasks', () => {
      const decomposition = createParallelDecomposition('task', [
        { type: 'code', description: 'Write code' },
      ]);

      expect(decomposition.subtasks[0].type).toBe('code');
    });

    test('handles skill type subtasks', () => {
      const decomposition = createParallelDecomposition('task', [
        { type: 'skill', description: 'Execute skill' },
      ]);

      expect(decomposition.subtasks[0].type).toBe('skill');
    });
  });

  describe('TaskDecomposition structure', () => {
    test('has all required fields for sequential', () => {
      const decomposition = createSequentialDecomposition('test', ['a', 'b']);

      expect(decomposition).toHaveProperty('originalTask');
      expect(decomposition).toHaveProperty('subtasks');
      expect(decomposition).toHaveProperty('strategy');
      expect(decomposition).toHaveProperty('reasoning');
      expect(decomposition).toHaveProperty('totalComplexity');
      expect(decomposition).toHaveProperty('maxParallelism');
    });

    test('has all required fields for parallel', () => {
      const decomposition = createParallelDecomposition('test', [
        { type: 'general', description: 'a' },
      ]);

      expect(decomposition).toHaveProperty('originalTask');
      expect(decomposition).toHaveProperty('subtasks');
      expect(decomposition).toHaveProperty('strategy');
      expect(decomposition).toHaveProperty('reasoning');
      expect(decomposition).toHaveProperty('totalComplexity');
      expect(decomposition).toHaveProperty('maxParallelism');
    });
  });
});
