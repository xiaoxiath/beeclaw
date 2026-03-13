/**
 * Test P3 Module Integration
 *
 * This test file validates that the P3 optimization modules
 * can initialize and work together correctly.
 *
 * Run with: bun test tests/integration/p3-integration.test.ts
 */

import { describe, test, expect, beforeAll } from 'bun:test';

describe('P3 Module Integration', () => {
  test('Logger should configure', async () => {
    const { logger } = await import('../../src/infra/observability/logger');

    // Configure logger
    logger.configure({
      level: 'info',
      format: 'pretty',
    });

    // Should not throw
    logger.info('Test log message');
    expect(true).toBe(true);
  });

  test('Embedding Provider should create', async () => {
    const { LocalEmbeddingProvider } = await import('../../src/domain/memory/embeddings');

    // Test local provider (no API key required)
    const localProvider = new LocalEmbeddingProvider();
    expect(localProvider.id).toBe('local');
    expect(localProvider.dims).toBe(256);

    const embedding = await localProvider.embed('test text');
    expect(embedding.length).toBe(256);

    // Test batch embedding
    const embeddings = await localProvider.embedBatch(['text 1', 'text 2']);
    expect(embeddings.length).toBe(2);
    expect(embeddings[0].length).toBe(256);
  });

  test('Vector Store should initialize', async () => {
    const { VectorMemoryStore, setEmbeddingProvider } = await import('../../src/domain/memory/vector-store');
    const { LocalEmbeddingProvider } = await import('../../src/domain/memory/embeddings');

    const localProvider = new LocalEmbeddingProvider();
    setEmbeddingProvider({
      embed: async (text) => localProvider.embed(text),
      embedBatch: async (texts) => localProvider.embedBatch(texts),
      dimensions: 256,
      name: 'local-test',
    });

    const store = new VectorMemoryStore({
      basePath: '/tmp/test-vector-store',
      autoPersist: false,
    });

    expect(store).toBeDefined();

    const stats = store.getStats();
    expect(stats.totalDocuments).toBe(0);
  });

  test('Summary Engine should initialize', async () => {
    const { SummaryEngine, setSummaryLLMProvider } = await import('../../src/domain/memory/summary-engine');

    // Create a mock LLM provider
    const mockProvider = {
      name: 'mock-summary',
      generate: async (prompt: string) => {
        return 'Mock summary: The user discussed testing and integration.';
      },
    };

    setSummaryLLMProvider(mockProvider);

    const engine = new SummaryEngine({
      llmThresholdTokens: 100,
      fallbackToRules: true,
    });

    expect(engine).toBeDefined();
  });

  test('Lifecycle Manager should initialize', async () => {
    const { getLifecycleManager } = await import('../../src/domain/memory/lifecycle-manager');

    const manager = getLifecycleManager({
      basePath: '/tmp/test-lifecycle',
      autoCleanupIntervalMs: 0,
    });

    expect(manager).toBeDefined();
  });

  test('Reflection Engine should initialize', async () => {
    const { getReflectionEngine } = await import('../../src/domain/agent/reflection-engine');

    const engine = getReflectionEngine({
      maxConversations: 100,
      minPatternFrequency: 3,
      useLLMReflection: false,
    });

    expect(engine).toBeDefined();
  });

  test('Skill Discovery Engine should initialize', async () => {
    const { getSkillDiscoveryEngine } = await import('../../src/domain/agent/skill-discovery');

    const engine = getSkillDiscoveryEngine({
      minSequenceFrequency: 3,
      minSequenceLength: 2,
      autoPropose: false,
    });

    expect(engine).toBeDefined();
  });

  test('LocalEmbeddingProvider should generate consistent embeddings', async () => {
    const { LocalEmbeddingProvider, cosineSimilarity } = await import('../../src/domain/memory/embeddings');

    const provider = new LocalEmbeddingProvider();

    // Same text should produce same embedding
    const embedding1 = await provider.embed('hello world');
    const embedding2 = await provider.embed('hello world');
    expect(embedding1).toEqual(embedding2);

    // Similar texts should have high similarity
    const embedding3 = await provider.embed('hello universe');
    const similarity = cosineSimilarity(embedding1, embedding3);
    expect(similarity).toBeGreaterThanOrEqual(0.5); // Should be somewhat similar
  });
});
