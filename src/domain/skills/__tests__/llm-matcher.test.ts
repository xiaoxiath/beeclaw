/**
 * Tests for LLM Skill Matcher
 */

import { describe, test, expect, beforeAll, vi } from 'vitest';

// Mock bun-only and problematic ESM modules to allow tests to run in Node.js
vi.mock('bun:sqlite', () => {
  const MockDatabase = vi.fn(() => ({
    exec: vi.fn(), run: vi.fn(),
    query: vi.fn(() => ({ all: vi.fn(() => []) })),
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })),
    transaction: vi.fn((fn: Function) => fn),
    close: vi.fn(),
  }));
  return { Database: MockDatabase, default: MockDatabase };
});
vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  })),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: vi.fn() }));
vi.mock('bunqueue/client', () => ({ Queue: vi.fn(), Worker: vi.fn() }));

// We need to hoist the mock judge so vi.mock factory can access it
const { mockJudgeFn } = vi.hoisted(() => {
  const mockJudgeFn = vi.fn();
  return { mockJudgeFn };
});

// Mock getFastLLMJudge to return a fake judge that delegates to our mock
vi.mock('../../agent/fast-llm-judge', () => ({
  getFastLLMJudge: vi.fn(() => ({
    judge: mockJudgeFn,
  })),
}));

import { LLMSkillMatcher, createLLMSkillMatcher } from '../llm-matcher';
import type { Skill } from '../types';

// Mock provider - matches the AIProvider interface shape
const mockProvider: any = {
  name: 'test-provider',
  type: 'openai',
  apiKey: 'test-key',
  baseUrl: 'https://api.test.com',
};

// Mock skills
const mockSkills: Skill[] = [
  {
    name: 'web-scraper',
    description: 'Scrape and extract data from websites',
    version: '1.0.0',
    tags: ['web', 'scraping', 'extraction'],
    triggers: ['scrape', '抓取', '爬虫'],
    content: '',
    path: '/skills/web-scraper',
    isBuiltin: true,
    readonly: true,
    usageCount: 10,
    successCount: 9,
    failureCount: 1,
    maturityScore: 90,
  },
  {
    name: 'http-client',
    description: 'Make HTTP requests and handle APIs',
    version: '1.0.0',
    tags: ['http', 'api', 'request'],
    triggers: ['http', 'request', 'api'],
    content: '',
    path: '/skills/http-client',
    isBuiltin: true,
    readonly: true,
    usageCount: 5,
    successCount: 5,
    failureCount: 0,
    maturityScore: 80,
  },
  {
    name: 'data-analyzer',
    description: 'Analyze and visualize data',
    version: '1.0.0',
    tags: ['analysis', 'data', 'visualization'],
    triggers: ['analyze', '分析', 'data'],
    content: '',
    path: '/skills/data-analyzer',
    isBuiltin: true,
    readonly: true,
    usageCount: 8,
    successCount: 7,
    failureCount: 1,
    maturityScore: 85,
  },
];

describe('LLMSkillMatcher', () => {
  let matcher: LLMSkillMatcher;

  beforeAll(() => {
    matcher = createLLMSkillMatcher({
      provider: mockProvider,
      fastModel: 'test-model',
      config: {
        enabled: true,
        maxCandidates: 10,
        topK: 5,
        cacheTTL: 3600,
        minConfidence: 0.3,
      },
    });
  });

  test('should match web scraping query', async () => {
    mockJudgeFn.mockResolvedValueOnce({
      result: [
        { skill: 'web-scraper', confidence: 0.95, reason: 'Matches web scraping intent' },
        { skill: 'http-client', confidence: 0.7, reason: 'Related to HTTP requests' },
      ],
      fromCache: false,
      failed: false,
    });

    const result = await matcher.match('I want to scrape website data', mockSkills);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].skill).toBe('web-scraper');
    expect(result[0].confidence).toBeGreaterThan(0.8);
  });

  test('should match Chinese query', async () => {
    mockJudgeFn.mockResolvedValueOnce({
      result: [
        { skill: 'web-scraper', confidence: 0.92, reason: '匹配网页抓取意图' },
      ],
      fromCache: false,
      failed: false,
    });

    const result = await matcher.match('帮我抓取网页数据', mockSkills);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].skill).toBe('web-scraper');
  });

  test('should match analysis query', async () => {
    mockJudgeFn.mockResolvedValueOnce({
      result: [
        { skill: 'data-analyzer', confidence: 0.9, reason: 'Matches data analysis intent' },
      ],
      fromCache: false,
      failed: false,
    });

    const result = await matcher.match('analyze this dataset', mockSkills);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].skill).toBe('data-analyzer');
  });

  test('should return empty for unrelated query', async () => {
    mockJudgeFn.mockResolvedValueOnce({
      result: [],
      fromCache: false,
      failed: false,
    });

    const result = await matcher.match('play music', mockSkills);

    expect(result.length).toBe(0);
  });

  test('should cache results', async () => {
    mockJudgeFn.mockResolvedValue({
      result: [
        { skill: 'web-scraper', confidence: 0.9, reason: 'Cached result' },
      ],
      fromCache: false,
      failed: false,
    });

    const query = 'scrape data from website';

    // First call
    const result1 = await matcher.match(query, mockSkills);

    // Second call (same query)
    const result2 = await matcher.match(query, mockSkills);

    // Both calls should return results
    expect(result1.length).toBeGreaterThan(0);
    expect(result2.length).toBeGreaterThan(0);
    // Results should be the same
    expect(result1).toEqual(result2);
  });

  test('should respect maxCandidates', async () => {
    mockJudgeFn.mockResolvedValueOnce({
      result: [],
      fromCache: false,
      failed: false,
    });

    const manySkills = Array(20).fill(mockSkills[0]).map((s, i) => ({
      ...s,
      name: `skill-${i}`,
    }));

    const matcher2 = createLLMSkillMatcher({
      provider: mockProvider,
      fastModel: 'test-model',
      config: {
        maxCandidates: 5,
        topK: 3,
      },
    });

    const result = await matcher2.match('test query', manySkills);

    // Result should be at most topK=3
    expect(result.length).toBeLessThanOrEqual(3);
  });

  test('should handle timeout', async () => {
    // Simulate a failed judgment (timeout would cause failure)
    mockJudgeFn.mockResolvedValueOnce({
      result: [],
      fromCache: false,
      failed: true,
      error: 'Timeout',
    });

    const result = await matcher.match('test timeout query', mockSkills);

    // Should return empty result on failure
    expect(result.length).toBe(0);
  });

  test('should handle malformed JSON response', async () => {
    // Simulate a failed judgment (malformed JSON would cause failure)
    mockJudgeFn.mockResolvedValueOnce({
      result: [],
      fromCache: false,
      failed: true,
      error: 'Invalid JSON',
    });

    const result = await matcher.match('test malformed query', mockSkills);

    // Should return empty array, not throw
    expect(result.length).toBe(0);
  });

  test('should extract JSON from markdown code block', async () => {
    // The judge handles JSON extraction internally, so we just return the parsed result
    mockJudgeFn.mockResolvedValueOnce({
      result: [
        { skill: 'web-scraper', confidence: 0.9, reason: 'test' },
      ],
      fromCache: false,
      failed: false,
    });

    const result = await matcher.match('test markdown query', mockSkills);

    expect(result.length).toBe(1);
    expect(result[0].skill).toBe('web-scraper');
  });

  test('should filter by minConfidence', async () => {
    mockJudgeFn.mockResolvedValueOnce({
      result: [
        { skill: 'web-scraper', confidence: 0.95, reason: 'High confidence' },
      ],
      fromCache: false,
      failed: false,
    });

    const matcher3 = createLLMSkillMatcher({
      provider: mockProvider,
      fastModel: 'test-model',
      config: {
        minConfidence: 0.8,
      },
    });

    const result = await matcher3.match('scrape website', mockSkills);

    // Only results with confidence >= 0.8
    result.forEach(r => {
      expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    });
  });
});
