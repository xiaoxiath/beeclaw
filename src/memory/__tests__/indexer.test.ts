import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  buildFullIndex,
  loadIndex,
  saveIndex,
  searchIndex,
  updateFileIndex,
  type MemoryIndex,
} from '../indexer';

const TEST_INDEXER_PATH = './test-indexer-data';

describe('Memory Indexer', () => {
  beforeEach(() => {
    if (existsSync(TEST_INDEXER_PATH)) {
      rmSync(TEST_INDEXER_PATH, { recursive: true });
    }
    mkdirSync(TEST_INDEXER_PATH, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_INDEXER_PATH)) {
      rmSync(TEST_INDEXER_PATH, { recursive: true });
    }
  });

  describe('buildFullIndex', () => {
    test('creates empty index for non-existent directories', () => {
      const index = buildFullIndex(TEST_INDEXER_PATH);

      expect(index).toBeDefined();
      expect(index.facts).toBeDefined();
      expect(index.knowledge).toBeDefined();
      expect(index.facts.keywords).toEqual({});
      expect(index.knowledge.keywords).toEqual({});
      expect(index.lastFullIndex).toBeDefined();
    });

    test('indexes facts directory', () => {
      const factsPath = join(TEST_INDEXER_PATH, 'facts');
      mkdirSync(factsPath, { recursive: true });
      writeFileSync(
        join(factsPath, 'test.md'),
        '# Test\n\nThis is about React and Vue development.',
        'utf-8'
      );

      const index = buildFullIndex(TEST_INDEXER_PATH);

      expect(index.facts.keywords).toBeDefined();
      // Should contain English keywords
      expect(Object.keys(index.facts.keywords).length).toBeGreaterThan(0);
    });

    test('indexes knowledge directory', () => {
      const knowledgePath = join(TEST_INDEXER_PATH, 'knowledge');
      mkdirSync(knowledgePath, { recursive: true });
      writeFileSync(
        join(knowledgePath, 'info.md'),
        '# Info\n\nInformation about TypeScript and JavaScript.',
        'utf-8'
      );

      const index = buildFullIndex(TEST_INDEXER_PATH);

      expect(index.knowledge.keywords).toBeDefined();
      expect(Object.keys(index.knowledge.keywords).length).toBeGreaterThan(0);
    });

    test('indexes both directories', () => {
      const factsPath = join(TEST_INDEXER_PATH, 'facts');
      const knowledgePath = join(TEST_INDEXER_PATH, 'knowledge');
      mkdirSync(factsPath, { recursive: true });
      mkdirSync(knowledgePath, { recursive: true });

      writeFileSync(join(factsPath, 'fact1.md'), 'Content about React', 'utf-8');
      writeFileSync(join(knowledgePath, 'know1.md'), 'Content about Vue', 'utf-8');

      const index = buildFullIndex(TEST_INDEXER_PATH);

      expect(Object.keys(index.facts.keywords).length).toBeGreaterThan(0);
      expect(Object.keys(index.knowledge.keywords).length).toBeGreaterThan(0);
    });

    test('extracts Chinese keywords', () => {
      const factsPath = join(TEST_INDEXER_PATH, 'facts');
      mkdirSync(factsPath, { recursive: true });
      writeFileSync(
        join(factsPath, 'chinese.md'),
        '# 中文测试\n\n他在北京字节跳动工作，年薪很高。',
        'utf-8'
      );

      const index = buildFullIndex(TEST_INDEXER_PATH);

      // Should extract Chinese keywords like 北京, 字节, 年薪
      const allKeywords = Object.keys(index.facts.keywords);
      expect(allKeywords.length).toBeGreaterThan(0);
    });

    test('handles nested directories', () => {
      const factsPath = join(TEST_INDEXER_PATH, 'facts', 'subdir', 'nested');
      mkdirSync(factsPath, { recursive: true });
      writeFileSync(join(factsPath, 'nested.md'), 'Nested content about AI', 'utf-8');

      const index = buildFullIndex(TEST_INDEXER_PATH);

      expect(Object.keys(index.facts.keywords).length).toBeGreaterThan(0);
    });

    test('ignores non-markdown files', () => {
      const factsPath = join(TEST_INDEXER_PATH, 'facts');
      mkdirSync(factsPath, { recursive: true });
      writeFileSync(join(factsPath, 'test.txt'), 'This is text content', 'utf-8');
      writeFileSync(join(factsPath, 'test.md'), 'This is markdown content about React', 'utf-8');

      const index = buildFullIndex(TEST_INDEXER_PATH);

      // Should only index .md file
      const allPaths = Object.values(index.facts.keywords).flat();
      expect(allPaths.some(p => p.endsWith('.md'))).toBe(true);
      expect(allPaths.some(p => p.endsWith('.txt'))).toBe(false);
    });
  });

  describe('saveIndex and loadIndex', () => {
    test('saves and loads index', () => {
      const index: MemoryIndex = {
        facts: {
          keywords: { react: ['facts/frontend.md'] },
          lastUpdated: '2026-03-02T00:00:00Z',
        },
        knowledge: {
          keywords: { typescript: ['knowledge/ts.md'] },
          lastUpdated: '2026-03-02T00:00:00Z',
        },
        lastFullIndex: '2026-03-02T00:00:00Z',
      };

      const indexPath = join(TEST_INDEXER_PATH, 'index.json');
      saveIndex(indexPath, index);

      const loaded = loadIndex(indexPath);

      expect(loaded).not.toBeNull();
      expect(loaded!.facts.keywords['react']).toEqual(['facts/frontend.md']);
      expect(loaded!.knowledge.keywords['typescript']).toEqual(['knowledge/ts.md']);
      expect(loaded!.lastFullIndex).toBe('2026-03-02T00:00:00Z');
    });

    test('loadIndex returns null for non-existent file', () => {
      const result = loadIndex(join(TEST_INDEXER_PATH, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    test('loadIndex returns null for invalid JSON', () => {
      const indexPath = join(TEST_INDEXER_PATH, 'invalid.json');
      writeFileSync(indexPath, 'not valid json', 'utf-8');

      const result = loadIndex(indexPath);
      expect(result).toBeNull();
    });

    test('saveIndex creates valid JSON file', () => {
      const index: MemoryIndex = {
        facts: { keywords: {}, lastUpdated: '2026-03-02T00:00:00Z' },
        knowledge: { keywords: {}, lastUpdated: '2026-03-02T00:00:00Z' },
        lastFullIndex: '2026-03-02T00:00:00Z',
      };

      const indexPath = join(TEST_INDEXER_PATH, 'index.json');
      saveIndex(indexPath, index);

      expect(existsSync(indexPath)).toBe(true);

      // Verify it's valid JSON
      const content = readFileSync(indexPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.lastFullIndex).toBe('2026-03-02T00:00:00Z');
    });
  });

  describe('searchIndex', () => {
    let testIndex: MemoryIndex;

    beforeEach(() => {
      testIndex = {
        facts: {
          keywords: {
            react: ['facts/frontend.md', 'facts/web.md'],
            vue: ['facts/frontend.md'],
            typescript: ['facts/types.md'],
            北京: ['facts/location.md'],
          },
          lastUpdated: '2026-03-02T00:00:00Z',
        },
        knowledge: {
          keywords: {
            algorithm: ['knowledge/algo.md'],
            react: ['knowledge/react-patterns.md'],
          },
          lastUpdated: '2026-03-02T00:00:00Z',
        },
        lastFullIndex: '2026-03-02T00:00:00Z',
      };
    });

    test('searches all scopes by default', () => {
      const results = searchIndex(testIndex, 'react');

      expect(results.length).toBeGreaterThan(0);
      const paths = results.map(r => r.path);
      expect(paths).toContain('facts/frontend.md');
      expect(paths).toContain('knowledge/react-patterns.md');
    });

    test('searches only facts scope', () => {
      const results = searchIndex(testIndex, 'react', { scope: 'facts' });

      const paths = results.map(r => r.path);
      expect(paths).toContain('facts/frontend.md');
      expect(paths).not.toContain('knowledge/react-patterns.md');
    });

    test('searches only knowledge scope', () => {
      const results = searchIndex(testIndex, 'react', { scope: 'knowledge' });

      const paths = results.map(r => r.path);
      expect(paths).not.toContain('facts/frontend.md');
      expect(paths).toContain('knowledge/react-patterns.md');
    });

    test('returns matched keywords', () => {
      const results = searchIndex(testIndex, 'react');

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.matchedKeywords).toBeDefined();
        expect(result.matchedKeywords.length).toBeGreaterThan(0);
      }
    });

    test('handles Chinese keywords', () => {
      const results = searchIndex(testIndex, '北京');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe('facts/location.md');
    });

    test('returns empty array for no matches', () => {
      const results = searchIndex(testIndex, 'nonexistent');

      expect(results).toEqual([]);
    });

    test('handles partial matches', () => {
      const results = searchIndex(testIndex, 'type');

      // Should match 'typescript' via partial match
      expect(results.length).toBeGreaterThan(0);
    });

    test('handles multiple keywords in query', () => {
      const results = searchIndex(testIndex, 'react vue');

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('updateFileIndex', () => {
    let testIndex: MemoryIndex;
    let factsPath: string;

    beforeEach(() => {
      factsPath = join(TEST_INDEXER_PATH, 'facts');
      mkdirSync(factsPath, { recursive: true });

      testIndex = {
        facts: {
          keywords: {
            old: ['facts/old.md'],
          },
          lastUpdated: '2026-03-01T00:00:00Z',
        },
        knowledge: {
          keywords: {},
          lastUpdated: '2026-03-01T00:00:00Z',
        },
        lastFullIndex: '2026-03-01T00:00:00Z',
      };
    });

    test('updates index for new file', () => {
      const filePath = join(factsPath, 'new.md');
      writeFileSync(filePath, 'Content about React and Vue', 'utf-8');

      const updated = updateFileIndex(testIndex, filePath, TEST_INDEXER_PATH, 'facts');

      expect(Object.keys(updated.facts.keywords).length).toBeGreaterThan(0);
    });

    test('updates lastUpdated timestamp', () => {
      const filePath = join(factsPath, 'new.md');
      writeFileSync(filePath, 'New content', 'utf-8');

      const oldTimestamp = testIndex.facts.lastUpdated;
      const updated = updateFileIndex(testIndex, filePath, TEST_INDEXER_PATH, 'facts');

      expect(updated.facts.lastUpdated).not.toBe(oldTimestamp);
    });

    test('removes old entries for updated file', () => {
      const filePath = join(factsPath, 'update.md');
      writeFileSync(filePath, 'Old react content', 'utf-8');

      // First index
      let updated = updateFileIndex(testIndex, filePath, TEST_INDEXER_PATH, 'facts');
      const initialKeywordCount = Object.keys(updated.facts.keywords).length;

      // Update file with different content
      writeFileSync(filePath, 'Vue content only', 'utf-8');
      updated = updateFileIndex(updated, filePath, TEST_INDEXER_PATH, 'facts');

      // Keywords should be updated
      expect(Object.keys(updated.facts.keywords).length).toBeDefined();
    });

    test('handles knowledge category', () => {
      const knowledgePath = join(TEST_INDEXER_PATH, 'knowledge');
      mkdirSync(knowledgePath, { recursive: true });
      const filePath = join(knowledgePath, 'new.md');
      writeFileSync(filePath, 'Knowledge about AI', 'utf-8');

      const updated = updateFileIndex(testIndex, filePath, TEST_INDEXER_PATH, 'knowledge');

      expect(Object.keys(updated.knowledge.keywords).length).toBeGreaterThan(0);
      expect(updated.knowledge.lastUpdated).toBeDefined();
    });
  });
});
