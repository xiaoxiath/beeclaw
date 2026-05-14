/**
 * Memory Indexer
 *
 * Generates and maintains keyword index for facts/ and knowledge/ directories.
 * Keyword patterns are loaded via keyword-config.ts so operators on a
 * different locale (or different personal domain) can override without
 * forking the code.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  compilePatterns,
  getDefaultKeywordConfig,
  type KeywordPatternConfig,
} from './keyword-config';

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

/**
 * Pre-compiled extraction context. Compiling regexes once per call avoided
 * re-compilation cost when indexing thousands of files; this struct keeps
 * the same hot path while letting the config be injected.
 */
interface CompiledKeywordContext {
  patterns: RegExp[];
  stopWords: Set<string>;
}

function compileContext(config: KeywordPatternConfig): CompiledKeywordContext {
  return {
    patterns: compilePatterns(config.patterns),
    stopWords: new Set(config.stopWords.map(w => w.toLowerCase())),
  };
}

// Chinese word segmentation (simple approach - extract meaningful terms)
function extractChineseKeywords(text: string, patterns: RegExp[]): string[] {
  const keywords: string[] = [];
  for (const pattern of patterns) {
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
function extractEnglishKeywords(text: string, stopWords: Set<string>): string[] {
  const keywords: string[] = [];
  const englishPattern = /\b([A-Za-z]{3,})\b/g;
  let match;
  while ((match = englishPattern.exec(text)) !== null) {
    const word = match[1].toLowerCase();
    if (!stopWords.has(word) && !keywords.includes(word)) {
      keywords.push(word);
    }
  }
  return keywords;
}

/**
 * Extract all keywords from content using the supplied config (defaults
 * to the built-in zh-CN personal-assistant patterns).
 */
export function extractKeywords(
  content: string,
  config: KeywordPatternConfig = getDefaultKeywordConfig(),
): string[] {
  const ctx = compileContext(config);
  const chinese = extractChineseKeywords(content, ctx.patterns);
  const english = extractEnglishKeywords(content, ctx.stopWords);
  return [...new Set([...chinese, ...english])];
}

// Index a single file
function indexFile(
  filePath: string,
  basePath: string,
  config: KeywordPatternConfig,
): { path: string; keywords: string[] } {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const keywords = extractKeywords(content, config);
    const relativePath = filePath.replace(basePath, '').replace(/^\//, '');
    return { path: relativePath, keywords };
  } catch {
    return { path: '', keywords: [] };
  }
}

// Build index for a directory
function buildDirectoryIndex(
  dirPath: string,
  basePath: string,
  config: KeywordPatternConfig,
): Record<string, string[]> {
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
        const { path: relativePath, keywords } = indexFile(fullPath, basePath, config);

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

/**
 * Full index rebuild.
 *
 * Accepts an optional KeywordPatternConfig; when omitted, falls back to
 * the built-in defaults (preserves prior behaviour for existing callers).
 */
export function buildFullIndex(
  basePath: string,
  config: KeywordPatternConfig = getDefaultKeywordConfig(),
): MemoryIndex {
  const now = new Date().toISOString();

  const factsPath = join(basePath, 'facts');
  const knowledgePath = join(basePath, 'knowledge');

  return {
    facts: {
      keywords: buildDirectoryIndex(factsPath, basePath, config),
      lastUpdated: now,
    },
    knowledge: {
      keywords: buildDirectoryIndex(knowledgePath, basePath, config),
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

/**
 * Search index for keywords. Uses the same config as indexing if supplied —
 * critical when patterns are user-customised, otherwise the query won't
 * extract the same keyword set the index stored.
 */
export function searchIndex(
  index: MemoryIndex,
  query: string,
  options?: { scope?: 'facts' | 'knowledge' | 'all'; config?: KeywordPatternConfig },
): { path: string; matchedKeywords: string[] }[] {
  const results: Map<string, string[]> = new Map();
  const queryKeywords = extractKeywords(query, options?.config);
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

/**
 * Incrementally update the index for a single file (re-index that file in
 * place). Removes any prior entries for the file's relative path and
 * re-extracts keywords with the supplied config (defaults to built-in).
 */
export function updateFileIndex(
  index: MemoryIndex,
  filePath: string,
  basePath: string,
  category: 'facts' | 'knowledge',
  config: KeywordPatternConfig = getDefaultKeywordConfig(),
): MemoryIndex {
  const { path: relativePath, keywords: newKeywords } = indexFile(filePath, basePath, config);
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
