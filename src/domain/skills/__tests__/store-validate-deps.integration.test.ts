/**
 * Real-fs integration test for SkillStore.validateAllDependencies().
 *
 * Pairs with dependency-graph.test.ts (pure-logic unit tests) — this one
 * proves the wiring: load actual skills from disk, build the graph,
 * detect cycles + missing deps end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.unmock('fs');

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import { SkillStore } from '../store';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'beeclaw-skill-deps-'));
}

function writeSkill(baseDir: string, name: string, deps: string[] = []): void {
  const skillDir = path.join(baseDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const depsLine = deps.length > 0 ? `depends_on:\n${deps.map(d => `  - ${d}`).join('\n')}\n` : '';
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} skill\nversion: '1.0.0'\n${depsLine}---\n\n# ${name}\n`,
  );
}

describe('SkillStore.validateAllDependencies — real fs', () => {
  let userBase: string;
  beforeEach(() => { userBase = mkTmp(); });
  afterEach(() => { fs.rmSync(userBase, { recursive: true, force: true }); });

  it('returns healthy for a clean dependency graph', () => {
    writeSkill(userBase, 'foundation');
    writeSkill(userBase, 'middle', ['foundation']);
    writeSkill(userBase, 'top', ['middle', 'foundation']);

    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateAllDependencies();

    expect(result.healthy).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.cycles).toEqual([]);
    expect(result.totalSkills).toBe(3);
  });

  it('flags a missing dependency declared by an existing skill', () => {
    writeSkill(userBase, 'orphan-parent', ['ghost-skill']);

    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateAllDependencies();

    expect(result.healthy).toBe(false);
    expect(result.missing).toEqual([{ source: 'orphan-parent', missing: 'ghost-skill' }]);
    expect(result.cycles).toEqual([]);
  });

  it('detects a direct cycle a → b → a between two skills', () => {
    writeSkill(userBase, 'a', ['b']);
    writeSkill(userBase, 'b', ['a']);

    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateAllDependencies();

    expect(result.healthy).toBe(false);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].path).toContain('a');
    expect(result.cycles[0].path).toContain('b');
  });

  it('detects a self-loop skill → skill', () => {
    writeSkill(userBase, 'narcissist', ['narcissist']);

    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateAllDependencies();

    expect(result.healthy).toBe(false);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].path).toEqual(['narcissist', 'narcissist']);
  });

  it('reports missing deps and cycles together when both are present', () => {
    writeSkill(userBase, 'a', ['b', 'ghost']);
    writeSkill(userBase, 'b', ['a']);

    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateAllDependencies();

    expect(result.healthy).toBe(false);
    expect(result.missing).toEqual([{ source: 'a', missing: 'ghost' }]);
    expect(result.cycles).toHaveLength(1);
  });

  it('returns healthy for an empty skill directory (no skills loaded)', () => {
    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateAllDependencies();
    expect(result.healthy).toBe(true);
    expect(result.totalSkills).toBe(0);
  });
});

describe('SkillStore.validateNewSkillDependencies — pre-create check', () => {
  let userBase: string;
  beforeEach(() => { userBase = mkTmp(); });
  afterEach(() => { fs.rmSync(userBase, { recursive: true, force: true }); });

  it('returns valid when all declared deps exist on disk', () => {
    writeSkill(userBase, 'foundation');
    writeSkill(userBase, 'middle');
    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateNewSkillDependencies('newcomer', ['foundation', 'middle']);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('flags missing deps that do not exist on disk', () => {
    writeSkill(userBase, 'real-dep');
    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateNewSkillDependencies('newcomer', ['real-dep', 'ghost']);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['ghost']);
    expect(result.errors.some(e => e.includes('"ghost" not found'))).toBe(true);
  });

  it('detects a cycle introduced by the new skill (missed by the old API)', () => {
    // Existing skill A depends on the to-be-created skill B.
    // Creating B with depends_on=[A] would close the loop A → B → A.
    // The old validateDependencies() saw A exists and waved it through;
    // the new graph-aware check rejects.
    writeSkill(userBase, 'a', ['b']);  // declares dep on B which doesn't exist yet
    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateNewSkillDependencies('b', ['a']);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Circular'))).toBe(true);
  });

  it('detects a self-loop (new skill that depends on itself)', () => {
    const store = new SkillStore(userBase, '/nonexistent/builtin');
    // Self-loop means dep "narcissist" doesn't exist on disk yet — both
    // the missing-dep check AND the cycle check fire.
    const result = store.validateNewSkillDependencies('narcissist', ['narcissist']);
    expect(result.valid).toBe(false);
  });

  it('does not falsely flag a diamond as a cycle', () => {
    writeSkill(userBase, 'leaf');
    writeSkill(userBase, 'mid-a', ['leaf']);
    writeSkill(userBase, 'mid-b', ['leaf']);
    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateNewSkillDependencies('top', ['mid-a', 'mid-b']);
    expect(result.valid).toBe(true);
  });

  it('returns valid for empty dependsOn (no-op)', () => {
    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.validateNewSkillDependencies('standalone', []);
    expect(result.valid).toBe(true);
  });
});
