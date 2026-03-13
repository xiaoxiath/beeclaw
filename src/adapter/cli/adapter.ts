/**
 * CLI Adapter
 *
 * CLI 入口适配器，提供命令行交互界面
 *
 * 注意：这个 adapter 主要是一个包装器，实际的 CLI 逻辑在 entries/cli.ts 中
 */

import type { EntryAdapter, EntryContext, AdapterStatus } from '../../infra/entry/types';
import { CLIChannel } from './channel';
import { logger } from '../../infra/observability/logger';

export class CLIAdapter implements EntryAdapter {
  readonly name = 'cli';
  readonly type = 'cli' as const;

  private context: EntryContext | null = null;
  private channel: CLIChannel | null = null;
  private running: boolean = false;
  private startTime: number = 0;

  async initialize(context: EntryContext): Promise<void> {
    this.context = context;

    // 注册 CLI channel 到 gateway
    this.channel = new CLIChannel();
    context.gateway.registerChannel(this.channel);

    logger.debug('[CLIAdapter] Initialized');
  }

  async start(): Promise<void> {
    this.running = true;
    this.startTime = Date.now();
    logger.info('[CLIAdapter] CLI adapter started');

    // 注意：实际的 CLI REPL 循环在 entries/cli.ts 中启动
    // 这里只是标记 adapter 为 running 状态
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info('[CLIAdapter] CLI adapter stopped');
  }

  async healthCheck(): Promise<boolean> {
    return this.running;
  }

  getStatus(): AdapterStatus {
    return {
      running: this.running,
      uptime: this.running ? Date.now() - this.startTime : 0,
    };
  }
}
