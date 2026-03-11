import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { handleSkillJob } from '../../../app/queue-handlers/handlers/skill-handler';
import { getSkillStore, resetSkillStore } from '../../../domain/skills/store';
import type { SkillJobData } from '../types';
import type { Job } from 'bunqueue/client';

const TEST_SKILL_PATH = './test-skill-data';

// Mock Job object
function createMockJob<T>(data: T): Job<T> {
  let progress = 0;
  return {
    id: `job-${Date.now()}`,
    name: 'test-job',
    data,
    queueName: 'test-queue',
    state: 'waiting',
    progress: 0,
    timestamp: Date.now(),
    updateProgress: async (p: number) => {
      progress = p;
    },
    getProgress: () => progress,
  } as unknown as Job<T>;
}

describe('Skill Handler', () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_SKILL_PATH)) {
      rmSync(TEST_SKILL_PATH, { recursive: true });
    }
    mkdirSync(TEST_SKILL_PATH, { recursive: true });
    resetSkillStore();
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_SKILL_PATH)) {
      rmSync(TEST_SKILL_PATH, { recursive: true });
    }
    resetSkillStore();
  });

  describe('handleSkillJob', () => {
    test('executes skill with required parameters', async () => {
      // Initialize skill store with a test skill
      const skillStore = getSkillStore(TEST_SKILL_PATH, TEST_SKILL_PATH);
      skillStore.init();

      // Create a test skill
      skillStore.create({
        name: 'test-skill',
        description: 'A test skill',
        content: 'Test skill content',
      });

      const job = createMockJob<SkillJobData>({
        skillName: 'test-skill',
        action: 'execute',
        params: {},
      });

      const result = await handleSkillJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
      expect((result as any).skillName).toBe('test-skill');
      expect((result as any).action).toBe('execute');
    });

    test('executes skill with params', async () => {
      const skillStore = getSkillStore(TEST_SKILL_PATH, TEST_SKILL_PATH);
      skillStore.init();
      skillStore.create({
        name: 'param-skill',
        description: 'Skill with params',
        content: 'Content',
      });

      const job = createMockJob<SkillJobData>({
        skillName: 'param-skill',
        action: 'test',
        params: { key: 'value', count: 42 },
      });

      const result = await handleSkillJob(job);

      expect(result).toBeDefined();
      expect((result as any).params).toEqual({ key: 'value', count: 42 });
    });

    test('throws for non-existent skill', async () => {
      const skillStore = getSkillStore(TEST_SKILL_PATH, TEST_SKILL_PATH);
      skillStore.init();

      const job = createMockJob<SkillJobData>({
        skillName: 'non-existent-skill',
        action: 'execute',
        params: {},
      });

      await expect(handleSkillJob(job)).rejects.toThrow('Skill not found');
    });

    test('includes sessionId in result', async () => {
      const skillStore = getSkillStore(TEST_SKILL_PATH, TEST_SKILL_PATH);
      skillStore.init();
      skillStore.create({
        name: 'session-skill',
        description: 'Skill with session',
        content: 'Content',
      });

      const job = createMockJob<SkillJobData>({
        skillName: 'session-skill',
        action: 'execute',
        params: {},
        sessionId: 'session-123',
      });

      const result = await handleSkillJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
    });

    test('handles different actions', async () => {
      const skillStore = getSkillStore(TEST_SKILL_PATH, TEST_SKILL_PATH);
      skillStore.init();
      skillStore.create({
        name: 'multi-action-skill',
        description: 'Multi-action skill',
        content: 'Content',
      });

      const actions = ['execute', 'validate', 'preview'];

      for (const action of actions) {
        const job = createMockJob<SkillJobData>({
          skillName: 'multi-action-skill',
          action,
          params: {},
        });

        const result = await handleSkillJob(job);
        expect((result as any).action).toBe(action);
      }
    });
  });
});
