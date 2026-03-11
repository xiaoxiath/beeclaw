/**
 * MCP Client Tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MCPClientManager, getMCPManager, resetMCPManager, type MCPServerConfig } from '../client';

describe('MCPClientManager', () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    manager = new MCPClientManager();
  });

  afterEach(() => {
    manager.disconnectAll().catch(() => {});
  });

  describe('isMCPToolName', () => {
    test('should detect MCP tool names', () => {
      expect(MCPClientManager.isMCPToolName('mcp_filesystem_read')).toBe(true);
      expect(MCPClientManager.isMCPToolName('mcp_github_list_repos')).toBe(true);
      expect(MCPClientManager.isMCPToolName('memory_read')).toBe(false);
      expect(MCPClientManager.isMCPToolName('skill_list')).toBe(false);
    });
  });

  describe('parseMCPToolName', () => {
    test('should parse valid MCP tool names', () => {
      const result = MCPClientManager.parseMCPToolName('mcp_filesystem_read');
      expect(result).toEqual({
        serverId: 'filesystem',
        toolName: 'read',
      });
    });

    test('should parse MCP tool names with underscores in tool name', () => {
      const result = MCPClientManager.parseMCPToolName('mcp_github_list_repositories');
      expect(result).toEqual({
        serverId: 'github',
        toolName: 'list_repositories',
      });
    });

    test('should return null for non-MCP tool names', () => {
      expect(MCPClientManager.parseMCPToolName('memory_read')).toBeNull();
      expect(MCPClientManager.parseMCPToolName('invalid')).toBeNull();
    });
  });

  describe('getStatus', () => {
    test('should return empty array when no connections', () => {
      const status = manager.getStatus();
      expect(status).toEqual([]);
    });
  });

  // Note: Testing actual connections requires real MCP servers
  // which would be integration tests
});
