/**
 * Test P3 Module Integration
 *
 * Run with: bun test tests/p3-integration.test.ts
 */

import { describe, test, expect, beforeAll } from 'bun:test';

describe('P3 Module Integration', () => {
  test('Config Center should initialize', async () => {
    const { initializeConfig, config } = await import('../src/utils/config-center');

    const result = initializeConfig({
      envPrefix: 'BEECLAW_TEST',
      overrides: {
        agent: {
          defaultProvider: 'test-provider',
          defaultModel: 'test-model',
          locale: 'zh-CN',
        },
      },
    });

    expect(result.errors.length).toBe(0);
    expect(config.get('agent.defaultProvider')).toBe('test-provider');
    expect(config.get('agent.defaultModel')).toBe('test-model');
  });

  test('Observability should configure', async () => {
    const { Observability, logger } = await import('../src/utils/observability');

    Observability.configure({
      level: 'info',
      structured: false,
      tracingEnabled: true,
      metricsEnabled: true,
    });

    // Should not throw
    logger.info('Test log message');
    expect(true).toBe(true);
  });

  test('Embedding Provider should create', async () => {
    const { createEmbeddingProvider, MockEmbeddingProvider } = await import('../src/providers');

    // Test mock provider
    const mockProvider = new MockEmbeddingProvider();
    expect(mockProvider.name).toBe('mock-embedding');
    expect(mockProvider.dimensions).toBe(128);

    const embedding = await mockProvider.embed('test text');
    expect(embedding.length).toBe(128);
  });

  test('Summary Provider should create', async () => {
    const { FallbackSummaryProvider } = await import('../src/providers');

    const fallbackProvider = new FallbackSummaryProvider();
    expect(fallbackProvider.name).toBe('fallback-summary');

    const result = await fallbackProvider.generate('test prompt');
    expect(result).toContain('Summary generation is disabled');
  });

  test('Vector Store should initialize', async () => {
    const { VectorMemoryStore, setEmbeddingProvider } = await import('../src/memory/vector-store');
    const { MockEmbeddingProvider } = await import('../src/providers');

    const mockProvider = new MockEmbeddingProvider();
    setEmbeddingProvider(mockProvider);

    const store = new VectorMemoryStore({
      basePath: '/tmp/test-vector-store',
      autoPersist: false,
    });

    expect(store).toBeDefined();

    const stats = store.getStats();
    expect(stats.totalDocuments).toBe(0);
  });

  test('Summary Engine should initialize', async () => {
    const { SummaryEngine, setSummaryLLMProvider } = await import('../src/memory/summary-engine');
    const { FallbackSummaryProvider } = await import('../src/providers');

    const fallbackProvider = new FallbackSummaryProvider();
    setSummaryLLMProvider(fallbackProvider);

    const engine = new SummaryEngine({
      llmThresholdTokens: 100,
      fallbackToRules: true,
    });

    expect(engine).toBeDefined();
  });

  test('Lifecycle Manager should initialize', async () => {
    const { getLifecycleManager } = await import('../src/memory/lifecycle-manager');

    const manager = getLifecycleManager({
      basePath: '/tmp/test-lifecycle',
      autoCleanupIntervalMs: 0,
    });

    expect(manager).toBeDefined();
  });

  test('Reflection Engine should initialize', async () => {
    const { getReflectionEngine } = await import('../src/agent/reflection-engine');

    const engine = getReflectionEngine({
      maxConversations: 100,
      minPatternFrequency: 3,
      useLLMReflection: false,
    });

    expect(engine).toBeDefined();
  });

  test('Skill Discovery Engine should initialize', async () => {
    const { getSkillDiscoveryEngine } = await import('../src/agent/skill-discovery');

    const engine = getSkillDiscoveryEngine({
      minSequenceFrequency: 3,
      minSequenceLength: 2,
      autoPropose: false,
    });

    expect(engine).toBeDefined();
  });
});
