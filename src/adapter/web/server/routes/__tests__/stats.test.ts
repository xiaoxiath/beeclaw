import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetTokenUsageTracker, getTokenUsageTracker } from '@/infra/observability/token-usage';

vi.mock('../../../../../infra/observability/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockListSessions = vi.fn();
vi.mock('@/app', () => ({
  listSessions: () => mockListSessions(),
  getAgent: () => { throw new Error('agent not initialized'); },
}));

const mockSkillList = vi.fn();
vi.mock('@/domain/skills/store', () => ({
  getSkillStore: () => ({ list: mockSkillList }),
}));

import statsRoutes from '../stats';

describe('GET /stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTokenUsageTracker();
    mockListSessions.mockReturnValue([]);
    mockSkillList.mockReturnValue([]);
  });

  it('returns sessions, skills, uptime, and zero token usage on a cold tracker', async () => {
    mockListSessions.mockReturnValue([{ id: 'a' }, { id: 'b' }]);
    mockSkillList.mockReturnValue([{ name: 'x' }, { name: 'y' }, { name: 'z' }]);

    const res = await statsRoutes.request('/');
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.status).toBe('ok');
    expect(json.sessions).toBe(2);
    expect(json.skills).toBe(3);
    expect(typeof json.uptime).toBe('number');
    expect(json.uptime).toBeGreaterThanOrEqual(0);

    expect(json.tokenUsage).toBe(0);
    expect(json.tokens).toEqual({
      prompt: 0,
      completion: 0,
      total: 0,
      callCount: 0,
      lastRecordedAt: null,
      byModel: {},
    });
  });

  it('reflects recorded token usage in the response', async () => {
    getTokenUsageTracker().record({
      model: 'claude-sonnet-4-6',
      promptTokens: 1000,
      completionTokens: 250,
    });
    getTokenUsageTracker().record({
      model: 'claude-haiku-4-5',
      promptTokens: 80,
      completionTokens: 30,
    });

    const res = await statsRoutes.request('/');
    const json = await res.json();

    expect(json.tokenUsage).toBe(1360); // 1000+250+80+30
    expect(json.tokens.prompt).toBe(1080);
    expect(json.tokens.completion).toBe(280);
    expect(json.tokens.callCount).toBe(2);
    expect(json.tokens.lastRecordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(json.tokens.byModel['claude-sonnet-4-6']).toEqual({
      promptTokens: 1000, completionTokens: 250, totalTokens: 1250, callCount: 1,
    });
    expect(json.tokens.byModel['claude-haiku-4-5']).toEqual({
      promptTokens: 80, completionTokens: 30, totalTokens: 110, callCount: 1,
    });
  });

  it('returns 500 with an error message when listSessions throws', async () => {
    mockListSessions.mockImplementation(() => { throw new Error('boom'); });
    const res = await statsRoutes.request('/');
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to get stats');
    expect(json.message).toBe('boom');
  });
});
