/**
 * Docker Sandbox Provider
 *
 * TODO: Implement Docker-based sandbox execution
 * This is a stub implementation for now
 */

import type { Sandbox, SandboxProvider, SandboxCreateOptions, SandboxExecResult } from '../types';
import { logger } from '../../../infra/observability/logger';

export class DockerSandboxProvider implements SandboxProvider {
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    // Check if Docker is available
    // In stub mode, always return false
    logger.info('[DockerSandboxProvider] Using stub implementation - Docker not checked');
    return false;
  }

  async create(options: SandboxCreateOptions): Promise<Sandbox> {
    throw new Error('DockerSandboxProvider not implemented yet. See TODO in src/domain/sandbox/providers/docker.ts');
  }

  async destroy(sandboxId: string): Promise<void> {
    // No-op in stub
  }

  async exec(sandboxId: string, command: string, args?: string[]): Promise<SandboxExecResult> {
    throw new Error('DockerSandboxProvider not implemented yet. See TODO in src/domain/sandbox/providers/docker.ts');
  }

  async list(): Promise<Sandbox[]> {
    return [];
  }
}
