import { describe, it, expect, vi } from 'vitest';

// Mock the sandbox tools module
vi.mock('../../../sandbox/tools', () => ({
  sandboxTools: [{ name: 'sandbox_exec' }],
  sandboxToolNames: ['sandbox_exec'],
  executeSandboxTool: vi.fn(() => Promise.resolve({ success: true })),
  getSandboxToolsForAI: vi.fn(() => []),
  setCurrentSandboxSession: vi.fn(),
  getCurrentSandboxSession: vi.fn(() => null),
}));

import {
  sandboxTools,
  sandboxToolNames,
  executeSandboxTool,
  getSandboxToolsForAI,
  setCurrentSandboxSession,
  getCurrentSandboxSession,
} from '../sandbox';

describe('categories/sandbox re-exports', () => {
  it('exports sandboxTools', () => {
    expect(sandboxTools).toBeDefined();
    expect(Array.isArray(sandboxTools)).toBe(true);
  });

  it('exports sandboxToolNames', () => {
    expect(sandboxToolNames).toBeDefined();
    expect(Array.isArray(sandboxToolNames)).toBe(true);
  });

  it('exports executeSandboxTool as function', () => {
    expect(typeof executeSandboxTool).toBe('function');
  });

  it('exports getSandboxToolsForAI as function', () => {
    expect(typeof getSandboxToolsForAI).toBe('function');
  });

  it('exports setCurrentSandboxSession as function', () => {
    expect(typeof setCurrentSandboxSession).toBe('function');
  });

  it('exports getCurrentSandboxSession as function', () => {
    expect(typeof getCurrentSandboxSession).toBe('function');
  });
});
