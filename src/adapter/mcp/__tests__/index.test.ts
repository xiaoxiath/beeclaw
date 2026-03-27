import { describe, it, expect, vi } from 'vitest';

describe('adapter/mcp/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // From client
    expect(typeof mod.MCPClientManager).toBe('function');
    expect(typeof mod.getMCPManager).toBe('function');
    // From executor
    expect(typeof mod.isMCPTool).toBe('function');
    expect(typeof mod.parseMCPToolName).toBe('function');
    expect(typeof mod.executeMCPTool).toBe('function');
    // From initializer
    expect(typeof mod.initializeMCP).toBe('function');
    expect(typeof mod.shutdownMCP).toBe('function');
    expect(typeof mod.getMCPStatusSummary).toBe('function');
  });
});
