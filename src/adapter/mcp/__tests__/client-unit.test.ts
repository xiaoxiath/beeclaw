/**
 * Comprehensive unit tests for src/adapter/mcp/client.ts
 * Targets maximum statement and branch coverage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks – survive vitest mockReset
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const mockClientInstance = {
    connect: vi.fn(),
    close: vi.fn(),
    listTools: vi.fn(),
    listResources: vi.fn(),
    listPrompts: vi.fn(),
    callTool: vi.fn(),
    readResource: vi.fn(),
    getPrompt: vi.fn(),
  };

  return {
    mockClientInstance,
    MockClient: vi.fn(),
    MockStdioTransportSpy: vi.fn(),
    MockStreamableHTTPSpy: vi.fn(),
    MockSSESpy: vi.fn(),
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  function FakeClient(this: any, ...args: any[]) {
    mocks.MockClient(...args);
    Object.assign(this, {
      connect: (...a: any[]) => mocks.mockClientInstance.connect(...a),
      close: (...a: any[]) => mocks.mockClientInstance.close(...a),
      listTools: (...a: any[]) => mocks.mockClientInstance.listTools(...a),
      listResources: (...a: any[]) => mocks.mockClientInstance.listResources(...a),
      listPrompts: (...a: any[]) => mocks.mockClientInstance.listPrompts(...a),
      callTool: (...a: any[]) => mocks.mockClientInstance.callTool(...a),
      readResource: (...a: any[]) => mocks.mockClientInstance.readResource(...a),
      getPrompt: (...a: any[]) => mocks.mockClientInstance.getPrompt(...a),
    });
  }
  return { Client: FakeClient };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  function FakeStdioTransport(this: any, ...args: any[]) {
    mocks.MockStdioTransportSpy(...args);
    this.type = 'stdio';
  }
  return { StdioClientTransport: FakeStdioTransport };
});

// Dynamic imports - these are imported via `import()` inside createTransport
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  function FakeStreamableHTTP(this: any, ...args: any[]) {
    mocks.MockStreamableHTTPSpy(...args);
    this.type = 'http';
  }
  return { StreamableHTTPClientTransport: FakeStreamableHTTP };
});

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => {
  function FakeSSE(this: any, ...args: any[]) {
    mocks.MockSSESpy(...args);
    this.type = 'sse';
  }
  return { SSEClientTransport: FakeSSE };
});

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: mocks.mockLogger,
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
import {
  MCPClientManager,
  getMCPManager,
  resetMCPManager,
  type MCPServerConfig,
} from '../client';

// ---------------------------------------------------------------------------
// Helper: reset mock implementations after vitest's automatic mockReset
// ---------------------------------------------------------------------------
function resetMockImplementations() {
  mocks.mockClientInstance.connect.mockResolvedValue(undefined);
  mocks.mockClientInstance.close.mockResolvedValue(undefined);
  mocks.mockClientInstance.listTools.mockResolvedValue({ tools: [] });
  mocks.mockClientInstance.listResources.mockResolvedValue({ resources: [] });
  mocks.mockClientInstance.listPrompts.mockResolvedValue({ prompts: [] });
  mocks.mockClientInstance.callTool.mockResolvedValue({
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
  });
  mocks.mockClientInstance.readResource.mockResolvedValue({
    contents: [{ text: 'resource text' }],
  });
  mocks.mockClientInstance.getPrompt.mockResolvedValue({
    messages: [
      { role: 'user', content: { type: 'text', text: 'hello' } },
    ],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeStdioConfig(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    id: 'test-server',
    name: 'Test Server',
    transport: 'stdio',
    command: '/usr/bin/node',
    args: ['server.js'],
    env: { FOO: 'bar' },
    enabled: true,
    timeout: 5000,
    ...overrides,
  };
}

function makeHttpConfig(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    id: 'http-server',
    name: 'HTTP Server',
    transport: 'http',
    url: 'http://localhost:3000/mcp',
    headers: { Authorization: 'Bearer token' },
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPClientManager', () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    resetMockImplementations();
    manager = new MCPClientManager();
  });

  afterEach(async () => {
    await manager.disconnectAll().catch(() => {});
  });

  // ========================================================================
  // connect()
  // ========================================================================

  describe('connect()', () => {
    it('should connect via stdio transport and list capabilities', async () => {
      const tools = [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }];
      const resources = [{ uri: 'file:///tmp', name: 'tmp' }];
      const prompts = [{ name: 'greeting', description: 'greet' }];

      mocks.mockClientInstance.listTools.mockResolvedValue({ tools });
      mocks.mockClientInstance.listResources.mockResolvedValue({ resources });
      mocks.mockClientInstance.listPrompts.mockResolvedValue({ prompts });

      const conn = await manager.connect(makeStdioConfig());

      expect(conn.id).toBe('test-server');
      expect(conn.name).toBe('Test Server');
      expect(conn.connected).toBe(true);
      expect(conn.tools).toEqual(tools);
      expect(conn.resources).toEqual(resources);
      expect(conn.prompts).toEqual(prompts);
      expect(mocks.mockClientInstance.connect).toHaveBeenCalledOnce();
    });

    it('should return existing connection if already connected', async () => {
      const conn1 = await manager.connect(makeStdioConfig());
      const conn2 = await manager.connect(makeStdioConfig());

      expect(conn1).toBe(conn2);
      // connect called only once (second time returns cached)
      expect(mocks.mockClientInstance.connect).toHaveBeenCalledTimes(1);
    });

    it('should throw when transport creation fails', async () => {
      const config = makeStdioConfig({ command: undefined });

      await expect(manager.connect(config)).rejects.toThrow('Failed to create transport');
      expect(mocks.mockLogger.error).toHaveBeenCalled();
    });

    it('should throw when client.connect fails', async () => {
      mocks.mockClientInstance.connect.mockRejectedValue(new Error('Connection refused'));

      await expect(manager.connect(makeStdioConfig())).rejects.toThrow('Failed to connect');
      expect(mocks.mockLogger.error).toHaveBeenCalled();
    });

    it('should handle non-Error thrown in client.connect', async () => {
      mocks.mockClientInstance.connect.mockRejectedValue('string error');

      await expect(manager.connect(makeStdioConfig())).rejects.toThrow('Failed to connect: string error');
    });

    it('should handle non-Error thrown in createTransport', async () => {
      const config = makeStdioConfig({ transport: 'unknown' as any });

      await expect(manager.connect(config)).rejects.toThrow('Failed to create transport');
    });

    it('should handle listTools failure gracefully', async () => {
      mocks.mockClientInstance.listTools.mockRejectedValue(new Error('not supported'));

      const conn = await manager.connect(makeStdioConfig());
      expect(conn.tools).toEqual([]);
      expect(mocks.mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle listResources failure gracefully', async () => {
      mocks.mockClientInstance.listResources.mockRejectedValue(new Error('not supported'));

      const conn = await manager.connect(makeStdioConfig());
      expect(conn.resources).toEqual([]);
    });

    it('should handle listPrompts failure gracefully', async () => {
      mocks.mockClientInstance.listPrompts.mockRejectedValue(new Error('not supported'));

      const conn = await manager.connect(makeStdioConfig());
      expect(conn.prompts).toEqual([]);
    });
  });

  // ========================================================================
  // createTransport (via connect)
  // ========================================================================

  describe('createTransport (private, via connect)', () => {
    it('should create StdioClientTransport for stdio', async () => {
      await manager.connect(makeStdioConfig());
      expect(mocks.MockStdioTransportSpy).toHaveBeenCalled();
    });

    it('should throw for stdio without command', async () => {
      await expect(
        manager.connect(makeStdioConfig({ command: undefined })),
      ).rejects.toThrow('stdio transport requires command');
    });

    it('should create StreamableHTTPClientTransport for http', async () => {
      await manager.connect(makeHttpConfig());
      expect(mocks.MockStreamableHTTPSpy).toHaveBeenCalled();
    });

    it('should fall back to SSE transport when StreamableHTTP constructor throws', async () => {
      mocks.MockStreamableHTTPSpy.mockImplementation(() => {
        throw new Error('StreamableHTTP not available');
      });

      await manager.connect(makeHttpConfig());
      expect(mocks.MockSSESpy).toHaveBeenCalled();
    });

    it('should create transport for sse transport type (same branch as http)', async () => {
      await manager.connect(makeHttpConfig({ transport: 'sse' }));
      expect(mocks.MockStreamableHTTPSpy).toHaveBeenCalled();
    });

    it('should throw for http transport without url', async () => {
      await expect(
        manager.connect(makeHttpConfig({ url: undefined })),
      ).rejects.toThrow('http transport requires url');
    });

    it('should throw for unknown transport type', async () => {
      await expect(
        manager.connect(makeStdioConfig({ transport: 'websocket' as any })),
      ).rejects.toThrow('Unknown transport type: websocket');
    });
  });

  // ========================================================================
  // disconnect() / disconnectAll()
  // ========================================================================

  describe('disconnect()', () => {
    it('should close connection and remove from map', async () => {
      await manager.connect(makeStdioConfig());
      expect(manager.getConnection('test-server')).toBeDefined();

      await manager.disconnect('test-server');
      expect(manager.getConnection('test-server')).toBeUndefined();
      expect(mocks.mockClientInstance.close).toHaveBeenCalledOnce();
    });

    it('should be a no-op for non-existent id', async () => {
      await manager.disconnect('nonexistent');
      // Should not throw
    });

    it('should handle close error gracefully', async () => {
      await manager.connect(makeStdioConfig());
      mocks.mockClientInstance.close.mockRejectedValue(new Error('close failed'));

      await manager.disconnect('test-server');
      expect(manager.getConnection('test-server')).toBeUndefined();
      expect(mocks.mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('disconnectAll()', () => {
    it('should disconnect all connections', async () => {
      await manager.connect(makeStdioConfig({ id: 's1', name: 'S1' }));
      await manager.connect(makeStdioConfig({ id: 's2', name: 'S2' }));

      await manager.disconnectAll();
      expect(manager.getStatus()).toHaveLength(0);
    });
  });

  // ========================================================================
  // getConnection() / getStatus()
  // ========================================================================

  describe('getConnection()', () => {
    it('should return undefined for unknown id', () => {
      expect(manager.getConnection('unknown')).toBeUndefined();
    });

    it('should return connection for known id', async () => {
      await manager.connect(makeStdioConfig());
      const conn = manager.getConnection('test-server');
      expect(conn).toBeDefined();
      expect(conn!.id).toBe('test-server');
    });
  });

  describe('getStatus()', () => {
    it('should return empty array when no connections', () => {
      expect(manager.getStatus()).toEqual([]);
    });

    it('should return status for all connections', async () => {
      const tools = [{ name: 't1', inputSchema: { type: 'object' } }];
      mocks.mockClientInstance.listTools.mockResolvedValue({ tools });

      await manager.connect(makeStdioConfig());
      const status = manager.getStatus();

      expect(status).toHaveLength(1);
      expect(status[0]).toEqual({
        id: 'test-server',
        name: 'Test Server',
        connected: true,
        tools: 1,
        resources: 0,
        prompts: 0,
        lastError: undefined,
      });
    });
  });

  // ========================================================================
  // getAllToolsAsOpenAI()
  // ========================================================================

  describe('getAllToolsAsOpenAI()', () => {
    it('should return empty array when no connections', () => {
      expect(manager.getAllToolsAsOpenAI()).toEqual([]);
    });

    it('should convert MCP tools to OpenAI format', async () => {
      mocks.mockClientInstance.listTools.mockResolvedValue({
        tools: [
          {
            name: 'read_file',
            description: 'Read a file',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
      });

      await manager.connect(makeStdioConfig());
      const tools = manager.getAllToolsAsOpenAI();

      expect(tools).toHaveLength(1);
      expect(tools[0].type).toBe('function');
      expect(tools[0].function.name).toBe('mcp_test-server__read_file');
      expect(tools[0].function.description).toBe('Read a file');
      expect(tools[0].function.parameters).toEqual({
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      });
    });

    it('should use default description when tool has none', async () => {
      mocks.mockClientInstance.listTools.mockResolvedValue({
        tools: [{ name: 'my_tool', inputSchema: { type: 'object' } }],
      });

      await manager.connect(makeStdioConfig());
      const tools = manager.getAllToolsAsOpenAI();

      expect(tools[0].function.description).toBe('MCP tool: my_tool');
    });

    it('should handle tool with no properties or required in inputSchema', async () => {
      mocks.mockClientInstance.listTools.mockResolvedValue({
        tools: [{ name: 'no_params', description: 'desc', inputSchema: { type: 'object' } }],
      });

      await manager.connect(makeStdioConfig());
      const tools = manager.getAllToolsAsOpenAI();

      expect(tools[0].function.parameters).toEqual({
        type: 'object',
        properties: {},
        required: [],
      });
    });

    it('should skip disabled connections', async () => {
      mocks.mockClientInstance.listTools.mockResolvedValue({
        tools: [{ name: 't1', inputSchema: { type: 'object' } }],
      });

      await manager.connect(makeStdioConfig({ enabled: false }));
      const tools = manager.getAllToolsAsOpenAI();

      expect(tools).toHaveLength(0);
    });

    it('should apply exclude filter', async () => {
      mocks.mockClientInstance.listTools.mockResolvedValue({
        tools: [
          { name: 'allowed', inputSchema: { type: 'object' } },
          { name: 'blocked', inputSchema: { type: 'object' } },
        ],
      });

      await manager.connect(
        makeStdioConfig({ tools: { exclude: ['blocked'] } }),
      );
      const tools = manager.getAllToolsAsOpenAI();

      expect(tools).toHaveLength(1);
      expect(tools[0].function.name).toContain('allowed');
    });

    it('should apply include filter', async () => {
      mocks.mockClientInstance.listTools.mockResolvedValue({
        tools: [
          { name: 'allowed', inputSchema: { type: 'object' } },
          { name: 'not_in_include', inputSchema: { type: 'object' } },
        ],
      });

      await manager.connect(
        makeStdioConfig({ tools: { include: ['allowed'] } }),
      );
      const tools = manager.getAllToolsAsOpenAI();

      expect(tools).toHaveLength(1);
      expect(tools[0].function.name).toContain('allowed');
    });
  });

  // ========================================================================
  // executeTool()
  // ========================================================================

  describe('executeTool()', () => {
    it('should execute tool and return success result', async () => {
      mocks.mockClientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'file contents here' }],
        isError: false,
      });

      await manager.connect(makeStdioConfig());
      const result = await manager.executeTool('test-server', 'read_file', { path: '/tmp/a' });

      expect(result.success).toBe(true);
      expect(result.data).toBe('file contents here');
      expect(result.isError).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('should return error when server not found', async () => {
      const result = await manager.executeTool('nonexistent', 'tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when server not connected', async () => {
      await manager.connect(makeStdioConfig());
      const conn = manager.getConnection('test-server')!;
      conn.connected = false;

      const result = await manager.executeTool('test-server', 'tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });

    it('should handle isError=true in tool result', async () => {
      mocks.mockClientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Permission denied' }],
        isError: true,
      });

      await manager.connect(makeStdioConfig());
      const result = await manager.executeTool('test-server', 'tool', {});

      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.error).toBe('Permission denied');
    });

    it('should join multiple text content blocks', async () => {
      mocks.mockClientInstance.callTool.mockResolvedValue({
        content: [
          { type: 'text', text: 'line1' },
          { type: 'image', data: 'binary' },
          { type: 'text', text: 'line2' },
        ],
        isError: false,
      });

      await manager.connect(makeStdioConfig());
      const result = await manager.executeTool('test-server', 'tool', {});

      expect(result.data).toBe('line1\nline2');
    });

    it('should use raw content when no text content available', async () => {
      mocks.mockClientInstance.callTool.mockResolvedValue({
        content: [{ type: 'image', data: 'binary' }],
        isError: false,
      });

      await manager.connect(makeStdioConfig());
      const result = await manager.executeTool('test-server', 'tool', {});

      expect(result.data).toEqual([{ type: 'image', data: 'binary' }]);
    });

    it('should use custom timeout over defaults', async () => {
      mocks.mockClientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      });

      await manager.connect(makeStdioConfig());
      await manager.executeTool('test-server', 'tool', {}, 60000);

      expect(mocks.mockClientInstance.callTool).toHaveBeenCalledWith(
        { name: 'tool', arguments: {} },
        undefined,
        { timeout: 60000 },
      );
    });

    it('should use config timeout when no custom timeout', async () => {
      mocks.mockClientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      });

      await manager.connect(makeStdioConfig({ timeout: 10000 }));
      await manager.executeTool('test-server', 'tool', {});

      expect(mocks.mockClientInstance.callTool).toHaveBeenCalledWith(
        { name: 'tool', arguments: {} },
        undefined,
        { timeout: 10000 },
      );
    });

    it('should fall back to default 30s timeout when none specified', async () => {
      mocks.mockClientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      });

      await manager.connect(makeStdioConfig({ timeout: undefined }));
      await manager.executeTool('test-server', 'tool', {});

      expect(mocks.mockClientInstance.callTool).toHaveBeenCalledWith(
        { name: 'tool', arguments: {} },
        undefined,
        { timeout: 30000 },
      );
    });

    it('should return error on generic tool execution failure', async () => {
      mocks.mockClientInstance.callTool.mockRejectedValue(new Error('Some error'));

      await manager.connect(makeStdioConfig());
      const result = await manager.executeTool('test-server', 'tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Some error');
    });

    it('should handle non-Error thrown in executeTool', async () => {
      mocks.mockClientInstance.callTool.mockRejectedValue('string thrown');

      await manager.connect(makeStdioConfig());
      const result = await manager.executeTool('test-server', 'tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('string thrown');
    });

    it('should set lastError on connection when tool fails', async () => {
      mocks.mockClientInstance.callTool.mockRejectedValue(new Error('timeout'));

      await manager.connect(makeStdioConfig());
      await manager.executeTool('test-server', 'tool', {});

      const conn = manager.getConnection('test-server')!;
      expect(conn.lastError).toBe('timeout');
    });
  });

  // ========================================================================
  // executeTool() - reconnection logic (B-P2-07)
  // ========================================================================

  describe('executeTool() - reconnection', () => {
    it('should attempt reconnection on connection error and retry on success', async () => {
      vi.useFakeTimers();

      let callCount = 0;
      mocks.mockClientInstance.callTool.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.reject(new Error('ECONNREFUSED'));
        }
        return Promise.resolve({
          content: [{ type: 'text', text: 'retried OK' }],
          isError: false,
        });
      });

      await manager.connect(makeStdioConfig());

      const resultPromise = manager.executeTool('test-server', 'tool', {});

      // Advance past the reconnection delay (BASE_DELAY * 2^0 = 1000ms)
      await vi.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toBe('retried OK');

      vi.useRealTimers();
    });

    it('should return original error when reconnection fails', async () => {
      vi.useFakeTimers();

      mocks.mockClientInstance.callTool.mockRejectedValue(new Error('connection closed'));

      // First connect succeeds. Reconnect (second connect) fails.
      let connectCount = 0;
      mocks.mockClientInstance.connect.mockImplementation(() => {
        connectCount++;
        if (connectCount > 1) {
          return Promise.reject(new Error('reconnect failed'));
        }
        return Promise.resolve(undefined);
      });

      await manager.connect(makeStdioConfig());

      const resultPromise = manager.executeTool('test-server', 'tool', {});
      await vi.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('connection closed');

      vi.useRealTimers();
    });

    it('should return retry error when retry after reconnect fails', async () => {
      vi.useFakeTimers();

      // All callTool calls fail with connection errors
      mocks.mockClientInstance.callTool.mockRejectedValue(new Error('EPIPE'));

      await manager.connect(makeStdioConfig());

      const resultPromise = manager.executeTool('test-server', 'tool', {});
      await vi.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Retry after reconnect failed');

      vi.useRealTimers();
    });

    it('should not attempt reconnection for non-connection errors', async () => {
      mocks.mockClientInstance.callTool.mockRejectedValue(new Error('Invalid argument'));

      await manager.connect(makeStdioConfig());
      const result = await manager.executeTool('test-server', 'tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid argument');
      // Connection should still be marked as connected
      const conn = manager.getConnection('test-server')!;
      expect(conn.connected).toBe(true);
    });

    it('should stop reconnecting after MAX_RECONNECT (5) attempts', async () => {
      vi.useFakeTimers();

      mocks.mockClientInstance.callTool.mockRejectedValue(new Error('ECONNREFUSED'));
      // Reconnect always fails (connect throws after first)
      let connectCount = 0;
      mocks.mockClientInstance.connect.mockImplementation(() => {
        connectCount++;
        if (connectCount > 1) {
          return Promise.reject(new Error('still down'));
        }
        return Promise.resolve(undefined);
      });

      await manager.connect(makeStdioConfig());

      // Exhaust reconnection attempts by calling executeTool multiple times
      for (let i = 0; i < 6; i++) {
        const conn = manager.getConnection('test-server');
        if (conn) conn.connected = true;
        const p = manager.executeTool('test-server', 'tool', {});
        await vi.advanceTimersByTimeAsync(60000);
        await p;
      }

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Max reconnect attempts'),
      );

      vi.useRealTimers();
    });

    it('should handle ENOTCONN as connection error', async () => {
      vi.useFakeTimers();

      let callCount = 0;
      mocks.mockClientInstance.callTool.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return Promise.reject(new Error('ENOTCONN'));
        return Promise.resolve({
          content: [{ type: 'text', text: 'recovered' }],
          isError: false,
        });
      });

      await manager.connect(makeStdioConfig());
      const p = manager.executeTool('test-server', 'tool', {});
      await vi.advanceTimersByTimeAsync(2000);
      const result = await p;

      expect(result.success).toBe(true);

      vi.useRealTimers();
    });

    it('should handle "disconnect" keyword in error message', async () => {
      vi.useFakeTimers();

      let callCount = 0;
      mocks.mockClientInstance.callTool.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return Promise.reject(new Error('Server disconnected unexpectedly'));
        return Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        });
      });

      await manager.connect(makeStdioConfig());
      const p = manager.executeTool('test-server', 'tool', {});
      await vi.advanceTimersByTimeAsync(2000);
      const result = await p;

      expect(result.success).toBe(true);

      vi.useRealTimers();
    });

    it('should handle non-Error in retry after reconnect', async () => {
      vi.useFakeTimers();

      let callCount = 0;
      mocks.mockClientInstance.callTool.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return Promise.reject(new Error('ECONNREFUSED'));
        return Promise.reject('string retry error');
      });

      await manager.connect(makeStdioConfig());
      const p = manager.executeTool('test-server', 'tool', {});
      await vi.advanceTimersByTimeAsync(2000);
      const result = await p;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Retry after reconnect failed');

      vi.useRealTimers();
    });
  });

  // ========================================================================
  // readResource()
  // ========================================================================

  describe('readResource()', () => {
    it('should read resource and return text', async () => {
      mocks.mockClientInstance.readResource.mockResolvedValue({
        contents: [{ text: 'content1' }, { text: 'content2' }],
      });

      await manager.connect(makeStdioConfig());
      const result = await manager.readResource('test-server', 'file:///tmp');

      expect(result).toBe('content1\ncontent2');
    });

    it('should throw when server not found', async () => {
      await expect(
        manager.readResource('unknown', 'file:///tmp'),
      ).rejects.toThrow('not connected');
    });

    it('should throw when server not connected', async () => {
      await manager.connect(makeStdioConfig());
      manager.getConnection('test-server')!.connected = false;

      await expect(
        manager.readResource('test-server', 'file:///tmp'),
      ).rejects.toThrow('not connected');
    });

    it('should filter out contents without text', async () => {
      mocks.mockClientInstance.readResource.mockResolvedValue({
        contents: [{ text: 'good' }, { data: 'binary' }, { text: '' }],
      });

      await manager.connect(makeStdioConfig());
      const result = await manager.readResource('test-server', 'file:///tmp');

      expect(result).toBe('good');
    });
  });

  // ========================================================================
  // getPrompt()
  // ========================================================================

  describe('getPrompt()', () => {
    it('should get prompt and format messages', async () => {
      mocks.mockClientInstance.getPrompt.mockResolvedValue({
        messages: [
          { role: 'user', content: { type: 'text', text: 'What is 2+2?' } },
          { role: 'assistant', content: { type: 'text', text: '4' } },
        ],
      });

      await manager.connect(makeStdioConfig());
      const result = await manager.getPrompt('test-server', 'math', { question: '2+2' });

      expect(result).toBe('user: What is 2+2?\n\nassistant: 4');
    });

    it('should throw when server not connected', async () => {
      await expect(
        manager.getPrompt('unknown', 'prompt', {}),
      ).rejects.toThrow('not connected');
    });

    it('should filter out non-text content messages', async () => {
      mocks.mockClientInstance.getPrompt.mockResolvedValue({
        messages: [
          { role: 'user', content: { type: 'text', text: 'hello' } },
          { role: 'assistant', content: { type: 'image', data: 'binary' } },
        ],
      });

      await manager.connect(makeStdioConfig());
      const result = await manager.getPrompt('test-server', 'prompt');

      expect(result).toBe('user: hello');
    });

    it('should pass arguments to client.getPrompt', async () => {
      mocks.mockClientInstance.getPrompt.mockResolvedValue({
        messages: [],
      });

      await manager.connect(makeStdioConfig());
      await manager.getPrompt('test-server', 'my_prompt', { key: 'value' });

      expect(mocks.mockClientInstance.getPrompt).toHaveBeenCalledWith({
        name: 'my_prompt',
        arguments: { key: 'value' },
      });
    });
  });

  // ========================================================================
  // refreshTools()
  // ========================================================================

  describe('refreshTools()', () => {
    it('should refresh and update tools list', async () => {
      mocks.mockClientInstance.listTools.mockResolvedValue({ tools: [] });
      await manager.connect(makeStdioConfig());

      const newTools = [{ name: 'new_tool', inputSchema: { type: 'object' } }];
      mocks.mockClientInstance.listTools.mockResolvedValue({ tools: newTools });

      const result = await manager.refreshTools('test-server');
      expect(result).toEqual(newTools);

      const conn = manager.getConnection('test-server')!;
      expect(conn.tools).toEqual(newTools);
    });

    it('should throw when server not connected', async () => {
      await expect(manager.refreshTools('unknown')).rejects.toThrow('not connected');
    });
  });

  // ========================================================================
  // static isMCPToolName() / parseMCPToolName()
  // ========================================================================

  describe('isMCPToolName()', () => {
    it('should return true for mcp_ prefixed names', () => {
      expect(MCPClientManager.isMCPToolName('mcp_server__tool')).toBe(true);
      expect(MCPClientManager.isMCPToolName('mcp_')).toBe(true);
    });

    it('should return false for non-mcp names', () => {
      expect(MCPClientManager.isMCPToolName('tool')).toBe(false);
      expect(MCPClientManager.isMCPToolName('Mcp_tool')).toBe(false);
    });
  });

  describe('parseMCPToolName()', () => {
    it('should parse valid tool name with double underscore', () => {
      expect(MCPClientManager.parseMCPToolName('mcp_fs__read_file')).toEqual({
        serverId: 'fs',
        toolName: 'read_file',
      });
    });

    it('should return null for non-mcp prefix', () => {
      expect(MCPClientManager.parseMCPToolName('other_tool')).toBeNull();
    });

    it('should return null when no double underscore separator', () => {
      expect(MCPClientManager.parseMCPToolName('mcp_noseparator')).toBeNull();
    });

    it('should handle server id with underscores', () => {
      expect(MCPClientManager.parseMCPToolName('mcp_my_server__tool')).toEqual({
        serverId: 'my_server',
        toolName: 'tool',
      });
    });

    it('should handle empty toolName after separator', () => {
      const result = MCPClientManager.parseMCPToolName('mcp_server__');
      expect(result).toEqual({ serverId: 'server', toolName: '' });
    });
  });

  // ========================================================================
  // pingServer()
  // ========================================================================

  describe('pingServer()', () => {
    it('should return ok:true with latency on success', async () => {
      const tools = [{ name: 't' }];
      mocks.mockClientInstance.listTools.mockResolvedValue({ tools });

      await manager.connect(makeStdioConfig());
      const ping = await manager.pingServer('test-server');

      expect(ping.ok).toBe(true);
      expect(ping.latencyMs).toBeGreaterThanOrEqual(0);
      expect(ping.toolCount).toBe(1);
    });

    it('should return error when server not found', async () => {
      const ping = await manager.pingServer('unknown');

      expect(ping.ok).toBe(false);
      expect(ping.error).toContain('not found');
      expect(ping.latencyMs).toBe(0);
      expect(ping.toolCount).toBe(0);
    });

    it('should return error when server not connected', async () => {
      await manager.connect(makeStdioConfig());
      manager.getConnection('test-server')!.connected = false;

      const ping = await manager.pingServer('test-server');

      expect(ping.ok).toBe(false);
      expect(ping.error).toContain('not connected');
    });

    it('should handle timeout', async () => {
      mocks.mockClientInstance.listTools.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000)),
      );

      await manager.connect(makeStdioConfig());
      const ping = await manager.pingServer('test-server', 50);

      expect(ping.ok).toBe(false);
      expect(ping.error).toContain('timeout');
    });

    it('should handle listTools error during ping', async () => {
      await manager.connect(makeStdioConfig());
      mocks.mockClientInstance.listTools.mockRejectedValue(new Error('network error'));

      const ping = await manager.pingServer('test-server');

      expect(ping.ok).toBe(false);
      expect(ping.error).toBe('network error');
    });

    it('should handle non-Error thrown during ping', async () => {
      await manager.connect(makeStdioConfig());
      mocks.mockClientInstance.listTools.mockRejectedValue('string error');

      const ping = await manager.pingServer('test-server');

      expect(ping.ok).toBe(false);
      expect(ping.error).toBe('string error');
    });

    it('should use entry.tools.length when result has no tools property', async () => {
      mocks.mockClientInstance.listTools.mockResolvedValue({
        tools: [{ name: 't1' }, { name: 't2' }],
      });
      await manager.connect(makeStdioConfig());

      // Now listTools returns something without .tools
      mocks.mockClientInstance.listTools.mockResolvedValue({});

      const ping = await manager.pingServer('test-server');
      expect(ping.ok).toBe(true);
      // Falls back to entry.tools.length which is 2 from connection
      expect(ping.toolCount).toBe(2);
    });

    it('should use custom timeout', async () => {
      mocks.mockClientInstance.listTools.mockResolvedValue({ tools: [] });
      await manager.connect(makeStdioConfig());

      const ping = await manager.pingServer('test-server', 1000);
      expect(ping.ok).toBe(true);
    });
  });

  // ========================================================================
  // pingAllServers()
  // ========================================================================

  describe('pingAllServers()', () => {
    it('should ping all connected servers', async () => {
      await manager.connect(makeStdioConfig({ id: 's1', name: 'S1' }));
      await manager.connect(makeStdioConfig({ id: 's2', name: 'S2' }));

      const results = await manager.pingAllServers();

      expect(Object.keys(results)).toHaveLength(2);
      expect(results.s1.ok).toBe(true);
      expect(results.s2.ok).toBe(true);
    });

    it('should handle failed pings', async () => {
      await manager.connect(makeStdioConfig());
      mocks.mockClientInstance.listTools.mockRejectedValue(new Error('critical'));

      const results = await manager.pingAllServers();

      expect(results['test-server'].ok).toBe(false);
      expect(results['test-server'].error).toBe('critical');
    });

    it('should return empty object when no connections', async () => {
      const results = await manager.pingAllServers();
      expect(Object.keys(results)).toHaveLength(0);
    });

    it('should pass custom timeout to pingServer', async () => {
      await manager.connect(makeStdioConfig());
      const results = await manager.pingAllServers(1000);
      expect(results['test-server'].ok).toBe(true);
    });
  });

  // ========================================================================
  // getHealthStatus()
  // ========================================================================

  describe('getHealthStatus()', () => {
    it('should combine status and ping results', async () => {
      mocks.mockClientInstance.listTools.mockResolvedValue({
        tools: [{ name: 't1' }],
      });

      await manager.connect(makeStdioConfig());
      const health = await manager.getHealthStatus();

      expect(health['test-server']).toBeDefined();
      expect(health['test-server'].connected).toBe(true);
      expect(health['test-server'].toolCount).toBe(1);
      expect(health['test-server'].pingOk).toBe(true);
      expect(health['test-server'].circuitState).toBe('UNKNOWN');
    });

    it('should show ping failure in health status', async () => {
      await manager.connect(makeStdioConfig());
      mocks.mockClientInstance.listTools.mockRejectedValue(new Error('down'));

      const health = await manager.getHealthStatus(100);

      expect(health['test-server'].pingOk).toBe(false);
      expect(health['test-server'].error).toBe('down');
    });

    it('should handle server with no ping result', async () => {
      await manager.connect(makeStdioConfig());
      const health = await manager.getHealthStatus();

      expect(health['test-server'].pingLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================================================
  // Singleton: getMCPManager() / resetMCPManager()
  // ========================================================================

  describe('getMCPManager() / resetMCPManager()', () => {
    afterEach(() => {
      resetMCPManager();
    });

    it('should return same instance on multiple calls', () => {
      const m1 = getMCPManager();
      const m2 = getMCPManager();
      expect(m1).toBe(m2);
    });

    it('should create new instance after reset', () => {
      const m1 = getMCPManager();
      resetMCPManager();
      const m2 = getMCPManager();
      expect(m1).not.toBe(m2);
    });

    it('should handle reset when no manager exists', () => {
      // Should not throw
      resetMCPManager();
      resetMCPManager();
    });
  });
});
