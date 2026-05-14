/**
 * Tests for the memory_semantic_search tool — the LLM's entry point to
 * the vector store for semantic recall.
 *
 * The vector store and embedding provider singletons are mocked so the
 * tests run with no LLM API access and no fs side-effects.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetMemoryStore = vi.fn(() => ({
  ls: vi.fn(),
  grep: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  record: vi.fn(),
  searchByKeyword: vi.fn(),
  stat: vi.fn(),
}));
vi.mock('../store', () => ({ getMemoryStore: () => mockGetMemoryStore() }));

vi.mock('../compression', () => ({
  getCompressionEngine: () => ({ compress: vi.fn() }),
}));
vi.mock('../scoring', () => ({ scoreImportance: vi.fn() }));

const mockGetEmbeddingProvider = vi.fn();
const mockSearch = vi.fn();
const mockGetVectorStore = vi.fn(() => ({ search: mockSearch }));

vi.mock('../vector-store', () => ({
  getEmbeddingProvider: () => mockGetEmbeddingProvider(),
  getVectorStore: () => mockGetVectorStore(),
}));

import { executeMemoryTool, memoryTools } from '../tools';

beforeEach(() => {
  mockGetEmbeddingProvider.mockReset();
  mockSearch.mockReset();
  mockGetVectorStore.mockClear();
});

describe('memory_semantic_search — tool definition', () => {
  it('is registered in memoryTools', () => {
    expect(memoryTools.memory_semantic_search).toBeDefined();
    expect(memoryTools.memory_semantic_search.name).toBe('memory_semantic_search');
  });

  it('declares only `query` as required (topK / minScore / category optional)', () => {
    const params = memoryTools.memory_semantic_search.parameters;
    expect(params.required).toEqual(['query']);
    expect(params.properties.query).toBeDefined();
    expect(params.properties.topK).toBeDefined();
    expect(params.properties.minScore).toBeDefined();
    expect(params.properties.category).toBeDefined();
  });
});

describe('memory_semantic_search — happy path', () => {
  beforeEach(() => {
    mockGetEmbeddingProvider.mockReturnValue({ name: 'fake', embed: vi.fn() });
  });

  it('returns formatted results with score and source path', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'facts/finances.md',
        text: 'Worried about market volatility and retirement timing.',
        score: 0.87,
        metadata: { source: 'facts/finances.md', category: 'preferences' },
      },
      {
        id: 'conversations/2026-04/14.md',
        text: 'Talked through the budget for the family trip.',
        score: 0.62,
        metadata: { source: 'conversations/2026-04/14.md' },
      },
    ]);

    const result = await executeMemoryTool('memory_semantic_search', { query: 'money worries' });
    expect(result.success).toBe(true);
    expect(String(result.data)).toContain('facts/finances.md');
    expect(String(result.data)).toContain('score=0.870');
    expect(String(result.data)).toContain('Worried about market volatility');
    expect(String(result.data)).toContain('---'); // multi-result separator
  });

  it('passes topK / minScore / category through to the vector store', async () => {
    mockSearch.mockResolvedValue([]);
    await executeMemoryTool('memory_semantic_search', {
      query: 'q', topK: 7, minScore: 0.4, category: 'health',
    });
    expect(mockSearch).toHaveBeenCalledWith('q', 7, { minScore: 0.4, category: 'health' });
  });

  it('clamps topK at 20 (rejects 1000)', async () => {
    const result = await executeMemoryTool('memory_semantic_search', {
      query: 'q', topK: 1000,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/topK|less than or equal/i);
  });

  it('clamps minScore to [0, 1]', async () => {
    const result = await executeMemoryTool('memory_semantic_search', {
      query: 'q', minScore: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('truncates very long passages with an ellipsis (response stays bounded)', async () => {
    const long = 'x'.repeat(500);
    mockSearch.mockResolvedValue([{
      id: 'big.md', text: long, score: 0.5,
      metadata: { source: 'big.md' },
    }]);
    const result = await executeMemoryTool('memory_semantic_search', { query: 'q' });
    expect(String(result.data)).toContain('…');
    // Total response per passage capped — sanity check.
    expect(String(result.data).length).toBeLessThan(400);
  });

  it('returns "(no semantic matches found)" when the store returns 0 results', async () => {
    mockSearch.mockResolvedValue([]);
    const result = await executeMemoryTool('memory_semantic_search', { query: 'unmatched' });
    expect(result.success).toBe(true);
    expect(result.data).toBe('(no semantic matches found)');
  });
});

describe('memory_semantic_search — graceful degradation', () => {
  it('reports a clean error when no embedding provider is configured', async () => {
    mockGetEmbeddingProvider.mockReturnValue(null);
    const result = await executeMemoryTool('memory_semantic_search', { query: 'q' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no embedding provider/i);
    // Suggests fallbacks so the LLM can pick a different tool.
    expect(result.error).toMatch(/memory_search|memory_grep/);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('catches vector-store throws (e.g. dimension mismatch) and returns a structured error', async () => {
    mockGetEmbeddingProvider.mockReturnValue({ name: 'fake', embed: vi.fn() });
    mockSearch.mockRejectedValue(new Error('dimension mismatch: 1536 vs 768'));
    const result = await executeMemoryTool('memory_semantic_search', { query: 'q' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/dimension mismatch/);
  });

  it('rejects empty query at the schema layer', async () => {
    mockGetEmbeddingProvider.mockReturnValue({ name: 'fake', embed: vi.fn() });
    const result = await executeMemoryTool('memory_semantic_search', { query: '' });
    expect(result.success).toBe(false);
    // Should not even reach the vector store.
    expect(mockSearch).not.toHaveBeenCalled();
  });
});

describe('memory_semantic_search — Advanced tier registration', () => {
  it('is part of the advanced (conditionally-loaded) memory tool set', async () => {
    // Smoke check via the public getter; if it weren't in
    // ADVANCED_MEMORY_TOOL_NAMES the conditional loader wouldn't expose it.
    const { getAdvancedMemoryTools } = await import('../tools');
    const advanced = getAdvancedMemoryTools();
    const names = advanced.map(t => t.name);
    expect(names).toContain('memory_semantic_search');
  });
});
