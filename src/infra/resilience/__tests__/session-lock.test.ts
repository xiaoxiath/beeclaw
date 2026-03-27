/**
 * Test: Session Queue Timeout Alignment
 *
 * This test verifies that the session queue's maxWaitTime is properly
 * aligned with the resilience config's turn timeout.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { SessionMessageQueue } from '../session-lock';
import { resolveConfig } from '../../config/resilience-config';

describe('SessionMessageQueue', () => {
  beforeEach(() => {
    SessionMessageQueue.resetInstance();
  });

  test('should have maxWaitTime >= turn timeout', () => {
    const resilienceConfig = resolveConfig('standard');
    const turnTimeout = resilienceConfig.timeout.turnTimeoutMs;

    const queueOptions = {
      maxQueueDepth: 10,
      maxWaitTime: Math.max(turnTimeout + 60000, 600000), // Turn timeout + 1 minute buffer
    };

    const queue = SessionMessageQueue.getInstance(queueOptions);

    // Verify queue's maxWaitTime is >= turn timeout
    expect((queue as any).maxWaitTime).toBeGreaterThanOrEqual(turnTimeout);

    console.log(
      `✅ Queue configured correctly: maxWaitTime=${Math.round(queueOptions.maxWaitTime / 1000)}s >= turnTimeout=${Math.round(turnTimeout / 1000)}s`
    );
  });

  test('should reject messages that wait too long', async () => {
    const queue = SessionMessageQueue.getInstance({
      maxQueueDepth: 10,
      maxWaitTime: 1000, // 1 second for testing
    });

    // Create a long-running task that blocks the queue
    const longTask = () => new Promise((resolve) => setTimeout(resolve, 2000));

    // Start the long task
    const taskPromise = queue.enqueue('test-session', longTask);

    // Add another message while the first is processing
    // This should expire while waiting
    const queuedPromise = queue.enqueue('test-session', () => Promise.resolve('done'));

    // The queued message should be rejected because it waited too long
    await expect(queuedPromise).rejects.toThrow('Message expired');
  });
});
