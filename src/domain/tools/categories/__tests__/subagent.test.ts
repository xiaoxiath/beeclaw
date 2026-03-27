import { describe, it, expect, vi } from 'vitest';

// Mock upstream module
vi.mock('../../builtin', () => ({
  spawnSubagentToolDef: { name: 'spawn_subagent' },
  spawnParallelToolDef: { name: 'spawn_parallel' },
  executeSpawnSubagentTool: vi.fn(() => Promise.resolve({ success: true })),
  executeSpawnParallelTool: vi.fn(() => Promise.resolve({ success: true })),
}));

import {
  spawnSubagentToolDef,
  spawnParallelToolDef,
  executeSpawnSubagentTool,
  executeSpawnParallelTool,
} from '../subagent';

describe('categories/subagent re-exports', () => {
  it('exports spawnSubagentToolDef', () => {
    expect(spawnSubagentToolDef).toBeDefined();
    expect(spawnSubagentToolDef.name).toBe('spawn_subagent');
  });

  it('exports spawnParallelToolDef', () => {
    expect(spawnParallelToolDef).toBeDefined();
    expect(spawnParallelToolDef.name).toBe('spawn_parallel');
  });

  it('exports executeSpawnSubagentTool as function', () => {
    expect(typeof executeSpawnSubagentTool).toBe('function');
  });

  it('exports executeSpawnParallelTool as function', () => {
    expect(typeof executeSpawnParallelTool).toBe('function');
  });
});
