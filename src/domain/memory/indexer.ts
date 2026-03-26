/**
 * Memory Indexer
 *
 * Generates and maintains keyword index for facts/ and knowledge/ directories
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Index structure
export interface MemoryIndex {
  facts: {
    keywords: Record<string, string[]>; // keyword -> [file paths]
    lastUpdated: string;
  };
  knowledge: {
    keywords: Record<string, string[]>;
    lastUpdated: string;
  };
  lastFullIndex: string;
}

// ---------------------------------------------------------------------------
// Keyword extraction configuration
//
// TODO(i18n): The Chinese keyword patterns below are hardcoded for the
// original author's personal-assistant use case.  To support other languages
// or deployable instances, extract these into a user-facing config file
// (e.g. `data/memory/keyword-patterns.json`) that is loaded at startup.
// The config schema could look like:
//
//   interface KeywordPatternConfig {
//     locale: string;                  // e.g. "zh-CN", "en-US"
//     patterns: { label: string; regex: string; flags: string }[];
//     stopWords: string[];
//   }
//
// For now the patterns are inlined to avoid a breaking change.
// ---------------------------------------------------------------------------

/** Default Chinese keyword patterns (personal-assistant domain). */
const DEFAULT_CHINESE_PATTERNS: RegExp[] = [
  // Names (2-4 Chinese characters preceded by common surname chars)
  /([汤吴纪修][\u4e00-\u9fa5]{1,3})/g,
  // Companies / organisations
  /(A司|百度|腾讯|阿里|美团|快手|小红书|百奥赛图|特斯拉|Tesla)/g,
  // Financial terms
  /(期权|股票|基金|港股|A股|美股|存款|资产|收入|年薪|月薪|赔偿|FIRE)/g,
  // Family terms
  /(媳妇|闺女|父亲|母亲|岳母|父母|家人|带娃)/g,
  // Locations
  /(北京|新疆|石河子|海淀|永丰|海南|云南|南京|沈阳)/g,
  // Life events
  /(裁员|绩效|开学|幼儿园|面试|求职)/g,
  // Technical terms
  /(前端|全栈|React|Vue|Angular|AI|编程)/g,
];

/** Common English stop words filtered during extraction. */
const DEFAULT_ENGLISH_STOP_WORDS: string[] = [
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
  'can', 'had', 'her', 'was', 'one', 'our', 'out',
];

// Chinese word segmentation (simple approach - extract meaningful terms)
function extractChineseKeywords(text: string, patterns?: RegExp[]): string[] {
  const keywords: string[] = [];
  const activePatterns = patterns ?? DEFAULT_CHINESE_PATTERNS;

  for (const pattern of activePatterns) {
    // Reset lastIndex for global regexps that may have been reused
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] && !keywords.includes(match[1])) {
        keywords.push(match[1]);
      }
    }
  }

  return keywords;
}

// Extract English keywords
function extractEnglishKeywords(text: string, stopWords?: string[]): string[] {
  const keywords: string[] = [];
  const activeStopWords = stopWords ?? DEFAULT_ENGLISH_STOP_WORDS;

  // Match English words (3+ chars)
  const englishPattern = /\b([A-Za-z]{3,})\b/g;
  let match;
  while ((match = englishPattern.exec(text)) !== null) {
    const word = match[1].toLowerCase();
    if (!activeStopWords.includes(word) && !keywords.includes(word)) {
      keywords.push(word);
    }
  }

  return keywords;
}

// Extract all keywords from content
function extractKeywords(content: string): string[] {
  const chinese = extractChineseKeywords(content);
  const english = extractEnglishKeywords(content);
  return [...new Set([...chinese, ...english])];
}

// Index a single file
function indexFile(filePath: string, basePath: string): { path: string; keywords: string[] } {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const keywords = extractKeywords(content);
    const relativePath = filePath.replace(basePath, '').replace(/^\//, '');
    return { path: relativePath, keywords };
  } catch {
    return { path: '', keywords: [] };
  }
}

// Build index for a directory
function buildDirectoryIndex(dirPath: string, basePath: string): Record<string, string[]> {
  const keywordIndex: Record<string, string[]> = {};

  if (!existsSync(dirPath)) {
    return keywordIndex;
  }

  const processDir = (path: string) => {
    const entries = readdirSync(path, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(path, entry.name);

      if (entry.isDirectory()) {
        processDir(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const { path: relativePath, keywords } = indexFile(fullPath, basePath);

        for (const keyword of keywords) {
          if (!keywordIndex[keyword]) {
            keywordIndex[keyword] = [];
          }
          if (!keywordIndex[keyword].includes(relativePath)) {
            keywordIndex[keyword].push(relativePath);
          }
        }
      }
    }
  };

  processDir(dirPath);
  return keywordIndex;
}

// Full index rebuild
export function buildFullIndex(basePath: string): MemoryIndex {
  const now = new Date().toISOString();

  const factsPath = join(basePath, 'facts');
  const knowledgePath = join(basePath, 'knowledge');

  return {
    facts: {
      keywords: buildDirectoryIndex(factsPath, basePath),
      lastUpdated: now,
    },
    knowledge: {
      keywords: buildDirectoryIndex(knowledgePath, basePath),
      lastUpdated: now,
    },
    lastFullIndex: now,
  };
}

// Load existing index
export function loadIndex(indexPath: string): MemoryIndex | null {
  if (!existsSync(indexPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch {
    return null;
  }
}

// Save index
export function saveIndex(indexPath: string, index: MemoryIndex): void {
  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

// Search index for keywords
export function searchIndex(
  index: MemoryIndex,
  query: string,
  options?: { scope?: 'facts' | 'knowledge' | 'all' }
): { path: string; matchedKeywords: string[] }[] {
  const results: Map<string, string[]> = new Map();
  const queryKeywords = extractKeywords(query);
  const scope = options?.scope || 'all';

  const searchScope = (keywords: Record<string, string[]>) => {
    for (const queryKw of queryKeywords) {
      // Exact match
      if (keywords[queryKw]) {
        for (const path of keywords[queryKw]) {
          if (!results.has(path)) {
            results.set(path, []);
          }
          results.get(path)!.push(queryKw);
        }
      }

      // Partial match
      for (const [indexKw, paths] of Object.entries(keywords)) {
        if (indexKw.includes(queryKw) || queryKw.includes(indexKw)) {
          for (const path of paths) {
            if (!results.has(path)) {
              results.set(path, []);
            }
            if (!results.get(path)!.includes(indexKw)) {
              results.get(path)!.push(indexKw);
            }
          }
        }
      }
    }
  };

  if (scope === 'facts' || scope === 'all') {
    searchScope(index.facts.keywords);
  }
  if (scope === 'knowledge' || scope === 'all') {
    searchScope(index.knowledge.keywords);
  }

  return Array.from(results.entries()).map(([path, matchedKeywords]) => ({
    path,
    matchedKeywords,
  }));
}

// Update index for a specific file
export function updateFileIndex(
  index: MemoryIndex,
  filePath: string,
  basePath: string,
  category: 'facts' | 'knowledge'
): MemoryIndex {
  const { path: relativePath, keywords: newKeywords } = indexFile(filePath, basePath);
  const keywordIndex = category === 'facts' ? index.facts.keywords : index.knowledge.keywords;

  // Remove old entries for this file
  for (const [keyword, paths] of Object.entries(keywordIndex)) {
    keywordIndex[keyword] = paths.filter(p => p !== relativePath);
    if (keywordIndex[keyword].length === 0) {
      delete keywordIndex[keyword];
    }
  }

  // Add new entries
  for (const keyword of newKeywords) {
    if (!keywordIndex[keyword]) {
      keywordIndex[keyword] = [];
    }
    if (!keywordIndex[keyword].includes(relativePath)) {
      keywordIndex[keyword].push(relativePath);
    }
  }

  const now = new Date().toISOString();
  if (category === 'facts') {
    index.facts.lastUpdated = now;
  } else {
    index.knowledge.lastUpdated = now;
  }

  return index;
}
