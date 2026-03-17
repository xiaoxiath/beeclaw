/**
 * Tests for LLM Skill Matcher
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { LLMSkillMatcher, createLLMSkillMatcher } from '../llm-matcher';
import type { Skill } from '../types';

// Mock provider
const mockProvider = {
  chat: async (messages: any[], options?: any) => {
    const userMessage = messages.find((m: any) => m.role === 'user')?.content || '';

    // 调试：打印用户消息
    console.log('[Mock Provider] User message:', userMessage.substring(0, 200));

    // 模拟 LLM 响应 - 根据查询内容判断
    const queryMatch = userMessage.match(/User Query: "([^"]+)"/);
    const query = queryMatch ? queryMatch[1].toLowerCase() : '';

    console.log('[Mock Provider] Extracted query:', query);

    // 根据查询返回不同的结果
    if (query.includes('scrape') || query.includes('抓取')) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              matches: [
                { skill: 'web-scraper', confidence: 0.95, reason: 'Matches web scraping intent' },
                { skill: 'http-client', confidence: 0.7, reason: 'Related to HTTP requests' },
              ],
            }),
          },
        }],
      };
    }

    if (query.includes('analyze') || query.includes('分析')) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              matches: [
                { skill: 'data-analyzer', confidence: 0.9, reason: 'Matches data analysis intent' },
              ],
            }),
          },
        }],
      };
    }

    // play music 或其他无关查询 - 返回空
    if (query.includes('play music') || query.includes('music')) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({ matches: [] }),
          },
        }],
      };
    }

    // Default: 返回空（对于未知查询）
    return {
      choices: [{
        message: {
          content: JSON.stringify({ matches: [] }),
        },
      }],
    };
  },
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
      config: {
        enabled: true,
        maxCandidates: 10,
        topK: 5,
        timeout: 5000,
        cacheTTL: 3600,
        minConfidence: 0.3,
      },
    });
  });

  afterAll(() => {
    matcher.clearCache();
  });

  test('should match web scraping query', async () => {
    const result = await matcher.match('I want to scrape website data', mockSkills);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].skill).toBe('web-scraper');
    expect(result[0].confidence).toBeGreaterThan(0.8);
  });

  test('should match Chinese query', async () => {
    const result = await matcher.match('帮我抓取网页数据', mockSkills);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].skill).toBe('web-scraper');
  });

  test('should match analysis query', async () => {
    // 清除缓存以避免干扰
    matcher.clearCache();

    const result = await matcher.match('analyze this dataset', mockSkills);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].skill).toBe('data-analyzer');
  });

  test('should return empty for unrelated query', async () => {
    // 清除缓存
    matcher.clearCache();

    const result = await matcher.match('play music', mockSkills);

    expect(result.length).toBe(0);
  });

  test('should cache results', async () => {
    const query = 'scrape data from website';

    // First call
    const result1 = await matcher.match(query, mockSkills);

    // Second call (should use cache)
    const result2 = await matcher.match(query, mockSkills);

    expect(result1).toEqual(result2);

    const stats = matcher.getCacheStats();
    expect(stats.size).toBeGreaterThan(0);
  });

  test('should respect maxCandidates', async () => {
    const manySkills = Array(20).fill(mockSkills[0]).map((s, i) => ({
      ...s,
      name: `skill-${i}`,
    }));

    const matcher2 = createLLMSkillMatcher({
      provider: mockProvider,
      config: {
        maxCandidates: 5,
        topK: 3,
      },
    });

    // Provider 应该只收到 5 个候选技能
    const result = await matcher2.match('test query', manySkills);

    // 结果应该最多 3 个
    expect(result.length).toBeLessThanOrEqual(3);
  });

  test('should handle timeout', async () => {
    const slowProvider = {
      chat: async () => {
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10s delay
        return { choices: [{ message: { content: '{}' } }] };
      },
    };

    const timeoutMatcher = createLLMSkillMatcher({
      provider: slowProvider,
      config: {
        timeout: 100, // 100ms timeout
      },
    });

    const result = await timeoutMatcher.match('test', mockSkills);

    // 应该因为超时而返回空结果
    expect(result.length).toBe(0);
  });

  test('should handle malformed JSON response', async () => {
    const badProvider = {
      chat: async () => ({
        choices: [{
          message: {
            content: 'This is not valid JSON',
          },
        }],
      }),
    };

    const badMatcher = createLLMSkillMatcher({
      provider: badProvider,
    });

    const result = await badMatcher.match('test', mockSkills);

    // 应该返回空数组而不是抛出错误
    expect(result.length).toBe(0);
  });

  test('should extract JSON from markdown code block', async () => {
    const markdownProvider = {
      chat: async () => ({
        choices: [{
          message: {
            content: '```json\n{"matches":[{"skill":"web-scraper","confidence":0.9,"reason":"test"}]}\n```',
          },
        }],
      }),
    };

    const mdMatcher = createLLMSkillMatcher({
      provider: markdownProvider,
    });

    const result = await mdMatcher.match('test', mockSkills);

    expect(result.length).toBe(1);
    expect(result[0].skill).toBe('web-scraper');
  });

  test('should filter by minConfidence', async () => {
    const matcher3 = createLLMSkillMatcher({
      provider: mockProvider,
      config: {
        minConfidence: 0.8,
      },
    });

    const result = await matcher3.match('scrape website', mockSkills);

    // 只有 confidence >= 0.8 的结果
    result.forEach(r => {
      expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    });
  });
});
