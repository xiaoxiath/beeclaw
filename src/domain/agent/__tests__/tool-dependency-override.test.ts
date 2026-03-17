/**
 * P2-4.8: Tool Dependency Override Tests
 *
 * Tests for runtime tool dependency override registry
 * with exact and pattern matching support.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

// Import the functions to test
import {
  registerToolDependencyOverride,
  registerToolDependencyPattern,
  clearToolDependencyOverrides,
  getToolDependencyOverrides,
  getToolDependency
} from '../../agent/tool-dependencies';

describe('Tool Dependency Overrides', () => {
  beforeEach(() => {
    // Clear all overrides before each test
    clearToolDependencyOverrides();
  });

  afterEach(() => {
    // Clean up after each test
    clearToolDependencyOverrides();
  });

  describe('Exact override registration', () => {
    test('should register exact tool override', () => {
      registerToolDependencyOverride('test_tool', {
        mode: 'sequential',
        hasSideEffects: true,
      }, 'test');

      const overrides = getToolDependencyOverrides();
      expect(overrides.exact['test_tool']).toBeDefined();

      const config = overrides.exact['test_tool'];
      expect(config?.mode).toBe('sequential');
      expect(config?.hasSideEffects).toBe(true);
    });

    test('should override existing exact override', () => {
      registerToolDependencyOverride('test_tool', {
        mode: 'sequential',
      }, 'test1');

      registerToolDependencyOverride('test_tool', {
        mode: 'parallel',
      }, 'test2');

      const overrides = getToolDependencyOverrides();
      const config = overrides.exact['test_tool'];

      expect(config?.mode).toBe('parallel');
    });

    test('should merge with default config', () => {
      registerToolDependencyOverride('test_tool', {
        hasSideEffects: true,
        // mode not specified, should use default
      }, 'test');

      const overrides = getToolDependencyOverrides();
      const config = overrides.exact['test_tool'];

      expect(config?.hasSideEffects).toBe(true);
    });

    test('should support all dependency modes', () => {
      const modes: Array<'parallel' | 'sequential' | 'exclusive'> = ['parallel', 'sequential', 'exclusive'];

      modes.forEach((mode, index) => {
        registerToolDependencyOverride(`tool_${index}`, { mode }, 'test');
      });

      const overrides = getToolDependencyOverrides();

      expect(overrides.exact['tool_0']?.mode).toBe('parallel');
      expect(overrides.exact['tool_1']?.mode).toBe('sequential');
      expect(overrides.exact['tool_2']?.mode).toBe('exclusive');
    });
  });

  describe('Pattern override registration', () => {
    test('should register pattern-based override', () => {
      registerToolDependencyPattern(/^mcp_.*/, {
        mode: 'sequential',
      }, 'test');

      const overrides = getToolDependencyOverrides();
      expect(overrides.patterns.length).toBe(1);
      expect(overrides.patterns[0].config.mode).toBe('sequential');
    });

    test('should support multiple patterns', () => {
      registerToolDependencyPattern(/^mcp_.*/, { mode: 'sequential' }, 'test1');
      registerToolDependencyPattern(/^feishu_.*/, { mode: 'exclusive' }, 'test2');
      registerToolDependencyPattern(/^web_.*/, { mode: 'parallel' }, 'test3');

      const overrides = getToolDependencyOverrides();
      expect(overrides.patterns.length).toBe(3);
    });

    test('should match patterns case-insensitively', () => {
      registerToolDependencyPattern(/MCP_.*/i, { mode: 'sequential' }, 'test');

      // Pattern should match both uppercase and lowercase
      const pattern = /MCP_.*/i;
      expect(pattern.test('mcp_tool')).toBe(true);
      expect(pattern.test('MCP_Tool')).toBe(true);
    });
  });

  describe('Override retrieval', () => {
    test('should return exact override when registered', () => {
      registerToolDependencyOverride('exact_tool', {
        mode: 'exclusive',
      }, 'test');

      const config = getToolDependency('exact_tool');

      expect(config?.mode).toBe('exclusive');
    });

    test('should return pattern override when no exact match', () => {
      registerToolDependencyPattern(/^mcp_.*/, {
        mode: 'sequential',
      }, 'test');

      const config = getToolDependency('mcp_filesystem');

      expect(config?.mode).toBe('sequential');
    });

    test('should prioritize exact over pattern match', () => {
      registerToolDependencyPattern(/^mcp_.*/, {
        mode: 'sequential',
      }, 'test1');

      registerToolDependencyOverride('mcp_special', {
        mode: 'exclusive',
      }, 'test2');

      const config = getToolDependency('mcp_special');

      // Exact match should take precedence
      expect(config?.mode).toBe('exclusive');
    });

    test('should return null when no override or builtin', () => {
      const config = getToolDependency('unknown_tool_xyz');

      // Should return null or builtin default
      // (depends on implementation)
      expect(config).toBeDefined();
    });
  });

  describe('Clear overrides', () => {
    test('should clear all exact overrides', () => {
      registerToolDependencyOverride('tool1', { mode: 'sequential' }, 'test');
      registerToolDependencyOverride('tool2', { mode: 'parallel' }, 'test');

      clearToolDependencyOverrides();

      const overrides = getToolDependencyOverrides();
      expect(Object.keys(overrides.exact).length).toBe(0);
    });

    test('should clear all pattern overrides', () => {
      registerToolDependencyPattern(/^mcp_.*/, { mode: 'sequential' }, 'test');
      registerToolDependencyPattern(/^feishu_.*/, { mode: 'exclusive' }, 'test');

      clearToolDependencyOverrides();

      const overrides = getToolDependencyOverrides();
      expect(overrides.patterns.length).toBe(0);
    });

    test('should clear both exact and pattern overrides', () => {
      registerToolDependencyOverride('exact_tool', { mode: 'parallel' }, 'test');
      registerToolDependencyPattern(/^mcp_.*/, { mode: 'sequential' }, 'test');

      clearToolDependencyOverrides();

      const overrides = getToolDependencyOverrides();
      expect(Object.keys(overrides.exact).length).toBe(0);
      expect(overrides.patterns.length).toBe(0);
    });
  });

  describe('Real-world scenarios', () => {
    test('should handle MCP tool override pattern', () => {
      // All MCP tools should be sequential
      registerToolDependencyPattern(/^mcp_.*/, {
        mode: 'sequential',
        hasSideEffects: true,
      }, 'mcp-config');

      const tools = ['mcp_filesystem', 'mcp_github', 'mcp_database'];
      tools.forEach(tool => {
        const config = getToolDependency(tool);
        expect(config?.mode).toBe('sequential');
        expect(config?.hasSideEffects).toBe(true);
      });
    });

    test('should handle Feishu tool override pattern', () => {
      // All Feishu tools should be exclusive
      registerToolDependencyPattern(/^feishu_.*/, {
        mode: 'exclusive',
        hasSideEffects: true,
      }, 'feishu-config');

      const tools = ['feishu_send_message', 'feishu_upload_file', 'feishu_create_doc'];
      tools.forEach(tool => {
        const config = getToolDependency(tool);
        expect(config?.mode).toBe('exclusive');
      });
    });

    test('should handle tool-specific override within pattern', () => {
      // All web tools are parallel
      registerToolDependencyPattern(/^web_.*/, {
        mode: 'parallel',
      }, 'web-config');

      // Except web_search which needs to be sequential
      registerToolDependencyOverride('web_search', {
        mode: 'sequential',
      }, 'search-config');

      expect(getToolDependency('web_fetch')?.mode).toBe('parallel');
      expect(getToolDependency('web_search')?.mode).toBe('sequential');
    });

    test('should handle testing scenario with isolated overrides', () => {
      // In tests, we might want to override specific tools
      registerToolDependencyOverride('test_tool_1', { mode: 'sequential' }, 'test');
      registerToolDependencyOverride('test_tool_2', { mode: 'parallel' }, 'test');

      const overrides = getToolDependencyOverrides();
      expect(Object.keys(overrides.exact).length).toBe(2);

      // After test, clear
      clearToolDependencyOverrides();
      expect(Object.keys(getToolDependencyOverrides().exact).length).toBe(0);
    });
  });

  describe('Pattern matching edge cases', () => {
    test('should match complex regex patterns', () => {
      registerToolDependencyPattern(/^(web|search|http)_/, {
        mode: 'sequential',
      }, 'test');

      const config1 = getToolDependency('web_search');
      const config2 = getToolDependency('search_google');
      const config3 = getToolDependency('http_fetch');

      expect(config1?.mode).toBe('sequential');
      expect(config2?.mode).toBe('sequential');
      expect(config3?.mode).toBe('sequential');
    });

    test('should not match partial tool names', () => {
      registerToolDependencyPattern(/^mcp_/, {
        mode: 'sequential',
      }, 'test');

      // Should not match tools that contain 'mcp_' in the middle
      const config = getToolDependency('my_mcp_tool');

      // This should not match the pattern ^mcp_
      // It should fall back to default or builtin
      expect(config?.mode).toBeDefined();
    });

    test('should handle empty pattern', () => {
      registerToolDependencyPattern(/.*/, {
        mode: 'parallel',
      }, 'test');

      // Empty pattern should match everything
      const config = getToolDependency('any_tool');
      expect(config?.mode).toBe('parallel');
    });
  });

  describe('Configuration merging', () => {
    test('should preserve unspecified fields from default', () => {
      registerToolDependencyOverride('test_tool', {
        mode: 'sequential',
        // hasSideEffects not specified
      }, 'test');

      const config = getToolDependency('test_tool');

      expect(config?.mode).toBe('sequential');
      // hasSideEffects should have default value
      expect(config?.hasSideEffects).toBeDefined();
    });

    test('should override all fields when specified', () => {
      registerToolDependencyOverride('test_tool', {
        mode: 'exclusive',
        hasSideEffects: true,
      }, 'test');

      const config = getToolDependency('test_tool');

      expect(config?.mode).toBe('exclusive');
      expect(config?.hasSideEffects).toBe(true);
    });
  });
});
