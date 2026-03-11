/**
 * Local Sandbox Provider
 *
 * TODO: Implement local sandbox execution
 * This is a stub implementation for now
 */

import type { Sandbox, SandboxProvider, SandboxCreateOptions, SandboxExecResult } from '../types';
import { logger } from '../../../infra/observability/logger';

export class LocalSandboxProvider implements SandboxProvider {
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    // Local provider is always "available" in stub mode
    // but won't actually create sandboxes
    logger.info('[LocalSandboxProvider] Using stub implementation');
    return true;
  }

  async create(options: SandboxCreateOptions): Promise<Sandbox> {
    throw new Error('LocalSandboxProvider not implemented yet. See TODO in src/domain/sandbox/providers/local.ts');
  }

  async destroy(sandboxId: string): Promise<void> {
    // No-op in stub
  }

  async exec(sandboxId: string, command: string, args?: string[]): Promise<SandboxExecResult> {
    throw new Error('LocalSandboxProvider not implemented yet. See TODO in src/domain/sandbox/providers/local.ts');
  }

  async list(): Promise<Sandbox[]> {
    return [];
  }
}
