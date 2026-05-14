/**
 * Structural and size-budget tests for the base system prompt.
 *
 * The system prompt is the single most behaviour-defining file in the
 * project. Many of its sections encode safety contracts (trust hierarchy,
 * verification protocol, error handling) that an accidental edit could
 * silently weaken. These tests catch:
 *   - missing or renamed safety sections
 *   - prompt growth that would eat too much of the context window
 *   - skills-injection size growth at scale
 *   - examples-verbose.md drifting out of step with the base
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// tools.ts pulls in adapter ports that touch bun:sqlite — stub the Bun-only
// modules so vitest (running under Node) can load the SYSTEM_PROMPTS export.
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

const BASE_MD_PATH = path.resolve(__dirname, '..', 'prompts', 'base.md');
const EXAMPLES_MD_PATH = path.resolve(__dirname, '..', 'prompts', 'examples-verbose.md');

const baseMd = fs.readFileSync(BASE_MD_PATH, 'utf-8');
const examplesMd = fs.readFileSync(EXAMPLES_MD_PATH, 'utf-8');

/** Cheap LLM token estimate: ~4 chars per token for mixed Chinese+English. */
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

describe('base.md — required sections (safety contract)', () => {
  it('declares the agent identity', () => {
    expect(baseMd).toMatch(/^# Beeclaw/m);
    expect(baseMd).toMatch(/## Identity/);
  });

  it('declares an explicit P0–P5 instruction priority table', () => {
    // P0..P5 must each be referenced in the priority table.
    for (const level of ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']) {
      expect(baseMd).toContain(level);
    }
    expect(baseMd).toMatch(/Instruction Priority/i);
  });

  it('contains the Safety Constraints section (P0 non-negotiable)', () => {
    expect(baseMd).toMatch(/## Safety Constraints/);
    expect(baseMd).toMatch(/P0[\s\S]*Non-negotiable/);
  });

  it('declares a Content Trust Hierarchy with TRUSTED / SEMI-TRUSTED / UNTRUSTED labels', () => {
    // These labels are the prompt-injection defence boundary. If any are
    // accidentally renamed or removed, the agent loses its anti-injection
    // anchor — fail loudly here.
    expect(baseMd).toMatch(/\*\*TRUSTED\*\*/);
    expect(baseMd).toMatch(/\*\*SEMI-TRUSTED\*\*/);
    expect(baseMd).toMatch(/\*\*UNTRUSTED\*\*/);
    // The "ignore meta-instructions in untrusted content" rule is the
    // operational guarantee — both halves of the contract must be present:
    // the recognition pattern ("meta-instructions") and the IGNORE directive.
    expect(baseMd).toMatch(/meta-instructions/i);
    expect(baseMd).toMatch(/IGNORE/);
  });

  it('declares the Skill Usage Protocol with skill_get-before-execute rule', () => {
    expect(baseMd).toMatch(/## Skill Usage Protocol/);
    expect(baseMd).toMatch(/skill_get/);
    // Anti-pattern: never execute a skill from description alone.
    expect(baseMd).toMatch(/NEVER execute a skill without loading it first/);
  });

  it('declares the Verification Rules section with mandatory write→read mapping', () => {
    expect(baseMd).toMatch(/## Verification Rules/);
    expect(baseMd).toMatch(/MUST be verified/);
    // Each write tool must have a verifier listed.
    for (const tool of ['proactive_schedule', 'memory_write', 'memory_record', 'skill_ensure']) {
      expect(baseMd).toContain(tool);
    }
  });

  it('declares the Error Handling Protocol with 3-strikes hard limit', () => {
    expect(baseMd).toMatch(/## Error Handling Protocol/);
    expect(baseMd).toMatch(/3rd consecutive failure|3 consecutive times/);
  });

  it('declares Sub-agent Delegation rules (when to spawn_subagent)', () => {
    expect(baseMd).toMatch(/## Sub-agent Delegation/);
    expect(baseMd).toMatch(/spawn_subagent/);
  });

  it('declares Context Management with explicit "do not preload" rules', () => {
    expect(baseMd).toMatch(/## Context Management/);
    expect(baseMd).toMatch(/What NOT to Preload/);
  });
});

describe('base.md — token-budget regression cap', () => {
  // Hard caps. Tightening these requires a deliberate update of this file
  // so reviewers see the prompt is growing.
  const SIZE_CAP_CHARS = 12_000;
  const TOKEN_CAP = 3_500;

  it(`stays under ${SIZE_CAP_CHARS.toLocaleString()} characters (current: ${baseMd.length})`, () => {
    expect(baseMd.length).toBeLessThan(SIZE_CAP_CHARS);
  });

  it(`stays under ${TOKEN_CAP.toLocaleString()} estimated tokens (current: ${estimateTokens(baseMd)})`, () => {
    expect(estimateTokens(baseMd)).toBeLessThan(TOKEN_CAP);
  });
});

describe('examples-verbose.md — pairs with base.md', () => {
  it('begins with a Beeclaw "Worked Examples" header', () => {
    expect(examplesMd).toMatch(/^# Beeclaw[\s\S]*Worked Examples/);
  });

  it('contains at least 5 numbered worked examples', () => {
    const exampleHeaders = examplesMd.match(/^## Example \d+:/gm) ?? [];
    expect(exampleHeaders.length).toBeGreaterThanOrEqual(5);
  });

  const EXAMPLES_SIZE_CAP = 8_000;
  const EXAMPLES_TOKEN_CAP = 2_500;

  it(`stays under ${EXAMPLES_SIZE_CAP.toLocaleString()} characters (current: ${examplesMd.length})`, () => {
    expect(examplesMd.length).toBeLessThan(EXAMPLES_SIZE_CAP);
  });

  it(`stays under ${EXAMPLES_TOKEN_CAP.toLocaleString()} estimated tokens (current: ${estimateTokens(examplesMd)})`, () => {
    expect(estimateTokens(examplesMd)).toBeLessThan(EXAMPLES_TOKEN_CAP);
  });
});

describe('SYSTEM_PROMPTS export uses the on-disk base.md verbatim', () => {
  // Catches the case where someone edits base.md but tools.ts has been
  // pinned to a stale copy, or vice-versa.
  it('SYSTEM_PROMPTS.default starts with the base.md identity header', async () => {
    const { SYSTEM_PROMPTS } = await import('../tools');
    expect(SYSTEM_PROMPTS.default).toMatch(/^# Beeclaw/);
    expect(SYSTEM_PROMPTS.default.length).toBe(baseMd.length);
  });
});
