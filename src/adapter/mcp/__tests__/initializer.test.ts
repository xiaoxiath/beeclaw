/**
 * Tests for MCP Initializer
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const mockConnect = vi.fn(async () => {});
const mockDisconnectAll = vi.fn(async () => {});
const mockGetStatus = vi.fn(() => [] as any[]);
const mockExecuteTool = vi.fn(async () => ({ success: true }));

vi.mock('../client', () => ({
  getMCPManager: () => ({
    connect: mockConnect,
    disconnectAll: mockDisconnectAll,
    getStatus: mockGetStatus,
    executeTool: mockExecuteTool,
  }),
}));

import { initializeMCP, shutdownMCP, getMCPStatusSummary } from '../initializer';

describe('MCP Initializer', () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnectAll.mockClear();
    mockGetStatus.mockClear();
    mockConnect.mockResolvedValue(undefined);
    mockDisconnectAll.mockResolvedValue(undefined);
  });

  describe('initializeMCP', () => {
    it('returns empty result when MCP is disabled', async () => {
      const result = await initializeMCP({ enabled: false, servers: [] } as any);
      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('returns empty result when no servers are configured', async () => {
      const result = await initializeMCP({ enabled: true, servers: [] } as any);
      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('returns empty result when servers is undefined', async () => {
      const result = await initializeMCP({ enabled: true } as any);
      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('connects to enabled servers', async () => {
      const config = {
        enabled: true,
        servers: [
          { id: 'srv1', name: 'Server 1', enabled: true, transport: 'stdio' },
          { id: 'srv2', name: 'Server 2', enabled: true, transport: 'stdio' },
        ],
      } as any;

      const result = await initializeMCP(config);
      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('skips disabled servers', async () => {
      const config = {
        enabled: true,
        servers: [
          { id: 'srv1', name: 'Server 1', enabled: true, transport: 'stdio' },
          { id: 'srv2', name: 'Server 2', enabled: false, transport: 'stdio' },
        ],
      } as any;

      const result = await initializeMCP(config);
      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('records errors for failed connections', async () => {
      mockConnect.mockRejectedValueOnce(new Error('connection refused'));

      const config = {
        enabled: true,
        servers: [
          { id: 'srv1', name: 'Server 1', enabled: true, transport: 'stdio' },
        ],
      } as any;

      const result = await initializeMCP(config);
      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].serverId).toBe('srv1');
      expect(result.errors[0].error).toBe('connection refused');
    });

    it('handles non-Error throws', async () => {
      mockConnect.mockRejectedValueOnce('string error');

      const config = {
        enabled: true,
        servers: [
          { id: 'srv1', name: 'Server 1', enabled: true, transport: 'stdio' },
        ],
      } as any;

      const result = await initializeMCP(config);
      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toBe('string error');
    });

    it('handles mix of success and failure', async () => {
      mockConnect
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined);

      const config = {
        enabled: true,
        servers: [
          { id: 's1', name: 'S1', enabled: true },
          { id: 's2', name: 'S2', enabled: true },
          { id: 's3', name: 'S3', enabled: true },
        ],
      } as any;

      const result = await initializeMCP(config);
      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
    });
  });

  describe('shutdownMCP', () => {
    it('calls disconnectAll on the manager', async () => {
      await shutdownMCP();
      expect(mockDisconnectAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMCPStatusSummary', () => {
    it('returns "No MCP servers configured" when empty', () => {
      mockGetStatus.mockReturnValue([]);
      const summary = getMCPStatusSummary();
      expect(summary).toBe('No MCP servers configured');
    });

    it('shows connected servers with tool count', () => {
      mockGetStatus.mockReturnValue([
        { name: 'Server1', connected: true, tools: 5, lastError: null },
      ]);
      const summary = getMCPStatusSummary();
      expect(summary).toContain('Server1');
      expect(summary).toContain('5 tools');
    });

    it('shows disconnected servers with error', () => {
      mockGetStatus.mockReturnValue([
        { name: 'Server2', connected: false, tools: 0, lastError: 'timeout' },
      ]);
      const summary = getMCPStatusSummary();
      expect(summary).toContain('Server2');
      expect(summary).toContain('timeout');
    });

    it('shows disconnected servers without error', () => {
      mockGetStatus.mockReturnValue([
        { name: 'Server3', connected: false, tools: 0, lastError: null },
      ]);
      const summary = getMCPStatusSummary();
      expect(summary).toContain('disconnected');
    });

    it('handles multiple servers', () => {
      mockGetStatus.mockReturnValue([
        { name: 'A', connected: true, tools: 3, lastError: null },
        { name: 'B', connected: false, tools: 0, lastError: 'err' },
      ]);
      const summary = getMCPStatusSummary();
      const lines = summary.split('\n');
      expect(lines).toHaveLength(2);
    });
  });
});
