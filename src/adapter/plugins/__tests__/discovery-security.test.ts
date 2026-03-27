/**
 * Tests for Plugin Discovery - validatePluginSecurity
 *
 * The core.test.ts already covers discoverPlugins.
 * This file focuses on the security validation function.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fs to control security checks
const { mockRealpathSync, mockStatSync } = vi.hoisted(() => ({
  mockRealpathSync: vi.fn((p: string) => p),
  mockStatSync: vi.fn(() => ({
    mode: 0o755,
    uid: process.getuid ? process.getuid() : 1000,
  })),
}));

vi.mock('fs', () => ({
  realpathSync: mockRealpathSync,
  statSync: mockStatSync,
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => '{}'),
}));

import { validatePluginSecurity } from '../discovery/index';

describe('validatePluginSecurity', () => {
  beforeEach(() => {
    mockRealpathSync.mockClear();
    mockStatSync.mockClear();
    // Default: good path, good permissions, good ownership
    mockRealpathSync.mockImplementation((p: string) => p);
    mockStatSync.mockReturnValue({
      mode: 0o755,
      uid: process.getuid ? process.getuid() : 1000,
    } as any);
  });

  it('returns valid for a safe directory', () => {
    const result = validatePluginSecurity('/home/user/plugins/my-plugin');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('detects symlink escape', () => {
    // Real path doesn't start with parent
    mockRealpathSync.mockImplementation((p: string) => {
      if (p === '/home/user/plugins/my-plugin') return '/etc/evil';
      return p;
    });

    const result = validatePluginSecurity('/home/user/plugins/my-plugin');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Symlink escape');
  });

  it('detects world-writable directory', () => {
    mockStatSync.mockReturnValue({
      mode: 0o777, // world-writable
      uid: process.getuid ? process.getuid() : 1000,
    } as any);

    const result = validatePluginSecurity('/home/user/plugins/my-plugin');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('World-writable');
  });

  it('detects file ownership mismatch', () => {
    if (!process.getuid) {
      // Skip on platforms without getuid
      return;
    }
    mockStatSync.mockReturnValue({
      mode: 0o755,
      uid: 99999, // different user
    } as any);

    const result = validatePluginSecurity('/home/user/plugins/my-plugin');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('ownership mismatch');
  });

  it('handles errors gracefully', () => {
    mockRealpathSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = validatePluginSecurity('/nonexistent');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Security check failed');
  });
});
