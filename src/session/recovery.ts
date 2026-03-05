/**
 * Session Recovery Module
 *
 * Automatically detects and recovers unanswered sessions after restart.
 * Handles scenarios like:
 * - PM2 scheduled restart (daily at 4 AM)
 * - Process crash and auto-restart
 * - Manual service restart
 * - Messages sent just before restart
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Session } from './index';

export interface RecoveryConfig {
  /** Enable recovery feature (default: true) */
  enabled: boolean;
  /** Maximum unanswered time in milliseconds (default: 300000 = 5 minutes) */
  maxAge: number;
  /** Minimum unanswered time in milliseconds (default: 10000 = 10 seconds) */
  minAge: number;
  /** Channels to recover (default: ['feishu']) */
  channels: string[];
  /** Batch size for processing (default: 5) */
  batchSize: number;
  /** Delay between messages in milliseconds (default: 2000) */
  delayMs: number;
  /** Delay before starting recovery in milliseconds (default: 10000) */
  startupDelay: number;
}

export interface UnansweredSession {
  session: Session;
  lastMessageAge: number;  // milliseconds
  lastMessageContent: string;
}

export interface RecoveryResult {
  recovered: number;
  failed: number;
  skipped: number;
  details: Array<{
    sessionId: string;
    status: 'recovered' | 'failed' | 'skipped';
    error?: string;
  }>;
}

/**
 * Detect unanswered sessions
 */
export async function detectUnansweredSessions(
  config: RecoveryConfig,
  options?: {
    sessionsPath?: string;
    getAllSessions?: () => Session[];
  }
): Promise<UnansweredSession[]> {
  const now = Date.now();
  const unanswered: UnansweredSession[] = [];

  // Get all sessions
  let sessions: Session[];

  if (options?.getAllSessions) {
    sessions = options.getAllSessions();
  } else {
    // Fallback: Load sessions from disk
    const sessionsPath = options?.sessionsPath || './data/memory/sessions';
    if (!existsSync(sessionsPath)) {
      return [];
    }

    sessions = [];
    const files = readdirSync(sessionsPath).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const content = await import('fs').then(fs =>
          fs.readFileSync(join(sessionsPath, file), 'utf-8')
        );
        const session = JSON.parse(content) as Session;
        sessions.push(session);
      } catch (error) {
        console.error('[Recovery] Failed to load session file:', file, error);
      }
    }
  }

  // Check each session
  for (const session of sessions) {
    // Filter by channel
    if (!config.channels.includes(session.channel)) {
      continue;
    }

    // Check if there are any messages
    if (session.messages.length === 0) {
      continue;
    }

    // Get last message
    const lastMessage = session.messages[session.messages.length - 1];

    // Skip if last message is not from user
    if (lastMessage.role !== 'user') {
      continue;
    }

    // Check if session is marked for recovery (bot restarted during processing)
    const isPendingRecovery = session.pendingRecovery === true;

    // Calculate age
    const lastMessageTime = new Date(lastMessage.timestamp).getTime();
    const age = now - lastMessageTime;

    // Skip if too old
    if (age > config.maxAge) {
      continue;
    }

    // Skip if too recent (might still be processing)
    // Unless it's marked as pending recovery - then process immediately
    if (!isPendingRecovery && age < config.minAge) {
      continue;
    }

    // Found an unanswered session
    // Add recovery status to the log
    if (isPendingRecovery) {
      console.log(`[Recovery] 🔄 Session ${session.id} marked as pending recovery (bot restarted during processing)`);
    }

    unanswered.push({
      session,
      lastMessageAge: age,
      lastMessageContent: lastMessage.content.substring(0, 100),
    });
  }

  // Sort by age (oldest first - descending order)
  unanswered.sort((a, b) => b.lastMessageAge - a.lastMessageAge);

  return unanswered;
}

/**
 * Recover unanswered sessions
 */
export async function recoverUnansweredSessions(
  config: RecoveryConfig,
  options: {
    getFeishuClient?: () => any;
    sendProactiveMessage?: (options: any) => Promise<any>;
    getAllSessions?: () => Session[];
  }
): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    recovered: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  if (!config.enabled) {
    console.log('[Recovery] Disabled in configuration');
    return result;
  }

  console.log('[Recovery] 🔍 Scanning for unanswered sessions...');

  // Detect unanswered sessions
  const unanswered = await detectUnansweredSessions(config, {
    getAllSessions: options.getAllSessions,
  });

  if (unanswered.length === 0) {
    console.log('[Recovery] ✓ No unanswered sessions found');
    return result;
  }

  console.log(`[Recovery] 📨 Found ${unanswered.length} unanswered session(s)`);

  // Process in batches
  const batches = [];
  for (let i = 0; i < unanswered.length; i += config.batchSize) {
    batches.push(unanswered.slice(i, i + config.batchSize));
  }

  for (const batch of batches) {
    for (const item of batch) {
      const { session, lastMessageAge, lastMessageContent } = item;

      console.log(`[Recovery] 🔄 Recovering session ${session.id}`);
      console.log(`[Recovery]    Last message: "${lastMessageContent}..."`);
      console.log(`[Recovery]    Age: ${Math.round(lastMessageAge / 1000)}s`);

      try {
        // Determine channel
        const channel = session.channel as 'cli' | 'feishu' | 'webhook' | 'api';

        // Send proactive message to reprocess
        let proactiveResult: { success: boolean; response?: string; error?: string } | undefined;

        if (options.sendProactiveMessage) {
          proactiveResult = await options.sendProactiveMessage({
            sessionId: session.id,
            userId: session.userId,
            channel,
            message: lastMessageContent,
            context: {
              chatId: session.metadata?.chatId,
              isRecovery: true,  // Mark as recovery
            },
          });

          if (!proactiveResult.success) {
            throw new Error(proactiveResult.error || 'Unknown error');
          }
        }

        // Send response to Feishu if applicable
        if (channel === 'feishu' && options.getFeishuClient && proactiveResult?.response) {
          const client = options.getFeishuClient();
          if (client && session.metadata?.chatId) {
            try {
              // Send the actual AI response
              await client.sendPostMessage(
                session.metadata.chatId as string,
                'chat_id',
                proactiveResult.response,
                { title: '🔄 恢复处理结果' }
              );
              console.log('[Recovery] 📤 Response sent to Feishu');

              // Clear recovery flag after successful delivery
              const { clearRecoveryFlag } = await import('./index');
              clearRecoveryFlag(session.id);
            } catch (error) {
              console.error('[Recovery] Failed to send response:', error);
            }
          }
        }

        result.recovered++;
        result.details.push({
          sessionId: session.id,
          status: 'recovered',
        });

        console.log(`[Recovery] ✅ Session recovered`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.failed++;
        result.details.push({
          sessionId: session.id,
          status: 'failed',
          error: errorMsg,
        });

        console.error(`[Recovery] ❌ Failed to recover session:`, errorMsg);
      }

      // Delay between messages
      if (config.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, config.delayMs));
      }
    }
  }

  console.log(
    `[Recovery] 📊 Done: ${result.recovered} recovered, ${result.failed} failed, ${result.skipped} skipped`
  );

  return result;
}
