/**
 * Graceful Shutdown Manager — Bug #5 Fix
 *
 * Problem: Original code only had:
 *   process.on('SIGINT', () => process.exit(0));
 * No SIGTERM, no in-flight request draining, no state persistence.
 *
 * Solution: Ordered shutdown with configurable grace period.
 */

import { SessionMessageQueue } from './session-lock';

export interface ShutdownCleanupFn {
  name: string;
  priority?: number;
  fn: () => Promise<void> | void;
}

export interface GracefulShutdownOptions {
  gracePeriodMs?: number;
  installSignalHandlers?: boolean;
}

const DEFAULT_GRACE_PERIOD = 30_000;

export class GracefulShutdown {
  private cleanupFns: ShutdownCleanupFn[] = [];
  private _shuttingDown = false;
  private gracePeriodMs: number;

  private static instance: GracefulShutdown | null = null;

  static getInstance(options?: GracefulShutdownOptions): GracefulShutdown {
    if (!GracefulShutdown.instance) {
      GracefulShutdown.instance = new GracefulShutdown(options);
    }
    return GracefulShutdown.instance;
  }

  static resetInstance(): void {
    GracefulShutdown.instance = null;
  }

  constructor(options?: GracefulShutdownOptions) {
    this.gracePeriodMs = options?.gracePeriodMs ?? DEFAULT_GRACE_PERIOD;
    if (options?.installSignalHandlers !== false) {
      this.installSignalHandlers();
    }
  }

  get shuttingDown(): boolean {
    return this._shuttingDown;
  }

  register(entry: ShutdownCleanupFn): void {
    this.cleanupFns.push(entry);
  }

  installSignalHandlers(): void {
    const handler = (signal: string) => {
      console.log(`\n[Shutdown] Received ${signal}, starting graceful shutdown...`);
      this.shutdown().then(() => {
        process.exit(0);
      }).catch((error) => {
        console.error('[Shutdown] Error during shutdown:', error);
        process.exit(1);
      });
    };

    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.on('SIGINT', () => handler('SIGINT'));
    process.on('SIGTERM', () => handler('SIGTERM'));
  }

  async shutdown(): Promise<void> {
    if (this._shuttingDown) {
      console.log('[Shutdown] Already shutting down, ignoring duplicate signal.');
      return;
    }
    this._shuttingDown = true;

    console.log('[Shutdown] Phase 1: Draining in-flight message queues...');
    const queue = SessionMessageQueue.getInstance();
    const drainTimeout = Math.floor(this.gracePeriodMs * 0.6);
    try {
      await queue.drainAll(drainTimeout);
      console.log('[Shutdown] Message queues drained.');
    } catch (error) {
      console.warn('[Shutdown] Queue drain error:', error);
    }

    console.log('[Shutdown] Phase 2: Running cleanup functions...');
    const sorted = [...this.cleanupFns].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100)
    );

    const cleanupTimeout = Math.floor(this.gracePeriodMs * 0.35);
    const cleanupDeadline = Date.now() + cleanupTimeout;

    for (const entry of sorted) {
      if (Date.now() >= cleanupDeadline) {
        console.warn(`[Shutdown] Cleanup timeout reached, skipping remaining: ${entry.name}`);
        break;
      }
      try {
        console.log(`[Shutdown]   Running: ${entry.name}...`);
        await Promise.race([
          Promise.resolve(entry.fn()),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Cleanup timeout')), 5000)
          ),
        ]);
        console.log(`[Shutdown]   ✓ ${entry.name} done`);
      } catch (error) {
        console.error(`[Shutdown]   ✗ ${entry.name} failed:`, error);
      }
    }

    console.log('[Shutdown] Graceful shutdown complete. 👋');
  }
}
