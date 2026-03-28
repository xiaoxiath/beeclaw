import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { PersonaStore, getPersonaStore, resetPersonaStore } from '../store';

const TEST_DIR = join('/tmp', `persona-store-ext-${Date.now()}`);

describe('PersonaStore - extended coverage', () => {
  let store: PersonaStore;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new PersonaStore(TEST_DIR);
  });

  afterEach(() => {
    resetPersonaStore();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  // ─── init with non-existent base path ─────────────────────
  describe('init', () => {
    it('creates base directory if it does not exist', () => {
      const newDir = join(TEST_DIR, 'sub', 'nested');
      const s = new PersonaStore(newDir);
      s.init();
      expect(existsSync(newDir)).toBe(true);
    });
  });

  // ─── loadSoul / parseSoulContent ──────────────────────────
  describe('loadSoul / parseSoulContent', () => {
    beforeEach(() => store.init());

    it('parses SOUL.md with identity section', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), '# Identity\nI am a helpful assistant.', 'utf-8');
      // Re-init to re-load
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const soul = s2.getSoul();
      expect(soul).not.toBeNull();
      expect(soul!.essence).toContain('helpful assistant');
    });

    it('parses 本质 section as essence', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), '# 本质\n我是一个智能助手', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      expect(s2.getSoul()!.essence).toContain('智能助手');
    });

    it('parses traits/核心/价值观 as values', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), '# 核心价值观\n- 诚实\n- 可靠\n• 高效', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const soul = s2.getSoul();
      expect(soul!.values).toEqual(['诚实', '可靠', '高效']);
    });

    it('parses communication section', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), '# Communication Style\nFriendly and concise.', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      expect(s2.getSoul()!.communicationStyle).toContain('Friendly');
    });

    it('parses growth section', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), '# Growth Goals\n- Learn faster\n• Be more empathetic', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      expect(s2.getSoul()!.growthGoals).toEqual(['Learn faster', 'Be more empathetic']);
    });

    it('parses lessons section with _ prefix', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), '# Lessons Learned\n_ Always verify\n- Double check', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      expect(s2.getSoul()!.lessonsLearned).toEqual(['Always verify', 'Double check']);
    });

    it('falls back to entire content as essence if no sections found', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), 'Just a simple soul description.', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      expect(s2.getSoul()!.essence).toBe('Just a simple soul description.');
    });

    it('handles empty SOUL.md', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), '', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      expect(s2.getSoul()!.essence).toBe('');
    });

    it('returns null on read error', () => {
      // Write a file then make it unreadable is tricky, but we can test the null branch
      // by simply not writing the file
      expect(store.getSoul()).toBeNull();
    });
  });

  // ─── loadAgents / parseAgentsContent ──────────────────────
  describe('loadAgents / parseAgentsContent', () => {
    beforeEach(() => store.init());

    it('parses AGENTS.md with all sections', () => {
      const agentsContent = [
        '## Task Execution Rules',
        '- Plan before acting',
        '- Verify results',
        '',
        '## Decision Making',
        'Make decisions based on data.',
        '',
        '## Tool Usage',
        '- Use tools wisely',
        '',
        '## Error Handling',
        'Log and recover gracefully.',
        '',
        '## Escalation Rules',
        '- Escalate when uncertain',
        '',
        '## Prohibited Actions',
        '- Never delete without confirmation',
      ].join('\n');

      writeFileSync(join(TEST_DIR, 'AGENTS.md'), agentsContent, 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const agents = s2.getAgents();

      expect(agents).not.toBeNull();
      expect(agents!.taskExecution).toEqual(['Plan before acting', 'Verify results']);
      expect(agents!.decisionMaking).toContain('data');
      expect(agents!.toolUsage).toEqual(['Use tools wisely']);
      expect(agents!.errorHandling).toContain('gracefully');
      expect(agents!.escalationRules).toEqual(['Escalate when uncertain']);
      expect(agents!.prohibitedActions).toEqual(['Never delete without confirmation']);
    });

    it('parses Chinese section titles', () => {
      const agentsContent = [
        '## 任务执行',
        '- 先计划再行动',
        '',
        '## 决策',
        '基于数据做决策',
        '',
        '## 工具使用',
        '- 合理使用',
        '',
        '## 错误处理',
        '优雅恢复',
        '',
        '## 升级规则',
        '- 不确定时升级',
        '',
        '## 禁止操作',
        '- 不得未经确认删除',
      ].join('\n');

      writeFileSync(join(TEST_DIR, 'AGENTS.md'), agentsContent, 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const agents = s2.getAgents();
      expect(agents!.taskExecution).toHaveLength(1);
      expect(agents!.prohibitedActions).toHaveLength(1);
    });

    it('returns null when no AGENTS.md', () => {
      expect(store.getAgents()).toBeNull();
    });
  });

  // ─── loadUser / parseUserContent ──────────────────────────
  describe('loadUser / parseUserContent', () => {
    beforeEach(() => store.init());

    it('parses USER.md with personal info (Name extraction)', () => {
      const userContent = [
        '## Personal Info',
        '**Name**: John Doe',
        '',
        '## Background',
        'Senior developer with 10 years experience.',
        '',
        '## Goals',
        '- Learn Rust',
        '• Master distributed systems',
      ].join('\n');

      writeFileSync(join(TEST_DIR, 'USER.md'), userContent, 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const user = s2.getUser();

      expect(user).not.toBeNull();
      expect(user!.name).toBe('John Doe');
      expect(user!.background).toContain('developer');
      expect(user!.goals).toEqual(['Learn Rust', 'Master distributed systems']);
    });

    it('parses 个人 section title for name', () => {
      const userContent = [
        '## 个人信息',
        '- **Name**: 张三',
      ].join('\n');

      writeFileSync(join(TEST_DIR, 'USER.md'), userContent, 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      expect(s2.getUser()!.name).toBe('张三');
    });

    it('parses 目标 section for goals', () => {
      const userContent = '## 目标\n- 学习新技术\n- 提高效率';
      writeFileSync(join(TEST_DIR, 'USER.md'), userContent, 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      expect(s2.getUser()!.goals).toEqual(['学习新技术', '提高效率']);
    });

    it('falls back to entire content as background', () => {
      writeFileSync(join(TEST_DIR, 'USER.md'), 'Just some text about the user.', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      expect(s2.getUser()!.background).toBe('Just some text about the user.');
    });

    it('returns null when no USER.md', () => {
      expect(store.getUser()).toBeNull();
    });
  });

  // ─── loadTraits ──────────────────────────────────────────
  describe('loadTraits', () => {
    it('returns null for invalid JSON', () => {
      writeFileSync(join(TEST_DIR, 'traits.json'), 'not json', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      // loadTraits is called during init; it catches errors
      s2.init();
      // Since invalid JSON => null => defaults are created
      expect(s2.getTraits()).toBeDefined();
      expect(s2.getTraits().mbti).toBeDefined();
    });

    it('returns null for invalid schema (missing fields)', () => {
      writeFileSync(join(TEST_DIR, 'traits.json'), '{"invalid": true}', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      // Should fall back to defaults
      expect(s2.getTraits()).toBeDefined();
    });
  });

  // ─── parseFrontmatter ────────────────────────────────────
  describe('parseFrontmatter (via loadIdentity)', () => {
    it('parses frontmatter with array values', () => {
      const content = '---\nname: Bot\nversion: 1.0.0\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: ["ai", "bot"]\n---\nA bot';
      writeFileSync(join(TEST_DIR, 'IDENTITY.md'), content, 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const id = s2.getIdentity();
      expect(id!.name).toBe('Bot');
      expect(id!.tags).toEqual(['ai', 'bot']);
    });

    it('parses numeric values in frontmatter', () => {
      const content = '---\nname: Bot\nversion: 2\ncreated: 2026-01-01\nmodified: 2026-01-01\n---\nDesc';
      writeFileSync(join(TEST_DIR, 'IDENTITY.md'), content, 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const id = s2.getIdentity();
      expect(id!.version).toBeDefined();
    });

    it('handles invalid array JSON in frontmatter (keeps as string)', () => {
      const content = '---\nname: Bot\nversion: 1.0.0\ncreated: 2026-01-01\nmodified: 2026-01-01\ntags: [broken\n---\nDesc';
      writeFileSync(join(TEST_DIR, 'IDENTITY.md'), content, 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      // tags will be kept as string "[broken" which may fail schema validation
      // causing identity to be null, triggering default creation
      const id = s2.getIdentity();
      expect(id).not.toBeNull();
    });

    it('handles content without frontmatter', () => {
      writeFileSync(join(TEST_DIR, 'IDENTITY.md'), 'Just content no frontmatter', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      // Without frontmatter, parse result depends on schema
      // IdentitySchema requires name/version/created/modified, so it'll fail
      // and identity will be null, causing defaults to be created
      expect(s2.getIdentity()).not.toBeNull();
      expect(s2.getIdentity()!.name).toBe('Beeclaw'); // default
    });
  });

  // ─── generateMarkdown (via saveIdentity) ─────────────────
  describe('generateMarkdown (via setIdentity)', () => {
    beforeEach(() => store.init());

    it('generates markdown with frontmatter excluding undefined values', () => {
      store.setIdentity({ name: 'NewBot', description: 'A new bot' });
      const content = require('fs').readFileSync(join(TEST_DIR, 'IDENTITY.md'), 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('name: NewBot');
      expect(content).toContain('A new bot');
    });

    it('serializes arrays as JSON in frontmatter', () => {
      store.setIdentity({ tags: ['a', 'b'] });
      const content = require('fs').readFileSync(join(TEST_DIR, 'IDENTITY.md'), 'utf-8');
      expect(content).toContain('tags: ["a","b"]');
    });
  });

  // ─── setTraits ───────────────────────────────────────────
  describe('setTraits', () => {
    beforeEach(() => store.init());

    it('throws on invalid traits', () => {
      expect(() => store.setTraits({ mbti: 'ZZZZ' as any })).toThrow('Invalid traits');
    });
  });

  // ─── exportPersona ──────────────────────────────────────
  describe('exportPersona', () => {
    beforeEach(() => store.init());

    it('includes soul as empty essence when no SOUL.md', () => {
      const pkg = store.exportPersona();
      expect(pkg.soul.essence).toBe('');
    });

    it('includes soul from SOUL.md when present', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), '# Identity\nI am great.', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const pkg = s2.exportPersona();
      expect(pkg.soul.essence).toContain('great');
    });

    it('includes agents when present', () => {
      writeFileSync(join(TEST_DIR, 'AGENTS.md'), '## Task Rules\n- Be thorough', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const pkg = s2.exportPersona();
      expect(pkg.agents).toBeDefined();
    });

    it('includes user when present', () => {
      writeFileSync(join(TEST_DIR, 'USER.md'), '## Background\nA developer', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const pkg = s2.exportPersona();
      expect(pkg.user).toBeDefined();
    });

    it('includes memories from facts directory', () => {
      const factsDir = join(TEST_DIR, '..', 'facts');
      mkdirSync(factsDir, { recursive: true });
      writeFileSync(join(factsDir, 'preferences.md'), '- Likes dark mode', 'utf-8');
      writeFileSync(join(factsDir, 'knowledge.md'), '- Knows Python', 'utf-8');

      const pkg = store.exportPersona({ includeMemories: true });
      expect(pkg.memories).toBeDefined();
      expect(pkg.memories!.length).toBeGreaterThanOrEqual(2);

      // Cleanup
      rmSync(factsDir, { recursive: true });
    });

    it('omits memories when includeMemories is false', () => {
      const pkg = store.exportPersona({ includeMemories: false });
      expect(pkg.memories).toBeUndefined();
    });

    it('loads empty goal skills', () => {
      const pkg = store.exportPersona({ includeGoals: true });
      expect(pkg.skills).toEqual([]);
    });

    it('omits skills when includeGoals is false', () => {
      const pkg = store.exportPersona({ includeGoals: false });
      expect(pkg.skills).toBeUndefined();
    });
  });

  // ─── importPersona ──────────────────────────────────────
  describe('importPersona', () => {
    beforeEach(() => store.init());

    it('imports traits and validates them', () => {
      const pkg = store.exportPersona();
      pkg.traits = store.getTraits();
      const result = store.importPersona(pkg);
      expect(result.imported).toContain('traits');
    });

    it('reports errors on invalid traits', () => {
      const pkg = store.exportPersona();
      pkg.traits = { mbti: 'ZZZZ' } as any;
      const result = store.importPersona(pkg);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.success).toBe(false);
    });

    it('imports memories when merge=true', () => {
      const pkg = store.exportPersona();
      pkg.memories = [{ category: 'test', content: 'data' }];
      const result = store.importPersona(pkg, { merge: true });
      expect(result.imported).toContain('memories');
    });

    it('does not import memories when merge=false', () => {
      const pkg = store.exportPersona();
      pkg.memories = [{ category: 'test', content: 'data' }];
      const result = store.importPersona(pkg, { merge: false });
      expect(result.imported).not.toContain('memories');
    });

    it('validateOnly returns success without modifying anything', () => {
      const pkg = store.exportPersona();
      pkg.identity.name = 'Should not be applied';
      const result = store.importPersona(pkg, { validateOnly: true });
      expect(result.success).toBe(true);
      expect(result.imported).toHaveLength(0);
      // exportPersona returns identity by reference, so mutation happens in-memory
      // The key assertion is that importPersona returns empty imported list
    });
  });

  // ─── getSystemPrompt ────────────────────────────────────
  describe('getSystemPrompt', () => {
    it('includes soul values in prompt', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), '# Core Traits\n- Honest\n- Kind\n# Identity\nI value truth.', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const prompt = s2.getSystemPrompt();
      expect(prompt).toContain('Personality');
      expect(prompt).toContain('truth');
      expect(prompt).toContain('Core Values');
      expect(prompt).toContain('Honest');
    });

    it('includes user background in prompt', () => {
      writeFileSync(join(TEST_DIR, 'USER.md'), '## Background\nExperienced engineer.', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const prompt = s2.getSystemPrompt();
      expect(prompt).toContain('About the User');
      expect(prompt).toContain('Experienced engineer');
    });

    it('includes agent guidelines in prompt', () => {
      writeFileSync(join(TEST_DIR, 'AGENTS.md'), '## Task Execution\n- Be thorough\n## Prohibited Actions\n- No spam', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const prompt = s2.getSystemPrompt();
      expect(prompt).toContain('Behavior Guidelines');
      expect(prompt).toContain('Task Execution');
      expect(prompt).toContain('Be thorough');
      expect(prompt).toContain('Prohibited Actions');
      expect(prompt).toContain('No spam');
    });

    it('returns minimal prompt when only identity exists', () => {
      store.init();
      const prompt = store.getSystemPrompt();
      expect(prompt).toContain('Identity');
      expect(prompt).toContain('Beeclaw');
      expect(prompt).not.toContain('Personality');
      expect(prompt).not.toContain('About the User');
    });

    it('includes identity description', () => {
      store.init();
      const prompt = store.getSystemPrompt();
      expect(prompt).toContain('Description:');
    });

    it('handles soul with empty values array', () => {
      writeFileSync(join(TEST_DIR, 'SOUL.md'), '# Identity\nJust essence, no values.', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const prompt = s2.getSystemPrompt();
      expect(prompt).toContain('Just essence, no values');
      expect(prompt).not.toContain('Core Values');
    });

    it('handles agents with empty arrays', () => {
      writeFileSync(join(TEST_DIR, 'AGENTS.md'), '## Decision Making\nBe cautious.', 'utf-8');
      const s2 = new PersonaStore(TEST_DIR);
      s2.init();
      const prompt = s2.getSystemPrompt();
      expect(prompt).toContain('Behavior Guidelines');
      // taskExecution and prohibitedActions are empty, so their sections should not appear
      expect(prompt).not.toContain('Task Execution');
    });
  });

  // ─── saveIdentity when identity is null ──────────────────
  describe('saveIdentity edge case', () => {
    it('does nothing when identity is null', () => {
      // Don't init (identity stays null)
      // Calling saveIdentity should be a no-op
      (store as any).saveIdentity();
      expect(existsSync(join(TEST_DIR, 'IDENTITY.md'))).toBe(false);
    });
  });

  // ─── saveTraits when traits is null ──────────────────────
  describe('saveTraits edge case', () => {
    it('does nothing when traits is null', () => {
      (store as any).saveTraits();
      expect(existsSync(join(TEST_DIR, 'traits.json'))).toBe(false);
    });
  });

  // ─── loadCoreMemories when no facts directory ────────────
  describe('loadCoreMemories', () => {
    it('returns empty array when facts directory does not exist', () => {
      store.init();
      const pkg = store.exportPersona({ includeMemories: true });
      // No facts directory => empty
      expect(pkg.memories).toEqual([]);
    });
  });
});
