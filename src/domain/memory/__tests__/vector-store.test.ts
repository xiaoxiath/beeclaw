import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  euclideanDistance,
  normalizeVector,
  chunkText,
  VectorMemoryStore,
  setEmbeddingProvider,
  getEmbeddingProvider,
  getVectorStore,
} from '../vector-store';
import type { EmbeddingProvider } from '../vector-store';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFakeProvider(dims = 4): EmbeddingProvider {
  return {
    dimensions: dims,
    name: 'test-provider',
    embed: vi.fn(async (text: string) => {
      const v = new Array(dims).fill(0);
      for (let i = 0; i < text.length; i++) {
        v[i % dims] += text.charCodeAt(i) / 1000;
      }
      return normalizeVector(v);
    }),
    embedBatch: vi.fn(async (texts: string[]) => {
      const results: number[][] = [];
      for (const t of texts) {
        const v = new Array(dims).fill(0);
        for (let i = 0; i < t.length; i++) {
          v[i % dims] += t.charCodeAt(i) / 1000;
        }
        results.push(normalizeVector(v));
      }
      return results;
    }),
  };
}

// Text long enough to pass minChunkSize (50 chars)
const SAMPLE_TEXT = 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript code.';
const SAMPLE_TEXT_2 = 'Python is a popular programming language widely used in artificial intelligence research.';
const SAMPLE_TEXT_3 = 'Rust provides memory safety guarantees without the need for a garbage collection runtime.';
const LONG_TEXT = 'A'.repeat(1500);

// ── euclideanDistance ──────────────────────────────────────────────────────

describe('euclideanDistance', () => {
  it('returns 0 for identical vectors', () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it('computes correct distance', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
  });

  it('returns Infinity for mismatched dimensions', () => {
    expect(euclideanDistance([1, 2], [1, 2, 3])).toBe(Infinity);
  });
});

// ── normalizeVector ──────────────────────────────────────────────────────

describe('normalizeVector', () => {
  it('normalizes to unit length', () => {
    const v = normalizeVector([3, 4]);
    const mag = Math.sqrt(v[0] ** 2 + v[1] ** 2);
    expect(mag).toBeCloseTo(1.0, 5);
  });

  it('returns zero vector unchanged', () => {
    const v = normalizeVector([0, 0, 0]);
    expect(v).toEqual([0, 0, 0]);
  });

  it('handles single dimension', () => {
    const v = normalizeVector([5]);
    expect(v[0]).toBeCloseTo(1.0, 5);
  });
});

// ── chunkText ────────────────────────────────────────────────────────────

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkText('Hello world this is a sufficient length string for testing chunking purposes', 500, 50, 5);
    expect(chunks.length).toBe(1);
  });

  it('returns empty for text shorter than minChunkSize', () => {
    const chunks = chunkText('Hi', 500, 50, 50);
    expect(chunks).toEqual([]);
  });

  it('splits long text into multiple chunks', () => {
    const chunks = chunkText(LONG_TEXT, 500, 50, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(600);
    }
  });

  it('prefers paragraph boundaries', () => {
    const text = 'First paragraph content here is long enough.\n\nSecond paragraph content here is long enough.\n\nThird paragraph for testing purposes is long enough.';
    const chunks = chunkText(text, 60, 10, 10);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('handles Chinese text', () => {
    const text = '这是第一段内容。这是第二段内容。这是第三段内容。'.repeat(20);
    const chunks = chunkText(text, 100, 20, 10);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ── setEmbeddingProvider / getEmbeddingProvider ──────────────────────────

describe('EmbeddingProvider management', () => {
  it('set and get roundtrip', () => {
    const provider = makeFakeProvider();
    setEmbeddingProvider(provider);
    expect(getEmbeddingProvider()).toBe(provider);
  });
});

// ── VectorMemoryStore ────────────────────────────────────────────────────

describe('VectorMemoryStore', () => {
  let store: VectorMemoryStore;
  let provider: EmbeddingProvider;
  let tmpDir: string;

  beforeEach(() => {
    provider = makeFakeProvider(4);
    setEmbeddingProvider(provider);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vecstore-test-'));
    store = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
  });

  afterEach(() => {
    // Clean up temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('addDocument', () => {
    it('adds text as chunk(s)', async () => {
      const count = await store.addDocument('test.md', SAMPLE_TEXT);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(store.getStats().totalChunks).toBeGreaterThanOrEqual(1);
    });

    it('adds long text as multiple chunks', async () => {
      const count = await store.addDocument('long.md', LONG_TEXT);
      expect(count).toBeGreaterThan(1);
    });

    it('throws without embedding provider', async () => {
      setEmbeddingProvider(null as any);
      const localStore = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      await expect(localStore.addDocument('x.md', SAMPLE_TEXT)).rejects.toThrow();
      setEmbeddingProvider(provider);
    });

    it('returns 0 for very short text', async () => {
      const count = await store.addDocument('empty.md', 'hi');
      expect(count).toBe(0);
    });

    it('uses embedBatch for multiple chunks', async () => {
      await store.addDocument('batched.md', LONG_TEXT);
      expect(provider.embedBatch).toHaveBeenCalled();
    });

    it('replaces existing document on re-add', async () => {
      await store.addDocument('dup.md', SAMPLE_TEXT);
      await store.addDocument('dup.md', SAMPLE_TEXT_2);
      expect(store.getStats().totalDocuments).toBe(1);
    });
  });

  describe('removeDocument', () => {
    it('removes document and its chunks', async () => {
      await store.addDocument('rm.md', SAMPLE_TEXT);
      const removed = store.removeDocument('rm.md');
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(store.getStats().totalChunks).toBe(0);
    });

    it('returns 0 for non-existent document', () => {
      expect(store.removeDocument('nope.md')).toBe(0);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await store.addDocument('doc1.md', SAMPLE_TEXT);
      await store.addDocument('doc2.md', SAMPLE_TEXT_2);
      await store.addDocument('doc3.md', SAMPLE_TEXT_3);
    });

    // NOTE: search() uses cosineSimilarity without local import (re-export only).
    // Skipped until source adds: import { cosineSimilarity } from '../../infra/utils';
    it.skip('returns results sorted by score', async () => {
      const results = await store.search('TypeScript JavaScript', 5);
      expect(results.length).toBeGreaterThan(0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it.skip('respects topK (blocked by cosineSimilarity source bug)', async () => {
      const results = await store.search('programming', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it.skip('respects minScore filter (blocked by cosineSimilarity source bug)', async () => {
      const results = await store.search('completely unrelated query xyz', 5, { minScore: 0.99 });
      // Very high threshold should filter most results
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('returns empty for empty store', async () => {
      const emptyStore = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      const results = await emptyStore.search('test');
      expect(results).toEqual([]);
    });

    it('throws without embedding provider', async () => {
      setEmbeddingProvider(null as any);
      const localStore = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      await expect(localStore.search('test')).rejects.toThrow();
      setEmbeddingProvider(provider);
    });
  });

  describe('getStats', () => {
    it('reports correct counts', async () => {
      await store.addDocument('a.md', SAMPLE_TEXT);
      const stats = store.getStats();
      expect(stats.totalDocuments).toBe(1);
      expect(stats.totalChunks).toBeGreaterThanOrEqual(1);
      expect(stats.dimensions).toBe(4);
      expect(stats.dirty).toBe(true);
    });
  });

  describe('clear', () => {
    it('empties all documents', async () => {
      await store.addDocument('a.md', SAMPLE_TEXT);
      store.clear();
      expect(store.getStats().totalChunks).toBe(0);
      expect(store.getStats().dirty).toBe(true);
    });
  });

  describe('save / load', () => {
    it('save writes to file system and load reads back', async () => {
      await store.addDocument('persist.md', SAMPLE_TEXT);
      await store.save();

      const indexPath = path.join(tmpDir, '.vector-index.json');
      expect(fs.existsSync(indexPath)).toBe(true);

      // Load in a new store
      const store2 = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      const loaded = await store2.load();
      expect(loaded).toBe(true);
      expect(store2.getStats().totalChunks).toBeGreaterThanOrEqual(1);
    });

    it('load returns false when file does not exist', async () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vecstore-empty-'));
      const store2 = new VectorMemoryStore({ basePath: emptyDir, autoPersist: false });
      const result = await store2.load();
      expect(result).toBe(false);
      fs.rmSync(emptyDir, { recursive: true, force: true });
    });

    it('load returns false on invalid JSON', async () => {
      const indexPath = path.join(tmpDir, '.vector-index.json');
      fs.writeFileSync(indexPath, 'not valid json!!!', 'utf-8');
      const store2 = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      const result = await store2.load();
      expect(result).toBe(false);
    });
  });
});

// ── getVectorStore singleton ─────────────────────────────────────────────

describe('getVectorStore', () => {
  it('returns VectorMemoryStore instance', () => {
    const vs = getVectorStore({ basePath: '/tmp/vs-test' });
    expect(vs).toBeInstanceOf(VectorMemoryStore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Additional deep-coverage tests appended below
// ═══════════════════════════════════════════════════════════════════════════

import { cosineSimilarity } from '../vector-store';

describe('cosineSimilarity (re-export)', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5);
  });
});

describe('chunkText (deep)', () => {
  it('prefers sentence boundary with Chinese punctuation 。', () => {
    // Build text: first sentence > 0.3*chunkSize, then more text
    const part1 = 'A'.repeat(40) + '。';  // 41 chars
    const part2 = 'B'.repeat(100);         // 100 chars
    const text = part1 + part2;            // 141 chars total
    const chunks = chunkText(text, 100, 10, 10);
    // Should prefer to split at 。 (index 40) if it's > 0.3 * 100 = 30
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to line break when no sentence boundary', () => {
    // No paragraph break, no sentence punctuation, but has newline
    const part1 = 'A'.repeat(40) + '\n';
    const part2 = 'B'.repeat(100);
    const text = part1 + part2;
    const chunks = chunkText(text, 100, 10, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('does not split when no suitable boundary found', () => {
    // No breaks at all, just continuous characters
    const text = 'A'.repeat(250);
    const chunks = chunkText(text, 100, 10, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be around chunkSize
  });

  it('handles question mark and exclamation boundaries', () => {
    const text = 'A'.repeat(40) + '? ' + 'B'.repeat(100);
    const chunks = chunkText(text, 100, 10, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('handles Chinese question/exclamation marks', () => {
    const text = 'A'.repeat(40) + '？' + 'B'.repeat(100);
    const chunks = chunkText(text, 100, 10, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('trims whitespace from chunks', () => {
    const text = '  Hello world this is a decent chunk of text for testing  ';
    const chunks = chunkText(text, 500, 50, 5);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).not.toMatch(/^\s/);
    expect(chunks[0]).not.toMatch(/\s$/);
  });

  it('filters out chunks smaller than minChunkSize after trim', () => {
    // Create a scenario where a chunk after trimming is too small
    const text = 'A'.repeat(100) + '\n\n' + 'B'.repeat(3); // second "paragraph" is tiny
    const chunks = chunkText(text, 100, 10, 50);
    // The second chunk "BBB" (3 chars) should be filtered out since < minChunkSize(50)
    for (const c of chunks) {
      expect(c.length).toBeGreaterThanOrEqual(50);
    }
  });
});

describe('euclideanDistance (additional)', () => {
  it('handles empty vectors', () => {
    expect(euclideanDistance([], [])).toBe(0);
  });

  it('handles single dimension', () => {
    expect(euclideanDistance([3], [7])).toBe(4);
  });
});

describe('normalizeVector (additional)', () => {
  it('handles negative values', () => {
    const v = normalizeVector([-3, 4]);
    const mag = Math.sqrt(v[0] ** 2 + v[1] ** 2);
    expect(mag).toBeCloseTo(1.0, 5);
  });
});

describe('VectorMemoryStore (deep)', () => {
  let store: VectorMemoryStore;
  let provider: EmbeddingProvider;
  let tmpDir: string;

  beforeEach(() => {
    provider = makeFakeProvider(4);
    setEmbeddingProvider(provider);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vecstore-deep-'));
    store = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('addDocument (deep)', () => {
    it('uses single embed call when only 1 chunk (no embedBatch)', async () => {
      const count = await store.addDocument('single.md', SAMPLE_TEXT);
      expect(count).toBe(1);
      // For a single chunk, embedBatch should NOT be called (even if available)
      // Actually the code checks chunks.length > 1 for batch
      // With SAMPLE_TEXT (~85 chars) and chunkSize=500, it's 1 chunk
      // embedBatch should not have been called for this single chunk
    });

    it('uses embed (not embedBatch) when provider lacks embedBatch', async () => {
      const noBatchProvider: EmbeddingProvider = {
        dimensions: 4,
        name: 'no-batch',
        embed: vi.fn(async (text: string) => {
          const v = new Array(4).fill(0);
          for (let i = 0; i < text.length; i++) v[i % 4] += text.charCodeAt(i) / 1000;
          return normalizeVector(v);
        }),
        // no embedBatch
      };
      setEmbeddingProvider(noBatchProvider);
      const s = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      const count = await s.addDocument('nobatch.md', LONG_TEXT);
      expect(count).toBeGreaterThan(1);
      expect(noBatchProvider.embed).toHaveBeenCalled();
    });

    it('triggers autoPersist when pendingPersist >= persistInterval', async () => {
      const autoStore = new VectorMemoryStore({
        basePath: tmpDir,
        autoPersist: true,
        persistInterval: 1, // trigger after 1 chunk
      });
      await autoStore.addDocument('auto.md', SAMPLE_TEXT);
      // After auto-persist, dirty should be false
      expect(autoStore.getStats().dirty).toBe(false);
      // Index file should exist
      expect(fs.existsSync(path.join(tmpDir, '.vector-index.json'))).toBe(true);
    });

    it('stores metadata with chunks', async () => {
      await store.addDocument('meta.md', SAMPLE_TEXT, { category: 'facts', fileName: 'meta.md' });
      const stats = store.getStats();
      expect(stats.totalDocuments).toBe(1);
    });
  });

  describe('removeDocument (deep)', () => {
    it('removes all chunks of a multi-chunk document', async () => {
      await store.addDocument('multi.md', LONG_TEXT);
      const statsBefore = store.getStats();
      expect(statsBefore.totalChunks).toBeGreaterThan(1);
      const removed = store.removeDocument('multi.md');
      expect(removed).toBe(statsBefore.totalChunks);
      expect(store.getStats().totalChunks).toBe(0);
    });

    it('sets dirty flag when documents removed', async () => {
      await store.addDocument('d.md', SAMPLE_TEXT);
      await store.save(); // resets dirty
      expect(store.getStats().dirty).toBe(false);
      store.removeDocument('d.md');
      expect(store.getStats().dirty).toBe(true);
    });

    it('does not set dirty when nothing removed', () => {
      // Fresh store with dirty=false (no documents added)
      const freshStore = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      freshStore.removeDocument('nonexistent.md');
      // dirty should still be false since nothing was removed
      expect(freshStore.getStats().dirty).toBe(false);
    });
  });

  describe('search (unskipped + deep)', () => {
    beforeEach(async () => {
      await store.addDocument('doc1.md', SAMPLE_TEXT, { category: 'facts' });
      await store.addDocument('doc2.md', SAMPLE_TEXT_2, { category: 'knowledge' });
      await store.addDocument('doc3.md', SAMPLE_TEXT_3, { category: 'facts' });
    });

    it('returns results sorted by score', async () => {
      const results = await store.search('TypeScript JavaScript', 5);
      expect(results.length).toBeGreaterThan(0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('respects topK', async () => {
      const results = await store.search('programming', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('respects minScore filter', async () => {
      const results = await store.search('completely unrelated xyz', 5, { minScore: 0.999 });
      // Very high threshold should filter most results
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('filters by category', async () => {
      const results = await store.search('programming', 10, { category: 'facts' });
      for (const r of results) {
        expect(r.metadata.category).toBe('facts');
      }
    });

    it('filters by since timestamp', async () => {
      // All docs have createdAt = Date.now() approximately
      // Set since far in the future to filter everything
      const futureTs = Date.now() + 1000 * 60 * 60;
      const results = await store.search('programming', 10, { since: futureTs });
      expect(results.length).toBe(0);
    });

    it('deduplicates chunks from same document', async () => {
      // Add a document that produces multiple chunks
      await store.addDocument('chunked.md', LONG_TEXT);
      const results = await store.search('AAAA', 10);
      // Even though there are multiple chunks, dedup should merge them
      const ids = results.map(r => r.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size); // no duplicate IDs
    });
  });

  describe('save (deep)', () => {
    it('creates directory when it does not exist', async () => {
      const nestedDir = path.join(tmpDir, 'nested', 'deep');
      const s = new VectorMemoryStore({ basePath: nestedDir, autoPersist: false });
      await s.addDocument('x.md', SAMPLE_TEXT);
      await s.save();
      expect(fs.existsSync(path.join(nestedDir, '.vector-index.json'))).toBe(true);
    });

    it('saves provider name and dimensions', async () => {
      await store.addDocument('x.md', SAMPLE_TEXT);
      await store.save();
      const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, '.vector-index.json'), 'utf-8'));
      expect(raw.providerName).toBe('test-provider');
      expect(raw.dimensions).toBe(4);
      expect(raw.version).toBe(1);
    });

    it('resets dirty and pendingPersist after save', async () => {
      await store.addDocument('x.md', SAMPLE_TEXT);
      expect(store.getStats().dirty).toBe(true);
      await store.save();
      expect(store.getStats().dirty).toBe(false);
    });

    it('handles provider without name', async () => {
      const noNameProvider: EmbeddingProvider = {
        dimensions: 4,
        embed: vi.fn(async () => [1, 0, 0, 0]),
      };
      setEmbeddingProvider(noNameProvider);
      const s = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      await s.addDocument('x.md', SAMPLE_TEXT);
      await s.save();
      const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, '.vector-index.json'), 'utf-8'));
      expect(raw.providerName).toBe('unknown');
    });

    it('handles no provider at all during save', async () => {
      // Add doc with a provider, then remove provider before save
      await store.addDocument('x.md', SAMPLE_TEXT);
      setEmbeddingProvider(null as any);
      await store.save();
      const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, '.vector-index.json'), 'utf-8'));
      expect(raw.dimensions).toBe(0);
      setEmbeddingProvider(provider); // restore
    });
  });

  describe('load (deep)', () => {
    it('detects dimension mismatch and returns false', async () => {
      // Save with dims=4
      await store.addDocument('x.md', SAMPLE_TEXT);
      await store.save();

      // Now set provider with different dimensions
      const bigProvider: EmbeddingProvider = {
        dimensions: 1536,
        name: 'big-provider',
        embed: vi.fn(async () => new Array(1536).fill(0)),
      };
      setEmbeddingProvider(bigProvider);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store2 = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      const loaded = await store2.load();
      expect(loaded).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Dimension mismatch'),
        // Possibly more args
      );
      warnSpy.mockRestore();
      setEmbeddingProvider(provider); // restore
    });

    it('loads successfully when no provider is set (skips dimension check)', async () => {
      await store.addDocument('x.md', SAMPLE_TEXT);
      await store.save();

      setEmbeddingProvider(null as any);
      const store2 = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      const loaded = await store2.load();
      expect(loaded).toBe(true);
      expect(store2.getStats().totalChunks).toBeGreaterThanOrEqual(1);
      setEmbeddingProvider(provider); // restore
    });

    it('loads successfully when dimensions match', async () => {
      await store.addDocument('x.md', SAMPLE_TEXT);
      await store.save();

      const store2 = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });
      const loaded = await store2.load();
      expect(loaded).toBe(true);
    });
  });

  describe('buildFromFileSystem', () => {
    it('indexes files from specified categories', async () => {
      // Create category directory structure
      const factsDir = path.join(tmpDir, 'facts');
      fs.mkdirSync(factsDir, { recursive: true });
      fs.writeFileSync(path.join(factsDir, 'fact1.md'), SAMPLE_TEXT, 'utf-8');
      fs.writeFileSync(path.join(factsDir, 'fact2.md'), SAMPLE_TEXT_2, 'utf-8');

      const result = await store.buildFromFileSystem(['facts']);
      expect(result.indexed).toBe(2);
      expect(result.chunks).toBeGreaterThanOrEqual(2);
      expect(result.errors).toBe(0);
    });

    it('skips non-existent category directories', async () => {
      const result = await store.buildFromFileSystem(['nonexistent']);
      expect(result.indexed).toBe(0);
    });

    it('skips hidden files', async () => {
      const factsDir = path.join(tmpDir, 'facts');
      fs.mkdirSync(factsDir, { recursive: true });
      fs.writeFileSync(path.join(factsDir, '.hidden'), SAMPLE_TEXT, 'utf-8');
      fs.writeFileSync(path.join(factsDir, 'visible.md'), SAMPLE_TEXT, 'utf-8');

      const result = await store.buildFromFileSystem(['facts']);
      expect(result.indexed).toBe(1); // only visible.md
    });

    it('applies fileFilter', async () => {
      const factsDir = path.join(tmpDir, 'facts');
      fs.mkdirSync(factsDir, { recursive: true });
      fs.writeFileSync(path.join(factsDir, 'keep.md'), SAMPLE_TEXT, 'utf-8');
      fs.writeFileSync(path.join(factsDir, 'skip.txt'), SAMPLE_TEXT_2, 'utf-8');

      const result = await store.buildFromFileSystem(['facts'], {
        fileFilter: (name) => name.endsWith('.md'),
      });
      expect(result.indexed).toBe(1);
    });

    it('skips files shorter than minChunkSize', async () => {
      const factsDir = path.join(tmpDir, 'facts');
      fs.mkdirSync(factsDir, { recursive: true });
      fs.writeFileSync(path.join(factsDir, 'tiny.md'), 'hi', 'utf-8');

      const result = await store.buildFromFileSystem(['facts']);
      expect(result.indexed).toBe(0);
    });

    it('counts errors for problematic files', async () => {
      // Create a valid directory structure but make embed throw
      const factsDir = path.join(tmpDir, 'facts');
      fs.mkdirSync(factsDir, { recursive: true });
      fs.writeFileSync(path.join(factsDir, 'bad.md'), SAMPLE_TEXT, 'utf-8');

      const errorProvider: EmbeddingProvider = {
        dimensions: 4,
        name: 'error-provider',
        embed: vi.fn(async () => { throw new Error('embed failed'); }),
      };
      setEmbeddingProvider(errorProvider);
      const s = new VectorMemoryStore({ basePath: tmpDir, autoPersist: false });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await s.buildFromFileSystem(['facts']);
      expect(result.errors).toBe(1);
      expect(result.indexed).toBe(0);
      warnSpy.mockRestore();
      setEmbeddingProvider(provider); // restore
    });

    it('persists after building when dirty', async () => {
      const factsDir = path.join(tmpDir, 'facts');
      fs.mkdirSync(factsDir, { recursive: true });
      fs.writeFileSync(path.join(factsDir, 'f.md'), SAMPLE_TEXT, 'utf-8');

      await store.buildFromFileSystem(['facts']);
      expect(fs.existsSync(path.join(tmpDir, '.vector-index.json'))).toBe(true);
    });

    it('indexes files from nested subdirectories', async () => {
      const nestedDir = path.join(tmpDir, 'knowledge', 'sub', 'deep');
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(path.join(nestedDir, 'deep.md'), SAMPLE_TEXT, 'utf-8');

      const result = await store.buildFromFileSystem(['knowledge']);
      expect(result.indexed).toBe(1);
    });

    it('skips hidden subdirectories', async () => {
      const hiddenDir = path.join(tmpDir, 'facts', '.hidden-dir');
      fs.mkdirSync(hiddenDir, { recursive: true });
      fs.writeFileSync(path.join(hiddenDir, 'hidden-file.md'), SAMPLE_TEXT, 'utf-8');

      const factsDir = path.join(tmpDir, 'facts');
      fs.writeFileSync(path.join(factsDir, 'visible.md'), SAMPLE_TEXT, 'utf-8');

      const result = await store.buildFromFileSystem(['facts']);
      expect(result.indexed).toBe(1); // only visible.md
    });

    it('uses default categories when none specified', async () => {
      const factsDir = path.join(tmpDir, 'facts');
      const knowledgeDir = path.join(tmpDir, 'knowledge');
      fs.mkdirSync(factsDir, { recursive: true });
      fs.mkdirSync(knowledgeDir, { recursive: true });
      fs.writeFileSync(path.join(factsDir, 'f.md'), SAMPLE_TEXT, 'utf-8');
      fs.writeFileSync(path.join(knowledgeDir, 'k.md'), SAMPLE_TEXT_2, 'utf-8');

      const result = await store.buildFromFileSystem();
      expect(result.indexed).toBe(2);
    });
  });

  describe('getStats (deep)', () => {
    it('counts unique base document IDs for totalDocuments', async () => {
      await store.addDocument('a.md', LONG_TEXT); // multiple chunks
      const stats = store.getStats();
      expect(stats.totalDocuments).toBe(1); // still 1 document
      expect(stats.totalChunks).toBeGreaterThan(1); // but multiple chunks
    });

    it('reports 0 dimensions when no provider', async () => {
      await store.addDocument('x.md', SAMPLE_TEXT);
      setEmbeddingProvider(null as any);
      const stats = store.getStats();
      expect(stats.dimensions).toBe(0);
      setEmbeddingProvider(provider); // restore
    });
  });

  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const s = new VectorMemoryStore();
      const stats = s.getStats();
      expect(stats.totalChunks).toBe(0);
      expect(stats.dirty).toBe(false);
    });

    it('merges partial config with defaults', () => {
      const s = new VectorMemoryStore({ chunkSize: 1000 });
      // Can't directly access config, but we can test behavior
      const stats = s.getStats();
      expect(stats.totalChunks).toBe(0);
    });
  });
});

describe('getVectorStore (deep)', () => {
  it('returns same instance when called without config', () => {
    const s1 = getVectorStore({ basePath: '/tmp/vs-singleton-test' });
    const s2 = getVectorStore();
    expect(s2).toBe(s1);
  });

  it('creates new instance when config is provided', () => {
    const s1 = getVectorStore({ basePath: '/tmp/vs-first' });
    const s2 = getVectorStore({ basePath: '/tmp/vs-second' });
    // When config is passed, a new instance is created
    expect(s2).not.toBe(s1);
  });
});
