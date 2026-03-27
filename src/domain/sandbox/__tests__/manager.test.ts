/**
 * Sandbox Manager Tests
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { SandboxManager } from '../manager';
import type { SandboxConfig } from '../types';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

describe('SandboxManager', () => {
  const testWorkspaceBase = join(__dirname, '__test_workspaces__');
  const config: SandboxConfig = {
    enabled: true,
    provider: 'local',
    workspaceBase: testWorkspaceBase,
    local: {
      enabled: true,
      defaultTimeout: 5000,
      maxOutputSize: 1024,
      blockedCommands: ['rm\\s+-rf\\s+/'],
    },
    docker: {
      enabled: false,
      memoryLimitMb: 512,
      cpuLimit: 1,
      networkEnabled: false,
      defaultTimeout: 10000,
      maxOutputSize: 2048,
      idleTimeout: 300000,
    },
    pool: {
      enabled: false,
      minIdle: 1,
      maxTotal: 5,
      healthCheckInterval: 60000,
    },
  };

  let manager: SandboxManager;

  beforeEach(async () => {
    // Clean up test workspace
    if (existsSync(testWorkspaceBase)) {
      rmSync(testWorkspaceBase, { recursive: true, force: true });
    }
    mkdirSync(testWorkspaceBase, { recursive: true });

    manager = SandboxManager.getInstance();
    await manager.initialize(config);
  });

  afterEach(async () => {
    await manager.shutdown();
    SandboxManager.resetInstance();

    // Clean up test workspace
    if (existsSync(testWorkspaceBase)) {
      rmSync(testWorkspaceBase, { recursive: true, force: true });
    }
  });

  test('should initialize with local provider', () => {
    const stats = manager.getStats();
    expect(stats.providers).toContain('local');
    expect(stats.activeSandboxes).toBe(0);
  });

  test('should create and acquire sandbox', async () => {
    const { sandbox, pathMapper } = await manager.acquire({ sessionId: 'test-session' });

    expect(sandbox.id).toBeDefined();
    expect(sandbox.provider).toBe('local');
    expect(sandbox.alive).toBe(true);
    expect(pathMapper).toBeDefined();

    const stats = manager.getStats();
    expect(stats.activeSandboxes).toBe(1);
    expect(stats.activeSessions).toBe(1);
  });

  test('should reuse sandbox for same session', async () => {
    const first = await manager.acquire({ sessionId: 'test-session' });
    const second = await manager.acquire({ sessionId: 'test-session' });

    expect(first.sandbox.id).toBe(second.sandbox.id);
  });

  test('should execute command in sandbox', async () => {
    const { sandbox } = await manager.acquire({ sessionId: 'test-session' });

    const result = await sandbox.exec('echo "Hello, World!"');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello, World!');
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test('should enforce timeout', async () => {
    const { sandbox } = await manager.acquire({ sessionId: 'test-session' });

    const result = await sandbox.exec('sleep 10', { timeout: 100 });

    expect(result.timedOut).toBe(true);
  });

  test('should block dangerous commands', async () => {
    const { sandbox } = await manager.acquire({ sessionId: 'test-session' });

    try {
      await sandbox.exec('rm -rf /');
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain('Command blocked by security policy');
    }
  });

  test('should write and read files', async () => {
    const { sandbox, pathMapper } = await manager.acquire({ sessionId: 'test-session' });

    await sandbox.writeFile('test.txt', 'Hello, Sandbox!');

    const content = await sandbox.readFile('test.txt');
    expect(content).toBe('Hello, Sandbox!');
  });

  test('should list files', async () => {
    const { sandbox } = await manager.acquire({ sessionId: 'test-session' });

    await sandbox.writeFile('file1.txt', 'content1');
    await sandbox.writeFile('file2.txt', 'content2');
    await sandbox.writeFile('dir/file3.txt', 'content3');

    const files = await sandbox.listFiles('.', { recursive: true });
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.name === 'file1.txt')).toBe(true);
  });

  test('should release sandbox', async () => {
    const { sandbox } = await manager.acquire({ sessionId: 'test-session' });
    const sandboxId = sandbox.id;

    await manager.release(sandboxId);

    const stats = manager.getStats();
    expect(stats.activeSandboxes).toBe(0);
  });

  test('should release sandbox by session', async () => {
    await manager.acquire({ sessionId: 'test-session' });

    await manager.releaseBySession('test-session');

    const stats = manager.getStats();
    expect(stats.activeSandboxes).toBe(0);
    expect(stats.activeSessions).toBe(0);
  });

  test('should prevent path traversal', async () => {
    const { sandbox } = await manager.acquire({ sessionId: 'test-session' });

    try {
      await sandbox.readFile('../../../etc/passwd');
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error.message.toLowerCase()).toContain('path traversal blocked');
    }
  });
});
