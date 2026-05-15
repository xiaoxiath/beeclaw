/**
 * Fuzzy scorer for the slash-command picker.
 *
 * Pure function: given a query and a list of commands, returns the
 * top-ranked matches. Ranking favors:
 *   1. exact name match            (score 100)
 *   2. name prefix match           (score 80)
 *   3. name substring match        (score 60)
 *   4. name fuzzy match            (score 40 + similarity bonus)
 *   5. description substring match (score 20)
 *
 * Built-ins win ties over skills (subtle cohesion bias for the user).
 *
 * Empty query returns the full list in registry order, capped at limit.
 * Query without leading '/' is treated identically (caller usually
 * strips it).
 */

import type { Command } from './commands';

export interface ScoredCommand {
  command: Command;
  score: number;
}

const PREFIX_SCORE = 80;
const EXACT_SCORE = 100;
const SUBSTRING_NAME_SCORE = 60;
const FUZZY_BASE = 40;
const DESCRIPTION_SUBSTRING = 20;
const BUILTIN_BONUS = 1; // tie-break

/**
 * Loose subsequence match — every char of needle (in order) appears in
 * haystack. Returns a similarity 0..1 (longer matches relative to
 * haystack length score higher). Returns -1 on no match.
 */
function fuzzySimilarity(needle: string, haystack: string): number {
  if (!needle) return 0;
  let i = 0;
  let lastIdx = -1;
  let runs = 0;
  for (const ch of needle) {
    const idx = haystack.indexOf(ch, lastIdx + 1);
    if (idx === -1) return -1;
    if (idx === lastIdx + 1) runs++;
    lastIdx = idx;
    i++;
  }
  void i;
  // Reward dense matches; cap at 1.
  return Math.min(1, runs / Math.max(1, haystack.length));
}

export function scoreCommand(query: string, command: Command): number {
  const q = query.toLowerCase();
  const name = command.name.toLowerCase();

  if (q === '') {
    // Empty query: stable list ordering, light builtin bias.
    return command.kind === 'builtin' ? BUILTIN_BONUS : 0;
  }

  if (name === q) return EXACT_SCORE + (command.kind === 'builtin' ? BUILTIN_BONUS : 0);
  if (name.startsWith(q)) return PREFIX_SCORE + (command.kind === 'builtin' ? BUILTIN_BONUS : 0);
  if (name.includes(q)) return SUBSTRING_NAME_SCORE + (command.kind === 'builtin' ? BUILTIN_BONUS : 0);

  const fuzzy = fuzzySimilarity(q, name);
  if (fuzzy >= 0) {
    return FUZZY_BASE + Math.round(fuzzy * 20) + (command.kind === 'builtin' ? BUILTIN_BONUS : 0);
  }

  const desc = (command.description ?? '').toLowerCase();
  if (q.length >= 2 && desc.includes(q)) return DESCRIPTION_SUBSTRING;

  return 0;
}

/**
 * Rank commands by relevance. Discards score=0 entries unless the
 * query is empty (then we return all in registry order).
 */
export function rankCommands(
  query: string,
  commands: readonly Command[],
  limit: number = 5,
): ScoredCommand[] {
  const scored: ScoredCommand[] = commands
    .map(c => ({ command: c, score: scoreCommand(query, c) }))
    .filter(s => query === '' || s.score > 0);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable secondary sort by registry position.
    return commands.indexOf(a.command) - commands.indexOf(b.command);
  });
  return scored.slice(0, limit);
}
