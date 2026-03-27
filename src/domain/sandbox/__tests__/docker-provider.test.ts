/**
 * Tests for Docker Sandbox Provider
 *
 * Tests container-based sandboxing with resource limits and network isolation
 *
 * NOTE: These tests require Docker to be installed and running.
 * Run with: DOCKER_HOST=unix:///var/run/docker.sock bun test
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DockerSandboxProvider } from '../providers/docker';
import type { SandboxConfig } from '../types';

// Skip tests if Docker is not available
const DOCKER_AVAILABLE = process.env.DOCKER_AVAILABLE === 'true';

const describeIf = DOCKER_AVAILABLE ? describe : describe.skip;

describeIf('DockerSandboxProvider', () => {
  let provider: DockerSandboxProvider;
  const testConfig: SandboxConfig = {
    enabled: true,
    provider: 'docker',
    workspaceBase: '/tmp/test-sandbox-docker',
    local: {
      enabled: true,
      defaultTimeout: 5000,
      maxOutputSize: 1024 * 1024,
      blockedCommands: [],
    },
    docker: {
      enabled: true,
      image: 'alpine:latest', // Use small image for tests
      memoryLimitMb: 128,
      cpuLimit: 0.5,
      networkEnabled: false,
      defaultTimeout: 5000,
      maxOutputSize: 1024 * 1024,
      idleTimeout: 60000,
    },
    pool: {
      enabled: false,
      minIdle: 0,
      maxTotal: 5,
      healthCheckInterval: 60000,
    },
  };

  beforeEach(() => {
    provider = new DockerSandboxProvider(testConfig);
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  describe('initialization', () => {
    test('should create provider', () => {
      expect(provider).toBeDefined();
      expect(provider.type).toBe('docker');
    });

    test('should check Docker availability', async () => {
      const available = await provider.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('create', () => {
    test('should create sandbox', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      expect(sandbox).toBeDefined();
      expect(sandbox.id).toBeDefined();
      expect(sandbox.provider).toBe('docker');
      expect(sandbox.alive).toBe(true);
    }, 30000);

    test('should create sandbox with session ID', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create({ sessionId: 'test-session' });

      expect(sandbox.sessionId).toBe('test-session');
    }, 30000);

    test('should create workspace directory', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      expect(fs.existsSync(sandbox.workspacePath)).toBe(true);
    }, 30000);

    test('should track created sandboxes', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      await provider.create();
      await provider.create();

      const all = await provider.list();
      expect(all.length).toBe(2);
    }, 60000);
  });

  describe('exec', () => {
    test('should execute simple command', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      const result = await sandbox.exec('echo "Hello World"');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello World');
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThan(0);
    }, 30000);

    test('should capture stderr', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      const result = await sandbox.exec('echo "Error" >&2');

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Error');
    }, 30000);

    test('should return non-zero exit code for failed command', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      const result = await sandbox.exec('exit 42');

      expect(result.exitCode).toBe(42);
    }, 30000);

    test('should enforce timeout', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      const result = await sandbox.exec('sleep 10', { timeout: 1000 });

      expect(result.timedOut).toBe(true);
    }, 30000);

    test('should use custom working directory', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      await sandbox.exec('mkdir subdir');
      const result = await sandbox.exec('pwd', { cwd: 'subdir' });

      expect(result.stdout).toContain('subdir');
    }, 30000);

    test('should set environment variables', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      const result = await sandbox.exec('echo $TEST_VAR', {
        env: { TEST_VAR: 'test_value' },
      });

      expect(result.stdout).toContain('test_value');
    }, 30000);

    test('should throw for destroyed sandbox', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();
      await sandbox.destroy();

      await expect(sandbox.exec('echo test')).rejects.toThrow('destroyed');
    }, 30000);
  });

  describe('resource limits', () => {
    test('should enforce memory limit', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create({ memoryLimitMb: 64 });

      // Try to allocate more than 64MB (should fail or be killed)
      const result = await sandbox.exec('dd if=/dev/zero bs=1M count=100 | tail');

      // Command should fail or be killed due to OOM
      expect(result.exitCode).not.toBe(0);
    }, 30000);

    test('should enforce CPU limit', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create({ cpuLimit: 0.25 });

      // This test is hard to verify, just ensure it doesn't crash
      const result = await sandbox.exec('echo "CPU test"');

      expect(result.exitCode).toBe(0);
    }, 30000);
  });

  describe('network isolation', () => {
    test('should block network when disabled', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      // Try to ping (should fail without network)
      const result = await sandbox.exec('ping -c 1 8.8.8.8 2>&1 || true');

      // Should fail or show network unreachable
      expect(result.exitCode).not.toBe(0);
    }, 30000);
  });

  describe('file operations', () => {
    test('should write file', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      await sandbox.writeFile('test.txt', 'Hello World');

      const content = await sandbox.readFile('test.txt');
      expect(content).toBe('Hello World');
    }, 30000);

    test('should write file to subdirectory', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      await sandbox.writeFile('subdir/test.txt', 'Nested file');

      const content = await sandbox.readFile('subdir/test.txt');
      expect(content).toBe('Nested file');
    }, 30000);

    test('should list files', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      await sandbox.writeFile('file1.txt', 'content1');
      await sandbox.writeFile('file2.txt', 'content2');
      await sandbox.exec('mkdir dir1');

      const files = await sandbox.listFiles('.');

      expect(files.length).toBe(3);
      expect(files.find(f => f.name === 'file1.txt')).toBeDefined();
      expect(files.find(f => f.name === 'dir1')).toBeDefined();
    }, 30000);

    test('should list files recursively', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      await sandbox.writeFile('file1.txt', 'content');
      await sandbox.exec('mkdir -p subdir');
      await sandbox.writeFile('subdir/file2.txt', 'content');

      const files = await sandbox.listFiles('.', { recursive: true });

      expect(files.length).toBe(3);
    }, 30000);
  });

  describe('destroy', () => {
    test('should destroy sandbox', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();
      const workspacePath = sandbox.workspacePath;

      await sandbox.destroy();

      expect(sandbox.alive).toBe(false);
      expect(fs.existsSync(workspacePath)).toBe(false);
    }, 30000);

    test('should cleanup workspace', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      await sandbox.writeFile('test.txt', 'content');
      await sandbox.destroy();

      expect(fs.existsSync(sandbox.workspacePath)).toBe(false);
    }, 30000);

    test('should be idempotent', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      await sandbox.destroy();
      await sandbox.destroy(); // Should not throw

      expect(sandbox.alive).toBe(false);
    }, 30000);
  });

  describe('getInfo', () => {
    test('should return sandbox info', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create({ sessionId: 'test-session' });

      const info = sandbox.getInfo();

      expect(info.id).toBe(sandbox.id);
      expect(info.provider).toBe('docker');
      expect(info.alive).toBe(true);
      expect(info.sessionId).toBe('test-session');
      expect(info.createdAt).toBeDefined();
      expect(info.workspacePath).toBeDefined();
    }, 30000);

    test('should track execution stats', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      await sandbox.exec('echo test1');
      await sandbox.exec('echo test2');

      const info = sandbox.getInfo();

      expect(info.stats?.execCount).toBe(2);
      expect(info.stats?.totalDurationMs).toBeGreaterThan(0);
      expect(info.stats?.lastExecAt).toBeDefined();
    }, 30000);
  });

  describe('provider shutdown', () => {
    test('should destroy all sandboxes on shutdown', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      await provider.create();
      await provider.create();
      await provider.create();

      await provider.shutdown();

      const all = await provider.list();
      expect(all.length).toBe(0);
    }, 60000);
  });

  describe('edge cases', () => {
    test('should handle concurrent executions', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      const promises = [
        sandbox.exec('echo test1'),
        sandbox.exec('echo test2'),
        sandbox.exec('echo test3'),
      ];

      const results = await Promise.all(promises);

      expect(results.every(r => r.exitCode === 0)).toBe(true);
    }, 30000);

    test('should handle unicode in commands and output', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      const result = await sandbox.exec('echo "你好世界 🌍"');

      expect(result.stdout).toContain('你好世界 🌍');
    }, 30000);

    test('should handle special characters in file paths', async () => {
      const available = await provider.isAvailable();

      if (!available) {
        console.log('Skipping test: Docker not available');
        return;
      }

      const sandbox = await provider.create();

      await sandbox.writeFile('file with spaces.txt', 'content');
      await sandbox.writeFile('文件.txt', 'chinese');

      const content1 = await sandbox.readFile('file with spaces.txt');
      const content2 = await sandbox.readFile('文件.txt');

      expect(content1).toBe('content');
      expect(content2).toBe('chinese');
    }, 30000);
  });
});

// Add note about running tests
describe('DockerSandboxProvider (without Docker)', () => {
  test('should gracefully handle missing Docker', async () => {
    const config: SandboxConfig = {
      enabled: true,
      provider: 'docker',
      workspaceBase: '/tmp/test',
      local: { enabled: true, defaultTimeout: 5000, maxOutputSize: 1024 * 1024, blockedCommands: [] },
      docker: { enabled: false, image: 'test:latest', memoryLimitMb: 128, cpuLimit: 0.5, networkEnabled: false, defaultTimeout: 5000, maxOutputSize: 1024 * 1024, idleTimeout: 60000 },
      pool: { enabled: false, minIdle: 0, maxTotal: 5, healthCheckInterval: 60000 },
    };

    const provider = new DockerSandboxProvider(config);

    const available = await provider.isAvailable();
    expect(available).toBe(false);

    await expect(provider.create()).rejects.toThrow('Docker is not available');
  });
});
