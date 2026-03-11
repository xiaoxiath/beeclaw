/**
 * Virtual Path Mapper
 *
 * Bidirectional path rewriting between sandbox-internal virtual paths
 * and real host filesystem paths. Prevents leaking real paths to the AI agent.
 *
 * Virtual: /sandbox/workspace/foo.ts → Real: /home/user/project/foo.ts
 * Real: /home/user/project/foo.ts → Virtual: /sandbox/workspace/foo.ts
 */

import { join, resolve, relative, isAbsolute } from 'path';

export const VIRTUAL_WORKSPACE = '/sandbox/workspace';
export const VIRTUAL_TMP = '/sandbox/tmp';

export class VirtualPathMapper {
  private readonly hostWorkspace: string;
  private readonly hostTmp: string;

  constructor(hostWorkspace: string, hostTmp?: string) {
    this.hostWorkspace = resolve(hostWorkspace);
    this.hostTmp = resolve(hostTmp || join(hostWorkspace, '.tmp'));
  }

  /**
   * Convert a virtual sandbox path to a real host path.
   * @throws if the virtual path escapes the sandbox root.
   */
  toHost(virtualPath: string): string {
    const normalized = virtualPath.replace(/\\/g, '/');

    if (normalized.startsWith(VIRTUAL_WORKSPACE + '/') || normalized === VIRTUAL_WORKSPACE) {
      const rel = normalized.slice(VIRTUAL_WORKSPACE.length).replace(/^\//, '');
      const hostPath = resolve(this.hostWorkspace, rel);
      this.assertWithinBounds(hostPath, this.hostWorkspace);
      return hostPath;
    }

    if (normalized.startsWith(VIRTUAL_TMP + '/') || normalized === VIRTUAL_TMP) {
      const rel = normalized.slice(VIRTUAL_TMP.length).replace(/^\//, '');
      const hostPath = resolve(this.hostTmp, rel);
      this.assertWithinBounds(hostPath, this.hostTmp);
      return hostPath;
    }

    // If it's a relative path, treat it as relative to workspace
    if (!isAbsolute(normalized)) {
      const hostPath = resolve(this.hostWorkspace, normalized);
      this.assertWithinBounds(hostPath, this.hostWorkspace);
      return hostPath;
    }

    throw new PathEscapeError(
      `Virtual path "${virtualPath}" does not start with ${VIRTUAL_WORKSPACE} or ${VIRTUAL_TMP}`
    );
  }

  /**
   * Convert a real host path to a virtual sandbox path.
   */
  toVirtual(hostPath: string): string {
    const resolved = resolve(hostPath);

    if (resolved.startsWith(this.hostWorkspace)) {
      const rel = relative(this.hostWorkspace, resolved);
      if (rel.startsWith('..')) {
        throw new PathEscapeError(`Host path "${hostPath}" escapes workspace boundary`);
      }
      return `${VIRTUAL_WORKSPACE}/${rel}`.replace(/\/+$/, '');
    }

    if (resolved.startsWith(this.hostTmp)) {
      const rel = relative(this.hostTmp, resolved);
      if (rel.startsWith('..')) {
        throw new PathEscapeError(`Host path "${hostPath}" escapes tmp boundary`);
      }
      return `${VIRTUAL_TMP}/${rel}`.replace(/\/+$/, '');
    }

    // Unknown host path — return as-is (for paths outside sandbox)
    return hostPath;
  }

  /**
   * Rewrite all occurrences of real host paths in output text to virtual paths.
   * This prevents leaking real filesystem paths to the AI agent.
   */
  sanitizeOutput(text: string): string {
    if (!text) return text;

    // Replace host workspace path with virtual workspace
    let sanitized = text.split(this.hostWorkspace).join(VIRTUAL_WORKSPACE);

    // Replace host tmp path with virtual tmp
    sanitized = sanitized.split(this.hostTmp).join(VIRTUAL_TMP);

    return sanitized;
  }

  /**
   * Rewrite virtual paths in input command to real host paths.
   * Handles common patterns like: cd /sandbox/workspace && ls
   */
  rewriteCommand(command: string): string {
    if (!command) return command;

    let rewritten = command;

    // Replace virtual workspace references with host paths
    rewritten = rewritten.split(VIRTUAL_WORKSPACE).join(this.hostWorkspace);
    rewritten = rewritten.split(VIRTUAL_TMP).join(this.hostTmp);

    return rewritten;
  }

  /**
   * Get the host workspace path.
   */
  getHostWorkspace(): string {
    return this.hostWorkspace;
  }

  /**
   * Get the virtual workspace path.
   */
  getVirtualWorkspace(): string {
    return VIRTUAL_WORKSPACE;
  }

  /**
   * Assert that a resolved path is within the allowed boundary.
   */
  private assertWithinBounds(resolvedPath: string, boundary: string): void {
    if (!resolvedPath.startsWith(boundary)) {
      throw new PathEscapeError(
        `Path traversal detected: "${resolvedPath}" escapes boundary "${boundary}"`
      );
    }
  }
}

/**
 * Error thrown when a path escapes sandbox boundaries.
 */
export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathEscapeError';
  }
}
