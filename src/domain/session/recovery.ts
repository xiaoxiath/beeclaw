/**
 * Session Recovery Module — Bugfix Version
 *
 * Automatically detects and recovers unanswered sessions after restart.
 * Handles scenarios like:
 * - PM2 scheduled restart (daily at 4 AM)
 * - Process crash and auto-restart
 * - Manual service restart
 * - Messages sent just before restart
 *
 * Fixes applied:
 *   Bug #2: Two-phase recovery (re-deliver vs. reprocess)
 *   Bug #4: Full message content used (no .substring(0,100) truncation)
 *   Bug #7: Recovery attempt limit (MAX_RECOVERY_ATTEMPTS)
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Session } from './index';
import { confirmDelivery, MAX_RECOVERY_ATTEMPTS } from './index';

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
  lastMessageContent: string;  // BUG #4 FIX: Full content, no truncation
  /** True if AI already responded but delivery failed */
  pendingDeliveryOnly: boolean;
  /** Cached AI response for re-delivery */
  existingResponse?: string;
  /** Current recovery attempt count */
  recoveryAttempts: number;
  /** [AUDIT FIX M-07] Whether original message was multimodal */
  wasMultimodal?: boolean;
  /** [AUDIT FIX M-07] Vision description from two-stage processing */
  visionDescription?: string;
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
        const content = readFileSync(join(sessionsPath, file), 'utf-8');
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

    // Check if session is marked for recovery (bot restarted during processing)
    const isPendingRecovery = session.pendingRecovery === true;

    // BUG #7 FIX: Check recovery attempt limit
    const attempts = session.recoveryAttempts ?? 0;
    if (isPendingRecovery && attempts >= MAX_RECOVERY_ATTEMPTS) {
      console.warn(
        `[Recovery] Session ${session.id} exceeded max recovery attempts ` +
        `(${attempts}/${MAX_RECOVERY_ATTEMPTS}). Marking as failed.`
      );
      session.pendingRecovery = false;
      session.pendingDelivery = false;
      continue;
    }

    // CRITICAL FIX: Check if this session was already answered
    // If last message is from assistant, or if there's an assistant response after the last user message
    // then this session doesn't need recovery (even if pendingRecovery is stale)
    if (lastMessage.role === 'assistant') {
      // Last message is from assistant - already answered
      // Clear stale pendingRecovery flag if exists
      if (isPendingRecovery) {
        console.log(`[Recovery] 🧹 Clearing stale pendingRecovery flag for answered session ${session.id}`);
        session.pendingRecovery = false;
        // Note: Caller (bot.ts or daemon.ts) will save the session after recovery completes
      }
      continue;
    }

    // Additional check: Look for any assistant response after the last user message
    if (lastMessage.role === 'user') {
      // Find the last user message and check if there's an assistant response after it
      const lastUserIndex = session.messages.length - 1;
      // Check if there are any messages after the last user message
      // (This shouldn't happen, but we need to be defensive)
      for (let i = lastUserIndex + 1; i < session.messages.length; i++) {
        if (session.messages[i].role === 'assistant') {
          // Found assistant response after last user message - already answered
          console.log(`[Recovery] 🧹 Session ${session.id} has assistant response, clearing pendingRecovery`);
          if (isPendingRecovery) {
            session.pendingRecovery = false;
            // Note: Caller will save the session
          }
          continue; // Skip this session
        }
      }
    }

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

    // BUG #2 FIX: Detect if this is a delivery-only recovery
    const isPendingDeliveryOnly = session.pendingDelivery === true;

    // [AUDIT FIX M-07] Capture multimodal metadata for recovery
    const lastMsgMeta = (lastMessage as any)._meta;
    const wasMultimodal = lastMsgMeta?.originalType === 'multimodal';

    unanswered.push({
      session,
      lastMessageAge: age,
      lastMessageContent: lastMessage.content, // BUG #4 FIX: Full content
      pendingDeliveryOnly: isPendingDeliveryOnly,
      existingResponse: isPendingDeliveryOnly ? session.lastAiResponse : undefined,
      recoveryAttempts: attempts,
      wasMultimodal,
      visionDescription: wasMultimodal ? lastMsgMeta?.visionDescription : undefined,
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
      const { session, lastMessageAge, lastMessageContent, pendingDeliveryOnly, existingResponse, recoveryAttempts } = item;

      console.log(`[Recovery] 🔄 Recovering session ${session.id}`);
      console.log(`[Recovery]    Last message: "${lastMessageContent.substring(0, 100)}..."`);
      console.log(`[Recovery]    Age: ${Math.round(lastMessageAge / 1000)}s`);
      console.log(`[Recovery]    Delivery-only: ${pendingDeliveryOnly}, Attempts: ${recoveryAttempts}`);

      // Increment recovery attempts
      session.recoveryAttempts = recoveryAttempts + 1;
      session.lastRecoveryAt = new Date().toISOString();

      let responseToSend: string | undefined;

      try {
        // Determine channel
        const channel = session.channel as 'cli' | 'feishu' | 'webhook' | 'api';

        if (pendingDeliveryOnly && existingResponse) {
          // BUG #2 FIX: Phase 1 - Re-deliver cached response
          console.log(`[Recovery] Phase 1: Re-delivering cached response...`);
          responseToSend = existingResponse;
        } else {
          // BUG #2 FIX: Phase 2 - Full reprocessing
          // [AUDIT FIX M-07] Multimodal-aware recovery
          let recoveryMessage: string;
          if (item.wasMultimodal && item.visionDescription) {
            // Reconstruct context from vision description instead of raw text
            recoveryMessage = `[恢复上下文 - 原始消息包含图片] 图片描述：${item.visionDescription}\n用户消息：${lastMessageContent}`;
            console.log('[Recovery] Phase 2: Reprocessing multimodal message with vision context...');
          } else {
            recoveryMessage = lastMessageContent;
            console.log('[Recovery] Phase 2: Reprocessing text message...');
          }

          // Send proactive message to reprocess
          let proactiveResult: { success: boolean; response?: string; error?: string } | undefined;

          if (options.sendProactiveMessage) {
            proactiveResult = await options.sendProactiveMessage({
              sessionId: session.id,
              userId: session.userId,
              channel,
              message: recoveryMessage, // [AUDIT FIX M-07] Use multimodal-aware message
              context: {
                chatId: session.metadata?.chatId,
                isRecovery: true,  // Mark as recovery
              },
            });

            if (!proactiveResult.success) {
              throw new Error(proactiveResult.error || 'Unknown error');
            }

            responseToSend = proactiveResult.response;
          }
        }

        // Send response to Feishu if applicable
        if (channel === 'feishu' && options.getFeishuClient && responseToSend) {
          const client = options.getFeishuClient();
          if (client && session.metadata?.chatId) {
            try {
              // Send the actual AI response
              await client.sendPostMessage(
                session.metadata.chatId as string,
                'chat_id',
                responseToSend,
                { title: pendingDeliveryOnly ? '🔄 重新投递' : '🔄 恢复处理结果' }
              );
              console.log('[Recovery] 📤 Response sent to Feishu');

              // BUG #2 FIX: Use confirmDelivery() instead of clearRecoveryFlag()
              confirmDelivery(session.id);
            } catch (error) {
              console.error('[Recovery] Failed to send response:', error);
              // BUG #2 FIX: Save AI response for Phase 1 retry next time
              if (!pendingDeliveryOnly && responseToSend) {
                session.pendingDelivery = true;
                session.lastAiResponse = responseToSend;
                console.warn(
                  `[Recovery] ✗ AI responded but delivery failed for session ${session.id}. ` +
                  `Will attempt re-delivery on next recovery.`
                );
              }
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
