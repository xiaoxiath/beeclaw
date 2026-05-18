/**
 * Docker sandbox: cwd + env validation at the boundary.
 *
 * Bun.spawn(['docker', ...args]) runs argv-form, so shell metacharacters
 * in env values cannot escape into a *host* shell. The risks this PR
 * addresses are narrower:
 *
 *   1. cwd: `--workdir /workspace/${cwd}` is built via string concat.
 *      `..` segments let a command chdir outside the mounted /workspace
 *      and read the container's base image filesystem.
 *
 *   2. env: bytes that break docker's downstream parsing (newlines,
 *      `=` in keys, NUL) cause confusing failures. Validate up front.
 *
 * Mocks Bun.spawn so no Docker daemon is required.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

function mockStream(data: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(data);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

let spawnCalls: string[][] = [];
let spawnBehavior = { stdout: '', stderr: '', exitCode: 0 };

function mockSpawn(cmd: string[]) {
  spawnCalls.push([...cmd]);
  return {
    stdout: mockStream(spawnBehavior.stdout),
    stderr: mockStream(spawnBehavior.stderr),
    kill: vi.fn(),
    exited: Promise.resolve(spawnBehavior.exitCode),
    pid: 12345,
  };
}

if (!(globalThis as any).Bun) (globalThis as any).Bun = {};
(globalThis as any).Bun.spawn = vi.fn(mockSpawn);

import { DockerSandboxProvider } from '../providers/docker';
import type { SandboxConfig } from '../types';

function makeConfig(): SandboxConfig {
  return {
    enabled: true,
    provider: 'docker',
    workspaceBase: '/tmp/test-docker-sandbox-sec',
    local: { enabled: false, defaultTimeout: 5000, maxOutputSize: 1024 * 1024, blockedCommands: [] },
    docker: {
      enabled: true,
      image: 'alpine:latest',
      defaultTimeout: 5000,
      maxOutputSize: 1024 * 1024,
      memoryLimitMb: 256,
      cpuLimit: 0.5,
      networkEnabled: false,
    },
  };
}

async function readySandbox() {
  const provider = new DockerSandboxProvider(makeConfig());
  spawnBehavior = { stdout: 'Docker version 24', stderr: '', exitCode: 0 };
  await provider.isAvailable();
  spawnBehavior = { stdout: 'cid-abc\n', stderr: '', exitCode: 0 };
  const sandbox = await provider.create();
  spawnCalls = []; // reset after setup
  return { provider, sandbox };
}

beforeEach(() => {
  spawnCalls = [];
  spawnBehavior = { stdout: '', stderr: '', exitCode: 0 };
  (globalThis as any).Bun.spawn = vi.fn(mockSpawn);
});

afterEach(() => {
  try {
    if (fs.existsSync('/tmp/test-docker-sandbox-sec')) {
      fs.rmSync('/tmp/test-docker-sandbox-sec', { recursive: true, force: true });
    }
  } catch { /* ignore */ }
});

describe('exec() — cwd validation', () => {
  test('rejects ".." segment (single)', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('ls', { cwd: '..' })).rejects.toThrow(/".." path segments/);
  });

  test('rejects ".." segment nested in path', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('ls', { cwd: 'a/../b' })).rejects.toThrow(/".." path segments/);
  });

  test('rejects backslash-separated ".." (Windows-style)', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('ls', { cwd: 'a\\..\\b' })).rejects.toThrow(/".." path segments/);
  });

  test('rejects absolute path', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('ls', { cwd: '/etc' })).rejects.toThrow(/absolute paths/);
  });

  test('rejects empty cwd', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('ls', { cwd: '' })).resolves.toBeDefined(); // empty falsy → skipped, no error
  });

  test('rejects NUL byte', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('ls', { cwd: 'a\0b' })).rejects.toThrow(/NUL byte/);
  });

  test('accepts simple subdir', async () => {
    const { sandbox } = await readySandbox();
    await sandbox.exec('ls', { cwd: 'subdir' });
    const lastCall = spawnCalls[spawnCalls.length - 1];
    expect(lastCall).toContain('--workdir');
    const idx = lastCall.indexOf('--workdir');
    expect(lastCall[idx + 1]).toBe('/workspace/subdir');
  });

  test('accepts nested path without ..', async () => {
    const { sandbox } = await readySandbox();
    await sandbox.exec('ls', { cwd: 'a/b/c' });
    const lastCall = spawnCalls[spawnCalls.length - 1];
    const idx = lastCall.indexOf('--workdir');
    expect(lastCall[idx + 1]).toBe('/workspace/a/b/c');
  });
});

describe('exec() — env validation', () => {
  test('rejects env key with "="', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('echo', { env: { 'BAD=KEY': 'v' } })).rejects.toThrow(/Invalid env key/);
  });

  test('rejects env key starting with digit', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('echo', { env: { '1FOO': 'v' } })).rejects.toThrow(/Invalid env key/);
  });

  test('rejects env key with hyphen', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('echo', { env: { 'FOO-BAR': 'v' } })).rejects.toThrow(/Invalid env key/);
  });

  test('rejects newline in env value', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('echo', { env: { FOO: 'line1\nline2' } })).rejects.toThrow(/newline or NUL/);
  });

  test('rejects NUL in env value', async () => {
    const { sandbox } = await readySandbox();
    await expect(sandbox.exec('echo', { env: { FOO: 'a\0b' } })).rejects.toThrow(/newline or NUL/);
  });

  test('accepts standard POSIX env names', async () => {
    const { sandbox } = await readySandbox();
    await sandbox.exec('echo', { env: { FOO_BAR: 'v', _UNDER: 'v', X9: 'v' } });
    const lastCall = spawnCalls[spawnCalls.length - 1];
    expect(lastCall).toContain('--env');
  });

  test('accepts empty env value (legitimate use case)', async () => {
    const { sandbox } = await readySandbox();
    await sandbox.exec('echo', { env: { OPTIONAL: '' } });
    const lastCall = spawnCalls[spawnCalls.length - 1];
    expect(lastCall).toContain('--env');
  });
});

describe('start() — env validation on container creation', () => {
  test('rejects newline in env value at create time', async () => {
    const provider = new DockerSandboxProvider(makeConfig());
    spawnBehavior = { stdout: 'Docker version 24', stderr: '', exitCode: 0 };
    await provider.isAvailable();
    spawnBehavior = { stdout: 'cid-abc\n', stderr: '', exitCode: 0 };
    await expect(provider.create({ env: { FOO: 'line1\nline2' } })).rejects.toThrow(/newline or NUL/);
  });

  test('rejects "=" in env key at create time', async () => {
    const provider = new DockerSandboxProvider(makeConfig());
    spawnBehavior = { stdout: 'Docker version 24', stderr: '', exitCode: 0 };
    await provider.isAvailable();
    spawnBehavior = { stdout: 'cid-abc\n', stderr: '', exitCode: 0 };
    await expect(provider.create({ env: { 'A=B': 'v' } })).rejects.toThrow(/Invalid env key/);
  });
});
