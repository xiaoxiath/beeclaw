/**
 * Tests for MCP Executor
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockIsMCPToolName = vi.fn((name: string) => name.startsWith('mcp__'));
const mockParseMCPToolName = vi.fn((name: string) => {
  if (!name.startsWith('mcp__')) return null;
  const parts = name.replace('mcp__', '').split('__');
  return { serverId: parts[0], toolName: parts.slice(1).join('__') };
});
const mockExecuteTool = vi.fn(async () => ({
  success: true,
  data: { result: 'ok' },
  error: undefined,
}));
const mockGetMCPManager = vi.fn(() => ({
  executeTool: mockExecuteTool,
}));

vi.mock('../client', () => ({
  getMCPManager: mockGetMCPManager,
  MCPClientManager: {
    isMCPToolName: mockIsMCPToolName,
    parseMCPToolName: mockParseMCPToolName,
  },
}));

import { isMCPTool, parseMCPToolName, executeMCPTool } from '../executor';

describe('MCP Executor', () => {
  beforeEach(() => {
    mockIsMCPToolName.mockClear();
    mockParseMCPToolName.mockClear();
    mockExecuteTool.mockClear();
    mockGetMCPManager.mockClear();
  });

  describe('isMCPTool', () => {
    it('returns true for MCP tool names', () => {
      expect(isMCPTool('mcp__server1__tool1')).toBe(true);
      expect(mockIsMCPToolName).toHaveBeenCalledWith('mcp__server1__tool1');
    });

    it('returns false for non-MCP tool names', () => {
      expect(isMCPTool('regular_tool')).toBe(false);
    });
  });

  describe('parseMCPToolName', () => {
    it('parses a valid MCP tool name', () => {
      const result = parseMCPToolName('mcp__server1__toolName');
      expect(result).toEqual({ serverId: 'server1', toolName: 'toolName' });
    });

    it('returns null for non-MCP tool name', () => {
      const result = parseMCPToolName('regular_tool');
      expect(result).toBeNull();
    });
  });

  describe('executeMCPTool', () => {
    it('returns error for non-MCP tool', async () => {
      const result = await executeMCPTool('regular_tool', { key: 'val' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not an MCP tool');
    });

    it('executes an MCP tool successfully', async () => {
      mockExecuteTool.mockResolvedValueOnce({
        success: true,
        data: { output: 'hello' },
        error: undefined,
      });

      const result = await executeMCPTool('mcp__srv__myTool', { arg: 1 });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ output: 'hello' });
      expect(result.error).toBeUndefined();

      expect(mockGetMCPManager).toHaveBeenCalled();
      expect(mockExecuteTool).toHaveBeenCalledWith('srv', 'myTool', { arg: 1 });
    });

    it('returns error when tool execution fails', async () => {
      mockExecuteTool.mockResolvedValueOnce({
        success: false,
        data: undefined,
        error: 'tool timeout',
      });

      const result = await executeMCPTool('mcp__srv__failTool', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('tool timeout');
    });
  });
});
