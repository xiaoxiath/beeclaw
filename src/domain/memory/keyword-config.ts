/**
 * Keyword-extraction configuration.
 *
 * The memory indexer extracts keywords from facts/ and knowledge/ files
 * to build an inverted index. The default patterns were authored for the
 * project author's personal-assistant domain (Chinese names, China-region
 * companies, financial terms specific to that user's situation, etc.).
 *
 * For deployable instances or other locales, an operator can drop a
 * `keyword-patterns.json` file into the memory base path to override the
 * defaults without touching code. Schema is enforced at load time so a
 * malformed file fails fast with an actionable error rather than silently
 * dropping all extraction.
 *
 * Loader is graceful: missing file → defaults; malformed file → defaults
 * + warning log. We never throw at startup over a config-file issue.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { logger } from '../../infra/observability/logger';

/** A single named regex pattern. The `regex` field is a JS regex source. */
export const KeywordPatternSchema = z.object({
  /** Human-readable label for diagnostics; not load-bearing. */
  label: z.string().min(1),
  /** Regex source (without surrounding slashes). */
  regex: z.string().min(1),
  /** Regex flags. Defaults to 'g' (global) which the indexer needs. */
  flags: z.string().default('g'),
});

export type KeywordPattern = z.infer<typeof KeywordPatternSchema>;

/** Full keyword config. */
export const KeywordPatternConfigSchema = z.object({
  /** BCP-47 locale tag for diagnostics; not load-bearing. */
  locale: z.string().default('zh-CN'),
  /** Patterns to extract from text. Each pattern's first capture group is the keyword. */
  patterns: z.array(KeywordPatternSchema).default([]),
  /** Words filtered after extraction (case-insensitive comparison). */
  stopWords: z.array(z.string()).default([]),
});

export type KeywordPatternConfig = z.infer<typeof KeywordPatternConfigSchema>;

/** Built-in default Chinese keyword patterns (personal-assistant domain). */
export const DEFAULT_CHINESE_PATTERNS: KeywordPattern[] = [
  { label: 'cn-names',      regex: '([汤吴纪修][\\u4e00-\\u9fa5]{1,3})', flags: 'g' },
  { label: 'cn-companies',  regex: '(A司|百度|腾讯|阿里|美团|快手|小红书|百奥赛图|特斯拉|Tesla)', flags: 'g' },
  { label: 'cn-finance',    regex: '(期权|股票|基金|港股|A股|美股|存款|资产|收入|年薪|月薪|赔偿|FIRE)', flags: 'g' },
  { label: 'cn-family',     regex: '(媳妇|闺女|父亲|母亲|岳母|父母|家人|带娃)', flags: 'g' },
  { label: 'cn-locations',  regex: '(北京|新疆|石河子|海淀|永丰|海南|云南|南京|沈阳)', flags: 'g' },
  { label: 'cn-life-events', regex: '(裁员|绩效|开学|幼儿园|面试|求职)', flags: 'g' },
  { label: 'cn-tech',       regex: '(前端|全栈|React|Vue|Angular|AI|编程)', flags: 'g' },
];

/** Built-in default English stop words. */
export const DEFAULT_ENGLISH_STOP_WORDS: string[] = [
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
  'can', 'had', 'her', 'was', 'one', 'our', 'out',
];

/**
 * The shipped default config. Returns a fresh shallow copy on every call
 * so callers (and tests) cannot mutate the module-level defaults by
 * accident.
 */
export function getDefaultKeywordConfig(): KeywordPatternConfig {
  return {
    locale: 'zh-CN',
    patterns: DEFAULT_CHINESE_PATTERNS.map(p => ({ ...p })),
    stopWords: [...DEFAULT_ENGLISH_STOP_WORDS],
  };
}

/** Conventional override-file location, relative to the memory base path. */
export const KEYWORD_CONFIG_FILENAME = 'keyword-patterns.json';

/**
 * Load keyword extraction config.
 *
 *   - file missing → built-in defaults (silent — this is the common case)
 *   - file malformed → built-in defaults + warning log
 *   - file valid → parsed config
 *
 * Never throws; the memory layer must keep working even if the user dropped
 * a broken JSON file in their data directory.
 */
export function loadKeywordConfig(memoryBasePath: string): KeywordPatternConfig {
  const filePath = join(memoryBasePath, KEYWORD_CONFIG_FILENAME);
  if (!existsSync(filePath)) {
    return getDefaultKeywordConfig();
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw) as unknown;
    const parsed = KeywordPatternConfigSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        `[Memory] keyword-patterns.json failed schema validation; using defaults. ` +
        `Issues: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
      return getDefaultKeywordConfig();
    }
    return parsed.data;
  } catch (e) {
    logger.warn(
      `[Memory] keyword-patterns.json could not be loaded; using defaults. ` +
      `Reason: ${(e as Error).message}`,
    );
    return getDefaultKeywordConfig();
  }
}

/**
 * Compile a list of KeywordPattern into RegExp objects.
 * Skips invalid regexes with a warning rather than throwing.
 */
export function compilePatterns(patterns: KeywordPattern[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns) {
    try {
      out.push(new RegExp(p.regex, p.flags));
    } catch (e) {
      logger.warn(
        `[Memory] skipping invalid keyword pattern "${p.label}": ${(e as Error).message}`,
      );
    }
  }
  return out;
}
