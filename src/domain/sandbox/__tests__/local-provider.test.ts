/**
 * Tests for Local Sandbox Provider
 *
 * Tests process-based sandboxing with command filtering and resource limits
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { LocalSandboxProvider } from '../providers/local';
import type { SandboxConfig } from '../types';

describe('LocalSandboxProvider', () => {
  let provider: LocalSandboxProvider;
  const testConfig: SandboxConfig = {
    enabled: true,
    provider: 'local',
    workspaceBase: '/tmp/test-sandbox',
    local: {
      enabled: true,
      defaultTimeout: 5000,
      maxOutputSize: 1024 * 1024, // 1MB
      blockedCommands: [
        'rm\\s+-rf\\s+/',
        'mkfs',
        'dd\\s+if=',
        ':(){ :|:& };:',
      ],
    },
    docker: {
      enabled: false,
      image: 'test:latest',
      memoryLimitMb: 512,
      cpuLimit: 1,
      networkEnabled: false,
      defaultTimeout: 10000,
      maxOutputSize: 2048 * 1024,
      idleTimeout: 300000,
    },
    pool: {
      enabled: false,
      minIdle: 0,
      maxTotal: 5,
      healthCheckInterval: 60000,
    },
  };

  beforeEach(() => {
    provider = new LocalSandboxProvider(testConfig);
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  describe('initialization', () => {
    test('should create provider', () => {
      expect(provider).toBeDefined();
      expect(provider.type).toBe('local');
    });

    test('should be available when enabled', async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    test('should not be available when disabled', async () => {
      const disabledConfig = {
        ...testConfig,
        local: { ...testConfig.local, enabled: false },
      };
      const disabledProvider = new LocalSandboxProvider(disabledConfig);

      const available = await disabledProvider.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('create', () => {
    test('should create sandbox', async () => {
      const sandbox = await provider.create();

      expect(sandbox).toBeDefined();
      expect(sandbox.id).toBeDefined();
      expect(sandbox.provider).toBe('local');
      expect(sandbox.alive).toBe(true);
    });

    test('should create sandbox with session ID', async () => {
      const sandbox = await provider.create({ sessionId: 'test-session' });

      expect(sandbox.sessionId).toBe('test-session');
    });

    test('should create workspace directory', async () => {
      const sandbox = await provider.create();

      expect(fs.existsSync(sandbox.workspacePath)).toBe(true);
    });

    test('should track created sandboxes', async () => {
      const sandbox1 = await provider.create();
      const sandbox2 = await provider.create();

      const all = await provider.list();
      expect(all.length).toBe(2);
    });
  });

  describe('exec', () => {
    test('should execute simple command', async () => {
      const sandbox = await provider.create();

      const result = await sandbox.exec('echo "Hello World"');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello World');
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    test('should capture stderr', async () => {
      const sandbox = await provider.create();

      const result = await sandbox.exec('echo "Error" >&2');

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Error');
    });

    test('should return non-zero exit code for failed command', async () => {
      const sandbox = await provider.create();

      const result = await sandbox.exec('exit 42');

      expect(result.exitCode).toBe(42);
    });

    test('should enforce timeout', async () => {
      const sandbox = await provider.create();

      const result = await sandbox.exec('sleep 10', { timeout: 100 });

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(137); // SIGKILL
    });

    test('should enforce output size limit', async () => {
      const sandbox = await provider.create();

      // Generate 2MB of output but limit to 1KB
      const result = await sandbox.exec('yes "test" | head -n 1000', {
        maxOutput: 1024,
      });

      expect(result.stdout.length).toBeLessThanOrEqual(1024);
    });

    test('should use custom working directory', async () => {
      const sandbox = await provider.create();

      await sandbox.exec('mkdir subdir');
      const result = await sandbox.exec('pwd', { cwd: 'subdir' });

      expect(result.stdout).toContain('subdir');
    });

    test('should set environment variables', async () => {
      const sandbox = await provider.create();

      const result = await sandbox.exec('echo $TEST_VAR', {
        env: { TEST_VAR: 'test_value' },
      });

      expect(result.stdout).toContain('test_value');
    });

    test('should throw for destroyed sandbox', async () => {
      const sandbox = await provider.create();
      await sandbox.destroy();

      await expect(sandbox.exec('echo test')).rejects.toThrow('destroyed');
    });
  });

  describe('command filtering', () => {
    test('should block dangerous commands', async () => {
      const sandbox = await provider.create();

      await expect(sandbox.exec('rm -rf /')).rejects.toThrow('blocked');
    });

    test('should block mkfs command', async () => {
      const sandbox = await provider.create();

      await expect(sandbox.exec('mkfs.ext4 /dev/sda1')).rejects.toThrow('blocked');
    });

    test('should block fork bomb', async () => {
      const sandbox = await provider.create();

      await expect(sandbox.exec(':(){ :|:& };:')).rejects.toThrow('blocked');
    });

    test('should allow safe commands', async () => {
      const sandbox = await provider.create();

      const result = await sandbox.exec('ls');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('file operations', () => {
    test('should write file', async () => {
      const sandbox = await provider.create();

      await sandbox.writeFile('test.txt', 'Hello World');

      const content = await sandbox.readFile('test.txt');
      expect(content).toBe('Hello World');
    });

    test('should write file to subdirectory', async () => {
      const sandbox = await provider.create();

      await sandbox.writeFile('subdir/test.txt', 'Nested file');

      const content = await sandbox.readFile('subdir/test.txt');
      expect(content).toBe('Nested file');
    });

    test('should write buffer', async () => {
      const sandbox = await provider.create();

      const buffer = Buffer.from('Binary data', 'utf-8');
      await sandbox.writeFile('binary.bin', buffer);

      const content = await sandbox.readFile('binary.bin');
      expect(content).toBe('Binary data');
    });

    test('should throw for non-existent file', async () => {
      const sandbox = await provider.create();

      await expect(sandbox.readFile('nonexistent.txt')).rejects.toThrow('not found');
    });

    test('should list files', async () => {
      const sandbox = await provider.create();

      await sandbox.writeFile('file1.txt', 'content1');
      await sandbox.writeFile('file2.txt', 'content2');
      await sandbox.exec('mkdir dir1');

      const files = await sandbox.listFiles('.');

      expect(files.length).toBe(3);
      expect(files.find(f => f.name === 'file1.txt')).toBeDefined();
      expect(files.find(f => f.name === 'dir1')).toBeDefined();
    });

    test('should list files recursively', async () => {
      const sandbox = await provider.create();

      await sandbox.writeFile('file1.txt', 'content');
      await sandbox.exec('mkdir -p subdir');
      await sandbox.writeFile('subdir/file2.txt', 'content');

      const files = await sandbox.listFiles('.', { recursive: true });

      expect(files.length).toBe(3); // file1.txt, subdir, subdir/file2.txt
    });

    test('should hide hidden files by default', async () => {
      const sandbox = await provider.create();

      await sandbox.writeFile('.hidden', 'content');
      await sandbox.writeFile('visible.txt', 'content');

      const files = await sandbox.listFiles('.');

      expect(files.find(f => f.name === '.hidden')).toBeUndefined();
      expect(files.find(f => f.name === 'visible.txt')).toBeDefined();
    });

    test('should show hidden files when requested', async () => {
      const sandbox = await provider.create();

      await sandbox.writeFile('.hidden', 'content');

      const files = await sandbox.listFiles('.', { hidden: true });

      expect(files.find(f => f.name === '.hidden')).toBeDefined();
    });
  });

  describe('destroy', () => {
    test('should destroy sandbox', async () => {
      const sandbox = await provider.create();
      const workspacePath = sandbox.workspacePath;

      await sandbox.destroy();

      expect(sandbox.alive).toBe(false);
      expect(fs.existsSync(workspacePath)).toBe(false);
    });

    test('should cleanup workspace', async () => {
      const sandbox = await provider.create();

      await sandbox.writeFile('test.txt', 'content');
      await sandbox.destroy();

      expect(fs.existsSync(sandbox.workspacePath)).toBe(false);
    });

    test('should be idempotent', async () => {
      const sandbox = await provider.create();

      await sandbox.destroy();
      await sandbox.destroy(); // Should not throw

      expect(sandbox.alive).toBe(false);
    });
  });

  describe('getInfo', () => {
    test('should return sandbox info', async () => {
      const sandbox = await provider.create({ sessionId: 'test-session' });

      const info = sandbox.getInfo();

      expect(info.id).toBe(sandbox.id);
      expect(info.provider).toBe('local');
      expect(info.alive).toBe(true);
      expect(info.sessionId).toBe('test-session');
      expect(info.createdAt).toBeDefined();
      expect(info.workspacePath).toBeDefined();
    });

    test('should track execution stats', async () => {
      const sandbox = await provider.create();

      await sandbox.exec('echo test1');
      await sandbox.exec('echo test2');

      const info = sandbox.getInfo();

      expect(info.stats?.execCount).toBe(2);
      expect(info.stats?.totalDurationMs).toBeGreaterThan(0);
      expect(info.stats?.lastExecAt).toBeDefined();
    });
  });

  describe('provider shutdown', () => {
    test('should destroy all sandboxes on shutdown', async () => {
      await provider.create();
      await provider.create();
      await provider.create();

      await provider.shutdown();

      const all = await provider.list();
      expect(all.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('should handle concurrent executions', async () => {
      const sandbox = await provider.create();

      const promises = [
        sandbox.exec('echo test1'),
        sandbox.exec('echo test2'),
        sandbox.exec('echo test3'),
      ];

      const results = await Promise.all(promises);

      expect(results.every(r => r.exitCode === 0)).toBe(true);
    });

    test('should handle very long command output', async () => {
      const sandbox = await provider.create();

      // Generate long output (at least 5000 chars)
      const result = await sandbox.exec('for i in {1..500}; do echo "Line $i with some extra text to make it longer"; done');

      expect(result.stdout.length).toBeGreaterThan(5000);
    });

    test('should handle unicode in commands and output', async () => {
      const sandbox = await provider.create();

      const result = await sandbox.exec('echo "你好世界 🌍"');

      expect(result.stdout).toContain('你好世界 🌍');
    });

    test('should handle special characters in file paths', async () => {
      const sandbox = await provider.create();

      await sandbox.writeFile('file with spaces.txt', 'content');
      await sandbox.writeFile('文件.txt', 'chinese');

      const content1 = await sandbox.readFile('file with spaces.txt');
      const content2 = await sandbox.readFile('文件.txt');

      expect(content1).toBe('content');
      expect(content2).toBe('chinese');
    });

    test('should handle empty output', async () => {
      const sandbox = await provider.create();

      const result = await sandbox.exec('true'); // Command that succeeds with no output

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });

    test('should handle command with only stderr output', async () => {
      const sandbox = await provider.create();

      const result = await sandbox.exec('echo error >&2');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('error');
    });
  });
});
