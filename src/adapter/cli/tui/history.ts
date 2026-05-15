/**
 * Persistent input history for the TUI editor.
 *
 * Format: JSON-lines at ~/.beeclaw_history. One submission per line:
 *   {"ts":"2026-05-15T10:00:00Z","line":"hello\nworld"}
 *
 * JSON-lines was picked over plain newline-separated because user
 * input may legitimately contain '\n' (multi-line prompts) which would
 * otherwise corrupt entry boundaries. The minor parse cost is fine —
 * load happens once at TUI mount.
 *
 * Caps at 1000 entries (oldest dropped on each append). Consecutive
 * duplicates are coalesced — pressing Up just to glance at the
 * previous prompt and re-submitting unchanged shouldn't double-up.
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

const MAX_ENTRIES = 1000;
const DEFAULT_HISTORY_PATH = path.join(homedir(), '.beeclaw_history');

interface HistoryEntry {
  ts: string;
  line: string;
}

/**
 * Load history from disk. Returns lines in MOST-RECENT-FIRST order so
 * the editor's history[0] is "the last thing the user typed".
 * Malformed JSON lines are skipped (forward-compat: we may extend the
 * row shape later and don't want old beeclaw to die on it).
 */
export function loadHistory(filePath: string = DEFAULT_HISTORY_PATH): string[] {
  if (!fs.existsSync(filePath)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const row of raw.split('\n')) {
    if (!row.trim()) continue;
    try {
      const parsed = JSON.parse(row) as HistoryEntry;
      if (typeof parsed.line === 'string' && parsed.line.length > 0) {
        out.push(parsed.line);
      }
    } catch {
      // Skip malformed lines.
    }
  }
  // File is append-ordered (oldest first). Reverse so [0] = newest.
  return out.reverse();
}

/**
 * Append a single submission to history. Coalesces consecutive
 * duplicates (vs the file's last entry) and rotates the file when it
 * grows past MAX_ENTRIES.
 *
 * Best-effort — failures (read-only filesystem, missing parent dir)
 * are swallowed because losing a history entry should never block the
 * chat loop.
 */
export function appendHistory(line: string, filePath: string = DEFAULT_HISTORY_PATH): void {
  const trimmed = line; // do NOT trim — multi-line entries may end \n intentionally
  if (!trimmed) return;

  try {
    // Dedup against the last on-disk entry.
    if (fs.existsSync(filePath)) {
      const existing = loadHistory(filePath);
      // existing is newest-first; existing[0] is most recent.
      if (existing.length > 0 && existing[0] === trimmed) return;
    } else {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const entry: HistoryEntry = {
      ts: new Date().toISOString(),
      line: trimmed,
    };
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');

    // Rotate if we crossed the cap. Cheap full-rewrite — the file is
    // always small relative to typical disk write throughput.
    const all = loadHistory(filePath); // newest-first
    if (all.length > MAX_ENTRIES) {
      const kept = all.slice(0, MAX_ENTRIES); // keep the newest N
      // Write back oldest-first.
      const rewritten = kept
        .reverse()
        .map(l => JSON.stringify({ ts: new Date().toISOString(), line: l }) + '\n')
        .join('');
      fs.writeFileSync(filePath, rewritten);
    }
  } catch {
    // Drop on the floor.
  }
}

/** Test helper. */
export function getDefaultHistoryPath(): string {
  return DEFAULT_HISTORY_PATH;
}
