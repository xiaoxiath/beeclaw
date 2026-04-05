/**
 * Tests for hooks and MCP utilities.
 */

import { describe, it, expect } from 'vitest';
import { NoOpHookRunner } from './hooks/types';
import type { BaseHookEvent } from './hooks/types';
import { isMCPToolName, parseMCPToolName } from './mcp/types';

// ============================================================================
// NoOpHookRunner
// ============================================================================

describe('NoOpHookRunner', () => {
  it('runVoidHook should resolve without error', async () => {
    const runner = new NoOpHookRunner();
    const event: BaseHookEvent = {
      context: { agentId: 'test', timestamp: new Date().toISOString() },
    };

    await runner.runVoidHook('test_hook', event);
  });

  it('runModifyingHook should return event unchanged', async () => {
    const runner = new NoOpHookRunner();
    const event: BaseHookEvent = {
      context: { agentId: 'test', timestamp: new Date().toISOString() },
    };

    const result = await runner.runModifyingHook('test_hook', event);
    expect(result).toEqual(event as Record<string, unknown>);
  });
});

// ============================================================================
// MCP utilities
// ============================================================================

describe('isMCPToolName', () => {
  it('should return true for MCP tool names', () => {
    expect(isMCPToolName('mcp_filesystem_read')).toBe(true);
    expect(isMCPToolName('mcp_server_tool_name')).toBe(true);
  });

  it('should return false for non-MCP tool names', () => {
    expect(isMCPToolName('get_weather')).toBe(false);
    expect(isMCPToolName('search')).toBe(false);
  });

  it('should return false for mcp_ with no further parts', () => {
    expect(isMCPToolName('mcp_')).toBe(false);
  });
});

describe('parseMCPToolName', () => {
  it('should parse valid MCP tool names', () => {
    expect(parseMCPToolName('mcp_filesystem_read')).toEqual({
      serverId: 'filesystem',
      toolName: 'read',
    });
  });

  it('should handle underscores in tool name', () => {
    expect(parseMCPToolName('mcp_server_read_file')).toEqual({
      serverId: 'server',
      toolName: 'read_file',
    });
  });

  it('should return null for non-MCP names', () => {
    expect(parseMCPToolName('get_weather')).toBeNull();
    expect(parseMCPToolName('mcp_')).toBeNull();
    expect(parseMCPToolName('mcp_only')).toBeNull();
  });
});
