/**
 * Virtual Path Mapper Tests
 */

import { describe, test, expect, vi } from 'vitest';
import { VirtualPathMapper } from '../path-mapper';

describe('VirtualPathMapper', () => {
  const hostWorkspace = '/home/user/project/workspace';
  const mapper = new VirtualPathMapper(hostWorkspace);

  test('should map virtual paths to host paths', () => {
    const virtualPath = '/sandbox/workspace/src/file.ts';
    const hostPath = mapper.toHost(virtualPath);

    expect(hostPath).toBe('/home/user/project/workspace/src/file.ts');
  });

  test('should map host paths to virtual paths', () => {
    const hostPath = '/home/user/project/workspace/src/file.ts';
    const virtualPath = mapper.toVirtual(hostPath);

    expect(virtualPath).toBe('/sandbox/workspace/src/file.ts');
  });

  test('should handle relative paths', () => {
    const relativePath = 'src/file.ts';
    const hostPath = mapper.toHost(relativePath);

    expect(hostPath).toBe('/home/user/project/workspace/src/file.ts');
  });

  test('should reject path traversal attempts', () => {
    const maliciousPath = '/sandbox/workspace/../../../etc/passwd';

    expect(() => mapper.toHost(maliciousPath)).toThrow('Path traversal');
  });

  test('should sanitize output', () => {
    const output = '/home/user/project/workspace/src/file.ts: No such file';
    const sanitized = mapper.sanitizeOutput(output);

    expect(sanitized).toBe('/sandbox/workspace/src/file.ts: No such file');
    expect(sanitized).not.toContain('/home/user');
  });

  test('should rewrite commands', () => {
    const command = 'cd /sandbox/workspace && npm test';
    const rewritten = mapper.rewriteCommand(command);

    expect(rewritten).toBe(`cd ${hostWorkspace} && npm test`);
    expect(rewritten).not.toContain('/sandbox/workspace');
  });
});
