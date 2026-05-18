import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const mockTrigger = {
  shouldTrigger: vi.fn(() => ({ trigger: false, reason: 'no trigger' })),
  resetCounter: vi.fn(),
  updateConfig: vi.fn(),
};

const mockExtractor = {
  extractIncremental: vi.fn(async () => []),
  detectSensitiveInfo: vi.fn(() => ({ shouldSkip: false, patterns: [] })),
  toItems: vi.fn(() => []),
  updateConfig: vi.fn(),
};

const mockDeduper = {
  deduplicate: vi.fn(() => ({ toAdd: [], toUpdate: [], conflicts: [] })),
};

const mockStore = {
  getAll: vi.fn(() => []),
  store: vi.fn(() => ({ added: 0, updated: 0 })),
  getPending: vi.fn(() => []),
  confirm: vi.fn(() => true),
  reject: vi.fn(() => true),
  search: vi.fn(() => []),
  getStats: vi.fn(() => ({ total: 0 })),
};

vi.mock('../trigger', () => ({
  ExtractionTrigger: vi.fn(function () { return mockTrigger; }),
  getExtractionTrigger: vi.fn(() => mockTrigger),
  resetExtractionTrigger: vi.fn(),
}));

vi.mock('../extractor', () => ({
  KnowledgeExtractor: vi.fn(function () { return mockExtractor; }),
  getKnowledgeExtractor: vi.fn(() => mockExtractor),
  initKnowledgeExtractor: vi.fn(),
  resetKnowledgeExtractor: vi.fn(),
}));

vi.mock('../deduper', () => ({
  KnowledgeDeduper: vi.fn(function () { return mockDeduper; }),
  getKnowledgeDeduper: vi.fn(() => mockDeduper),
}));

vi.mock('../store', () => ({
  KnowledgeStore: vi.fn(function () { return mockStore; }),
  getKnowledgeStore: vi.fn(() => mockStore),
  initKnowledgeStore: vi.fn(),
  resetKnowledgeStore: vi.fn(),
}));

vi.mock('../prompt', () => ({
  EXTRACTION_PROMPT: 'mock-prompt',
  INCREMENTAL_EXTRACTION_PROMPT: 'mock-inc-prompt',
  CONFLICT_DETECTION_PROMPT: 'mock-conflict-prompt',
  detectSensitiveInfo: vi.fn(() => ({ shouldSkip: false })),
  formatConversationForExtraction: vi.fn(() => ''),
  parseExtractionResult: vi.fn(() => []),
  validateExtraction: vi.fn(() => true),
}));

vi.mock('../types', () => ({
  DEFAULT_EXTRACTION_CONFIG: {
    enabled: true,
    triggerInterval: 5,
    confidenceThreshold: 0.7,
    maxExtractionsPerSession: 10,
    notifyOnHighConfidence: false,
  },
}));

vi.mock('../../../infra/config/schema', () => ({}));
vi.mock('../../agent/types', () => ({}));

import {
  ExtractionManager,
  initExtractionManager,
  getExtractionManager,
  resetExtractionManager,
} from '../index';

// ── Helpers ────────────────────────────────────────────────────────────────

const fakeProvider: any = { type: 'openai' };

// ── Re-export tests ────────────────────────────────────────────────────────

describe('extraction/index re-exports', () => {
  it('exports ExtractionManager class', () => {
    expect(ExtractionManager).toBeDefined();
    expect(typeof ExtractionManager).toBe('function');
  });

  it('exports singleton functions', () => {
    expect(typeof initExtractionManager).toBe('function');
    expect(typeof getExtractionManager).toBe('function');
    expect(typeof resetExtractionManager).toBe('function');
  });
});

// ── ExtractionManager ──────────────────────────────────────────────────────

describe('ExtractionManager', () => {
  let manager: ExtractionManager;

  beforeEach(() => {
    mockTrigger.shouldTrigger.mockReset();
    mockTrigger.resetCounter.mockReset();
    mockExtractor.extractIncremental.mockReset();
    mockExtractor.detectSensitiveInfo.mockReset();
    mockExtractor.toItems.mockReset();
    mockDeduper.deduplicate.mockReset();
    mockStore.getAll.mockReset();
    mockStore.store.mockReset();

    mockTrigger.shouldTrigger.mockReturnValue({ trigger: false, reason: 'no trigger' });
    mockExtractor.detectSensitiveInfo.mockReturnValue({ shouldSkip: false, patterns: [] });
    mockExtractor.extractIncremental.mockResolvedValue([]);
    mockExtractor.toItems.mockReturnValue([]);
    mockDeduper.deduplicate.mockReturnValue({ toAdd: [], toUpdate: [], conflicts: [] });
    mockStore.getAll.mockReturnValue([]);
    mockStore.store.mockReturnValue({ added: 0, updated: 0 });

    manager = new ExtractionManager(fakeProvider, 'gpt-4o', '/tmp/mem');
  });

  describe('shouldTrigger', () => {
    it('delegates to trigger', () => {
      const messages = [{ role: 'user', content: 'test' }] as any[];
      manager.shouldTrigger(messages);
      expect(mockTrigger.shouldTrigger).toHaveBeenCalled();
    });
  });

  describe('extract', () => {
    it('returns not triggered when trigger says no', async () => {
      mockTrigger.shouldTrigger.mockReturnValue({ trigger: false, reason: 'not yet' });
      const result = await manager.extract([{ role: 'user', content: 'hi' }] as any[]);
      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('not yet');
    });

    it('skips on sensitive info', async () => {
      mockTrigger.shouldTrigger.mockReturnValue({ trigger: true, reason: 'triggered' });
      mockExtractor.detectSensitiveInfo.mockReturnValue({ shouldSkip: true, patterns: ['password'] });

      const result = await manager.extract([{ role: 'user', content: 'my password is 123' }] as any[]);
      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('sensitive');
    });

    it('returns no-op when extractor returns empty', async () => {
      mockTrigger.shouldTrigger.mockReturnValue({ trigger: true, reason: 'triggered' });
      mockExtractor.extractIncremental.mockResolvedValue([]);

      const result = await manager.extract([{ role: 'user', content: 'hello' }] as any[]);
      expect(result.triggered).toBe(true);
      expect(result.added).toBe(0);
    });

    it('processes full extraction pipeline', async () => {
      mockTrigger.shouldTrigger.mockReturnValue({ trigger: true, reason: 'interval' });
      mockExtractor.extractIncremental.mockResolvedValue([{ key: 'lang', value: 'TypeScript' }]);
      mockExtractor.toItems.mockReturnValue([{ id: '1', key: 'lang', value: 'TypeScript', category: 'facts', confidence: 0.9, status: 'confirmed' }]);
      mockDeduper.deduplicate.mockReturnValue({
        toAdd: [{ id: '1', key: 'lang', value: 'TypeScript', category: 'facts', confidence: 0.9, status: 'confirmed' }],
        toUpdate: [],
        conflicts: [],
      });
      mockStore.store.mockReturnValue({ added: 1, updated: 0 });

      const result = await manager.extract([
        { role: 'user', content: 'I prefer TypeScript' },
        { role: 'assistant', content: 'Noted!' },
      ] as any[]);

      expect(result.triggered).toBe(true);
      expect(result.added).toBe(1);
      expect(mockTrigger.resetCounter).toHaveBeenCalled();
    });

    it('handles conflicts as pending', async () => {
      mockTrigger.shouldTrigger.mockReturnValue({ trigger: true, reason: 'triggered' });
      mockExtractor.extractIncremental.mockResolvedValue([{ key: 'k', value: 'v' }]);
      mockExtractor.toItems.mockReturnValue([{ id: '1', key: 'k', value: 'v', status: 'confirmed' }]);
      mockDeduper.deduplicate.mockReturnValue({
        toAdd: [],
        toUpdate: [],
        conflicts: [{ existing: { id: '0' }, incoming: { id: '1', key: 'k', value: 'v', status: 'confirmed' } }],
      });
      mockStore.store.mockReturnValue({ added: 0, updated: 0 });

      const result = await manager.extract([{ role: 'user', content: 'test' }] as any[]);
      expect(result.pending).toBe(1);
    });

    it('handles extraction error gracefully', async () => {
      mockTrigger.shouldTrigger.mockReturnValue({ trigger: true, reason: 'triggered' });
      mockExtractor.extractIncremental.mockRejectedValue(new Error('LLM down'));

      const result = await manager.extract([{ role: 'user', content: 'test' }] as any[]);
      expect(result.reason).toContain('failed');
    });
  });

  describe('delegated methods', () => {
    it('getPendingKnowledge delegates to store', () => {
      manager.getPendingKnowledge();
      expect(mockStore.getPending).toHaveBeenCalled();
    });

    it('confirmKnowledge delegates to store', () => {
      manager.confirmKnowledge('id1');
      expect(mockStore.confirm).toHaveBeenCalledWith('id1');
    });

    it('rejectKnowledge delegates to store', () => {
      manager.rejectKnowledge('id1');
      expect(mockStore.reject).toHaveBeenCalledWith('id1');
    });

    it('searchKnowledge delegates to store', () => {
      manager.searchKnowledge('query');
      expect(mockStore.search).toHaveBeenCalledWith('query');
    });

    it('getStats delegates to store', () => {
      manager.getStats();
      expect(mockStore.getStats).toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    it('updates trigger and extractor config', () => {
      manager.updateConfig({ triggerInterval: 10 } as any);
      expect(mockTrigger.updateConfig).toHaveBeenCalled();
      expect(mockExtractor.updateConfig).toHaveBeenCalled();
    });
  });
});

// ── Singleton ──────────────────────────────────────────────────────────────

describe('ExtractionManager singleton', () => {
  beforeEach(() => {
    resetExtractionManager();
  });

  it('throws before init', () => {
    expect(() => getExtractionManager()).toThrow('not initialized');
  });

  it('initExtractionManager creates instance', () => {
    const mgr = initExtractionManager(fakeProvider, 'gpt-4o', '/tmp/mem');
    expect(mgr).toBeInstanceOf(ExtractionManager);
  });

  it('getExtractionManager returns same instance', () => {
    initExtractionManager(fakeProvider, 'gpt-4o', '/tmp/mem');
    const a = getExtractionManager();
    const b = getExtractionManager();
    expect(a).toBe(b);
  });

  it('resetExtractionManager clears singleton', () => {
    initExtractionManager(fakeProvider, 'gpt-4o', '/tmp/mem');
    resetExtractionManager();
    expect(() => getExtractionManager()).toThrow();
  });
});
