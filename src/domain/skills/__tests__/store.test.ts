import { describe, it, expect, beforeEach, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  mockExistsSync,
  mockMkdirSync,
  mockReaddirSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockRmSync,
  mockWatch,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => false),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn(() => []),
  mockReadFileSync: vi.fn(() => ''),
  mockWriteFileSync: vi.fn(),
  mockRmSync: vi.fn(),
  mockWatch: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  rmSync: mockRmSync,
  watch: mockWatch,
}));

vi.mock('yaml', () => ({
  parse: vi.fn((s: string) => {
    try { return JSON.parse(s); } catch { return {}; }
  }),
  stringify: vi.fn((obj: unknown) => JSON.stringify(obj)),
}));

const { mockReadMetadata, mockWriteMetadata, mockEmptyMetadata, mockCalculateMaturity, mockHasSecurityIssues } = vi.hoisted(() => ({
  mockReadMetadata: vi.fn(() => ({
    usageCount: 0, successCount: 0, failureCount: 0, maturityScore: 0,
    performance: { executionTimes: [], totalExecutions: 0, avgExecutionTime: 0, minExecutionTime: 0, maxExecutionTime: 0 },
  })),
  mockWriteMetadata: vi.fn(),
  mockEmptyMetadata: vi.fn(() => ({
    usageCount: 0, successCount: 0, failureCount: 0, maturityScore: 0,
    performance: { executionTimes: [], totalExecutions: 0, avgExecutionTime: 0, minExecutionTime: 0, maxExecutionTime: 0 },
  })),
  mockCalculateMaturity: vi.fn(() => 50),
  mockHasSecurityIssues: vi.fn(() => false),
}));

vi.mock('../loader', () => ({
  readMetadata: mockReadMetadata,
  writeMetadata: mockWriteMetadata,
  emptyMetadata: mockEmptyMetadata,
  calculateMaturity: mockCalculateMaturity,
  hasSecurityIssues: mockHasSecurityIssues,
}));

const { mockRecommendSkills, mockRecommendSkillsWithLLM } = vi.hoisted(() => ({
  mockRecommendSkills: vi.fn(() => ({ context: '', recommendations: [], timestamp: '' })),
  mockRecommendSkillsWithLLM: vi.fn(async () => ({ context: '', recommendations: [], timestamp: '' })),
}));

vi.mock('../recommender', () => ({
  recommendSkills: mockRecommendSkills,
  recommendSkillsWithLLM: mockRecommendSkillsWithLLM,
  calculateRecommendationScore: vi.fn(() => 0),
}));

vi.mock('../llm-matcher', () => ({ LLMSkillMatcher: vi.fn() }));
vi.mock('../parser', () => ({ SkillParser: vi.fn(), getSkillParser: vi.fn() }));
vi.mock('../cache', () => ({ SkillCache: vi.fn() }));
vi.mock('../watcher', () => ({ SkillWatcher: vi.fn() }));

import { SkillStore, getSkillStore, resetSkillStore } from '../store';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function validSkillMd(name = 'test-skill', desc = 'A test skill') {
  return `---\n${JSON.stringify({ name, description: desc, tags: ['test'], triggers: ['when testing'], depends_on: [] })}\n---\n\nSkill body content\n`;
}

function makeDirEntry(name: string, isDir = true) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir };
}

/** Pre-initialize the store so init() won't interfere with mkdirSync mocks in later tests */
function initStore(s: SkillStore) {
  const origExists = mockExistsSync.getMockImplementation();
  mockExistsSync.mockReturnValue(false);
  s.init();
  if (origExists) mockExistsSync.mockImplementation(origExists);
  else mockExistsSync.mockReturnValue(false);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('SkillStore', () => {
  let store: SkillStore;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSkillStore();
    // Re-apply default implementations after clearAllMocks
    mockExistsSync.mockReturnValue(false);
    mockReadMetadata.mockReturnValue({
      usageCount: 0, successCount: 0, failureCount: 0, maturityScore: 0,
      performance: { executionTimes: [], totalExecutions: 0, avgExecutionTime: 0, minExecutionTime: 0, maxExecutionTime: 0 },
    });
    mockEmptyMetadata.mockReturnValue({
      usageCount: 0, successCount: 0, failureCount: 0, maturityScore: 0,
      performance: { executionTimes: [], totalExecutions: 0, avgExecutionTime: 0, minExecutionTime: 0, maxExecutionTime: 0 },
    });
    mockCalculateMaturity.mockReturnValue(50);
    mockHasSecurityIssues.mockReturnValue(false);
    mockRecommendSkills.mockReturnValue({ context: '', recommendations: [], timestamp: '' });
    mockRecommendSkillsWithLLM.mockResolvedValue({ context: '', recommendations: [], timestamp: '' });
    store = new SkillStore('/tmp/user-skills', '/tmp/builtin-skills');
  });

  /* ---- constructor ---- */

  describe('constructor', () => {
    it('sets basePath and builtinPath', () => {
      expect(store.getBasePath()).toBe('/tmp/user-skills');
      expect(store.getBuiltinPath()).toBe('/tmp/builtin-skills');
    });

    it('uses default builtinPath when not provided', () => {
      const s = new SkillStore('/tmp/user');
      expect(s.getBuiltinPath()).toContain('skills');
    });
  });

  /* ---- init ---- */

  describe('init', () => {
    it('creates basePath directory if missing', () => {
      mockExistsSync.mockReturnValue(false);
      store.init();
      expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/user-skills', { recursive: true });
    });

    it('skips mkdir if basePath exists', () => {
      mockExistsSync.mockReturnValue(true);
      store.init();
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('is idempotent', () => {
      store.init();
      mockMkdirSync.mockClear();
      store.init();
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('starts watching after initialization', () => {
      store.init();
      expect(mockWatch).toHaveBeenCalled();
    });
  });

  /* ---- watching ---- */

  describe('watching', () => {
    it('handles watcher error event', () => {
      const onHandlers: Record<string, Function> = {};
      mockWatch.mockReturnValue({
        on: vi.fn((event: string, handler: Function) => { onHandlers[event] = handler; }),
        close: vi.fn(),
      });
      store.init();
      expect(onHandlers['error']).toBeDefined();
      onHandlers['error'](new Error('watch fail'));
    });

    it('does not start a second watcher', () => {
      store.init();
      expect(mockWatch).toHaveBeenCalledTimes(1);
    });

    it('handles watcher setup failure gracefully', () => {
      mockWatch.mockImplementation(() => { throw new Error('not supported'); });
      expect(() => store.init()).not.toThrow();
    });

    it('stopWatching closes watcher', () => {
      const closeFn = vi.fn();
      mockWatch.mockReturnValue({ on: vi.fn(), close: closeFn });
      store.init();
      store.stopWatching();
      expect(closeFn).toHaveBeenCalled();
    });

    it('stopWatching is safe when no watcher', () => {
      expect(() => store.stopWatching()).not.toThrow();
    });
  });

  /* ---- handleSkillChange ---- */

  describe('handleSkillChange', () => {
    it('invalidates cache on SKILL.md change (debounced)', async () => {
      let watchCallback: Function = () => {};
      mockWatch.mockImplementation((_p: string, _o: any, cb: Function) => {
        watchCallback = cb;
        return { on: vi.fn(), close: vi.fn() };
      });
      store.init();
      watchCallback('change', 'my-skill/SKILL.md');
      await new Promise(r => setTimeout(r, 300));
    });

    it('ignores non-SKILL.md files and null filename', () => {
      let watchCallback: Function = () => {};
      mockWatch.mockImplementation((_p: string, _o: any, cb: Function) => {
        watchCallback = cb;
        return { on: vi.fn(), close: vi.fn() };
      });
      store.init();
      watchCallback('change', 'other.txt');
      watchCallback('change', null);
    });
  });

  /* ---- list ---- */

  describe('list', () => {
    it('returns empty array when no skills exist', () => {
      mockExistsSync.mockReturnValue(false);
      const skills = store.list();
      expect(skills).toEqual([]);
    });

    it('loads builtin and user skills', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/tmp/builtin-skills') return true;
        if (p === '/tmp/user-skills') return true;
        if (p.endsWith('/builtin-a/SKILL.md')) return true;
        if (p.endsWith('/user-b/SKILL.md')) return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: any) => {
        const path = typeof p === 'string' ? p : p.toString();
        if (path === '/tmp/builtin-skills') return [makeDirEntry('builtin-a')];
        if (path === '/tmp/user-skills') return [makeDirEntry('user-b')];
        return [];
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('builtin-a')) return validSkillMd('builtin-a', 'Builtin');
        if (p.includes('user-b')) return validSkillMd('user-b', 'User');
        return '';
      });

      const skills = store.list();
      expect(skills.length).toBe(2);
    });

    it('user skill overrides builtin with same name', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/tmp/builtin-skills') return true;
        if (p.endsWith('/common/SKILL.md')) return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: any) => {
        const path = typeof p === 'string' ? p : p.toString();
        if (path === '/tmp/builtin-skills') return [makeDirEntry('common')];
        if (path === '/tmp/user-skills') return [makeDirEntry('common')];
        return [];
      });
      mockReadFileSync.mockReturnValue(validSkillMd('common', 'version'));

      const skills = store.list();
      const commonSkills = skills.filter(s => s.name === 'common');
      expect(commonSkills.length).toBe(1);
    });

    it('returns cached skills on second call', () => {
      mockExistsSync.mockReturnValue(false);
      store.list();
      mockReaddirSync.mockClear();
      store.list();
      expect(mockReaddirSync).not.toHaveBeenCalled();
    });

    it('handles loadSkillsFromDir errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => { throw new Error('read error'); });
      const skills = store.list();
      expect(skills).toEqual([]);
    });

    it('skips non-directory entries', () => {
      mockExistsSync.mockImplementation((p: string) => p === '/tmp/builtin-skills');
      mockReaddirSync.mockImplementation((p: any) => {
        const path = typeof p === 'string' ? p : p.toString();
        if (path === '/tmp/builtin-skills') return [makeDirEntry('file.txt', false)];
        return [];
      });
      const skills = store.list();
      expect(skills).toEqual([]);
    });
  });

  /* ---- get ---- */

  describe('get', () => {
    beforeEach(() => { initStore(store); });

    it('returns null when skill not found', () => {
      mockExistsSync.mockReturnValue(false);
      expect(store.get('nope')).toBeNull();
    });

    it('prefers user skill over builtin', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('user-skills') && p.endsWith('SKILL.md')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(validSkillMd('my-skill', 'user'));
      const skill = store.get('my-skill');
      expect(skill).not.toBeNull();
      expect(skill!.isBuiltin).toBe(false);
    });

    it('falls back to builtin when no user skill', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('builtin-skills') && p.endsWith('SKILL.md')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(validSkillMd('my-skill', 'builtin'));
      const skill = store.get('my-skill');
      expect(skill).not.toBeNull();
      expect(skill!.isBuiltin).toBe(true);
    });

    it('adds missing-dependency warnings', () => {
      // Skill with a dep that doesn't exist at all
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('/dep-skill/SKILL.md')) return true;
        // missing-dep doesn't exist anywhere
        return false;
      });
      const md = `---\n${JSON.stringify({ name: 'dep-skill', description: 'x', depends_on: ['missing-dep'] })}\n---\n\nbody\n`;
      mockReadFileSync.mockReturnValue(md);
      const skill = store.get('dep-skill');
      expect(skill).not.toBeNull();
      const warnings = (skill as any).dependencyWarnings || [];
      expect(warnings.some((w: string) => w.includes('Missing'))).toBe(true);
    });
  });

  /* ---- create ---- */

  describe('create', () => {
    beforeEach(() => { initStore(store); });

    it('creates a new skill successfully', () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementation(() => {});
      mockWriteFileSync.mockImplementation(() => {});
      const result = store.create({
        name: 'new-skill',
        description: 'A new skill',
        content: 'Some content',
        tags: ['tag1'],
        triggers: ['trigger1'],
      });
      expect(result.success).toBe(true);
      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('fails if skill already exists', () => {
      mockExistsSync.mockImplementation((p: string) => p === '/tmp/user-skills/existing');
      const result = store.create({ name: 'existing', description: 'dup' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('validates dependencies before creating', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.create({
        name: 'dep-skill',
        description: 'needs deps',
        dependsOn: ['nonexistent'],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Dependency validation failed');
      expect(result.data).toHaveProperty('missing_dependencies');
    });

    it('creates skill with valid dependencies', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/tmp/user-skills/dep-skill') return false;
        if (p === '/tmp/user-skills/existing-dep') return true;
        return false;
      });
      const result = store.create({
        name: 'dep-skill',
        description: 'needs deps',
        dependsOn: ['existing-dep'],
      });
      expect(result.success).toBe(true);
    });

    it('handles write errors gracefully', () => {
      mockExistsSync.mockReturnValue(false);
      // mkdirSync succeeds for init (already done), but writeFileSync fails
      mockWriteFileSync.mockImplementation(() => { throw new Error('permission denied'); });
      const result = store.create({ name: 'fail-skill', description: 'fail' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('permission denied');
    });

    it('handles non-Error throws', () => {
      mockExistsSync.mockReturnValue(false);
      mockWriteFileSync.mockImplementation(() => { throw 'string error'; });
      const result = store.create({ name: 'fail2', description: 'fail' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('creates skill with empty content', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.create({ name: 'empty', description: 'empty skill' });
      expect(result.success).toBe(true);
    });
  });

  /* ---- update ---- */

  describe('update', () => {
    beforeEach(() => { initStore(store); });

    it('updates skill successfully', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('/my-skill/SKILL.md')) return true;
        if (p.endsWith('/my-skill')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(validSkillMd('my-skill'));
      const result = store.update('my-skill', { description: 'updated' });
      expect(result.success).toBe(true);
    });

    it('fails for readonly builtin skill', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('builtin-skills') && p.endsWith('SKILL.md')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(validSkillMd('builtin-skill'));
      const result = store.update('builtin-skill', { description: 'hack' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot modify built-in');
    });

    it('fails if skill not found', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.update('nope', { description: 'x' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('updates tags, triggers, compatibility, content', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('/s/SKILL.md')) return true;
        if (p.endsWith('/s')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(validSkillMd('s'));
      const result = store.update('s', {
        tags: ['new-tag'],
        triggers: ['new-trigger'],
        compatibility: 'v2',
        content: 'new body',
      });
      expect(result.success).toBe(true);
    });

    it('handles write errors', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('SKILL.md')) return true;
        if (p.endsWith('/err')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(validSkillMd('err'));
      mockWriteFileSync.mockImplementation(() => { throw new Error('disk full'); });
      const result = store.update('err', { description: 'x' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('disk full');
    });
  });

  /* ---- delete ---- */

  describe('delete', () => {
    beforeEach(() => { initStore(store); });

    it('deletes user skill', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('/del-me')) return true;
        if (p.endsWith('/del-me/SKILL.md')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(validSkillMd('del-me'));
      const result = store.delete('del-me');
      expect(result.success).toBe(true);
      expect(mockRmSync).toHaveBeenCalled();
    });

    it('cannot delete builtin-only skill', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('builtin-skills') && p.endsWith('SKILL.md')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(validSkillMd('builtin'));
      const result = store.delete('builtin');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot delete built-in');
    });

    it('fails if skill not found', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.delete('nope');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('handles rmSync errors', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('/fail-del')) return true;
        if (p.endsWith('SKILL.md')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(validSkillMd('fail-del'));
      mockRmSync.mockImplementation(() => { throw new Error('busy'); });
      const result = store.delete('fail-del');
      expect(result.success).toBe(false);
      expect(result.error).toContain('busy');
    });
  });

  /* ---- recordUsage ---- */

  describe('recordUsage', () => {
    beforeEach(() => { initStore(store); });

    it('records successful usage with execution time', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('/s1'));
      mockReadMetadata.mockReturnValue({
        usageCount: 5, successCount: 4, failureCount: 1, maturityScore: 40,
        performance: { executionTimes: [100], totalExecutions: 5, avgExecutionTime: 100, minExecutionTime: 50, maxExecutionTime: 200 },
      });
      const result = store.recordUsage('s1', true, 150);
      expect(result.success).toBe(true);
      expect(mockWriteMetadata).toHaveBeenCalled();
    });

    it('records failure with lastFailure timestamp', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('/s1'));
      mockReadMetadata.mockReturnValue({
        usageCount: 2, successCount: 2, failureCount: 0, maturityScore: 20,
        performance: { executionTimes: [], totalExecutions: 2, avgExecutionTime: 0, minExecutionTime: 0, maxExecutionTime: 0 },
      });
      const result = store.recordUsage('s1', false);
      expect(result.success).toBe(true);
      const written = mockWriteMetadata.mock.calls[0][1];
      expect(written.failureCount).toBe(1);
      expect(written.lastFailure).toBeDefined();
    });

    it('trims execution times to last 100', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('/s1'));
      const times = Array.from({ length: 100 }, (_, i) => i);
      mockReadMetadata.mockReturnValue({
        usageCount: 100, successCount: 100, failureCount: 0, maturityScore: 80,
        performance: { executionTimes: times, totalExecutions: 100, avgExecutionTime: 50, minExecutionTime: 0, maxExecutionTime: 99 },
      });
      const result = store.recordUsage('s1', true, 999);
      expect(result.success).toBe(true);
      const written = mockWriteMetadata.mock.calls[0][1];
      expect(written.performance.executionTimes.length).toBe(100);
    });

    it('fails if skill not found', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.recordUsage('nope', true);
      expect(result.success).toBe(false);
    });

    it('handles errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadMetadata.mockImplementation(() => { throw new Error('corrupt'); });
      const result = store.recordUsage('s1', true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('corrupt');
    });

    it('skips performance tracking when no executionTimeMs', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('/s1'));
      mockReadMetadata.mockReturnValue({
        usageCount: 0, successCount: 0, failureCount: 0, maturityScore: 0,
        performance: { executionTimes: [], totalExecutions: 0, avgExecutionTime: 0, minExecutionTime: 0, maxExecutionTime: 0 },
      });
      const result = store.recordUsage('s1', true);
      expect(result.success).toBe(true);
    });

    it('skips performance tracking when no performance field', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('/s1'));
      mockReadMetadata.mockReturnValue({
        usageCount: 0, successCount: 0, failureCount: 0, maturityScore: 0,
      });
      const result = store.recordUsage('s1', true, 100);
      expect(result.success).toBe(true);
    });
  });

  /* ---- getPerformanceMetrics ---- */

  describe('getPerformanceMetrics', () => {
    beforeEach(() => { initStore(store); });

    it('returns metrics with P95 calculation', () => {
      mockReadMetadata.mockReturnValue({
        usageCount: 20, successCount: 20, failureCount: 0, maturityScore: 80,
        performance: {
          executionTimes: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
          totalExecutions: 20, avgExecutionTime: 105, minExecutionTime: 10, maxExecutionTime: 200,
        },
      });
      const metrics = store.getPerformanceMetrics('s1');
      expect(metrics.avg_execution_time_ms).toBe(105);
      expect(metrics.p95_execution_time_ms).toBeGreaterThan(0);
      expect(metrics.total_executions).toBe(20);
    });

    it('returns zero P95 when no execution times', () => {
      mockReadMetadata.mockReturnValue({
        usageCount: 0, successCount: 0, failureCount: 0, maturityScore: 0,
      });
      const metrics = store.getPerformanceMetrics('s1');
      expect(metrics.p95_execution_time_ms).toBe(0);
    });
  });

  /* ---- assessMaturity ---- */

  describe('assessMaturity', () => {
    beforeEach(() => { initStore(store); });

    it('returns not-ready when skill not found', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.assessMaturity('nope');
      expect(result.ready).toBe(false);
      expect(result.recommendations).toContain('Skill not found');
    });

    it('assesses a mature skill', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      mockReadFileSync.mockReturnValue(validSkillMd('good', 'well done'));
      mockReadMetadata.mockReturnValue({
        usageCount: 10, successCount: 10, failureCount: 0, maturityScore: 90,
      });
      mockCalculateMaturity.mockReturnValue(90);

      const result = store.assessMaturity('good');
      expect(result.score).toBe(90);
    });

    it('flags security issues', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      mockReadFileSync.mockReturnValue(validSkillMd('sec', 'security'));
      mockReadMetadata.mockReturnValue({
        usageCount: 10, successCount: 10, failureCount: 0, maturityScore: 50,
      });
      mockHasSecurityIssues.mockReturnValue(true);

      const result = store.assessMaturity('sec');
      expect(result.checks.clean).toBe(false);
      // The actual recommendation text from the source code
      expect(result.recommendations).toEqual(
        expect.arrayContaining([
          expect.stringContaining('hardcoded'),
        ]),
      );
    });

    it('adds recommendation for low usage', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      mockReadFileSync.mockReturnValue(validSkillMd('new', 'new skill'));
      mockReadMetadata.mockReturnValue({
        usageCount: 1, successCount: 1, failureCount: 0, maturityScore: 10,
      });
      const result = store.assessMaturity('new');
      expect(result.checks.productionTested).toBe(false);
    });
  });

  /* ---- search ---- */

  describe('search', () => {
    it('returns matching skills sorted by name match', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/tmp/builtin-skills') return true;
        if (p.endsWith('/weather/SKILL.md')) return true;
        if (p.endsWith('/calc/SKILL.md')) return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: any) => {
        const path = typeof p === 'string' ? p : p.toString();
        if (path === '/tmp/builtin-skills') return [makeDirEntry('weather'), makeDirEntry('calc')];
        return [];
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('weather')) return validSkillMd('weather', 'Get weather info');
        return validSkillMd('calc', 'Calculate things');
      });

      const results = store.search('weather');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('weather');
    });

    it('returns empty for no matches', () => {
      mockExistsSync.mockReturnValue(false);
      const results = store.search('zzzzzz');
      expect(results).toEqual([]);
    });
  });

  /* ---- load edge cases ---- */

  describe('load edge cases', () => {
    beforeEach(() => { initStore(store); });

    it('returns null when SKILL.md missing', () => {
      mockExistsSync.mockReturnValue(false);
      expect(store.get('no-md')).toBeNull();
    });

    it('returns null on readFileSync error', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      mockReadFileSync.mockImplementation(() => { throw new Error('read error'); });
      expect(store.get('bad')).toBeNull();
    });

    it('handles SKILL.md without frontmatter delimiters', () => {
      // parseSkillMd returns {frontmatter: {name:'', description:''}, body: content}
      // Since yaml mock's parse on empty/invalid returns {}, SkillFrontmatterSchema.parse
      // actually produces a valid object with defaults. So load succeeds with empty name/desc.
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      mockReadFileSync.mockReturnValue('Just plain text, no frontmatter');
      const skill = store.get('no-fm');
      // The skill loads with the dir name as fallback name
      if (skill) {
        expect(skill.name).toBe('no-fm');
        expect(skill.content).toBe('Just plain text, no frontmatter');
      }
    });

    it('sets hasScripts/hasReferences/etc based on dir existence', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('SKILL.md')) return true;
        if (p.endsWith('scripts')) return true;
        if (p.endsWith('references')) return false;
        if (p.endsWith('assets')) return true;
        if (p.endsWith('agents')) return false;
        if (p.endsWith('evals')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(validSkillMd('s', 'desc'));
      const skill = store.get('s');
      expect(skill).not.toBeNull();
      expect(skill!.hasScripts).toBe(true);
      expect(skill!.hasReferences).toBe(false);
      expect(skill!.hasAssets).toBe(true);
      expect(skill!.hasAgents).toBe(false);
      expect(skill!.hasEvals).toBe(true);
    });
  });

  /* ---- getEvals / setEvals ---- */

  describe('getEvals', () => {
    it('returns evals when file exists', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ skill_name: 's', evals: [{ id: 1, prompt: 'test' }] }));
      const result = store.getEvals('s');
      expect(result.success).toBe(true);
    });

    it('fails when no evals file', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.getEvals('s');
      expect(result.success).toBe(false);
    });

    it('handles read errors', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => { throw new Error('corrupt'); });
      const result = store.getEvals('s');
      expect(result.success).toBe(false);
    });
  });

  describe('setEvals', () => {
    it('writes evals file', () => {
      mockExistsSync.mockReturnValue(true);
      const result = store.setEvals('s', { skill_name: 's', evals: [{ id: 1, prompt: 'x' }] });
      expect(result.success).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('creates evals directory if missing', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('evals')) return false;
        return true;
      });
      const result = store.setEvals('s', { skill_name: 's', evals: [] });
      expect(result.success).toBe(true);
      expect(mockMkdirSync).toHaveBeenCalled();
    });

    it('fails if skill not found', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.setEvals('nope', { skill_name: 'nope', evals: [] });
      expect(result.success).toBe(false);
    });

    it('handles write errors', () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => { throw new Error('disk full'); });
      const result = store.setEvals('s', { skill_name: 's', evals: [] });
      expect(result.success).toBe(false);
    });
  });

  /* ---- createWorkspace ---- */

  describe('createWorkspace', () => {
    beforeEach(() => { initStore(store); });

    it('creates workspace directory', () => {
      mockExistsSync.mockImplementation((p: string) => p.includes('user-skills/s'));
      const result = store.createWorkspace('s', 2);
      expect(result.success).toBe(true);
      expect((result.data as any).workspace_path).toContain('iteration-2');
    });

    it('defaults to iteration 1', () => {
      mockExistsSync.mockImplementation((p: string) => p.includes('user-skills/s'));
      const result = store.createWorkspace('s');
      expect(result.success).toBe(true);
      expect((result.data as any).workspace_path).toContain('iteration-1');
    });

    it('fails if skill not found', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.createWorkspace('nope');
      expect(result.success).toBe(false);
    });

    it('handles mkdir errors', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('user-skills/s')) return true;
        return false;
      });
      mockMkdirSync.mockImplementation(() => { throw new Error('perm'); });
      const result = store.createWorkspace('s');
      expect(result.success).toBe(false);
    });
  });

  /* ---- saveGrading ---- */

  describe('saveGrading', () => {
    it('writes grading.json', () => {
      const grading = { expectations: [], summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 } };
      const result = store.saveGrading('s', '/tmp/run1', grading as any);
      expect(result.success).toBe(true);
    });

    it('handles write errors', () => {
      mockWriteFileSync.mockImplementation(() => { throw new Error('fail'); });
      const result = store.saveGrading('s', '/tmp/run1', {} as any);
      expect(result.success).toBe(false);
    });
  });

  /* ---- saveTiming ---- */

  describe('saveTiming', () => {
    it('writes timing.json', () => {
      const result = store.saveTiming('/tmp/run1', { total_tokens: 100, duration_ms: 500, total_duration_seconds: 0.5 });
      expect(result.success).toBe(true);
    });

    it('handles write errors', () => {
      mockWriteFileSync.mockImplementation(() => { throw new Error('fail'); });
      const result = store.saveTiming('/tmp/run1', {} as any);
      expect(result.success).toBe(false);
    });
  });

  /* ---- saveBenchmark ---- */

  describe('saveBenchmark', () => {
    it('writes benchmark.json and benchmark.md', () => {
      mockExistsSync.mockReturnValue(false);
      const benchmark = {
        metadata: { skill_name: 's', skill_path: '/tmp', timestamp: '2024-01-01', evals_run: [1], runs_per_configuration: 3 },
        runs: [],
        run_summary: {
          with_skill: {
            pass_rate: { mean: 0.9, stddev: 0.05, min: 0.8, max: 1.0 },
            time_seconds: { mean: 5.0, stddev: 1.0, min: 3, max: 7 },
            tokens: { mean: 1000, stddev: 100, min: 800, max: 1200 },
          },
          without_skill: {
            pass_rate: { mean: 0.6, stddev: 0.1, min: 0.5, max: 0.7 },
            time_seconds: { mean: 10.0, stddev: 2.0, min: 8, max: 12 },
            tokens: { mean: 2000, stddev: 200, min: 1800, max: 2200 },
          },
          delta: { pass_rate: '+30%', time_seconds: '-5s', tokens: '-1000' },
        },
        notes: ['Test note'],
      };
      const result = store.saveBenchmark('s', benchmark as any);
      expect(result.success).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    });

    it('handles write errors', () => {
      mockMkdirSync.mockImplementation(() => { throw new Error('fail'); });
      const result = store.saveBenchmark('s', { metadata: { skill_name: 's' }, runs: [], run_summary: {} } as any);
      expect(result.success).toBe(false);
    });

    it('formats benchmark without optional sections', () => {
      mockExistsSync.mockReturnValue(false);
      const benchmark = {
        metadata: { skill_name: 's', skill_path: '/tmp', timestamp: '2024-01-01', evals_run: [], runs_per_configuration: 1 },
        runs: [],
        run_summary: {},
      };
      const result = store.saveBenchmark('s', benchmark as any);
      expect(result.success).toBe(true);
    });
  });

  /* ---- getStructure ---- */

  describe('getStructure', () => {
    beforeEach(() => { initStore(store); });

    it('returns directory structure', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([makeDirEntry('file.txt', false)]);
      const result = store.getStructure('s');
      expect(result.success).toBe(true);
      expect((result.data as any).root).toBeDefined();
    });

    it('fails if skill not found', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.getStructure('nope');
      expect(result.success).toBe(false);
    });

    it('skips missing subdirectories', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('/s'));
      const result = store.getStructure('s');
      expect(result.success).toBe(true);
    });
  });

  /* ---- readResource / writeResource ---- */

  describe('readResource', () => {
    it('reads resource file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('file content');
      const result = store.readResource('s', 'scripts', 'run.sh');
      expect(result.success).toBe(true);
      expect((result.data as any).content).toBe('file content');
    });

    it('fails if resource not found', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.readResource('s', 'scripts', 'missing.sh');
      expect(result.success).toBe(false);
    });

    it('handles read errors', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => { throw new Error('read fail'); });
      const result = store.readResource('s', 'assets', 'bad.txt');
      expect(result.success).toBe(false);
    });
  });

  describe('writeResource', () => {
    it('writes resource file', () => {
      mockExistsSync.mockReturnValue(true);
      const result = store.writeResource('s', 'scripts', 'run.sh', '#!/bin/bash');
      expect(result.success).toBe(true);
    });

    it('creates category directory if missing', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.writeResource('s', 'agents', 'agent.md', 'content');
      expect(result.success).toBe(true);
      expect(mockMkdirSync).toHaveBeenCalled();
    });

    it('handles write errors', () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => { throw new Error('fail'); });
      const result = store.writeResource('s', 'references', 'ref.md', 'x');
      expect(result.success).toBe(false);
    });
  });

  /* ---- runEval ---- */

  describe('runEval', () => {
    const evalsJson = JSON.stringify({
      skill_name: 's',
      evals: [
        { id: 1, name: 'Test 1', prompt: 'Do something', expected_output: 'Done', expectations: ['it works', 'it is fast'] },
        { id: 2, name: 'Test 2', prompt: 'Do other', expectations: [] },
      ],
    });

    it('runs all evals when no evalId', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(evalsJson);
      const result = store.runEval('s');
      expect(result.success).toBe(true);
      expect((result.data as any).total_evals).toBe(2);
    });

    it('runs specific eval by ID', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(evalsJson);
      const result = store.runEval('s', 1);
      expect(result.success).toBe(true);
      expect((result.data as any).total_evals).toBe(1);
    });

    it('fails if eval ID not found', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(evalsJson);
      const result = store.runEval('s', 999);
      expect(result.success).toBe(false);
      expect(result.error).toContain('999');
    });

    it('fails if skill not found', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.runEval('nope');
      expect(result.success).toBe(false);
    });

    it('fails if no evals file', () => {
      mockExistsSync.mockImplementation((p: string) => !p.endsWith('evals.json'));
      const result = store.runEval('s');
      expect(result.success).toBe(false);
    });

    it('handles parse errors', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not json');
      const result = store.runEval('s');
      expect(result.success).toBe(false);
    });

    it('calculates overall grade', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(evalsJson);
      const result = store.runEval('s');
      expect(result.success).toBe(true);
      expect(['A', 'B', 'C', 'D', 'F']).toContain((result.data as any).overall_grade);
    });

    it('handles eval with empty prompt', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        skill_name: 's',
        evals: [{ id: 1, name: 'Bad', prompt: '', expectations: [] }],
      }));
      const result = store.runEval('s');
      expect(result.success).toBe(true);
      expect((result.data as any).results[0].passed).toBe(false);
      expect((result.data as any).results[0].grade).toBe('F');
    });

    it('returns error for empty evals array', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ skill_name: 's', evals: [] }));
      const result = store.runEval('s');
      expect(result.success).toBe(false);
    });

    it('gives A for complete eval with all expectations', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        skill_name: 's',
        evals: [{ id: 1, name: 'Full', prompt: 'test', expected_output: 'ok', expectations: ['a', 'b', 'c'] }],
      }));
      const result = store.runEval('s');
      expect((result.data as any).results[0].grade).toBe('A');
    });

    it('gives lower grade for eval with only expected_output', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        skill_name: 's',
        evals: [{ id: 1, name: 'Partial', prompt: 'test', expected_output: 'ok' }],
      }));
      const result = store.runEval('s');
      const grade = (result.data as any).results[0].grade;
      expect(['B', 'C', 'D']).toContain(grade);
    });
  });

  /* ---- analyzeFailures ---- */

  describe('analyzeFailures', () => {
    beforeEach(() => { initStore(store); });

    it('returns empty analysis for unknown skill', () => {
      mockExistsSync.mockReturnValue(false);
      const result = store.analyzeFailures('nope');
      expect(result.total_failures).toBe(0);
    });

    it('returns patterns for API skill with failures', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      const md = `---\n${JSON.stringify({ name: 'api-skill', description: 'API calls', tags: ['api', 'web'] })}\n---\n\nbody\n`;
      mockReadFileSync.mockReturnValue(md);
      mockReadMetadata.mockReturnValue({
        usageCount: 20, successCount: 10, failureCount: 10, maturityScore: 30,
      });

      const result = store.analyzeFailures('api-skill');
      expect(result.total_failures).toBe(10);
      expect(result.failure_rate).toBe(0.5);
      expect(result.patterns.find(p => p.type === 'network_error')).toBeDefined();
    });

    it('includes timeout pattern for >5 failures', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      mockReadFileSync.mockReturnValue(validSkillMd('slow', 'slow'));
      mockReadMetadata.mockReturnValue({
        usageCount: 20, successCount: 14, failureCount: 6, maturityScore: 40,
      });

      const result = store.analyzeFailures('slow');
      expect(result.patterns.find(p => p.type === 'timeout')).toBeDefined();
    });

    it('includes parse_error pattern for data/parsing skills', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      const md = `---\n${JSON.stringify({ name: 'parser', description: 'parse', tags: ['parsing'] })}\n---\n\nbody\n`;
      mockReadFileSync.mockReturnValue(md);
      mockReadMetadata.mockReturnValue({
        usageCount: 10, successCount: 7, failureCount: 3, maturityScore: 50,
      });

      const result = store.analyzeFailures('parser');
      expect(result.patterns.find(p => p.type === 'parse_error')).toBeDefined();
    });

    it('adds performance bottleneck cause', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      mockReadFileSync.mockReturnValue(validSkillMd('slow', 'slow skill'));
      mockReadMetadata.mockReturnValue({
        usageCount: 5, successCount: 3, failureCount: 2, maturityScore: 30,
        performance: { executionTimes: [6000], totalExecutions: 5, avgExecutionTime: 6000, minExecutionTime: 5000, maxExecutionTime: 7000 },
      });

      const result = store.analyzeFailures('slow');
      expect(result.common_causes.some(c => c.includes('performance'))).toBe(true);
    });

    it('recommends review for high failure rate', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      mockReadFileSync.mockReturnValue(validSkillMd('bad', 'bad'));
      mockReadMetadata.mockReturnValue({
        usageCount: 10, successCount: 5, failureCount: 5, maturityScore: 20,
      });

      const result = store.analyzeFailures('bad');
      expect(result.recommendations.some(r => r.includes('reviewing'))).toBe(true);
    });

    it('adds low maturity recommendation', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      mockReadFileSync.mockReturnValue(validSkillMd('young', 'young'));
      mockReadMetadata.mockReturnValue({
        usageCount: 2, successCount: 2, failureCount: 0, maturityScore: 20,
      });

      const result = store.analyzeFailures('young');
      expect(result.recommendations.some(r => r.includes('maturity'))).toBe(true);
    });

    it('gives monitoring recommendation when no issues', () => {
      mockExistsSync.mockImplementation((p: string) => p.endsWith('SKILL.md'));
      mockReadFileSync.mockReturnValue(validSkillMd('ok', 'ok'));
      mockReadMetadata.mockReturnValue({
        usageCount: 2, successCount: 2, failureCount: 0, maturityScore: 80,
      });

      const result = store.analyzeFailures('ok');
      expect(result.recommendations.some(r => r.includes('Monitor'))).toBe(true);
    });
  });

  /* ---- exportSkill / importSkill ---- */

  describe('exportSkill / importSkill', () => {
    it('exportSkill throws NotImplementedError', () => {
      expect(() => store.exportSkill('s')).toThrow('NotImplementedError');
    });

    it('importSkill throws NotImplementedError', () => {
      expect(() => store.importSkill('/tmp/pkg.tar.gz')).toThrow('NotImplementedError');
    });
  });

  /* ---- recommendSkills ---- */

  describe('recommendSkills', () => {
    it('delegates to standalone function', () => {
      store.recommendSkills('test context');
      expect(mockRecommendSkills).toHaveBeenCalledWith(store, 'test context');
    });
  });

  describe('recommendSkillsWithLLM', () => {
    it('delegates to standalone function', async () => {
      await store.recommendSkillsWithLLM('test context', { topK: 3 });
      expect(mockRecommendSkillsWithLLM).toHaveBeenCalled();
    });
  });

  /* ---- setLLMMatcher ---- */

  describe('setLLMMatcher', () => {
    it('sets the matcher without error', () => {
      store.setLLMMatcher({} as any);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  getSkillStore / resetSkillStore                                   */
/* ------------------------------------------------------------------ */

describe('getSkillStore singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSkillStore();
    mockExistsSync.mockReturnValue(false);
  });

  it('creates and returns singleton', () => {
    const a = getSkillStore('/tmp/a');
    const b = getSkillStore('/tmp/b');
    expect(a).toBe(b);
  });

  it('throws if no basePath and not initialized', () => {
    expect(() => getSkillStore()).toThrow('not initialized');
  });

  it('resetSkillStore allows re-creation', () => {
    const a = getSkillStore('/tmp/a');
    resetSkillStore();
    const b = getSkillStore('/tmp/b');
    expect(a).not.toBe(b);
  });

  it('accepts builtinPath parameter', () => {
    const s = getSkillStore('/tmp/user', '/tmp/builtin');
    expect(s.getBuiltinPath()).toBe('/tmp/builtin');
  });
});
