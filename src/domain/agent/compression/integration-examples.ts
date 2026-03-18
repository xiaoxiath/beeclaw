/**
 * Integration Example: Context Compression in Beeclaw
 *
 * This example demonstrates how to integrate the three-tier compression
 * system into the existing agent chat flow.
 */

import { getTieredCompressor, getProgressiveCompactor } from './index';
import { estimateTotalTokens, type MultimodalContent } from '../context';
import { logger } from '../../../infra/observability/logger';

/**
 * Example 1: Integrate compression into agent chat
 */
export async function chatWithCompression(
  messages: Array<{
    role: string;
    content?: string | MultimodalContent[];
    tool_calls?: any;
    tool_call_id?: string;
  }>,
  config: {
    maxTokens: number;
    compressionThreshold: number;
    keepRecent: number;
    llmClient?: any;
  }
): Promise<typeof messages> {
  const compressor = getTieredCompressor();

  // Configure LLM client for L3 compression if provided
  if (config.llmClient) {
    compressor.setLLMClient(config.llmClient);
  }

  // Estimate current token usage
  const currentTokens = estimateTotalTokens(messages);
  const threshold = config.maxTokens * config.compressionThreshold;

  logger.debug(
    `[Compression] Current: ${currentTokens} tokens, Threshold: ${threshold} tokens`
  );

  // Check if compression is needed
  if (currentTokens <= threshold) {
    logger.debug('[Compression] Below threshold, no compression needed');
    return messages;
  }

  logger.info(
    `[Compression] Above threshold (${(currentTokens / config.maxTokens * 100).toFixed(1)}%), compressing...`
  );

  // Separate messages to compress
  const keepRecent = config.keepRecent;
  const recentMessages = messages.slice(-keepRecent);
  const oldMessages = messages.slice(0, -keepRecent);

  // Compress old messages
  const compressedMessages = await Promise.all(
    oldMessages.map(async (msg) => {
      // Only compress text content
      if (typeof msg.content === 'string' && msg.content.length > 100) {
        const result = await compressor.compress(
          msg.content,
          estimateTotalTokens([msg]),
          config.maxTokens * 0.05 // Allocate 5% of budget per message
        );

        logger.debug(
          `[Compression] Compressed message: ${result.originalTokens} → ${result.compressedTokens} tokens (${(result.ratio * 100).toFixed(1)}%)`
        );

        return { ...msg, content: result.compressed };
      }

      return msg;
    })
  );

  const finalMessages = [...compressedMessages, ...recentMessages];
  const finalTokens = estimateTotalTokens(finalMessages);

  logger.info(
    `[Compression] Completed: ${currentTokens} → ${finalTokens} tokens (saved ${currentTokens - finalTokens})`
  );

  return finalMessages;
}

/**
 * Example 2: Progressive compaction for long conversations
 */
export async function compactConversationHistory(
  messages: Array<{
    turn: number;
    role: string;
    content: string;
  }>,
  config?: {
    zones?: any[];
    llmClient?: any;
  }
): Promise<string[]> {
  const compactor = getProgressiveCompactor();

  // Configure custom zones if provided
  if (config?.zones) {
    compactor.setZones(config.zones);
  }

  // Configure LLM client for cold zone compression
  if (config?.llmClient) {
    const compressor = compactor['compressor'];
    compressor.setLLMClient(config.llmClient);
  }

  const currentTurn = Math.max(...messages.map(m => m.turn));

  logger.info(
    `[ProgressiveCompactor] Compacting ${messages.length} messages (turn ${currentTurn})...`
  );

  const result = await compactor.compact(messages, currentTurn);

  // Log zone statistics
  for (const [zoneName, stats] of Object.entries(result.byZone)) {
    if (stats.count > 0) {
      const ratio = 1 - stats.compactedTokens / stats.originalTokens;
      logger.debug(
        `[ProgressiveCompactor] Zone ${zoneName}: ${stats.count} messages, ${(ratio * 100).toFixed(1)}% compression`
      );
    }
  }

  logger.info(
    `[ProgressiveCompactor] Completed: ${result.originalTokens} → ${result.compactedTokens} tokens (${(result.ratio * 100).toFixed(1)}% total compression)`
  );

  return result.messages;
}

/**
 * Example 3: Compression middleware for memory system
 */
export function createCompressionMiddleware(config: {
  maxMemoryTokens: number;
  llmClient?: any;
}) {
  const compressor = getTieredCompressor();

  if (config.llmClient) {
    compressor.setLLMClient(config.llmClient);
  }

  return {
    async beforeStore(content: string): Promise<string> {
      const tokens = estimateTotalTokens([{ role: 'user', content }]);

      if (tokens > config.maxMemoryTokens * 0.5) {
        const result = await compressor.compress(
          content,
          tokens,
          config.maxMemoryTokens * 0.3
        );

        logger.debug(
          `[CompressionMiddleware] Compressed memory: ${result.originalTokens} → ${result.compressedTokens} tokens`
        );

        return result.compressed;
      }

      return content;
    },

    async beforeRetrieve(content: string): Promise<string> {
      // Could decompress or expand if needed
      return content;
    },
  };
}

/**
 * Example 4: Automatic compression in proactive scheduler
 */
export function scheduleMemoryCompression(scheduler: any, config: {
  interval: string;
  llmClient?: any;
}) {
  scheduler.createSchedule({
    id: 'memory-compression',
    cron: config.interval,
    handler: async () => {
      logger.info('[ScheduledCompression] Starting memory compression...');

      const compactor = getProgressiveCompactor();

      if (config.llmClient) {
        const compressor = compactor['compressor'];
        compressor.setLLMClient(config.llmClient);
      }

      // Get all active sessions (implementation depends on your session manager)
      // const sessions = await sessionManager.getActiveSessions();

      // for (const session of sessions) {
      //   const messages = await loadMessages(session.id);
      //   const result = await compactor.compact(messages, messages.length);
      //   await saveCompactedMessages(session.id, result.messages);
      // }

      logger.info('[ScheduledCompression] Memory compression completed');
    },
  });
}

/**
 * Example 5: Usage in agent.ts
 *
 * Add this to your agent's chat() method:
 */
/*
export async function chat(
  this: Agent,
  messages: ChatMessage[],
  onContentBlock?: (block: ContentBlock) => void
): Promise<ChatCompletion> {
  // ... existing code ...

  // NEW: Apply compression before calling LLM
  const compressor = getTieredCompressor();

  // Configure LLM client for L3 compression
  if (this.provider) {
    compressor.setLLMClient({
      complete: async (prompt: string, maxTokens: number) => {
        const response = await callAI({
          provider: this.provider,
          model: 'glm-4-flash', // Use fast model for compression
          messages: [{ role: 'user', content: prompt }],
          maxTokens,
        });
        return response.choices[0]?.message?.content || '';
      },
    });
  }

  // Compress messages if needed
  messages = await chatWithCompression(messages, {
    maxTokens: this.config.contextConfig.maxTokens,
    compressionThreshold: this.config.contextConfig.compressionThreshold,
    keepRecent: this.config.contextConfig.keepRecent,
    llmClient: this.provider,
  });

  // ... continue with existing chat logic ...
}
*/

/**
 * Example 6: CLI command to manually compress memory
 */
export async function compressMemoryCommand(options: {
  sessionId?: string;
  dryRun?: boolean;
  verbose?: boolean;
}) {
  const compactor = getProgressiveCompactor();

  logger.info('Starting memory compression...');

  if (options.sessionId) {
    // Compress specific session
    // const messages = await loadMessages(options.sessionId);
    // const result = await compactor.compact(messages, messages.length);

    if (options.verbose) {
      console.log('Compression result:');
      console.log(`  Original: ${result.originalTokens} tokens`);
      console.log(`  Compressed: ${result.compactedTokens} tokens`);
      console.log(`  Ratio: ${(result.ratio * 100).toFixed(1)}%`);
      console.log('\nBy zone:');

      for (const [zone, stats] of Object.entries(result.byZone)) {
        if (stats.count > 0) {
          console.log(`  ${zone}: ${stats.count} messages, ${stats.originalTokens} → ${stats.compactedTokens} tokens`);
        }
      }
    }

    if (!options.dryRun) {
      // await saveCompactedMessages(options.sessionId, result.messages);
      console.log('Memory compressed and saved');
    } else {
      console.log('Dry run - no changes saved');
    }
  } else {
    // Compress all sessions
    console.log('Compressing all sessions...');

    // const sessions = await getAllSessions();
    // let totalSaved = 0;

    // for (const session of sessions) {
    //   const messages = await loadMessages(session.id);
    //   const result = await compactor.compact(messages, messages.length);
    //
    //   if (!options.dryRun) {
    //     await saveCompactedMessages(session.id, result.messages);
    //   }
    //
    //   totalSaved += result.originalTokens - result.compactedTokens;
    // }

    // console.log(`Total tokens saved: ${totalSaved}`);
  }
}
