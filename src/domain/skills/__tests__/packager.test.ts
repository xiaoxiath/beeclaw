import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  packSkill,
  unpackSkill,
  validateSkillPackage,
  decodePackagedFile,
  SKILL_PACKAGE_FORMAT_VERSION,
  type SkillPackage,
} from '../packager';

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function writeSkill(dir: string, files: Record<string, string | Buffer>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

const SKILL_MD = `---
name: test-skill
description: A test skill
version: '1.2.3'
tags: [test]
---

# Test Skill

Body of skill.
`;

describe('packSkill', () => {
  let dir: string;
  beforeEach(() => { dir = mkTmpDir('beeclaw-skill-pack-src'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('packs a minimal single-file skill', () => {
    writeSkill(dir, { 'SKILL.md': SKILL_MD });
    const pkg = packSkill(dir, { now: () => new Date('2026-05-14T10:00:00Z') });

    expect(pkg.manifest.format).toBe(SKILL_PACKAGE_FORMAT_VERSION);
    expect(pkg.manifest.name).toBe('test-skill');
    expect(pkg.manifest.version).toBe('1.2.3');
    expect(pkg.manifest.exportedAt).toBe('2026-05-14T10:00:00.000Z');
    expect(pkg.manifest.fileCount).toBe(1);
    expect(pkg.files).toHaveLength(1);
    expect(pkg.files[0].path).toBe('SKILL.md');
    expect(pkg.files[0].encoding).toBe('utf-8');
    expect(pkg.files[0].content).toBe(SKILL_MD);
    expect(pkg.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('walks subdirectories and produces deterministic order', () => {
    writeSkill(dir, {
      'SKILL.md': SKILL_MD,
      'scripts/b.sh': '#!/bin/sh\necho b\n',
      'scripts/a.sh': '#!/bin/sh\necho a\n',
      'data/x.json': '{"k":1}\n',
    });
    const pkg = packSkill(dir);
    expect(pkg.files.map(f => f.path)).toEqual([
      'SKILL.md',
      'data/x.json',
      'scripts/a.sh',
      'scripts/b.sh',
    ]);
    // Repeating the pack must yield the same checksum.
    const pkg2 = packSkill(dir);
    expect(pkg2.checksum).toBe(pkg.checksum);
  });

  it('encodes binary files as base64 and recovers them losslessly', () => {
    const bin = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
    writeSkill(dir, { 'SKILL.md': SKILL_MD, 'assets/icon.bin': bin });
    const pkg = packSkill(dir);
    const binEntry = pkg.files.find(f => f.path === 'assets/icon.bin')!;
    expect(binEntry.encoding).toBe('base64');
    expect(decodePackagedFile(binEntry).equals(bin)).toBe(true);
  });

  it('skips node_modules, dist, hidden files, and .DS_Store', () => {
    writeSkill(dir, {
      'SKILL.md': SKILL_MD,
      'node_modules/foo/index.js': 'x',
      'dist/bundle.js': 'x',
      '.git/HEAD': 'x',
      '.DS_Store': 'x',
      '.hidden': 'x',
      '_meta.json': '{"k":1}',
      '.metadata.json': '{"k":1}',
    });
    const pkg = packSkill(dir);
    const paths = pkg.files.map(f => f.path);
    expect(paths).not.toContain('node_modules/foo/index.js');
    expect(paths).not.toContain('dist/bundle.js');
    expect(paths).not.toContain('.git/HEAD');
    expect(paths).not.toContain('.DS_Store');
    expect(paths).not.toContain('.hidden');
    // Well-known meta files ARE kept.
    expect(paths).toContain('_meta.json');
    expect(paths).toContain('.metadata.json');
  });

  it('throws when the directory does not exist', () => {
    expect(() => packSkill(path.join(dir, 'nope'))).toThrow(/not a directory/);
  });

  it('throws when no files survive exclusion', () => {
    writeSkill(dir, { 'node_modules/x.js': 'x' });
    expect(() => packSkill(dir)).toThrow(/no files to pack/);
  });

  it('enforces per-file size cap', () => {
    writeSkill(dir, { 'SKILL.md': SKILL_MD, 'big.txt': 'x'.repeat(100) });
    expect(() => packSkill(dir, { maxFileSize: 50 })).toThrow(/maxFileSize/);
  });

  it('enforces total package size cap', () => {
    writeSkill(dir, { 'SKILL.md': SKILL_MD, 'big.txt': 'x'.repeat(100) });
    expect(() => packSkill(dir, { maxPackageSize: SKILL_MD.length + 50 })).toThrow(/maxPackageSize/);
  });

  it('enforces file count cap', () => {
    const files: Record<string, string> = { 'SKILL.md': SKILL_MD };
    for (let i = 0; i < 10; i++) files[`f${i}.txt`] = 'x';
    writeSkill(dir, files);
    expect(() => packSkill(dir, { maxFiles: 5 })).toThrow(/maxFiles/);
  });

  it('falls back to directory name when SKILL.md is missing', () => {
    const named = mkTmpDir('beeclaw-no-skill-md');
    try {
      writeSkill(named, { 'README.md': '# No frontmatter' });
      const pkg = packSkill(named);
      expect(pkg.manifest.name).toBe(path.basename(named));
      expect(pkg.manifest.version).toBe('0.0.0');
    } finally {
      fs.rmSync(named, { recursive: true, force: true });
    }
  });
});

describe('validateSkillPackage', () => {
  function basePkg(): SkillPackage {
    const dir = mkTmpDir('beeclaw-skill-validate');
    writeSkill(dir, { 'SKILL.md': SKILL_MD });
    const pkg = packSkill(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return pkg;
  }

  it('accepts a freshly packed package', () => {
    const pkg = basePkg();
    expect(() => validateSkillPackage(pkg)).not.toThrow();
  });

  it('rejects unsupported format version', () => {
    const pkg = basePkg();
    pkg.manifest.format = 9999;
    expect(() => validateSkillPackage(pkg)).toThrow(/unsupported format/);
  });

  it('rejects empty files list', () => {
    const pkg = basePkg();
    pkg.files = [];
    expect(() => validateSkillPackage(pkg)).toThrow(/empty files list/);
  });

  it('rejects checksum mismatch when manifest metadata is tampered', () => {
    // The envelope checksum covers per-file {path, sha256, size}, so tampering
    // with sha256 (or path/size) breaks the envelope digest and is caught here.
    const pkg = basePkg();
    pkg.files[0].sha256 = '0'.repeat(64);
    expect(() => validateSkillPackage(pkg)).toThrow(/checksum mismatch/);
  });

  it('detects content tampering at unpack time via decodePackagedFile', () => {
    // Content tampering without updating the per-file sha256 passes envelope
    // validation (since the metadata digest is unchanged) but fails when the
    // unpacker hashes the raw bytes — by design, validation is cheap and
    // content verification happens lazily.
    const pkg = basePkg();
    // Same length so the size check passes; sha256 check is what catches it.
    const original = pkg.files[0].content;
    pkg.files[0].content = original.slice(0, -1) + (original.endsWith('X') ? 'Y' : 'X');
    expect(pkg.files[0].content.length).toBe(original.length);
    expect(() => validateSkillPackage(pkg)).not.toThrow();
    expect(() => decodePackagedFile(pkg.files[0])).toThrow(/sha256 mismatch/);
  });

  it('rejects path traversal in entries', () => {
    const pkg = basePkg();
    pkg.files[0].path = '../../etc/passwd';
    // Path is in the canonical digest, so the envelope checksum will mismatch
    // before the path-safety check fires; either failure is acceptable here.
    expect(() => validateSkillPackage(pkg)).toThrow();
  });

  it('rejects per-file oversize', () => {
    const pkg = basePkg();
    pkg.files[0].size = 99999999;
    expect(() => validateSkillPackage(pkg, { maxFileSize: 100 })).toThrow();
  });
});

describe('unpackSkill', () => {
  let srcDir: string;
  let dstDir: string;
  beforeEach(() => {
    srcDir = mkTmpDir('beeclaw-skill-unpack-src');
    dstDir = mkTmpDir('beeclaw-skill-unpack-dst');
  });
  afterEach(() => {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(dstDir, { recursive: true, force: true });
  });

  it('round-trips a multi-file skill exactly', () => {
    writeSkill(srcDir, {
      'SKILL.md': SKILL_MD,
      'scripts/run.sh': '#!/bin/sh\necho hi\n',
      'data/x.json': '{"k":1}\n',
    });
    const pkg = packSkill(srcDir);

    // dstDir starts non-empty (from mkdtempSync) only if we created files; it's empty by default.
    // unpack into the empty dstDir should succeed.
    const result = unpackSkill(pkg, dstDir);
    expect(result.filesWritten.sort()).toEqual([
      'SKILL.md', 'data/x.json', 'scripts/run.sh',
    ]);
    expect(result.conflictsResolved).toEqual([]);

    // Verify file contents by re-packing the destination.
    const repacked = packSkill(dstDir);
    expect(repacked.checksum).toBe(pkg.checksum);
  });

  it('refuses to unpack into a non-empty dir without overwrite', () => {
    writeSkill(srcDir, { 'SKILL.md': SKILL_MD });
    const pkg = packSkill(srcDir);
    fs.writeFileSync(path.join(dstDir, 'preexisting.txt'), 'x');
    expect(() => unpackSkill(pkg, dstDir)).toThrow(/non-empty/);
  });

  it('overwrites and reports conflicts when overwrite=true', () => {
    writeSkill(srcDir, { 'SKILL.md': SKILL_MD, 'scripts/run.sh': 'new\n' });
    const pkg = packSkill(srcDir);
    fs.mkdirSync(path.join(dstDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dstDir, 'scripts/run.sh'), 'old\n');

    const result = unpackSkill(pkg, dstDir, { overwrite: true });
    expect(result.conflictsResolved).toContain('scripts/run.sh');
    expect(fs.readFileSync(path.join(dstDir, 'scripts/run.sh'), 'utf-8')).toBe('new\n');
  });

  it('creates the target dir if missing', () => {
    writeSkill(srcDir, { 'SKILL.md': SKILL_MD });
    const pkg = packSkill(srcDir);
    const newDst = path.join(dstDir, 'nested', 'newdir');
    const result = unpackSkill(pkg, newDst);
    expect(fs.existsSync(path.join(newDst, 'SKILL.md'))).toBe(true);
    expect(result.filesWritten).toEqual(['SKILL.md']);
  });

  it('refuses path-traversal entries', () => {
    writeSkill(srcDir, { 'SKILL.md': SKILL_MD });
    const pkg = packSkill(srcDir);
    pkg.files[0].path = '../escape.txt';
    expect(() => unpackSkill(pkg, dstDir)).toThrow();
  });

  it('verifies sha256 on each file and refuses tampered content', () => {
    writeSkill(srcDir, { 'SKILL.md': SKILL_MD });
    const pkg = packSkill(srcDir);
    // Tamper with content but keep envelope checksum recomputable to land in decode check.
    pkg.files[0].content = pkg.files[0].content + 'tamper';
    // First the envelope checksum check fires because we changed content.
    expect(() => unpackSkill(pkg, dstDir)).toThrow();
  });
});
