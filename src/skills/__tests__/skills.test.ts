import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SkillStore, getSkillStore, resetSkillStore } from '../store';
import { executeSkillTool } from '../tools';

const TEST_SKILLS_PATH = './test-skills-data';
const TEST_BUILTIN_PATH = './test-skills-builtin';

describe('SkillStore', () => {
  let store: SkillStore;

  beforeEach(() => {
    if (existsSync(TEST_SKILLS_PATH)) {
      rmSync(TEST_SKILLS_PATH, { recursive: true });
    }
    if (existsSync(TEST_BUILTIN_PATH)) {
      rmSync(TEST_BUILTIN_PATH, { recursive: true });
    }
    resetSkillStore();
    // Pass a separate builtin path to avoid loading project's built-in skills
    store = getSkillStore(TEST_SKILLS_PATH, TEST_BUILTIN_PATH);
  });

  afterEach(() => {
    if (existsSync(TEST_SKILLS_PATH)) {
      rmSync(TEST_SKILLS_PATH, { recursive: true });
    }
    if (existsSync(TEST_BUILTIN_PATH)) {
      rmSync(TEST_BUILTIN_PATH, { recursive: true });
    }
  });

  describe('init', () => {
    test('creates skills directory', () => {
      expect(existsSync(TEST_SKILLS_PATH)).toBe(true);
    });
  });

  describe('create', () => {
    test('creates a new skill', () => {
      const result = store.create({
        name: 'test-skill',
        description: 'A test skill for testing',
        content: '# Test Skill\n\nThis is a test.',
        tags: ['test'],
        triggers: ['test trigger'],
      });

      expect(result.success).toBe(true);

      const skillPath = join(TEST_SKILLS_PATH, 'test-skill');
      expect(existsSync(skillPath)).toBe(true);
      expect(existsSync(join(skillPath, 'SKILL.md'))).toBe(true);
    });

    test('creates SKILL.md with frontmatter', () => {
      store.create({
        name: 'my-skill',
        description: 'My skill description',
        content: 'Skill body content',
      });

      const content = readFileSync(join(TEST_SKILLS_PATH, 'my-skill', 'SKILL.md'), 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('name: my-skill');
      expect(content).toContain('description: My skill description');
      expect(content).toContain('Skill body content');
    });

    test('fails if skill already exists', () => {
      store.create({ name: 'existing', description: 'First' });
      const result = store.create({ name: 'existing', description: 'Second' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('get', () => {
    test('returns skill by name', () => {
      store.create({
        name: 'get-test',
        description: 'Get test skill',
        content: 'Content here',
        tags: ['tag1'],
      });

      const skill = store.get('get-test');

      expect(skill).not.toBeNull();
      expect(skill?.name).toBe('get-test');
      expect(skill?.description).toBe('Get test skill');
      expect(skill?.content).toBe('Content here');
      expect(skill?.tags).toEqual(['tag1']);
    });

    test('returns null for non-existent skill', () => {
      const skill = store.get('non-existent');
      expect(skill).toBeNull();
    });
  });

  describe('list', () => {
    test('returns all skills', () => {
      store.create({ name: 'skill-a', description: 'A' });
      store.create({ name: 'skill-b', description: 'B' });
      store.create({ name: 'skill-c', description: 'C' });

      const skills = store.list();
      expect(skills.length).toBe(3);
      expect(skills.map(s => s.name).sort()).toEqual(['skill-a', 'skill-b', 'skill-c']);
    });

    test('returns empty array when no skills', () => {
      const skills = store.list();
      expect(skills).toEqual([]);
    });
  });

  describe('update', () => {
    test('updates skill description', () => {
      store.create({ name: 'update-test', description: 'Original' });
      const result = store.update('update-test', { description: 'Updated' });

      expect(result.success).toBe(true);

      const skill = store.get('update-test');
      expect(skill?.description).toBe('Updated');
    });

    test('updates skill content', () => {
      store.create({ name: 'update-content', description: 'D', content: 'Original content' });
      store.update('update-content', { content: 'New content' });

      const skill = store.get('update-content');
      expect(skill?.content).toBe('New content');
    });

    test('fails for non-existent skill', () => {
      const result = store.update('non-existent', { description: 'New' });
      expect(result.success).toBe(false);
    });
  });

  describe('delete', () => {
    test('deletes a skill', () => {
      store.create({ name: 'delete-test', description: 'To delete' });
      const result = store.delete('delete-test');

      expect(result.success).toBe(true);
      expect(store.get('delete-test')).toBeNull();
    });

    test('fails for non-existent skill', () => {
      const result = store.delete('non-existent');
      expect(result.success).toBe(false);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      store.create({
        name: 'web-scraper',
        description: 'Scrape web pages',
        tags: ['web', 'http'],
      });
      store.create({
        name: 'file-reader',
        description: 'Read files from disk',
        tags: ['file', 'io'],
      });
      store.create({
        name: 'api-client',
        description: 'Make HTTP API calls',
        tags: ['web', 'api'],
      });
    });

    test('finds skills by name', () => {
      const results = store.search('web');
      expect(results.length).toBe(2);
      expect(results.some(s => s.name === 'web-scraper')).toBe(true);
    });

    test('finds skills by tag', () => {
      const results = store.search('file');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('file-reader');
    });
  });

  describe('recordUsage', () => {
    test('records successful usage', () => {
      store.create({ name: 'usage-test', description: 'Test' });
      const result = store.recordUsage('usage-test', true);

      expect(result.success).toBe(true);

      const skill = store.get('usage-test');
      expect(skill?.usageCount).toBe(1);
      expect(skill?.successCount).toBe(1);
      expect(skill?.failureCount).toBe(0);
    });

    test('records failed usage', () => {
      store.create({ name: 'usage-fail', description: 'Test' });
      store.recordUsage('usage-fail', false);

      const skill = store.get('usage-fail');
      expect(skill?.usageCount).toBe(1);
      expect(skill?.successCount).toBe(0);
      expect(skill?.failureCount).toBe(1);
    });
  });

  describe('assessMaturity', () => {
    test('assesses immature skill', () => {
      store.create({ name: 'immature', description: 'Test' });
      const assessment = store.assessMaturity('immature');

      expect(assessment.ready).toBe(false);
      expect(assessment.checks.productionTested).toBe(false);
    });

    test('assesses mature skill after successful uses', () => {
      store.create({ name: 'mature', description: 'Test skill' });

      // Simulate 5 successful uses
      for (let i = 0; i < 5; i++) {
        store.recordUsage('mature', true);
      }

      const assessment = store.assessMaturity('mature');

      expect(assessment.checks.productionTested).toBe(true);
      expect(assessment.checks.stable).toBe(true);
    });
  });
});

describe('Skill Tools', () => {
  beforeEach(() => {
    if (existsSync(TEST_SKILLS_PATH)) {
      rmSync(TEST_SKILLS_PATH, { recursive: true });
    }
    resetSkillStore();
    getSkillStore(TEST_SKILLS_PATH);
  });

  afterEach(() => {
    if (existsSync(TEST_SKILLS_PATH)) {
      rmSync(TEST_SKILLS_PATH, { recursive: true });
    }
  });

  test('skill_list tool', () => {
    executeSkillTool('skill_create', {
      name: 'test',
      description: 'Test skill',
    });

    const result = executeSkillTool('skill_list', {});
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });

  test('skill_get tool', () => {
    executeSkillTool('skill_create', {
      name: 'get-test',
      description: 'Test',
      content: 'Skill content',
    });

    const result = executeSkillTool('skill_get', { name: 'get-test' });
    expect(result.success).toBe(true);
    expect((result.data as any).name).toBe('get-test');
  });

  test('skill_create tool', () => {
    const result = executeSkillTool('skill_create', {
      name: 'new-skill',
      description: 'A new skill',
      content: '# New Skill\n\nInstructions here.',
      tags: ['new', 'test'],
    });

    expect(result.success).toBe(true);
    expect((result.data as any).name).toBe('new-skill');
  });

  test('skill_update tool', () => {
    executeSkillTool('skill_create', {
      name: 'update-me',
      description: 'Original',
    });

    const result = executeSkillTool('skill_update', {
      name: 'update-me',
      description: 'Updated description',
    });

    expect(result.success).toBe(true);
    expect((result.data as any).description).toBe('Updated description');
  });

  test('skill_delete tool', () => {
    executeSkillTool('skill_create', {
      name: 'delete-me',
      description: 'To delete',
    });

    const result = executeSkillTool('skill_delete', { name: 'delete-me' });
    expect(result.success).toBe(true);
  });

  test('skill_search tool', () => {
    executeSkillTool('skill_create', {
      name: 'web-fetcher',
      description: 'Fetch web pages',
    });

    const result = executeSkillTool('skill_search', { query: 'web' });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as any[]).length).toBeGreaterThan(0);
  });

  test('skill_record tool', () => {
    executeSkillTool('skill_create', {
      name: 'record-test',
      description: 'Test',
    });

    const result = executeSkillTool('skill_record', {
      name: 'record-test',
      success: true,
    });

    expect(result.success).toBe(true);
    expect((result.data as any).usageCount).toBe(1);
  });

  test('skill_maturity tool', () => {
    executeSkillTool('skill_create', {
      name: 'maturity-test',
      description: 'Test',
    });

    const result = executeSkillTool('skill_maturity', { name: 'maturity-test' });
    expect(result.success).toBe(true);
    expect((result.data as any).ready).toBe(false);
    expect(Array.isArray((result.data as any).recommendations)).toBe(true);
  });

  test('invalid tool returns error', () => {
    const result = executeSkillTool('invalid', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });
});
