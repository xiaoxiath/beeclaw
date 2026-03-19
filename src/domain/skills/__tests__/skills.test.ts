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
    test('creates skills directory', async () => {
      expect(existsSync(TEST_SKILLS_PATH)).toBe(true);
    });
  });

  describe('create', () => {
    test('creates a new skill', async () => {
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

    test('creates SKILL.md with frontmatter', async () => {
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

    test('fails if skill already exists', async () => {
      store.create({ name: 'existing', description: 'First' });
      const result = store.create({ name: 'existing', description: 'Second' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('get', () => {
    test('returns skill by name', async () => {
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

    test('returns null for non-existent skill', async () => {
      const skill = store.get('non-existent');
      expect(skill).toBeNull();
    });
  });

  describe('list', () => {
    test('returns all skills', async () => {
      store.create({ name: 'skill-a', description: 'A' });
      store.create({ name: 'skill-b', description: 'B' });
      store.create({ name: 'skill-c', description: 'C' });

      const skills = store.list();
      expect(skills.length).toBe(3);
      expect(skills.map(s => s.name).sort()).toEqual(['skill-a', 'skill-b', 'skill-c']);
    });

    test('returns empty array when no skills', async () => {
      const skills = store.list();
      expect(skills).toEqual([]);
    });
  });

  describe('update', () => {
    test('updates skill description', async () => {
      store.create({ name: 'update-test', description: 'Original' });
      const result = store.update('update-test', { description: 'Updated' });

      expect(result.success).toBe(true);

      const skill = store.get('update-test');
      expect(skill?.description).toBe('Updated');
    });

    test('updates skill content', async () => {
      store.create({ name: 'update-content', description: 'D', content: 'Original content' });
      store.update('update-content', { content: 'New content' });

      const skill = store.get('update-content');
      expect(skill?.content).toBe('New content');
    });

    test('fails for non-existent skill', async () => {
      const result = store.update('non-existent', { description: 'New' });
      expect(result.success).toBe(false);
    });
  });

  describe('delete', () => {
    test('deletes a skill', async () => {
      store.create({ name: 'delete-test', description: 'To delete' });
      const result = store.delete('delete-test');

      expect(result.success).toBe(true);
      expect(store.get('delete-test')).toBeNull();
    });

    test('fails for non-existent skill', async () => {
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

    test('finds skills by name', async () => {
      const results = store.search('web');
      expect(results.length).toBe(2);
      expect(results.some(s => s.name === 'web-scraper')).toBe(true);
    });

    test('finds skills by tag', async () => {
      const results = store.search('file');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('file-reader');
    });
  });

  describe('recordUsage', () => {
    test('records successful usage', async () => {
      store.create({ name: 'usage-test', description: 'Test' });
      const result = store.recordUsage('usage-test', true);

      expect(result.success).toBe(true);

      const skill = store.get('usage-test');
      expect(skill?.usageCount).toBe(1);
      expect(skill?.successCount).toBe(1);
      expect(skill?.failureCount).toBe(0);
    });

    test('records failed usage', async () => {
      store.create({ name: 'usage-fail', description: 'Test' });
      store.recordUsage('usage-fail', false);

      const skill = store.get('usage-fail');
      expect(skill?.usageCount).toBe(1);
      expect(skill?.successCount).toBe(0);
      expect(skill?.failureCount).toBe(1);
    });
  });

  describe('assessMaturity', () => {
    test('assesses immature skill', async () => {
      store.create({ name: 'immature', description: 'Test' });
      const assessment = store.assessMaturity('immature');

      expect(assessment.ready).toBe(false);
      expect(assessment.checks.productionTested).toBe(false);
    });

    test('assesses mature skill after successful uses', async () => {
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

  test('skill_list tool', async () => {
    await executeSkillTool('skill_ensure', {
      name: 'test',
      description: 'Test skill',
    });

    const result = await executeSkillTool('skill_list', {});
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });

  test('skill_get tool', async () => {
    await executeSkillTool('skill_ensure', {
      name: 'get-test',
      description: 'Test',
      content: 'Skill content',
    });

    const result = await executeSkillTool('skill_get', { name: 'get-test' });
    expect(result.success).toBe(true);
    expect((result.data as any).name).toBe('get-test');
  });

  test('skill_ensure tool', async () => {
    const result = await executeSkillTool('skill_ensure', {
      name: 'new-skill',
      description: 'A new skill',
      content: '# New Skill\n\nInstructions here.',
      tags: ['new', 'test'],
    });

    expect(result.success).toBe(true);
    expect((result.data as any).name).toBe('new-skill');
  });

  test('skill_ensure tool', async () => {
    await executeSkillTool('skill_ensure', {
      name: 'update-me',
      description: 'Original',
    });

    const result = await executeSkillTool('skill_ensure', {
      name: 'update-me',
      description: 'Updated description',
    });

    expect(result.success).toBe(true);
    expect((result.data as any).description).toBe('Updated description');
  });

  test('skill_delete tool', async () => {
    await executeSkillTool('skill_ensure', {
      name: 'delete-me',
      description: 'To delete',
    });

    const result = await executeSkillTool('skill_delete', { name: 'delete-me' });
    expect(result.success).toBe(true);
  });

  test('skill_record tool', async () => {
    await executeSkillTool('skill_ensure', {
      name: 'record-test',
      description: 'Test',
    });

    const result = await executeSkillTool('skill_record', {
      name: 'record-test',
      success: true,
    });

    expect(result.success).toBe(true);
    expect((result.data as any).usageCount).toBe(1);
  });

  test('skill_maturity tool', async () => {
    await executeSkillTool('skill_ensure', {
      name: 'maturity-test',
      description: 'Test',
    });

    const result = await executeSkillTool('skill_maturity', { name: 'maturity-test' });
    expect(result.success).toBe(true);
    expect((result.data as any).ready).toBe(false);
    expect(Array.isArray((result.data as any).recommendations)).toBe(true);
  });

  test('invalid tool returns error', async () => {
    const result = await executeSkillTool('invalid', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });
});

describe('Skill Evals Run', () => {
  let store: SkillStore;

  beforeEach(() => {
    if (existsSync(TEST_SKILLS_PATH)) {
      rmSync(TEST_SKILLS_PATH, { recursive: true });
    }
    if (existsSync(TEST_BUILTIN_PATH)) {
      rmSync(TEST_BUILTIN_PATH, { recursive: true });
    }
    resetSkillStore();
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

  test('skill_evals returns error for non-existent skill', async () => {
    const result = await executeSkillTool('skill_evals', { action: 'run', skill_name: 'non-existent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('skill_evals returns error when no evals defined', async () => {
    store.create({
      name: 'skill-no-evals',
      description: 'Test skill without evals',
      content: '# Test\n\nNo evals here',
    });

    const result = await executeSkillTool('skill_evals', { action: 'run', skill_name: 'skill-no-evals' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No evals defined');
  });

  test('skill_evals runs all evals successfully', async () => {
    // Create skill
    store.create({
      name: 'test-skill',
      description: 'Test skill',
      content: '# Test\n\nTest skill',
    });

    // Set evals
    await executeSkillTool('skill_evals', {
      action: 'set',
      skill_name: 'test-skill',
      evals: [
        {
          id: 1,
          name: 'basic test',
          prompt: 'Test prompt',
          expected_output: 'Expected output',
        },
        {
          id: 2,
          name: 'advanced test',
          prompt: 'Another test',
          expectations: ['Should pass validation'],
        },
      ],
    });

    // Run evals
    const result = await executeSkillTool('skill_evals', { action: 'run', skill_name: 'test-skill' });
    expect(result.success).toBe(true);
    expect((result.data as any).total_evals).toBe(2);
    expect((result.data as any).passed_count).toBe(2);
    expect((result.data as any).pass_rate).toBe(1);
    expect((result.data as any).overall_grade).toBe('A');
    expect((result.data as any).results).toHaveLength(2);
  });

  test('skill_evals runs specific eval by ID', async () => {
    store.create({
      name: 'test-skill-2',
      description: 'Test',
      content: '# Test',
    });

    await executeSkillTool('skill_evals', {
      action: 'set',
      skill_name: 'test-skill-2',
      evals: [
        { id: 1, name: 'first', prompt: 'Test 1', expected_output: 'Output 1' },
        { id: 2, name: 'second', prompt: 'Test 2', expected_output: 'Output 2' },
      ],
    });

    const result = await executeSkillTool('skill_evals', {
      action: 'run',
      skill_name: 'test-skill-2',
      eval_id: 1,
    });

    expect(result.success).toBe(true);
    expect((result.data as any).total_evals).toBe(1);
    expect((result.data as any).results[0].eval_id).toBe(1);
  });

  test('skill_evals returns error for non-existent eval ID', async () => {
    store.create({
      name: 'test-skill-3',
      description: 'Test',
      content: '# Test',
    });

    await executeSkillTool('skill_evals', {
      action: 'set',
      skill_name: 'test-skill-3',
      evals: [{ id: 1, name: 'only', prompt: 'Test', expected_output: 'Output' }],
    });

    const result = await executeSkillTool('skill_evals', {
      action: 'run',
      skill_name: 'test-skill-3',
      eval_id: 999,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('Skill Dependency Validation', () => {
  let store: SkillStore;

  beforeEach(() => {
    if (existsSync(TEST_SKILLS_PATH)) {
      rmSync(TEST_SKILLS_PATH, { recursive: true });
    }
    if (existsSync(TEST_BUILTIN_PATH)) {
      rmSync(TEST_BUILTIN_PATH, { recursive: true });
    }
    resetSkillStore();
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

  test('skill_create validates dependencies', async () => {
    // Create a dependency skill first
    store.create({
      name: 'base-skill',
      description: 'Base skill',
    });

    // Create skill that depends on existing skill - should succeed
    const result = store.create({
      name: 'dependent-skill',
      description: 'Dependent skill',
      dependsOn: ['base-skill'],
    });

    expect(result.success).toBe(true);
    const skill = store.get('dependent-skill');
    expect(skill?.dependsOn).toEqual(['base-skill']);
  });

  test('skill_create fails for missing dependencies', async () => {
    const result = store.create({
      name: 'skill-with-missing-dep',
      description: 'Skill with missing dependency',
      dependsOn: ['non-existent-skill'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Dependency validation failed');
    expect((result.data as any)?.missing_dependencies).toContain('non-existent-skill');
  });

  test('skill_get includes dependency warnings for missing deps', async () => {
    // Create skill with missing dependency using raw file operations
    store.create({
      name: 'skill-with-dep',
      description: 'Test',
      dependsOn: [], // Create without deps first
    });

    // Manually update SKILL.md to add missing dependency
    const skillPath = join(TEST_SKILLS_PATH, 'skill-with-dep');
    const skillMdPath = join(skillPath, 'SKILL.md');
    const content = readFileSync(skillMdPath, 'utf-8');
    const updatedContent = content.replace(
      'depends_on: []',
      'depends_on: [missing-skill]'
    );
    require('fs').writeFileSync(skillMdPath, updatedContent, 'utf-8');

    // Get skill should return warning
    const skill = store.get('skill-with-dep');
    expect(skill).not.toBeNull();
    expect((skill as any).dependencyWarnings).toBeDefined();
    expect((skill as any).dependencyWarnings.some((w: string) => w.includes('missing-skill'))).toBe(true);
  });

  test('skill_create validates multiple dependencies', async () => {
    // Create two dependency skills
    store.create({ name: 'dep-1', description: 'Dependency 1' });
    store.create({ name: 'dep-2', description: 'Dependency 2' });

    // Create skill with multiple valid dependencies
    const result = store.create({
      name: 'multi-dep-skill',
      description: 'Skill with multiple deps',
      dependsOn: ['dep-1', 'dep-2'],
    });

    expect(result.success).toBe(true);
    const skill = store.get('multi-dep-skill');
    expect(skill?.dependsOn).toEqual(['dep-1', 'dep-2']);
  });

  test('skill_create fails if any dependency is missing', async () => {
    store.create({ name: 'existing-dep', description: 'Exists' });

    const result = store.create({
      name: 'partial-dep-skill',
      description: 'Partial deps',
      dependsOn: ['existing-dep', 'missing-dep-1', 'missing-dep-2'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Dependency validation failed');
    expect((result.data as any)?.missing_dependencies).toContain('missing-dep-1');
    expect((result.data as any)?.missing_dependencies).toContain('missing-dep-2');
  });
});

// ============================================================================
// P2 Feature Tests
// ============================================================================

describe('P2 Features', () => {
  let store: SkillStore;

  beforeEach(() => {
    if (existsSync(TEST_SKILLS_PATH)) {
      rmSync(TEST_SKILLS_PATH, { recursive: true });
    }
    if (existsSync(TEST_BUILTIN_PATH)) {
      rmSync(TEST_BUILTIN_PATH, { recursive: true });
    }
    resetSkillStore();
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




});

