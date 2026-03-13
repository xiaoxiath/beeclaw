/**
 * Feishu Adapter
 *
 * 飞书 Bot 入口适配器，提供飞书 WebSocket 连接和消息处理
 */

import type { EntryAdapter, EntryContext, AdapterStatus } from '../../infra/entry/types';
import { FeishuChannel } from './channel';
import { initFeishuWSIntegration } from '../../app/routes/proactive';
import { getFeishuWSClient } from './ws-client';
import { logger } from '../../infra/observability/logger';

export class FeishuAdapter implements EntryAdapter {
  readonly name = 'feishu';
  readonly type = 'bot' as const;

  private context: EntryContext | null = null;
  private channel: FeishuChannel | null = null;
  private running: boolean = false;
  private startTime: number = 0;

  async initialize(context: EntryContext): Promise<void> {
    this.context = context;

    // 注册 Feishu channel 到 gateway
    this.channel = new FeishuChannel();
    context.gateway.registerChannel(this.channel);

    logger.debug('[FeishuAdapter] Initialized');
  }

  async start(): Promise<void> {
    if (!this.context) {
      throw new Error('[FeishuAdapter] Not initialized');
    }

    const feishuConfig = this.context.config.feishu;
    if (!feishuConfig?.enabled) {
      logger.info('[FeishuAdapter] Feishu bot is disabled in config');
      return;
    }

    try {
      // 初始化飞书 WebSocket 连接
      await initFeishuWSIntegration(feishuConfig);

      this.running = true;
      this.startTime = Date.now();

      console.log('   📨 Feishu bot connected');
      logger.info('[FeishuAdapter] Feishu bot started');
    } catch (error) {
      logger.error('[FeishuAdapter] Failed to start:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.running) {
      try {
        // 断开飞书连接
        const client = getFeishuWSClient();
        if (client) {
          // TODO: implement disconnect method in client
          // await client.disconnect();
        }

        this.running = false;
        logger.info('[FeishuAdapter] Feishu bot stopped');
      } catch (error) {
        logger.error('[FeishuAdapter] Failed to stop:', error);
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.running) return false;

    try {
      const client = getFeishuWSClient();
      return client !== null && client !== undefined;
    } catch {
      return false;
    }
  }

  getStatus(): AdapterStatus {
    return {
      running: this.running,
      uptime: this.running ? Date.now() - this.startTime : 0,
      connections: this.running ? 1 : 0,
    };
  }
}
