/**
 * Unit tests for Docker Sandbox Provider (fully mocked, no Docker required)
 *
 * Covers DockerSandbox (private class accessed via provider.create())
 * and DockerSandboxProvider class methods, branches, and error paths.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Mock logger ────────────────────────────────────────────────────────────
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock Bun.spawn ─────────────────────────────────────────────────────────

function createMockReadableStream(data: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(data);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

let mockSpawnBehavior: {
  stdout: string;
  stderr: string;
  exitCode: number;
  shouldThrow?: boolean;
} = { stdout: '', stderr: '', exitCode: 0 };

const mockKill = vi.fn();

function defaultSpawnMock(_cmd: string[], _options?: any) {
  if (mockSpawnBehavior.shouldThrow) {
    throw new Error('spawn failed');
  }
  return {
    stdout: createMockReadableStream(mockSpawnBehavior.stdout),
    stderr: createMockReadableStream(mockSpawnBehavior.stderr),
    kill: mockKill,
    exited: Promise.resolve(mockSpawnBehavior.exitCode),
    pid: 12345,
  };
}

if (!(globalThis as any).Bun) {
  (globalThis as any).Bun = {};
}

(globalThis as any).Bun.spawn = vi.fn(defaultSpawnMock);

import { DockerSandboxProvider } from '../providers/docker';
import type { SandboxConfig } from '../types';

// ── Config helper ──────────────────────────────────────────────────────────

function makeConfig(overrides?: Record<string, any>): SandboxConfig {
  return {
    enabled: true,
    provider: 'docker',
    workspaceBase: '/tmp/test-docker-sandbox-unit',
    local: {
      enabled: false,
      defaultTimeout: 5000,
      maxOutputSize: 1024 * 1024,
      blockedCommands: [],
    },
    docker: {
      enabled: true,
      image: 'alpine:latest',
      memoryLimitMb: 256,
      cpuLimit: 1,
      networkEnabled: false,
      defaultTimeout: 10000,
      maxOutputSize: 1024 * 1024,
      idleTimeout: 60000,
      ...(overrides?.docker || {}),
    },
    pool: {
      enabled: false,
      minIdle: 0,
      maxTotal: 5,
      healthCheckInterval: 60000,
    },
    ...overrides,
  } as SandboxConfig;
}

// Helper: create provider with isAvailable=true cached
async function createReadyProvider(config?: SandboxConfig): Promise<DockerSandboxProvider> {
  const p = new DockerSandboxProvider(config || makeConfig());
  mockSpawnBehavior = { stdout: 'Docker version 24.0.0', stderr: '', exitCode: 0 };
  await p.isAvailable();
  return p;
}

// Helper: create provider + sandbox
async function createReadySandbox(options?: any): Promise<{ provider: DockerSandboxProvider; sandbox: any }> {
  const provider = await createReadyProvider();
  mockSpawnBehavior = { stdout: 'containerid123\n', stderr: '', exitCode: 0 };
  const sandbox = await provider.create(options);
  return { provider, sandbox };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DockerSandboxProvider (unit, mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
    // Always restore the default spawn mock
    (globalThis as any).Bun.spawn = vi.fn(defaultSpawnMock);
  });

  afterEach(() => {
    // Cleanup created workspaces
    try {
      if (fs.existsSync('/tmp/test-docker-sandbox-unit')) {
        fs.rmSync('/tmp/test-docker-sandbox-unit', { recursive: true, force: true });
      }
    } catch { /* ignore */ }
    // Restore default spawn
    (globalThis as any).Bun.spawn = vi.fn(defaultSpawnMock);
  });

  // ── type ──────────────────────────────────────────────────────────────────

  test('type should be docker', () => {
    const provider = new DockerSandboxProvider(makeConfig());
    expect(provider.type).toBe('docker');
  });

  // ── isAvailable ───────────────────────────────────────────────────────────

  describe('isAvailable', () => {
    test('returns false when docker.enabled is false', async () => {
      const p = new DockerSandboxProvider(makeConfig({ docker: { enabled: false } }));
      const result = await p.isAvailable();
      expect(result).toBe(false);
    });

    test('returns true when docker --version succeeds', async () => {
      mockSpawnBehavior = { stdout: 'Docker version 24.0.0', stderr: '', exitCode: 0 };
      const p = new DockerSandboxProvider(makeConfig());
      const result = await p.isAvailable();
      expect(result).toBe(true);
    });

    test('caches the availability result', async () => {
      mockSpawnBehavior = { stdout: 'Docker version 24.0.0', stderr: '', exitCode: 0 };
      const p = new DockerSandboxProvider(makeConfig());
      await p.isAvailable();
      // Second call should use cached result
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 1 };
      const result = await p.isAvailable();
      expect(result).toBe(true); // still true from cache
    });

    test('returns false when docker --version fails (non-zero exit)', async () => {
      mockSpawnBehavior = { stdout: '', stderr: 'not found', exitCode: 127 };
      const p = new DockerSandboxProvider(makeConfig());
      const result = await p.isAvailable();
      expect(result).toBe(false);
    });

    test('returns false when Bun.spawn throws', async () => {
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0, shouldThrow: true };
      const p = new DockerSandboxProvider(makeConfig());
      const result = await p.isAvailable();
      expect(result).toBe(false);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    test('throws when docker is not available', async () => {
      const p = new DockerSandboxProvider(makeConfig({ docker: { enabled: false } }));
      await expect(p.create()).rejects.toThrow('Docker is not available');
    });

    test('creates a sandbox with container id', async () => {
      const { sandbox } = await createReadySandbox();
      expect(sandbox).toBeDefined();
      expect(sandbox.id).toContain('docker_');
      expect(sandbox.provider).toBe('docker');
      expect(sandbox.alive).toBe(true);
    });

    test('creates sandbox with sessionId', async () => {
      const { sandbox } = await createReadySandbox({ sessionId: 'sess-1' });
      expect(sandbox.sessionId).toBe('sess-1');
    });

    test('creates sandbox with custom resource limits', async () => {
      const { sandbox } = await createReadySandbox({ memoryLimitMb: 512, cpuLimit: 2 });
      expect(sandbox.alive).toBe(true);
      const calls = (globalThis as any).Bun.spawn.mock.calls;
      const lastCall = calls[calls.length - 1][0] as string[];
      expect(lastCall).toContain('--memory');
      expect(lastCall).toContain('512m');
    });

    test('creates sandbox with env variables', async () => {
      const { sandbox } = await createReadySandbox({ env: { FOO: 'bar' } });
      expect(sandbox.alive).toBe(true);
      const calls = (globalThis as any).Bun.spawn.mock.calls;
      const lastCall = calls[calls.length - 1][0] as string[];
      expect(lastCall).toContain('--env');
      expect(lastCall).toContain('FOO=bar');
    });

    test('creates sandbox with network enabled', async () => {
      const cfg = makeConfig({ docker: { enabled: true, networkEnabled: true, image: 'alpine:latest', memoryLimitMb: 256, cpuLimit: 1, defaultTimeout: 10000, maxOutputSize: 1024*1024, idleTimeout: 60000 } });
      const p = await createReadyProvider(cfg);
      mockSpawnBehavior = { stdout: 'cid123\n', stderr: '', exitCode: 0 };
      const sandbox = await p.create();
      expect(sandbox.alive).toBe(true);
      // Should NOT have --network none
      const calls = (globalThis as any).Bun.spawn.mock.calls;
      const lastCall = calls[calls.length - 1][0] as string[];
      // Check no 'none' after '--network'
      const networkIdx = lastCall.indexOf('--network');
      expect(networkIdx).toBe(-1); // no --network at all when networkEnabled=true
    });

    test('throws when container creation fails (non-zero exit)', async () => {
      const provider = await createReadyProvider();
      mockSpawnBehavior = { stdout: '', stderr: 'image not found', exitCode: 1 };
      await expect(provider.create()).rejects.toThrow('Failed to create container');
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    test('returns empty list initially', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      const list = await provider.list();
      expect(list).toHaveLength(0);
    });

    test('returns created sandboxes', async () => {
      const provider = await createReadyProvider();
      mockSpawnBehavior = { stdout: 'cid1\n', stderr: '', exitCode: 0 };
      await provider.create();
      mockSpawnBehavior = { stdout: 'cid2\n', stderr: '', exitCode: 0 };
      await provider.create();
      const list = await provider.list();
      expect(list).toHaveLength(2);
    });
  });

  // ── destroy (provider level) ──────────────────────────────────────────────

  describe('destroy (provider)', () => {
    test('destroys a specific sandbox by ID', async () => {
      const { provider, sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
      await provider.destroy(sandbox.id);
      const list = await provider.list();
      expect(list).toHaveLength(0);
    });

    test('does nothing for unknown sandbox ID', async () => {
      const provider = new DockerSandboxProvider(makeConfig());
      await provider.destroy('nonexistent-id');
      // Should not throw
    });
  });

  // ── shutdown ──────────────────────────────────────────────────────────────

  describe('shutdown', () => {
    test('destroys all sandboxes', async () => {
      const provider = await createReadyProvider();
      mockSpawnBehavior = { stdout: 'cid1\n', stderr: '', exitCode: 0 };
      await provider.create();
      mockSpawnBehavior = { stdout: 'cid2\n', stderr: '', exitCode: 0 };
      await provider.create();

      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
      await provider.shutdown();
      const list = await provider.list();
      expect(list).toHaveLength(0);
    });

    test('handles errors in individual sandbox destruction gracefully', async () => {
      const provider = await createReadyProvider();
      mockSpawnBehavior = { stdout: 'cid1\n', stderr: '', exitCode: 0 };
      await provider.create();

      // Make stop fail with throw
      mockSpawnBehavior = { stdout: '', stderr: 'error', exitCode: 0, shouldThrow: true };
      // Should not throw even when sandbox.destroy() encounters errors
      await provider.shutdown();
    });
  });

  // ── Sandbox exec ──────────────────────────────────────────────────────────

  describe('Sandbox exec', () => {
    test('executes command and returns result', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: 'hello world\n', stderr: '', exitCode: 0 };
      const result = await sandbox.exec('echo hello world');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello world');
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('captures stderr', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: '', stderr: 'error msg', exitCode: 1 };
      const result = await sandbox.exec('failing_command');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error msg');
    });

    test('passes custom cwd', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: '/workspace/subdir\n', stderr: '', exitCode: 0 };
      await sandbox.exec('pwd', { cwd: 'subdir' });
      const calls = (globalThis as any).Bun.spawn.mock.calls;
      const lastCall = calls[calls.length - 1][0] as string[];
      expect(lastCall).toContain('--workdir');
      expect(lastCall.some((a: string) => a.includes('/workspace/subdir'))).toBe(true);
    });

    test('passes custom env variables', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: 'val\n', stderr: '', exitCode: 0 };
      await sandbox.exec('echo $VAR', { env: { VAR: 'val' } });
      const calls = (globalThis as any).Bun.spawn.mock.calls;
      const lastCall = calls[calls.length - 1][0] as string[];
      expect(lastCall).toContain('--env');
      expect(lastCall).toContain('VAR=val');
    });

    test('passes custom shell', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
      await sandbox.exec('echo test', { shell: '/bin/bash' });
      const calls = (globalThis as any).Bun.spawn.mock.calls;
      const lastCall = calls[calls.length - 1][0] as string[];
      expect(lastCall).toContain('/bin/bash');
    });

    test('throws on destroyed sandbox', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
      await sandbox.destroy();
      await expect(sandbox.exec('echo test')).rejects.toThrow('destroyed');
    });

    test('throws when spawn fails in exec', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0, shouldThrow: true };
      await expect(sandbox.exec('echo test')).rejects.toThrow('spawn failed');
    });

    test('updates exec stats', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: 'ok\n', stderr: '', exitCode: 0 };
      await sandbox.exec('echo 1');
      await sandbox.exec('echo 2');
      const info = sandbox.getInfo();
      expect(info.stats?.execCount).toBe(2);
      expect(info.stats?.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(info.stats?.lastExecAt).toBeDefined();
    });
  });

  // ── Sandbox file operations ───────────────────────────────────────────────

  describe('Sandbox writeFile/readFile/listFiles', () => {
    test('writeFile creates directories and writes', async () => {
      const { sandbox } = await createReadySandbox();
      await sandbox.writeFile('subdir/test.txt', 'hello');
      const fullPath = path.join(sandbox.workspacePath, 'subdir/test.txt');
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(content).toBe('hello');
    });

    test('readFile reads file', async () => {
      const { sandbox } = await createReadySandbox();
      const dir = sandbox.workspacePath;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'read.txt'), 'data', 'utf-8');
      const content = await sandbox.readFile('read.txt');
      expect(content).toBe('data');
    });

    test('readFile throws for non-existent file', async () => {
      const { sandbox } = await createReadySandbox();
      await expect(sandbox.readFile('nofile.txt')).rejects.toThrow('File not found');
    });

    test('writeFile throws on destroyed sandbox', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
      await sandbox.destroy();
      await expect(sandbox.writeFile('test.txt', 'data')).rejects.toThrow('destroyed');
    });

    test('readFile throws on destroyed sandbox', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
      await sandbox.destroy();
      await expect(sandbox.readFile('test.txt')).rejects.toThrow('destroyed');
    });

    test('listFiles throws on destroyed sandbox', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
      await sandbox.destroy();
      await expect(sandbox.listFiles('.')).rejects.toThrow('destroyed');
    });

    test('listFiles returns empty for non-existent directory', async () => {
      const { sandbox } = await createReadySandbox();
      const files = await sandbox.listFiles('nonexistent');
      expect(files).toEqual([]);
    });

    test('listFiles lists files and directories', async () => {
      const { sandbox } = await createReadySandbox();
      const dir = sandbox.workspacePath;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'file1.txt'), 'a');
      fs.writeFileSync(path.join(dir, 'file2.txt'), 'b');
      fs.mkdirSync(path.join(dir, 'subdir'));

      const files = await sandbox.listFiles('.');
      expect(files.length).toBe(3);
      expect(files.some((f: any) => f.name === 'file1.txt')).toBe(true);
      expect(files.some((f: any) => f.type === 'directory')).toBe(true);
    });

    test('listFiles skips hidden files by default', async () => {
      const { sandbox } = await createReadySandbox();
      const dir = sandbox.workspacePath;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.hidden'), 'x');
      fs.writeFileSync(path.join(dir, 'visible.txt'), 'x');

      const files = await sandbox.listFiles('.');
      expect(files.length).toBe(1);
      expect(files[0].name).toBe('visible.txt');
    });

    test('listFiles includes hidden files when requested', async () => {
      const { sandbox } = await createReadySandbox();
      const dir = sandbox.workspacePath;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.hidden'), 'x');
      fs.writeFileSync(path.join(dir, 'visible.txt'), 'x');

      const files = await sandbox.listFiles('.', { hidden: true });
      expect(files.length).toBe(2);
    });

    test('listFiles recursive', async () => {
      const { sandbox } = await createReadySandbox();
      const dir = sandbox.workspacePath;
      fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'top.txt'), 'a');
      fs.writeFileSync(path.join(dir, 'sub', 'nested.txt'), 'b');

      const files = await sandbox.listFiles('.', { recursive: true });
      expect(files.length).toBe(3); // top.txt, sub/, sub/nested.txt
    });

    test('listFiles recursive with maxDepth=1 does not descend', async () => {
      const { sandbox } = await createReadySandbox();
      const dir = sandbox.workspacePath;
      fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'a', 'b', 'deep.txt'), 'x');

      const files = await sandbox.listFiles('.', { recursive: true, maxDepth: 1 });
      const deepFile = files.find((f: any) => f.name === 'deep.txt');
      expect(deepFile).toBeUndefined();
    });
  });

  // ── Sandbox destroy ───────────────────────────────────────────────────────

  describe('Sandbox destroy', () => {
    test('stops container and cleans up workspace', async () => {
      const { sandbox } = await createReadySandbox();
      const wp = sandbox.workspacePath;
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
      await sandbox.destroy();
      expect(sandbox.alive).toBe(false);
      expect(fs.existsSync(wp)).toBe(false);
    });

    test('is idempotent', async () => {
      const { sandbox } = await createReadySandbox();
      mockSpawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
      await sandbox.destroy();
      await sandbox.destroy();
      expect(sandbox.alive).toBe(false);
    });

    test('handles stop failure (non-zero exit) and still sets alive=false', async () => {
      const { sandbox } = await createReadySandbox();
      // docker stop returns non-zero (container stop failed gracefully)
      mockSpawnBehavior = { stdout: '', stderr: 'timeout', exitCode: 1 };
      await sandbox.destroy();
      // _alive is set to false in the try block even with non-zero exit
      expect(sandbox.alive).toBe(false);
    });

    test('handles stop throwing and force removes container', async () => {
      const { sandbox } = await createReadySandbox();

      // Replace spawn: first call throws (stop), second call (force rm) succeeds
      let callNum = 0;
      (globalThis as any).Bun.spawn = vi.fn(() => {
        callNum++;
        if (callNum === 1) {
          throw new Error('stop failed');
        }
        return {
          stdout: createMockReadableStream(''),
          stderr: createMockReadableStream(''),
          kill: vi.fn(),
          exited: Promise.resolve(0),
          pid: 999,
        };
      });

      await sandbox.destroy();
      expect(sandbox.alive).toBe(false);
      // Verify force rm was attempted
      expect((globalThis as any).Bun.spawn).toHaveBeenCalledTimes(2);
    });

    test('handles both stop and force rm failing', async () => {
      const { sandbox } = await createReadySandbox();

      // Both calls throw
      (globalThis as any).Bun.spawn = vi.fn(() => {
        throw new Error('docker not available');
      });

      await sandbox.destroy();
      expect(sandbox.alive).toBe(false);
    });
  });

  // ── Sandbox getInfo ───────────────────────────────────────────────────────

  describe('Sandbox getInfo', () => {
    test('returns correct info', async () => {
      const { sandbox } = await createReadySandbox({ sessionId: 'test-sess' });
      const info = sandbox.getInfo();
      expect(info.id).toContain('docker_');
      expect(info.provider).toBe('docker');
      expect(info.alive).toBe(true);
      expect(info.sessionId).toBe('test-sess');
      expect(info.createdAt).toBeDefined();
      expect(info.workspacePath).toBeDefined();
      expect(info.stats?.execCount).toBe(0);
    });
  });

  // ── readStream truncation ─────────────────────────────────────────────────

  describe('readStream output truncation', () => {
    test('truncates output when exceeding maxOutput', async () => {
      const { sandbox } = await createReadySandbox();

      // Now replace spawn with large-output mock
      const largeData = 'x'.repeat(2000);
      (globalThis as any).Bun.spawn = vi.fn(() => ({
        stdout: createMockReadableStream(largeData),
        stderr: createMockReadableStream(''),
        kill: vi.fn(),
        exited: Promise.resolve(0),
        pid: 123,
      }));

      const result = await sandbox.exec('echo test', { maxOutput: 100 });
      expect(result.stdout.length).toBeLessThanOrEqual(100);
    });

    test('handles stream with exact maxOutput size', async () => {
      const { sandbox } = await createReadySandbox();

      const exactData = 'y'.repeat(500);
      (globalThis as any).Bun.spawn = vi.fn(() => ({
        stdout: createMockReadableStream(exactData),
        stderr: createMockReadableStream(''),
        kill: vi.fn(),
        exited: Promise.resolve(0),
        pid: 123,
      }));

      const result = await sandbox.exec('echo test', { maxOutput: 500 });
      expect(result.stdout.length).toBe(500);
    });
  });
});
