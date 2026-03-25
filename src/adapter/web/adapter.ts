/**
 * Web Adapter
 *
 * Web UI 入口适配器，提供 HTTP 服务和 WebSocket 支持
 */

import type { EntryAdapter, EntryContext, AdapterStatus } from '../../infra/entry/types';
import { createWebApp } from './server';
import { logger } from '../../infra/observability/logger';

export class WebAdapter implements EntryAdapter {
  readonly name = 'web';
  readonly type = 'web' as const;

  private context: EntryContext | null = null;
  private server: any = null;
  private startTime: number = 0;
  private activeConnections: Set<any> = new Set();

  async initialize(context: EntryContext): Promise<void> {
    this.context = context;
    logger.debug('[WebAdapter] Initialized');
  }

  async start(): Promise<void> {
    if (!this.context) {
      throw new Error('[WebAdapter] Not initialized');
    }

    const webConfig = this.context.config.web;
    if (!webConfig?.enabled) {
      logger.info('[WebAdapter] Web UI is disabled in config');
      return;
    }

    try {
      const { app } = createWebApp(webConfig);
      const port = webConfig.port || 3000;
      const host = webConfig.host || '0.0.0.0';

      this.server = Bun.serve({
        port,
        hostname: host,
        fetch: app.fetch,
        idleTimeout: 255, // SSE streaming support
        websocket: {
            open: (ws) => {
              this.activeConnections.add(ws);
              logger.debug(`[WebAdapter] WebSocket connected, total: ${this.activeConnections.size}`);
            },
            close: (ws) => {
              this.activeConnections.delete(ws);
              logger.debug(`[WebAdapter] WebSocket disconnected, total: ${this.activeConnections.size}`);
            },
          },
      });

      this.startTime = Date.now();

      const displayHost = host === '0.0.0.0' ? 'localhost' : host;
      logger.debug(`   🌐 Web UI: http://${displayHost}:${port}`);

      logger.info(`[WebAdapter] Server started on ${host}:${port}`);
    } catch (error) {
      logger.error('[WebAdapter] Failed to start server:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      try {
        this.server.stop();
        this.server = null;
        logger.info('[WebAdapter] Server stopped');
      } catch (error) {
        logger.error('[WebAdapter] Failed to stop server:', error);
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.server !== null;
  }

  getStatus(): AdapterStatus {
    return {
      running: this.server !== null,
      uptime: this.server ? Date.now() - this.startTime : 0,
      connections: this.activeConnections.size,
      metadata: {
        port: this.context?.config.web?.port || 3000,
        host: this.context?.config.web?.host || '0.0.0.0',
      },
    };
  }
}
