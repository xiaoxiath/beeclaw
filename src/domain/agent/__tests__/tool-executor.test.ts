/**
 * Tests for tool-executor.ts
 *
 * Covers: createDefaultToolExecutor, _executeToolInner, isMCPToolName/parseMCPToolName inlined helpers
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must come before importing the module under test
// ---------------------------------------------------------------------------

const {
  mockCBExecute,
  mockRegisterToolConfig,
  mockExecuteMemoryTool,
  mockExecuteSkillTool,
  mockGetSkillStore,
  mockExecuteGoalTool,
  mockExecuteProactiveTool,
  mockExecutePersonaTool,
  mockExecuteBuiltinTool,
  mockIsBuiltinTool,
  mockMCPExecuteTool,
  mockGetMCPManagerPort,
  mockGetPluginRegistryPort,
} = vi.hoisted(() => ({
  mockCBExecute: vi.fn(async (_name: string, fn: () => Promise<any>) => fn()),
  mockRegisterToolConfig: vi.fn(() => {}),
  mockExecuteMemoryTool: vi.fn(async () => ({ success: true, data: 'mem' })),
  mockExecuteSkillTool: vi.fn(async () => ({ success: true, data: 'skill' })),
  mockGetSkillStore: vi.fn(() => ({ getBasePath: () => '/skills' })),
  mockExecuteGoalTool: vi.fn(async () => ({ success: true, data: 'goal' })),
  mockExecuteProactiveTool: vi.fn(async () => ({ success: true, data: 'proactive' })),
  mockExecutePersonaTool: vi.fn(async () => ({ success: true, data: 'persona' })),
  mockExecuteBuiltinTool: vi.fn(async () => ({ success: true, data: 'builtin' })),
  mockIsBuiltinTool: vi.fn((name: string) => ['web_search', 'deep_research', 'get_weather'].includes(name)),
  mockMCPExecuteTool: vi.fn(async () => ({ success: true, data: 'mcp-result' })),
  mockGetMCPManagerPort: vi.fn(() => null),
  mockGetPluginRegistryPort: vi.fn(() => null),
}));

vi.mock('../../../infra/resilience/circuit-breaker', () => ({
  getCircuitBreakerRegistry: () => ({
    execute: mockCBExecute,
    registerToolConfig: mockRegisterToolConfig,
  }),
  CircuitOpenError: class CircuitOpenError extends Error {
    cooldownRemainingMs: number;
    constructor(msg: string, cooldown: number) {
      super(msg);
      this.cooldownRemainingMs = cooldown;
    }
  },
  CIRCUIT_BREAKER_PRESETS: { mcp_tool: { failureThreshold: 3, cooldownMs: 60000 } },
}));

vi.mock('../../memory/tools', () => ({ executeMemoryTool: mockExecuteMemoryTool }));
vi.mock('../../skills/tools', () => ({ executeSkillTool: mockExecuteSkillTool }));
vi.mock('../../skills/store', () => ({ getSkillStore: mockGetSkillStore }));
vi.mock('../goal/tools', () => ({ executeGoalTool: mockExecuteGoalTool }));
vi.mock('../../proactive/tools', () => ({ executeProactiveTool: mockExecuteProactiveTool }));
vi.mock('../persona/tools', () => ({ executePersonaTool: mockExecutePersonaTool }));
vi.mock('../../tools', () => ({
  executeBuiltinTool: mockExecuteBuiltinTool,
  isBuiltinTool: mockIsBuiltinTool,
}));
vi.mock('../../ports', () => ({
  getMCPManagerPort: mockGetMCPManagerPort,
  getPluginRegistryPort: mockGetPluginRegistryPort,
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------
import { createDefaultToolExecutor, _executeToolInner } from '../tool-executor';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tool-executor', () => {
  beforeEach(() => {
    mockExecuteMemoryTool.mockReset();
    mockExecuteSkillTool.mockReset();
    mockExecuteGoalTool.mockReset();
    mockExecuteProactiveTool.mockReset();
    mockExecutePersonaTool.mockReset();
    mockExecuteBuiltinTool.mockReset();
    mockIsBuiltinTool.mockReset();
    mockCBExecute.mockReset();
    mockMCPExecuteTool.mockReset();
    mockGetMCPManagerPort.mockReset();
    mockGetPluginRegistryPort.mockReset();

    // Restore defaults
    mockIsBuiltinTool.mockImplementation((name: string) =>
      ['web_search', 'deep_research', 'get_weather'].includes(name),
    );
    mockCBExecute.mockImplementation(async (_name: string, fn: () => Promise<any>) => fn());
    mockExecuteMemoryTool.mockResolvedValue({ success: true, data: 'mem' });
    mockExecuteSkillTool.mockResolvedValue({ success: true, data: 'skill' });
    mockExecuteGoalTool.mockResolvedValue({ success: true, data: 'goal' });
    mockExecuteProactiveTool.mockResolvedValue({ success: true, data: 'proactive' });
    mockExecutePersonaTool.mockResolvedValue({ success: true, data: 'persona' });
    mockExecuteBuiltinTool.mockResolvedValue({ success: true, data: 'builtin' });
    mockGetMCPManagerPort.mockReturnValue({ executeTool: mockMCPExecuteTool });
    mockMCPExecuteTool.mockResolvedValue({ success: true, data: 'mcp-result' });
    mockGetPluginRegistryPort.mockReturnValue(null);
  });

  // -----------------------------------------------------------------------
  // createDefaultToolExecutor
  // -----------------------------------------------------------------------
  describe('createDefaultToolExecutor', () => {
    it('should return a function', () => {
      const executor = createDefaultToolExecutor();
      expect(typeof executor).toBe('function');
    });

    it('should register circuit breaker presets on creation', () => {
      createDefaultToolExecutor();
      expect(mockRegisterToolConfig).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // _executeToolInner — routing
  // -----------------------------------------------------------------------
  describe('_executeToolInner routing', () => {
    it('routes memory_* to executeMemoryTool', async () => {
      const res = await _executeToolInner('memory_read', { key: 'a' });
      expect(res.success).toBe(true);
      expect(mockExecuteMemoryTool).toHaveBeenCalledWith('memory_read', { key: 'a' });
    });

    it('routes skill_* to executeSkillTool', async () => {
      const res = await _executeToolInner('skill_list', {});
      expect(res.success).toBe(true);
      expect(mockExecuteSkillTool).toHaveBeenCalledWith('skill_list', {});
    });

    it('routes goal_* to executeGoalTool', async () => {
      const res = await _executeToolInner('goal_create', { name: 'g' });
      expect(res.success).toBe(true);
      expect(mockExecuteGoalTool).toHaveBeenCalledWith('goal_create', { name: 'g' });
    });

    it('routes proactive_* to executeProactiveTool', async () => {
      const res = await _executeToolInner('proactive_schedule', {});
      expect(res.success).toBe(true);
      expect(mockExecuteProactiveTool).toHaveBeenCalled();
    });

    it('routes notification_* to executeProactiveTool', async () => {
      await _executeToolInner('notification_send', {});
      expect(mockExecuteProactiveTool).toHaveBeenCalled();
    });

    it('routes schedule_once to executeProactiveTool', async () => {
      await _executeToolInner('schedule_once', {});
      expect(mockExecuteProactiveTool).toHaveBeenCalled();
    });

    it('routes persona_* to executePersonaTool', async () => {
      const res = await _executeToolInner('persona_get', {});
      expect(res.success).toBe(true);
      expect(mockExecutePersonaTool).toHaveBeenCalled();
    });

    it('routes builtin tools to executeBuiltinTool', async () => {
      const res = await _executeToolInner('get_weather', {});
      expect(res.success).toBe(true);
      expect(mockExecuteBuiltinTool).toHaveBeenCalled();
    });

    it('returns migration message for feishu_* tools', async () => {
      const res = await _executeToolInner('feishu_calendar_list', {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('migrated');
    });

    it('routes mcp_* to MCPClientManager', async () => {
      const res = await _executeToolInner('mcp_server1__tool_name', {});
      expect(res.success).toBe(true);
      expect(mockMCPExecuteTool).toHaveBeenCalledWith('server1', 'tool_name', {});
    });

    it('returns error for invalid MCP tool name format', async () => {
      const res = await _executeToolInner('mcp_invalidformat', {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid MCP tool name');
    });

    it('returns error when MCP manager is null', async () => {
      mockGetMCPManagerPort.mockReturnValue(null);
      const res = await _executeToolInner('mcp_s__t', {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('MCP manager not initialized');
    });

    it('returns error for unknown tool', async () => {
      mockIsBuiltinTool.mockReturnValue(false);
      const res = await _executeToolInner('completely_unknown', {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('Unknown tool');
    });
  });

  // -----------------------------------------------------------------------
  // skill_ensure special handling
  // -----------------------------------------------------------------------
  describe('skill_ensure NEW_SKILL_REQUIRES_CREATOR', () => {
    it('returns enriched error message when skill_ensure fails with NEW_SKILL_REQUIRES_CREATOR', async () => {
      mockExecuteSkillTool.mockResolvedValue({
        success: false,
        error: 'NEW_SKILL_REQUIRES_CREATOR',
        data: { skillName: 'my-skill' },
      });

      const res = await _executeToolInner('skill_ensure', { name: 'my-skill' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('skill-creator');
      expect(res.error).toContain('my-skill');
    });
  });

  // -----------------------------------------------------------------------
  // Plugin tools (highest priority)
  // -----------------------------------------------------------------------
  describe('plugin tool dispatch', () => {
    it('dispatches to plugin tool when registry has the tool', async () => {
      const pluginExecute = vi.fn(async () => ({ success: true, data: 'plugin-result' }));
      mockGetPluginRegistryPort.mockReturnValue({
        tools: new Map([['my_plugin', { execute: pluginExecute }]]),
      });

      const res = await _executeToolInner('my_plugin', { x: 1 });
      expect(res.success).toBe(true);
      expect(res.data).toBe('plugin-result');
      expect(pluginExecute).toHaveBeenCalledWith({ x: 1 });
    });
  });

  // -----------------------------------------------------------------------
  // Circuit breaker integration
  // -----------------------------------------------------------------------
  describe('circuit breaker', () => {
    it('wraps feishu_ tools with circuit breaker', async () => {
      const executor = createDefaultToolExecutor();
      await executor('feishu_test', {});
      expect(mockCBExecute).toHaveBeenCalled();
    });

    it('wraps mcp_ tools with circuit breaker', async () => {
      const executor = createDefaultToolExecutor();
      await executor('mcp_s__t', {});
      expect(mockCBExecute).toHaveBeenCalled();
    });

    it('wraps web_search with circuit breaker', async () => {
      const executor = createDefaultToolExecutor();
      await executor('web_search', {});
      expect(mockCBExecute).toHaveBeenCalled();
    });

    it('handles CircuitOpenError gracefully', async () => {
      const { CircuitOpenError } = await import('../../../infra/resilience/circuit-breaker');
      mockCBExecute.mockRejectedValue(new CircuitOpenError('open', 30000));
      const executor = createDefaultToolExecutor();
      const res = await executor('web_search', {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('circuit breaker open');
    });

    it('handles non-CB errors as tool failure', async () => {
      mockCBExecute.mockRejectedValue(new Error('network timeout'));
      const executor = createDefaultToolExecutor();
      const res = await executor('mcp_s__t', {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('network timeout');
    });

    it('does not wrap non-protected tools', async () => {
      mockIsBuiltinTool.mockReturnValue(false);
      const executor = createDefaultToolExecutor();
      await executor('memory_read', {});
      expect(mockCBExecute).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // MCP tool execution error
  // -----------------------------------------------------------------------
  describe('MCP tool error handling', () => {
    it('catches and returns MCP execution error', async () => {
      mockMCPExecuteTool.mockRejectedValue(new Error('connection refused'));
      const res = await _executeToolInner('mcp_server__tool', {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('MCP tool execution failed');
    });
  });
});
