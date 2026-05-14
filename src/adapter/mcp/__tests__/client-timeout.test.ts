/**
 * MCP host-side timeout guard.
 *
 * The MCP SDK takes its own `timeout` via callTool's RequestOptions and
 * usually honors it. The bug we patch: a hung transport (HTTP keep-alive
 * that never returns, dead stdio pipe still readable in theory but never
 * delivering bytes) leaves the SDK promise pending past its declared
 * timeout. Our outer Promise.race ensures the host always rejects in
 * bounded time.
 *
 * Connect-time listTools/listResources/listPrompts had NO timeout at all,
 * so a misbehaving server could block bootstrap forever. Now bounded by
 * MCPClientManager.LIST_TIMEOUT_MS (10s).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockClientInstance: {
    connect: vi.fn(),
    close: vi.fn(),
    listTools: vi.fn(),
    listResources: vi.fn(),
    listPrompts: vi.fn(),
    callTool: vi.fn(),
    readResource: vi.fn(),
    getPrompt: vi.fn(),
  },
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  function FakeClient(this: any) {
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

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({}));

vi.mock('../../../infra/observability/logger', () => ({ logger: mocks.mockLogger }));

import { MCPClientManager, type MCPServerConfig } from '../client';

function defaultMocks() {
  mocks.mockClientInstance.connect.mockResolvedValue(undefined);
  mocks.mockClientInstance.listTools.mockResolvedValue({ tools: [] });
  mocks.mockClientInstance.listResources.mockResolvedValue({ resources: [] });
  mocks.mockClientInstance.listPrompts.mockResolvedValue({ prompts: [] });
  mocks.mockClientInstance.callTool.mockResolvedValue({
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
  });
}

const stdioConfig = (overrides: Partial<MCPServerConfig> = {}): MCPServerConfig => ({
  id: 'srv1',
  name: 'srv1',
  transport: 'stdio',
  command: 'echo',
  args: [],
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  defaultMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── executeTool callTool outer guard ──────────────────────────────────────

describe('executeTool — host-side Promise.race timeout', () => {
  it('rejects with timeout error if SDK callTool hangs past timeout', async () => {
    const manager = new MCPClientManager();
    await manager.connect(stdioConfig({ timeout: 5000 }));

    // Simulate SDK that never resolves nor rejects — naked Promise.
    mocks.mockClientInstance.callTool.mockImplementation(() => new Promise(() => {}));

    const promise = manager.executeTool('srv1', 'foo', {});
    // Advance past the 5s timeout window.
    await vi.advanceTimersByTimeAsync(5100);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out after 5000ms/);
    expect(result.error).toMatch(/srv1\/foo/);
  });

  it('returns success when SDK resolves within timeout', async () => {
    const manager = new MCPClientManager();
    await manager.connect(stdioConfig({ timeout: 5000 }));

    mocks.mockClientInstance.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'fast result' }],
      isError: false,
    });

    const promise = manager.executeTool('srv1', 'foo', {});
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data).toBe('fast result');
  });

  it('honors explicit timeout argument over config timeout', async () => {
    const manager = new MCPClientManager();
    await manager.connect(stdioConfig({ timeout: 30000 }));

    // Hang forever, expect 1s explicit timeout to fire.
    mocks.mockClientInstance.callTool.mockImplementation(() => new Promise(() => {}));

    const promise = manager.executeTool('srv1', 'foo', {}, 1000);
    await vi.advanceTimersByTimeAsync(1100);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out after 1000ms/);
  });

  it('cleans up the timer when SDK resolves before deadline (no leaked handle)', async () => {
    const manager = new MCPClientManager();
    await manager.connect(stdioConfig({ timeout: 5000 }));

    mocks.mockClientInstance.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    });

    const promise = manager.executeTool('srv1', 'foo', {});
    await vi.advanceTimersByTimeAsync(10);
    await promise;

    // If the timer leaked, getTimerCount() would still be > 0 well after
    // resolve. We only ever set 1 timer per call; expect it cleared.
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ─── connect-time list timeouts ────────────────────────────────────────────

describe('connect() — listTools/Resources/Prompts bounded by LIST_TIMEOUT_MS', () => {
  it('listTools hang → connect still returns with empty tools after 10s', async () => {
    const manager = new MCPClientManager();

    mocks.mockClientInstance.listTools.mockImplementation(() => new Promise(() => {}));
    // Resources + Prompts respond immediately so we isolate listTools timeout.
    mocks.mockClientInstance.listResources.mockResolvedValue({ resources: [] });
    mocks.mockClientInstance.listPrompts.mockResolvedValue({ prompts: [] });

    const connectP = manager.connect(stdioConfig());
    await vi.advanceTimersByTimeAsync(10100);
    const conn = await connectP;

    expect(conn.connected).toBe(true);
    expect(conn.tools).toEqual([]);
    // Logger should warn about the failure.
    expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to list tools'),
      expect.objectContaining({ message: expect.stringMatching(/timed out after 10000ms/) }),
    );
  });

  it('listResources hang → connect still returns, resources empty', async () => {
    const manager = new MCPClientManager();

    mocks.mockClientInstance.listTools.mockResolvedValue({ tools: [{ name: 'x', description: 'd', inputSchema: { type: 'object' } }] as any });
    mocks.mockClientInstance.listResources.mockImplementation(() => new Promise(() => {}));
    mocks.mockClientInstance.listPrompts.mockResolvedValue({ prompts: [] });

    const connectP = manager.connect(stdioConfig());
    await vi.advanceTimersByTimeAsync(10100);
    const conn = await connectP;

    expect(conn.connected).toBe(true);
    expect(conn.tools).toHaveLength(1); // listTools succeeded
    expect(conn.resources).toEqual([]); // listResources timed out
  });

  it('all three list calls hang → connect returns connected=true with everything empty', async () => {
    const manager = new MCPClientManager();

    mocks.mockClientInstance.listTools.mockImplementation(() => new Promise(() => {}));
    mocks.mockClientInstance.listResources.mockImplementation(() => new Promise(() => {}));
    mocks.mockClientInstance.listPrompts.mockImplementation(() => new Promise(() => {}));

    const connectP = manager.connect(stdioConfig());
    // 3 sequential 10s waits → ~30s total
    await vi.advanceTimersByTimeAsync(30500);
    const conn = await connectP;

    expect(conn.connected).toBe(true);
    expect(conn.tools).toEqual([]);
    expect(conn.resources).toEqual([]);
    expect(conn.prompts).toEqual([]);
  });

  it('happy path: list calls resolve fast, connect completes immediately', async () => {
    const manager = new MCPClientManager();

    mocks.mockClientInstance.listTools.mockResolvedValue({
      tools: [{ name: 't', description: '', inputSchema: { type: 'object' } }] as any,
    });

    const connectP = manager.connect(stdioConfig());
    await vi.advanceTimersByTimeAsync(10);
    const conn = await connectP;

    expect(conn.connected).toBe(true);
    expect(conn.tools).toHaveLength(1);
    // No timer should be left over.
    expect(vi.getTimerCount()).toBe(0);
  });
});
