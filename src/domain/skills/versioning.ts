import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../infra/observability/logger';
import type { SkillFrontmatter } from './types';

// ---------------------------------------------------------------------------
// Minimal reference to avoid circular dependency with ./evaluator
// ---------------------------------------------------------------------------

/** Lightweight eval-score reference stored alongside snapshots. */
export interface EvalSummaryRef {
  compositeScore: number;
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type SnapshotStatus = 'active' | 'discarded' | 'archived';
export type SnapshotAuthor = 'human' | 'agent';

export interface SkillSnapshot {
  versionId: string;
  skillName: string;
  content: string;
  timestamp: string; // ISO-8601
  author: SnapshotAuthor;
  changeDescription: string;
  evalResult?: EvalSummaryRef;
  status: SnapshotStatus;
}

/** Metadata row persisted to history.jsonl (content omitted for compactness). */
export interface HistoryEntry {
  versionId: string;
  skillName: string;
  timestamp: string;
  author: SnapshotAuthor;
  changeDescription: string;
  evalResult?: EvalSummaryRef;
  status: SnapshotStatus;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the next version id from existing snapshot files in a directory.
 * Returns strings like "v001", "v002", …
 */
function nextVersionId(skillDir: string): string {
  if (!existsSync(skillDir)) return 'v001';

  let max = 0;
  // Scan for vNNN.md files
  const entries = readdirSafe(skillDir);
  for (const entry of entries) {
    const match = entry.match(/^v(\d{3,})\.md$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return `v${String(max + 1).padStart(3, '0')}`;
}

/** Read a directory without throwing when it doesn't exist. */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir) as string[];
  } catch {
    return [];
  }
}

/** Produce a simple line-by-line diff between two strings. */
function lineDiff(
  a: string,
  b: string,
): { added: string[]; removed: string[]; unchanged: number } {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const setA = new Set(linesA);
  const setB = new Set(linesB);

  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;

  for (const line of linesB) {
    if (!setA.has(line)) {
      added.push(line);
    } else {
      unchanged++;
    }
  }
  for (const line of linesA) {
    if (!setB.has(line)) {
      removed.push(line);
    }
  }

  return { added, removed, unchanged };
}

// ---------------------------------------------------------------------------
// SkillVersionStore
// ---------------------------------------------------------------------------

/**
 * Manages skill version snapshots and rollback, analogous to git commit/reset.
 *
 * Storage layout:
 * ```
 * <basePath>/<skillName>/
 *   v001.md
 *   v002.md
 *   history.jsonl   (append-only metadata log)
 * ```
 */
export class SkillVersionStore {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Create a new immutable snapshot for the given skill.
   * Returns the created {@link SkillSnapshot}.
   */
  snapshot(
    skillName: string,
    content: string,
    description: string,
    author: SnapshotAuthor = 'agent',
  ): SkillSnapshot {
    const skillDir = this.skillDir(skillName);
    mkdirSync(skillDir, { recursive: true });

    const versionId = nextVersionId(skillDir);
    const timestamp = new Date().toISOString();
    const snapshotPath = join(skillDir, `${versionId}.md`);

    writeFileSync(snapshotPath, content, 'utf-8');

    const entry: HistoryEntry = {
      versionId,
      skillName,
      timestamp,
      author,
      changeDescription: description,
      status: 'active',
    };

    appendFileSync(
      join(skillDir, 'history.jsonl'),
      JSON.stringify(entry) + '\n',
      'utf-8',
    );

    logger.debug(`[versioning] snapshot ${skillName}@${versionId} created`);

    return { ...entry, content };
  }

  /**
   * Read the content of a specific snapshot, returning it for re-application
   * (i.e. a rollback). Does **not** mutate history.
   */
  rollback(skillName: string, versionId: string): string {
    const filePath = join(this.skillDir(skillName), `${versionId}.md`);
    if (!existsSync(filePath)) {
      throw new Error(
        `Snapshot ${versionId} not found for skill "${skillName}"`,
      );
    }
    logger.debug(`[versioning] rollback ${skillName} → ${versionId}`);
    return readFileSync(filePath, 'utf-8');
  }

  /**
   * Return the most recent history entries for a skill, newest first.
   */
  history(skillName: string, limit = 50): HistoryEntry[] {
    const historyPath = join(this.skillDir(skillName), 'history.jsonl');
    if (!existsSync(historyPath)) return [];

    const lines = readFileSync(historyPath, 'utf-8')
      .split('\n')
      .filter(Boolean);

    const entries: HistoryEntry[] = lines.map(
      (line) => JSON.parse(line) as HistoryEntry,
    );

    // Return newest-first, capped to limit.
    return entries.reverse().slice(0, limit);
  }

  /**
   * Simple line-by-line diff between two snapshots of the same skill.
   */
  diff(
    skillName: string,
    fromVersion: string,
    toVersion: string,
  ): { added: string[]; removed: string[]; unchanged: number } {
    const contentA = this.rollback(skillName, fromVersion);
    const contentB = this.rollback(skillName, toVersion);
    return lineDiff(contentA, contentB);
  }

  /**
   * Returns the latest snapshot whose status is not `discarded`.
   * Returns `undefined` when no qualifying snapshot exists.
   */
  getActiveVersion(skillName: string): SkillSnapshot | undefined {
    const entries = this.history(skillName);
    // Build a status map: last status entry per versionId wins.
    const statusMap = new Map<string, HistoryEntry>();
    // history() returns newest-first; we want last-write-wins so iterate
    // in chronological order (reverse of what history() gives us).
    const chronological = [...entries].reverse();
    for (const entry of chronological) {
      statusMap.set(entry.versionId, entry);
    }

    // Walk newest-first and find the first non-discarded version.
    for (const entry of entries) {
      const effective = statusMap.get(entry.versionId)!;
      if (effective.status !== 'discarded') {
        const filePath = join(
          this.skillDir(skillName),
          `${effective.versionId}.md`,
        );
        if (!existsSync(filePath)) continue;
        const content = readFileSync(filePath, 'utf-8');
        return { ...effective, content };
      }
    }

    return undefined;
  }

  /**
   * Mark a snapshot as discarded by appending a status-change entry to the
   * history log. The original snapshot file is **not** deleted.
   */
  markDiscarded(
    skillName: string,
    versionId: string,
    reason: string,
  ): void {
    const skillDir = this.skillDir(skillName);
    const historyPath = join(skillDir, 'history.jsonl');

    const entry: HistoryEntry = {
      versionId,
      skillName,
      timestamp: new Date().toISOString(),
      author: 'agent',
      changeDescription: `discarded: ${reason}`,
      status: 'discarded',
    };

    appendFileSync(historyPath, JSON.stringify(entry) + '\n', 'utf-8');
    logger.debug(
      `[versioning] ${skillName}@${versionId} marked discarded – ${reason}`,
    );
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private skillDir(skillName: string): string {
    return join(this.basePath, skillName);
  }
}
