import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock SandboxManager
const mockExec = mock(() => Promise.resolve({
  stdout: 'hello world',
  stderr: '',
  exitCode: 0,
  timedOut: false,
  oomKilled: false,
  durationMs: 50,
}));

const mockWriteFile = mock(() => Promise.resolve());
const mockReadFile = mock(() => Promise.resolve('file content here'));
const mockListFiles = mock(() => Promise.resolve([
  { path: 'src/', type: 'directory' },
  { path: 'README.md', type: 'file', size: 1024 },
]));

const mockPathMapper = {
  rewriteCommand: (cmd: string) => cmd,
  sanitizeOutput: (out: string) => out,
  getVirtualWorkspace: () => '/sandbox/workspace',
};

mock.module('../manager', () => ({
  SandboxManager: {
    getInstance: () => ({
      acquire: mock(() => Promise.resolve({
        sandbox: {
          exec: mockExec,
          writeFile: mockWriteFile,
          readFile: mockReadFile,
          listFiles: mockListFiles,
          getInfo: () => ({ id: 'test-sb', provider: 'local', alive: true, stats: { execCount: 5, totalDurationMs: 250 } }),
        },
        pathMapper: mockPathMapper,
      })),
      getStats: () => ({
        providers: ['local'],
        activeSandboxes: 1,
        activeSessions: 1,
      }),
      getBySession: (sid: string) => sid === 'default' ? {
        sandbox: {
          getInfo: () => ({ id: 'test-sb', provider: 'local', alive: true, stats: { execCount: 5, totalDurationMs: 250 } }),
        },
        pathMapper: mockPathMapper,
      } : null,
    }),
  },
}));

import {
  sandboxTools,
  sandboxToolNames,
  executeSandboxTool,
  getSandboxToolsForAI,
  setCurrentSandboxSession,
  getCurrentSandboxSession,
  sandboxExecTool,
  sandboxWriteFileTool,
  sandboxReadFileTool,
  sandboxListFilesTool,
  sandboxStatusTool,
  executeSandboxExec,
  executeSandboxWriteFile,
  executeSandboxReadFile,
  executeSandboxListFiles,
  executeSandboxStatus,
} from '../tools';

describe('sandbox/tools', () => {
  beforeEach(() => {
    mockExec.mockClear();
    mockWriteFile.mockClear();
    mockReadFile.mockClear();
    mockListFiles.mockClear();
    setCurrentSandboxSession('default');
  });

  describe('tool definitions', () => {
    it('sandboxExecTool has correct name', () => {
      expect(sandboxExecTool.name).toBe('sandbox_exec');
      expect(sandboxExecTool.parameters.required).toContain('command');
    });

    it('sandboxWriteFileTool has correct name', () => {
      expect(sandboxWriteFileTool.name).toBe('sandbox_write_file');
      expect(sandboxWriteFileTool.parameters.required).toContain('path');
      expect(sandboxWriteFileTool.parameters.required).toContain('content');
    });

    it('sandboxReadFileTool has correct name', () => {
      expect(sandboxReadFileTool.name).toBe('sandbox_read_file');
      expect(sandboxReadFileTool.parameters.required).toContain('path');
    });

    it('sandboxListFilesTool has correct name', () => {
      expect(sandboxListFilesTool.name).toBe('sandbox_list_files');
    });

    it('sandboxStatusTool has correct name', () => {
      expect(sandboxStatusTool.name).toBe('sandbox_status');
    });
  });

  describe('sandboxTools registry', () => {
    it('contains all 5 tools', () => {
      expect(Object.keys(sandboxTools).length).toBe(5);
      expect(sandboxTools.sandbox_exec).toBeDefined();
      expect(sandboxTools.sandbox_write_file).toBeDefined();
      expect(sandboxTools.sandbox_read_file).toBeDefined();
      expect(sandboxTools.sandbox_list_files).toBeDefined();
      expect(sandboxTools.sandbox_status).toBeDefined();
    });
  });

  describe('sandboxToolNames', () => {
    it('lists all tool names', () => {
      expect(sandboxToolNames).toContain('sandbox_exec');
      expect(sandboxToolNames).toContain('sandbox_write_file');
      expect(sandboxToolNames).toContain('sandbox_read_file');
      expect(sandboxToolNames).toContain('sandbox_list_files');
      expect(sandboxToolNames).toContain('sandbox_status');
    });
  });

  describe('session management', () => {
    it('defaults to "default" session', () => {
      expect(getCurrentSandboxSession()).toBe('default');
    });

    it('sets and gets session', () => {
      setCurrentSandboxSession('session-abc');
      expect(getCurrentSandboxSession()).toBe('session-abc');
    });
  });

  describe('getSandboxToolsForAI', () => {
    it('returns tools in OpenAI function format', () => {
      const tools = getSandboxToolsForAI();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBe(5);
      for (const tool of tools) {
        expect(tool.type).toBe('function');
        expect(tool.function.name).toBeDefined();
        expect(tool.function.description).toBeDefined();
        expect(tool.function.parameters).toBeDefined();
      }
    });
  });

  describe('executeSandboxTool', () => {
    it('dispatches sandbox_exec', async () => {
      const result = await executeSandboxTool('sandbox_exec', { command: 'echo hi' });
      expect(result.success).toBe(true);
    });

    it('dispatches sandbox_write_file', async () => {
      const result = await executeSandboxTool('sandbox_write_file', { path: 'test.txt', content: 'hello' });
      expect(result.success).toBe(true);
    });

    it('dispatches sandbox_read_file', async () => {
      const result = await executeSandboxTool('sandbox_read_file', { path: 'test.txt' });
      expect(result.success).toBe(true);
    });

    it('dispatches sandbox_list_files', async () => {
      const result = await executeSandboxTool('sandbox_list_files', {});
      expect(result.success).toBe(true);
    });

    it('dispatches sandbox_status', async () => {
      const result = await executeSandboxTool('sandbox_status', {});
      expect(result.success).toBe(true);
    });

    it('returns error for unknown tool', async () => {
      const result = await executeSandboxTool('sandbox_unknown', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown sandbox tool');
    });
  });

  describe('executeSandboxExec', () => {
    it('executes command and returns output', async () => {
      const result = await executeSandboxExec({ command: 'echo hello' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('hello world');
    });

    it('reports exit code', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'error msg',
        exitCode: 1,
        timedOut: false,
        oomKilled: false,
        durationMs: 10,
      });
      const result = await executeSandboxExec({ command: 'false' });
      expect(result.success).toBe(false);
      expect(result.data).toContain('exit code: 1');
    });

    it('reports timeout', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: 'partial',
        stderr: '',
        exitCode: 137,
        timedOut: true,
        oomKilled: false,
        durationMs: 30000,
      });
      const result = await executeSandboxExec({ command: 'sleep 999' });
      expect(result.data).toContain('timed out');
    });

    it('reports OOM kill', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 137,
        timedOut: false,
        oomKilled: true,
        durationMs: 100,
      });
      const result = await executeSandboxExec({ command: 'eat-memory' });
      expect(result.data).toContain('memory limit');
    });
  });

  describe('executeSandboxWriteFile', () => {
    it('writes file and returns path', async () => {
      const result = await executeSandboxWriteFile({ path: 'test.txt', content: 'hello' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('test.txt');
      expect(result.data).toContain('bytes');
    });
  });

  describe('executeSandboxReadFile', () => {
    it('reads file content', async () => {
      const result = await executeSandboxReadFile({ path: 'test.txt' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('file content here');
    });
  });

  describe('executeSandboxListFiles', () => {
    it('lists files with icons', async () => {
      const result = await executeSandboxListFiles({});
      expect(result.success).toBe(true);
      expect(result.data).toContain('src/');
      expect(result.data).toContain('README.md');
    });

    it('shows empty message for empty dir', async () => {
      mockListFiles.mockResolvedValueOnce([]);
      const result = await executeSandboxListFiles({ path: 'empty/' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('empty');
    });
  });

  describe('executeSandboxStatus', () => {
    it('returns status info', async () => {
      const result = await executeSandboxStatus({});
      expect(result.success).toBe(true);
      expect(result.data).toContain('Sandbox System Status');
      expect(result.data).toContain('local');
    });
  });
});
