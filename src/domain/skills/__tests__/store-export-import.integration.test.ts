/**
 * End-to-end integration test for SkillStore.exportSkill / importSkill.
 *
 * Uses real filesystem (temp dirs) and exercises the full pack → write JSON
 * → read JSON → unpack roundtrip. Pairs with packager.test.ts (pure logic)
 * and store.test.ts (mock-based orchestration).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Tests need real fs and real packager — block any global mocks that other
// suites in this directory install, but inside this file we mock nothing.
vi.unmock('fs');

import { SkillStore } from '../store';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const SKILL_MD = `---
name: roundtrip-skill
description: Used by export/import integration test
version: '0.1.0'
tags: [test]
---

# Round-trip skill body
`;

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

describe('SkillStore export/import integration (real fs)', () => {
  let userBase: string;
  let exportFile: string;

  beforeEach(() => {
    userBase = mkTmpDir('beeclaw-store-int-user');
    exportFile = path.join(mkTmpDir('beeclaw-store-int-out'), 'roundtrip-skill.skill.json');

    // Seed a skill on disk under userBase.
    const skillDir = path.join(userBase, 'roundtrip-skill');
    fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_MD);
    fs.writeFileSync(path.join(skillDir, 'scripts', 'run.sh'), '#!/bin/sh\necho hi\n');
    fs.writeFileSync(path.join(skillDir, '_meta.json'), '{"foo":1}\n');
  });

  afterEach(() => {
    fs.rmSync(userBase, { recursive: true, force: true });
    fs.rmSync(path.dirname(exportFile), { recursive: true, force: true });
  });

  it('exports a skill to a JSON envelope and reports correct metadata', () => {
    const store = new SkillStore(userBase, '/nonexistent/builtin');
    const result = store.exportSkill('roundtrip-skill', exportFile);

    expect(result.skill_name).toBe('roundtrip-skill');
    expect(result.export_path).toBe(exportFile);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.files_included.sort()).toEqual([
      'SKILL.md', '_meta.json', 'scripts/run.sh',
    ]);
    expect(result.size_bytes).toBeGreaterThan(0);

    expect(fs.existsSync(exportFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(exportFile, 'utf-8'));
    expect(parsed.checksum).toBe(result.checksum);
    expect(parsed.manifest.name).toBe('roundtrip-skill');
    expect(parsed.manifest.version).toBe('0.1.0');
  });

  it('round-trips: export then import into a fresh basePath reproduces the skill exactly', () => {
    const store1 = new SkillStore(userBase, '/nonexistent/builtin');
    store1.exportSkill('roundtrip-skill', exportFile);

    const importBase = mkTmpDir('beeclaw-store-int-import');
    try {
      const store2 = new SkillStore(importBase, '/nonexistent/builtin');
      const importResult = store2.importSkill(exportFile);

      expect(importResult.success).toBe(true);
      expect(importResult.skill_name).toBe('roundtrip-skill');
      expect(importResult.imported_version).toBe('0.1.0');
      expect(importResult.conflicts_resolved).toEqual([]);
      expect(importResult.files_imported.sort()).toEqual([
        'SKILL.md', '_meta.json', 'scripts/run.sh',
      ]);

      // Verify on-disk contents are identical to the original.
      const importedDir = path.join(importBase, 'roundtrip-skill');
      expect(fs.readFileSync(path.join(importedDir, 'SKILL.md'), 'utf-8')).toBe(SKILL_MD);
      expect(fs.readFileSync(path.join(importedDir, 'scripts/run.sh'), 'utf-8'))
        .toBe('#!/bin/sh\necho hi\n');
      expect(fs.readFileSync(path.join(importedDir, '_meta.json'), 'utf-8'))
        .toBe('{"foo":1}\n');
    } finally {
      fs.rmSync(importBase, { recursive: true, force: true });
    }
  });

  it('importSkill into an existing skill dir reports conflicts and overwrites', () => {
    const store1 = new SkillStore(userBase, '/nonexistent/builtin');
    store1.exportSkill('roundtrip-skill', exportFile);

    // Now mutate the original skill so import would conflict.
    const skillDir = path.join(userBase, 'roundtrip-skill');
    fs.writeFileSync(path.join(skillDir, 'scripts/run.sh'), 'old\n');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: roundtrip-skill\nversion: stale\n---\nstale\n');

    const result = store1.importSkill(exportFile);
    expect(result.conflicts_resolved.sort()).toEqual([
      'SKILL.md', '_meta.json', 'scripts/run.sh',
    ]);
    // The original SKILL.md should be back.
    expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8')).toBe(SKILL_MD);
  });

  it('importSkill rejects a tampered envelope (sha256 mismatch on metadata)', () => {
    const store = new SkillStore(userBase, '/nonexistent/builtin');
    store.exportSkill('roundtrip-skill', exportFile);

    // Tamper with the per-file sha256 in the on-disk envelope.
    const pkg = JSON.parse(fs.readFileSync(exportFile, 'utf-8'));
    pkg.files[0].sha256 = '0'.repeat(64);
    fs.writeFileSync(exportFile, JSON.stringify(pkg));

    const importBase = mkTmpDir('beeclaw-store-int-tamper');
    try {
      const store2 = new SkillStore(importBase, '/nonexistent/builtin');
      expect(() => store2.importSkill(exportFile)).toThrow(/checksum mismatch/);
    } finally {
      fs.rmSync(importBase, { recursive: true, force: true });
    }
  });
});
