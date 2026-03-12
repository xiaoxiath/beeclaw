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

describe('Skill Evals Run', () => {
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

  test('skill_evals_run returns error for non-existent skill', () => {
    const result = executeSkillTool('skill_evals_run', { skill_name: 'non-existent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('skill_evals_run returns error when no evals defined', () => {
    executeSkillTool('skill_create', {
      name: 'skill-no-evals',
      description: 'Test skill without evals',
    });

    const result = executeSkillTool('skill_evals_run', { skill_name: 'skill-no-evals' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No evals defined');
  });

  test('skill_evals_run runs all evals successfully', () => {
    // Create skill
    executeSkillTool('skill_create', {
      name: 'test-skill',
      description: 'Test skill',
    });

    // Set evals
    executeSkillTool('skill_evals_set', {
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
    const result = executeSkillTool('skill_evals_run', { skill_name: 'test-skill' });
    expect(result.success).toBe(true);
    expect((result.data as any).total_evals).toBe(2);
    expect((result.data as any).passed_count).toBe(2);
    expect((result.data as any).pass_rate).toBe(1);
    expect((result.data as any).overall_grade).toBe('A');
    expect((result.data as any).results).toHaveLength(2);
  });

  test('skill_evals_run runs specific eval by ID', () => {
    executeSkillTool('skill_create', {
      name: 'test-skill-2',
      description: 'Test',
    });

    executeSkillTool('skill_evals_set', {
      skill_name: 'test-skill-2',
      evals: [
        { id: 1, name: 'first', prompt: 'Test 1', expected_output: 'Output 1' },
        { id: 2, name: 'second', prompt: 'Test 2', expected_output: 'Output 2' },
      ],
    });

    const result = executeSkillTool('skill_evals_run', {
      skill_name: 'test-skill-2',
      eval_id: 1,
    });

    expect(result.success).toBe(true);
    expect((result.data as any).total_evals).toBe(1);
    expect((result.data as any).results[0].eval_id).toBe(1);
  });

  test('skill_evals_run returns error for non-existent eval ID', () => {
    executeSkillTool('skill_create', {
      name: 'test-skill-3',
      description: 'Test',
    });

    executeSkillTool('skill_evals_set', {
      skill_name: 'test-skill-3',
      evals: [{ id: 1, name: 'only', prompt: 'Test', expected_output: 'Output' }],
    });

    const result = executeSkillTool('skill_evals_run', {
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

  test('skill_create validates dependencies', () => {
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

  test('skill_create fails for missing dependencies', () => {
    const result = store.create({
      name: 'skill-with-missing-dep',
      description: 'Skill with missing dependency',
      dependsOn: ['non-existent-skill'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Dependency validation failed');
    expect((result.data as any)?.missing_dependencies).toContain('non-existent-skill');
  });

  test('skill_get includes dependency warnings for missing deps', () => {
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

  test('skill_create validates multiple dependencies', () => {
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

  test('skill_create fails if any dependency is missing', () => {
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

  describe('Skill Recommendation', () => {
    test('skill_recommend returns relevant skills', () => {
      // Create test skills with clear triggers
      store.create({
        name: 'web-scraper',
        description: 'Scrape web pages',
        tags: ['web', 'http'],
        triggers: ['scrape website', 'fetch url', 'web scraping'],
      });

      store.create({
        name: 'file-reader',
        description: 'Read files from disk',
        tags: ['file', 'io'],
      });

      // Test recommendation with matching trigger
      const result = store.recommendSkills('I want to scrape website');

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations[0].name).toBe('web-scraper');
      expect(result.recommendations[0].confidence).toBeGreaterThan(0.3);
      expect(result.recommendations[0].matched_triggers).toContain('scrape website');
    });

    test('skill_recommend returns empty array when no match', () => {
      store.create({
        name: 'unrelated-skill',
        description: 'Something else',
        tags: ['other'],
      });

      const result = store.recommendSkills('I want to analyze data');

      expect(result.recommendations.length).toBe(0);
    });

    test('skill_recommend tool', () => {
      executeSkillTool('skill_create', {
        name: 'test-skill',
        description: 'Test skill',
        triggers: ['test trigger'],
      });

      const result = executeSkillTool('skill_recommend', {
        context: 'test trigger',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).recommendations).toBeDefined();
    });
  });

  describe('Performance Monitoring', () => {
    test('skill_performance returns metrics', () => {
      store.create({
        name: 'perf-test-skill',
        description: 'Test skill',
      });

      // Record some usage with execution times
      store.recordUsage('perf-test-skill', true, 1000);
      store.recordUsage('perf-test-skill', true, 1200);
      store.recordUsage('perf-test-skill', true, 1100);

      const metrics = store.getPerformanceMetrics('perf-test-skill');

      expect(metrics.total_executions).toBe(3);
      expect(metrics.avg_execution_time_ms).toBeGreaterThan(0);
      expect(metrics.min_execution_time_ms).toBe(1000);
      expect(metrics.max_execution_time_ms).toBe(1200);
    });

    test('skill_performance tool', () => {
      executeSkillTool('skill_create', {
        name: 'perf-tool-test',
        description: 'Test',
      });

      const result = executeSkillTool('skill_performance', {
        name: 'perf-tool-test',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).total_executions).toBeDefined();
    });
  });

  describe('Failure Analysis', () => {
    test('skill_analyze_failures identifies patterns', () => {
      store.create({
        name: 'failing-skill',
        description: 'Problematic skill',
        tags: ['api', 'web'],
      });

      // Record some failures
      for (let i = 0; i < 5; i++) {
        store.recordUsage('failing-skill', false);
      }
      store.recordUsage('failing-skill', true);

      const analysis = store.analyzeFailures('failing-skill');

      expect(analysis.skill_name).toBe('failing-skill');
      expect(analysis.total_failures).toBe(5);
      expect(analysis.total_uses).toBe(6);
      expect(analysis.failure_rate).toBeCloseTo(0.83, 0.01);
      expect(analysis.patterns.length).toBeGreaterThan(0);
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });

    test('skill_analyze_failures tool', () => {
      executeSkillTool('skill_create', {
        name: 'analyze-test',
        description: 'Test',
      });

      const result = executeSkillTool('skill_analyze_failures', {
        name: 'analyze-test',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).skill_name).toBe('analyze-test');
    });
  });

  describe('Import/Export', () => {
    test('skill_export creates export package', () => {
      store.create({
        name: 'export-test-skill',
        description: 'Skill to export',
        content: '# Test Skill\n\nThis is a test.',
      });

      const result = store.exportSkill('export-test-skill');

      expect(result.skill_name).toBe('export-test-skill');
      expect(result.export_path).toContain('export-test-skill');
      expect(result.files_included).toContain('SKILL.md');
      expect(result.size_bytes).toBeGreaterThan(0);
      expect(result.checksum).toBeDefined();
    });

    test('skill_export tool', () => {
      executeSkillTool('skill_create', {
        name: 'export-tool-test',
        description: 'Test',
      });

      const result = executeSkillTool('skill_export', {
        name: 'export-tool-test',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).skill_name).toBe('export-tool-test');
    });

    test('skill_import imports package', () => {
      // This would normally use a real file, but we're testing the interface
      const result = store.importSkill('/path/to/skill.tar.gz');

      expect(result.success).toBe(true);
      expect(result.skill_name).toBeDefined();
      expect(result.files_imported.length).toBeGreaterThan(0);
    });

    test('skill_import tool', () => {
      const result = executeSkillTool('skill_import', {
        file_path: '/path/to/skill.tar.gz',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).message).toContain('Successfully imported');
    });
  });
});

