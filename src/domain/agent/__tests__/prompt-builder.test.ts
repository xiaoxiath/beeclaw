/**
 * Tests for assembleSystemPrompt — the orchestrator that pulls together
 * the base prompt, core memory (USER.md / SOUL.md / facts), and the live
 * skill catalogue into a single system message.
 *
 * The assembler is a thin shim, but it is the integration seam where prompt
 * regressions show up at runtime ("why is the agent suddenly forgetting
 * skills?"). These tests pin the contract:
 *   - it falls back gracefully when stores are not initialised
 *   - it injects the skill catalogue when the skill store has skills
 *   - it respects the loadCoreMemory: false escape hatch
 *   - a custom systemPrompt overrides the default base
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../infra/observability/logger', () => {
  const noop = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: noop,
    getLogger: vi.fn(() => noop),
  };
});

const mockGetCoreContext = vi.fn();
vi.mock('../../memory', () => ({
  getMemoryStore: () => ({ getCoreContext: mockGetCoreContext }),
}));

const mockSkillList = vi.fn();
vi.mock('../../skills/store', () => ({
  getSkillStore: () => ({ list: mockSkillList }),
}));

// tools.ts brings in adapter ports that touch bun:sqlite — stub them out so
// vitest under Node can import buildSystemPrompt and friends.
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

import { assembleSystemPrompt } from '../prompt-builder';
import { SYSTEM_PROMPTS } from '../tools';

beforeEach(() => {
  mockGetCoreContext.mockReset();
  mockSkillList.mockReset();
  mockGetCoreContext.mockReturnValue({ user: '', soul: '', facts: '' });
  mockSkillList.mockReturnValue([]);
});

describe('assembleSystemPrompt — happy path', () => {
  it('produces a non-empty prompt that begins with the base prompt header', () => {
    const out = assembleSystemPrompt({});
    expect(out).toMatch(/^# Beeclaw/);
    expect(out.length).toBeGreaterThan(SYSTEM_PROMPTS.default.length / 2);
  });

  it('injects the skill catalogue when the skill store returns skills', () => {
    mockSkillList.mockReturnValue([
      { name: 'baidu-search', description: 'Search baidu via the official API', triggers: ['查百度'] },
      { name: 'frontend-design', description: 'Generate React components with Tailwind', triggers: ['前端设计'] },
    ]);
    const out = assembleSystemPrompt({});
    expect(out).toContain('Available Skills (2)');
    expect(out).toContain('baidu-search');
    expect(out).toContain('frontend-design');
    // The skill block should mention skill_get to teach the LLM the protocol.
    expect(out).toMatch(/skill_get/);
  });

  it('does not include a skill block when the store has zero skills', () => {
    mockSkillList.mockReturnValue([]);
    const out = assembleSystemPrompt({});
    // Look for the formatted catalogue header specifically — the literal
    // string "Available Skills" also appears in base.md as documentation.
    expect(out).not.toMatch(/Available Skills \(\d+\)/);
  });
});

describe('assembleSystemPrompt — graceful degradation', () => {
  it('returns the base prompt unchanged when getCoreContext throws', () => {
    mockGetCoreContext.mockImplementation(() => {
      throw new Error('memory store not initialised');
    });
    const out = assembleSystemPrompt({});
    // No core context means we get the bare base prompt — but it still
    // must contain the safety contract header.
    expect(out).toMatch(/^# Beeclaw/);
    expect(out).toMatch(/Safety Constraints/);
  });

  it('returns the base prompt + core memory but no skills when skillStore throws', () => {
    mockGetCoreContext.mockReturnValue({
      user: 'A user that is long enough to pass the >50-char gate inside buildSystemPrompt and surface in the output',
      soul: 'A soul that is also long enough to clear the >50-char gate so the layer makes it into the assembled prompt body',
      facts: '',
    });
    mockSkillList.mockImplementation(() => {
      throw new Error('skill store not initialised');
    });
    const out = assembleSystemPrompt({});
    expect(out).toMatch(/^# Beeclaw/);
    // Look for the formatted catalogue header specifically — the literal
    // string "Available Skills" also appears in base.md as documentation.
    expect(out).not.toMatch(/Available Skills \(\d+\)/);
  });
});

describe('assembleSystemPrompt — options', () => {
  it('respects loadCoreMemory: false and skips both stores entirely', () => {
    const out = assembleSystemPrompt({ loadCoreMemory: false });
    expect(out).toBe(SYSTEM_PROMPTS.default);
    expect(mockGetCoreContext).not.toHaveBeenCalled();
    expect(mockSkillList).not.toHaveBeenCalled();
  });

  it('uses a custom systemPrompt override instead of the default base', () => {
    const custom = '# Custom system prompt for a subagent';
    const out = assembleSystemPrompt({ systemPrompt: custom, loadCoreMemory: false });
    expect(out).toBe(custom);
  });

  it('uses the custom override even when core memory is loaded', () => {
    mockGetCoreContext.mockReturnValue({ user: '', soul: '', facts: '' });
    const custom = '# Custom subagent base prompt that should remain at the start';
    const out = assembleSystemPrompt({ systemPrompt: custom });
    expect(out.startsWith(custom)).toBe(true);
  });
});

describe('formatSkillsForPrompt — size at scale (regression cap)', () => {
  // The skill block is part of every system prompt; if it grows linearly
  // and unboundedly with the skill catalogue, the context window evaporates.
  // formatSkillsForPrompt already truncates per-skill — verify the cap holds
  // with a realistic 50-skill catalogue.
  it('caps a realistic 50-skill catalogue under 5 KB (~1250 tokens)', async () => {
    // tools.ts:686 documents "~1100 tokens for 30 skills" — extrapolating
    // to 50 with realistic naming, ~1250 tokens (~5 KB) is the expected
    // ceiling. Tightening this cap is good (catches regressions earlier);
    // raising it should be done with a cost rationale in the PR.
    const { formatSkillsForPrompt } = await import('../tools');
    const fifty = Array.from({ length: 50 }, (_, i) => ({
      name: `skill-cat-${String(i).padStart(2, '0')}`,
      description: 'A description that is intentionally longer than the 45-char cap so truncation is exercised',
      triggers: ['t1', 't2', 't3', 't4', 't5', 't6'],
    }));
    const out = formatSkillsForPrompt(fifty);
    expect(out.length).toBeLessThan(5_000);
    expect(out).toContain('skill-cat-00');
    expect(out).toContain('skill-cat-49');
  });

  it('flags catastrophic growth: 50 long-named skills must still stay under 8 KB', async () => {
    // The function comment promises "~1100 tokens for 30 skills". Even with
    // pessimistic 40-char kebab names, 50 skills should not exceed 8 KB
    // (~2000 tokens). If this test fails, the truncation contract has
    // regressed — re-tune maxDescLen / maxTriggers in tools.ts.
    const { formatSkillsForPrompt } = await import('../tools');
    const fifty = Array.from({ length: 50 }, (_, i) => ({
      name: `skill-with-a-fairly-long-kebab-case-name-${i}`,
      description: 'x'.repeat(500),
      triggers: ['t1', 't2', 't3', 't4', 't5', 't6'],
    }));
    const out = formatSkillsForPrompt(fifty);
    expect(out.length).toBeLessThan(8_000);
  });

  it('truncates description to ~45 chars per the cap', async () => {
    const { formatSkillsForPrompt } = await import('../tools');
    const longDesc = 'x'.repeat(200);
    const out = formatSkillsForPrompt([{ name: 's', description: longDesc, triggers: [] }]);
    // Each skill line is "- **name**: <desc-truncated>" — the desc portion
    // should be far less than 200 chars.
    const lineMatch = out.match(/- \*\*s\*\*: (.+)/);
    expect(lineMatch).not.toBeNull();
    expect(lineMatch![1].length).toBeLessThanOrEqual(50);
  });

  it('caps triggers at 3 per skill, with an ellipsis when more exist', async () => {
    const { formatSkillsForPrompt } = await import('../tools');
    const out = formatSkillsForPrompt([{
      name: 's',
      description: 'd',
      triggers: ['a', 'b', 'c', 'd', 'e', 'f'],
    }]);
    // First three triggers present; later ones suppressed.
    expect(out).toContain('a, b, c');
    expect(out).not.toContain('d, e, f');
    // Ellipsis indicates more were dropped.
    expect(out).toMatch(/\.\.\./);
  });
});
