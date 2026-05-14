/**
 * Skill packager — pack a skill directory into a single JSON envelope and
 * unpack it back. Used for skill export/import (sharing, backup, marketplace).
 *
 * Design notes:
 * - JSON envelope (not tar.gz) so there are no native deps and tests are
 *   trivial — every byte that goes in comes back out, content-addressed.
 * - sha256 checksum over a canonicalized files list lets us detect tampering
 *   or partial transfer at import time.
 * - Text files travel as utf-8; binary files as base64. encoding is recorded
 *   per-file so the unpacker round-trips losslessly.
 * - Maximum sizes are enforced both per-file and per-package to keep importing
 *   an untrusted package from blowing up memory or disk.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const SKILL_PACKAGE_FORMAT_VERSION = 1;

export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;        // 5 MiB
export const DEFAULT_MAX_PACKAGE_SIZE = 50 * 1024 * 1024;    // 50 MiB
export const DEFAULT_MAX_FILES = 1000;

/** A single file entry inside a skill package. */
export interface PackagedFile {
  /** POSIX-style path relative to the skill root. */
  path: string;
  /** "utf-8" for text, "base64" for binary. */
  encoding: 'utf-8' | 'base64';
  /** Encoded content (raw text or base64-encoded bytes). */
  content: string;
  /** sha256 of the *raw bytes* (not the encoded form). */
  sha256: string;
  /** Size in raw bytes. */
  size: number;
}

/** Manifest metadata at the top of a package. */
export interface PackageManifest {
  /** Schema version. Bumps when the envelope shape changes. */
  format: number;
  /** Skill name copied from SKILL.md frontmatter (informational; not trusted). */
  name: string;
  /** Skill version copied from frontmatter (informational). */
  version: string;
  /** ISO timestamp of when the package was produced. */
  exportedAt: string;
  /** Number of files included. */
  fileCount: number;
  /** Total raw bytes across all files. */
  totalBytes: number;
}

/** Top-level package envelope. */
export interface SkillPackage {
  manifest: PackageManifest;
  files: PackagedFile[];
  /** sha256 of the canonicalised files list (see canonicalDigest). */
  checksum: string;
}

export interface PackOptions {
  /** Override per-file size cap (bytes). */
  maxFileSize?: number;
  /** Override total package size cap (bytes). */
  maxPackageSize?: number;
  /** Override file-count cap. */
  maxFiles?: number;
  /** Override exportedAt for deterministic tests. */
  now?: () => Date;
  /** File-name predicates to skip (default: dotfiles + node_modules + dist). */
  exclude?: (relPath: string) => boolean;
}

export interface UnpackOptions {
  /** Allow overwriting an existing target directory. */
  overwrite?: boolean;
  /** Override per-file size cap (bytes). */
  maxFileSize?: number;
  /** Override total package size cap (bytes). */
  maxPackageSize?: number;
  /** Override file-count cap. */
  maxFiles?: number;
}

export interface UnpackResult {
  filesWritten: string[];
  conflictsResolved: string[];
  totalBytes: number;
}

const DEFAULT_EXCLUDE = (relPath: string): boolean => {
  const segs = relPath.split('/');
  if (segs.some(s => s === 'node_modules' || s === 'dist' || s === '.git' || s === '.DS_Store')) return true;
  // Hidden files (other than well-known meta) are skipped by default.
  if (segs.some(s => s.startsWith('.') && s !== '.metadata.json' && s !== '_meta.json')) return true;
  return false;
};

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.ts', '.tsx', '.js', '.jsx',
  '.py', '.sh', '.toml', '.ini', '.csv', '.html', '.css', '.svg',
]);

function isTextFile(absPath: string, bytes: Buffer): boolean {
  const ext = path.extname(absPath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // Heuristic: NUL byte in first 512 bytes → binary.
  const probe = bytes.subarray(0, Math.min(bytes.length, 512));
  return !probe.includes(0);
}

function sha256OfBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** sha256 over a canonicalised JSON of {path, sha256} pairs sorted by path. */
function canonicalDigest(files: PackagedFile[]): string {
  const canonical = files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(f => ({ path: f.path, sha256: f.sha256, size: f.size }));
  return sha256OfBuffer(Buffer.from(JSON.stringify(canonical), 'utf-8'));
}

function listFilesRecursive(root: string, exclude: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (exclude(rel)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs, rel);
      } else if (ent.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

function readFrontmatterMeta(skillDir: string): { name: string; version: string } {
  const skillMd = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return { name: path.basename(skillDir), version: '0.0.0' };
  const content = fs.readFileSync(skillMd, 'utf-8');
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { name: path.basename(skillDir), version: '0.0.0' };
  const block = m[1];
  const nameLine = block.match(/^name:\s*(.+)$/m);
  const versionLine = block.match(/^version:\s*['"]?([^'"\n]+)['"]?$/m);
  return {
    name: (nameLine?.[1].trim() ?? path.basename(skillDir)).replace(/['"]/g, ''),
    version: versionLine?.[1].trim() ?? '0.0.0',
  };
}

/** Pack a skill directory into a SkillPackage envelope. */
export function packSkill(skillDir: string, opts: PackOptions = {}): SkillPackage {
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    throw new Error(`packSkill: not a directory: ${skillDir}`);
  }

  const maxFileSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxPackageSize = opts.maxPackageSize ?? DEFAULT_MAX_PACKAGE_SIZE;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const now = opts.now ?? (() => new Date());
  const exclude = opts.exclude ?? DEFAULT_EXCLUDE;

  const relPaths = listFilesRecursive(skillDir, exclude);
  if (relPaths.length === 0) {
    throw new Error(`packSkill: no files to pack in ${skillDir} (after exclusions)`);
  }
  if (relPaths.length > maxFiles) {
    throw new Error(`packSkill: ${relPaths.length} files exceeds maxFiles=${maxFiles}`);
  }

  const files: PackagedFile[] = [];
  let totalBytes = 0;
  for (const rel of relPaths) {
    const abs = path.join(skillDir, rel);
    const bytes = fs.readFileSync(abs);
    if (bytes.length > maxFileSize) {
      throw new Error(`packSkill: ${rel} (${bytes.length}B) exceeds maxFileSize=${maxFileSize}`);
    }
    totalBytes += bytes.length;
    if (totalBytes > maxPackageSize) {
      throw new Error(`packSkill: total ${totalBytes}B exceeds maxPackageSize=${maxPackageSize}`);
    }
    const text = isTextFile(abs, bytes);
    files.push({
      path: rel,
      encoding: text ? 'utf-8' : 'base64',
      content: text ? bytes.toString('utf-8') : bytes.toString('base64'),
      sha256: sha256OfBuffer(bytes),
      size: bytes.length,
    });
  }

  const meta = readFrontmatterMeta(skillDir);
  const manifest: PackageManifest = {
    format: SKILL_PACKAGE_FORMAT_VERSION,
    name: meta.name,
    version: meta.version,
    exportedAt: now().toISOString(),
    fileCount: files.length,
    totalBytes,
  };

  return {
    manifest,
    files,
    checksum: canonicalDigest(files),
  };
}

/**
 * Re-decode a packaged file back to its raw bytes and verify sha256.
 * Throws if the entry is corrupt.
 */
export function decodePackagedFile(file: PackagedFile): Buffer {
  const buf = file.encoding === 'utf-8'
    ? Buffer.from(file.content, 'utf-8')
    : Buffer.from(file.content, 'base64');
  if (buf.length !== file.size) {
    throw new Error(`decodePackagedFile: size mismatch for ${file.path} (got ${buf.length}, expected ${file.size})`);
  }
  const actual = sha256OfBuffer(buf);
  if (actual !== file.sha256) {
    throw new Error(`decodePackagedFile: sha256 mismatch for ${file.path}`);
  }
  return buf;
}

/**
 * Validate a SkillPackage envelope (checksum, format version, sizes).
 * Returns the package if valid; throws otherwise.
 */
export function validateSkillPackage(pkg: SkillPackage, opts: UnpackOptions = {}): SkillPackage {
  if (!pkg || typeof pkg !== 'object') {
    throw new Error('validateSkillPackage: not an object');
  }
  if (!pkg.manifest || pkg.manifest.format !== SKILL_PACKAGE_FORMAT_VERSION) {
    throw new Error(
      `validateSkillPackage: unsupported format ${pkg.manifest?.format} (expected ${SKILL_PACKAGE_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    throw new Error('validateSkillPackage: empty files list');
  }
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  if (pkg.files.length > maxFiles) {
    throw new Error(`validateSkillPackage: ${pkg.files.length} files exceeds maxFiles=${maxFiles}`);
  }

  const expected = canonicalDigest(pkg.files);
  if (expected !== pkg.checksum) {
    throw new Error(`validateSkillPackage: checksum mismatch (expected ${expected}, got ${pkg.checksum})`);
  }

  const maxFileSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxPackageSize = opts.maxPackageSize ?? DEFAULT_MAX_PACKAGE_SIZE;
  let total = 0;
  for (const f of pkg.files) {
    if (f.size > maxFileSize) {
      throw new Error(`validateSkillPackage: ${f.path} (${f.size}B) exceeds maxFileSize=${maxFileSize}`);
    }
    total += f.size;
    if (total > maxPackageSize) {
      throw new Error(`validateSkillPackage: total ${total}B exceeds maxPackageSize=${maxPackageSize}`);
    }
    if (f.path.startsWith('/') || f.path.includes('..')) {
      throw new Error(`validateSkillPackage: unsafe path ${f.path}`);
    }
  }
  return pkg;
}

/**
 * Unpack a SkillPackage into targetDir. Creates the directory if missing.
 * If targetDir already contains files, they are overwritten only when
 * `opts.overwrite` is true; the list of overwritten files is reported in
 * `conflictsResolved`.
 */
export function unpackSkill(
  pkg: SkillPackage,
  targetDir: string,
  opts: UnpackOptions = {},
): UnpackResult {
  validateSkillPackage(pkg, opts);

  const overwrite = opts.overwrite ?? false;

  if (fs.existsSync(targetDir)) {
    if (!fs.statSync(targetDir).isDirectory()) {
      throw new Error(`unpackSkill: targetDir exists and is not a directory: ${targetDir}`);
    }
    if (!overwrite) {
      const existing = fs.readdirSync(targetDir);
      if (existing.length > 0) {
        throw new Error(`unpackSkill: targetDir is non-empty and overwrite=false: ${targetDir}`);
      }
    }
  } else {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filesWritten: string[] = [];
  const conflictsResolved: string[] = [];
  let totalBytes = 0;

  for (const file of pkg.files) {
    const dest = path.join(targetDir, file.path);
    const destResolved = path.resolve(dest);
    const baseResolved = path.resolve(targetDir);
    if (!destResolved.startsWith(baseResolved + path.sep) && destResolved !== baseResolved) {
      throw new Error(`unpackSkill: refusing path traversal ${file.path}`);
    }

    const bytes = decodePackagedFile(file);
    totalBytes += bytes.length;

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) {
      conflictsResolved.push(file.path);
    }
    fs.writeFileSync(dest, bytes);
    filesWritten.push(file.path);
  }

  return { filesWritten, conflictsResolved, totalBytes };
}
