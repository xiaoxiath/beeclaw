/**
 * Session Manager
 *
 * Manages conversation sessions with:
 * - Persistence to disk (survives restarts)
 * - History loading (continue previous conversations)
 * - Context compression (handle long conversations)
 * - Auto knowledge extraction
 *
 * Submodules:
 * - dedup.ts: Message deduplication (three-state processing)
 * - storage.ts: Session persistence (JSON + SQLite dual-mode)
 * - proactive-messaging.ts: Proactive result injection & history retrieval
 */

import { existsSync, mkdirSync } from 'fs';
import type { ChatMessage, MultimodalContent } from '../agent/types';
import { DEFAULT_VISION_CONFIG } from '../agent/types';
import { createAgent, SYSTEM_PROMPTS, getAllToolsForAI, buildSystemPrompt, formatSkillsForPrompt, type TokenStatsConfig } from '../agent';
import { getBeeAIClient, toProviderConfig } from '../../infra/bee-adapter';
import { getFastModelFromConfig } from '../agent/fast-llm-judge';
import { getMemoryStore } from '../memory';
import { getSkillStore } from '../skills/store';
import { setDeepAnalysisContext, clearDeepAnalysisContext } from '../tools/deep-analysis';
import type { AIProvider, ExtractionConfigSchemaType } from '../../infra/config/schema';
import {
  initExtractionManager,
  getExtractionManager,
  resetExtractionManager,
  type ExtractionManager,
} from '../extraction';
// [CR-Layer] Domain ports replace direct adapter imports
import { getHookRunnerPort, getChannelClientPort, getMessageControllerFactory } from '../ports';
import type { IMessageController } from '../ports';
import { logger } from '../../infra/observability/logger';
import { SessionMessageQueue } from '../../infra/resilience/session-lock';
import type { SessionMessageQueueOptions } from '../../infra/resilience/session-lock';
import { SmartTimeout } from '../../infra/resilience/smart-timeout';
import { handleHITLResponse } from './hitl-manager';
import { resolveConfig, type ResilienceConfig } from '../../infra/config/resilience-config';

// --- Submodule imports ---
import {
  pruneProcessedMessages as _pruneProcessedMessages,
  isMessageProcessed as _isMessageProcessed,
  getMessageState as _getMessageState,
  markMessageProcessing as _markMessageProcessing,
  markMessageProcessed as _markMessageProcessed,
  markMessageCompleted as _markMessageCompleted,
  markMessageFailed as _markMessageFailed,
  getCachedAgentResponse as _getCachedAgentResponse,
} from './dedup';
import {
  saveSession as _saveSessionToStorage,
  loadSession as _loadSession,
  deleteSessionFile as _deleteSessionFile,
  loadAllSessions as _loadAllSessionsFromStorage,
  clearOldSessions as _clearOldSessions,
  saveAllSessions as _saveAllSessions,
} from './storage';
import {
  injectProactiveResult as _injectProactiveResult,
  getRecentSessionHistory as _getRecentSessionHistory,
} from './proactive-messaging';

// --- Re-export submodule public APIs ---
export {
  MESSAGE_DEDUP_TTL_MS,
  MESSAGE_DEDUP_MAX_SIZE,
  MAX_MESSAGE_RETRY_COUNT,
  PROCESSING_STALE_TIMEOUT_MS,
} from './dedup';

// Re-export types and functions from storage that external consumers might need
export { isValidSession } from './storage';

export interface SessionOptions {
  sessionId: string;
  userId?: string;
  channel: 'cli' | 'feishu' | 'webhook' | 'api' | 'web';
  metadata?: Record<string, unknown>;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  /** [AUDIT FIX M-03] Metadata for multimodal and source tracking */
  _meta?: {
    /** Original content type before text conversion */
    originalType?: 'text' | 'multimodal';
    /** Vision model description (from two-stage processing) */
    visionDescription?: string;
    /** Message source for context-aware processing */
    source?: 'user' | 'proactive' | 'recovery' | 'system';
  };
}

/**
 * Three-state message processing for Feishu duplicate message protection.
 *
 * States:
 * - 'processing': Agent is actively working on this message (set before execution)
 * - 'completed':  Reply delivered successfully (set after delivery)
 * - 'failed':     Processing or delivery failed (allows bounded retry)
 *
 * This prevents the race window between isMessageProcessed() check and
 * markMessageProcessed() call, where Feishu re-delivery during Agent
 * execution would bypass dedup.
 */
export interface MessageProcessingState {
  status: 'processing' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  failedAt?: number;
  retryCount: number;
  /** Cached agent response for delivery-only retry (avoids re-executing Agent) */
  cachedResponse?: string;
  /** Whether Card V2 was used for this message */
  cachedUsedCardV2?: boolean;
  /** Error message if failed */
  error?: string;
}

export interface Session {
  id: string;
  userId: string;
  channel: string;
  messages: SessionMessage[];
  summary?: string; // Compressed summary of old messages
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  pendingRecovery?: boolean; // Mark session for recovery if bot restarts
  responseDelivered?: boolean; // Mark if response was successfully sent to user
  pendingDelivery?: boolean; // True after AI response is generated but BEFORE it's delivered to the channel
  recoveryAttempts?: number; // Number of recovery attempts for the current pending message
  lastRecoveryAt?: string; // Timestamp of the last recovery attempt
  lastAiResponse?: string; // Cached AI response for re-delivery
  /** Source of the last user message (user, proactive, recovery, system) */
  lastMessageSource?: string;
  /** Consecutive recovery failure count for exponential backoff */
  consecutiveRecoveryFailures?: number;
  /**
   * Three-state message processing map for robust Feishu deduplication.
   * Key: messageId, Value: MessageProcessingState
   *
   * Handles: duplicate pushes, process restarts, delivery failures.
   * See MessageProcessingState for state machine documentation.
   */
  processedMessageIds?: Record<string, boolean | MessageProcessingState>;
}

export interface ProactiveMessageOptions {
  userId?: string;
  channel?: 'cli' | 'feishu' | 'webhook' | 'api' | 'web';
  message: string | MultimodalContent[];  // Support both text and multimodal
  context?: Record<string, unknown>;
  sessionId?: string;
  /** [AUDIT FIX M-06] Override agent options (e.g., blockedTools for proactive tasks) */
  agentOptions?: {
    blockedTools?: string[];
  };
}

export interface ProactiveMessageResult {
  success: boolean;
  sessionId?: string;
  response?: string;
  error?: string;
  usedCardV2?: boolean; // Whether Card V2 was used for response
}

// Configuration
interface SessionConfig {
  storagePath: string;
  maxMessages: number; // Max messages before compression
  keepRecent: number;  // Keep this many recent messages when compressing
}

let sessionConfig: SessionConfig = {
  storagePath: './data/memory/sessions',
  maxMessages: 20,
  keepRecent: 6,
};

/** Maximum recovery attempts before marking a message as "poison" */
export const MAX_RECOVERY_ATTEMPTS = 3;

// Active sessions cache
const sessions: Map<string, Session> = new Map();

// Agent configuration
let agentConfig: {
  provider: AIProvider;
  model: string;
  systemPrompt?: string;
  useTools?: boolean;
  tokenStatsConfig?: Partial<TokenStatsConfig>;
  extractionConfig?: Partial<ExtractionConfigSchemaType>;
  memoryDir?: string;
  visionConfig?: {
    visionModel?: string;
    textModel?: string;
    visionSystemPrompt?: string;
    fallbackOnError?: 'description' | 'placeholder' | 'retry';
    maxRetries?: number;
  };
  params?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    top_k?: number;
    do_sample?: boolean;
    stream?: boolean;
    thinking?: { type: 'enabled' | 'disabled' };
    [key: string]: any;
  };
  resilienceConfig?: ResilienceConfig;
  feishuConfig?: {
    useCardV2?: boolean;
    [key: string]: any;
  };
} | null = null;

// Channel handlers
const channelHandlers: Map<string, (sessionId: string, message: string) => Promise<void>> = new Map();

// [PERF OPT] Track ongoing compression to prevent duplicates
const compressionLocks: Map<string, Promise<void>> = new Map();

// ============================================================================
// Thin wrappers: bridge session-ID-based public API → submodule functions
// ============================================================================

/**
 * Save session to disk (delegates to storage submodule)
 */
export function saveSession(session: Session): void {
  _saveSessionToStorage(session, sessionConfig.storagePath);
}

/**
 * Load session from disk (private, delegates to storage submodule)
 */
function loadSession(sessionId: string): Session | null {
  return _loadSession(sessionId, sessionConfig.storagePath);
}

// --- Dedup wrappers (preserve original session-ID-based API) ---

export function pruneProcessedMessages(session: Session): number {
  return _pruneProcessedMessages(session);
}

export function isMessageProcessed(sessionId: string, messageId: string): boolean {
  const session = sessions.get(sessionId);
  return _isMessageProcessed(session, messageId);
}

export function getMessageState(sessionId: string, messageId: string): MessageProcessingState | null {
  const session = sessions.get(sessionId);
  return _getMessageState(session, messageId);
}

export function markMessageProcessing(sessionId: string, messageId: string): void {
  const session = sessions.get(sessionId);
  _markMessageProcessing(session, messageId, saveSession);
}

/**
 * @deprecated Use markMessageCompleted() for new code.
 */
export function markMessageProcessed(sessionId: string, messageId: string): void {
  const session = sessions.get(sessionId);
  _markMessageProcessed(session, messageId, saveSession);
}

export function markMessageCompleted(
  sessionId: string,
  messageId: string,
  response?: string,
  usedCardV2?: boolean,
): void {
  const session = sessions.get(sessionId);
  _markMessageCompleted(session, messageId, saveSession, response, usedCardV2);
}

export function markMessageFailed(
  sessionId: string,
  messageId: string,
  error: string,
  cachedResponse?: string,
  cachedUsedCardV2?: boolean,
): void {
  const session = sessions.get(sessionId);
  _markMessageFailed(session, messageId, error, saveSession, cachedResponse, cachedUsedCardV2);
}

export function getCachedAgentResponse(sessionId: string, messageId: string): { response: string; usedCardV2: boolean } | null {
  const session = sessions.get(sessionId);
  return _getCachedAgentResponse(session, messageId);
}

// --- Proactive messaging wrappers ---

/**
 * [AUDIT FIX M-02] Inject proactive task result into a user's active session.
 */
export function injectProactiveResult(
  targetSessionId: string,
  result: { source: string; content: string; timestamp?: number },
): boolean {
  const session = sessions.get(targetSessionId);
  return _injectProactiveResult(session, result, saveSession);
}

/**
 * [AUDIT FIX M-02] Load recent conversation history for a session.
 */
export function getRecentSessionHistory(
  sessionId: string,
  maxMessages: number = 10,
): SessionMessage[] {
  const session = sessions.get(sessionId) || loadSession(sessionId);
  return _getRecentSessionHistory(session, maxMessages);
}

// --- Storage wrappers ---

export function loadAllSessions(): number {
  return _loadAllSessionsFromStorage(sessionConfig.storagePath, sessions);
}

export function clearOldSessions(daysOld: number = 30): number {
  return _clearOldSessions(sessions, deleteSession, daysOld);
}

export function saveAllSessions(): void {
  _saveAllSessions(sessions, saveSession);
}

// ============================================================================
// Core session management (remains in index.ts)
// ============================================================================

/**
 * Configure session manager
 */
export function configureSessionManager(config: Partial<SessionConfig>): void {
  sessionConfig = { ...sessionConfig, ...config };

  // Ensure storage directory exists
  if (!existsSync(sessionConfig.storagePath)) {
    mkdirSync(sessionConfig.storagePath, { recursive: true });
  }
}

/**
 * Initialize the session manager with agent configuration
 */
export function initSessionManager(config: {
  provider: AIProvider;
  model: string;
  systemPrompt?: string;
  useTools?: boolean;
  tokenStatsConfig?: Partial<TokenStatsConfig>;
  extractionConfig?: Partial<ExtractionConfigSchemaType>;
  memoryDir?: string;
  visionConfig?: {
    visionModel?: string;
    textModel?: string;
    visionSystemPrompt?: string;
    fallbackOnError?: 'description' | 'placeholder' | 'retry';
    maxRetries?: number;
  };
  /** Resolved model parameters from three-layer configuration */
  params?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    top_k?: number;
    do_sample?: boolean;
    stream?: boolean;
    thinking?: { type: 'enabled' | 'disabled' };
    [key: string]: any;
  };
  /** Resilience configuration for timeout alignment */
  resilienceConfig?: ResilienceConfig;
  /** Feishu-specific config injected from app layer (eliminates reverse dependency) */
  feishuConfig?: {
    useCardV2?: boolean;
    [key: string]: any;
  };
}): void {
  agentConfig = config;

  // Ensure storage directory exists
  if (!existsSync(sessionConfig.storagePath)) {
    mkdirSync(sessionConfig.storagePath, { recursive: true });
  }

  // Configure SessionMessageQueue with timeout aligned to resilience config
  // IMPORTANT: maxWaitTime must be >= turn timeout to prevent messages from expiring
  // while agent is processing long-running tasks
  const resilience = config.resilienceConfig || resolveConfig('standard');
  const queueOptions: SessionMessageQueueOptions = {
    maxQueueDepth: 10,
    maxWaitTime: Math.max(
      resilience.timeout.turnTimeoutMs + 60000, // Add 1 minute buffer
      600000 // At least 10 minutes
    ),
  };

  // Reset and reinitialize the queue with correct timeout
  SessionMessageQueue.resetInstance();
  SessionMessageQueue.getInstance(queueOptions);

  logger.info(
    `[SessionManager] Queue configured with maxWaitTime: ${Math.round((queueOptions.maxWaitTime ?? 0) / 1000)}s ` +
    `(turn timeout: ${Math.round(resilience.timeout.turnTimeoutMs / 1000)}s)`
  );

  // Initialize extraction manager
  if (config.extractionConfig?.enabled !== false) {
    try {
      initExtractionManager(
        config.provider,
        config.model,
        config.memoryDir || './data/memory',
        config.extractionConfig || {}
      );
      logger.info('[Session] Extraction manager initialized');
    } catch (error) {
      logger.error('[Session] Failed to initialize extraction manager:', error);
    }
  }
}

/**
 * Clear recovery flag after response is delivered
 */
export function clearRecoveryFlag(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.pendingRecovery = false;
    session.responseDelivered = true;
    session.updatedAt = new Date().toISOString();
    saveSession(session);
    logger.info(`[Session] 📤 Response delivered, recovery flag cleared for ${sessionId}`);
  }
}

/**
 * Confirm that a message has been successfully delivered to the channel.
 */
export function confirmDelivery(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.pendingRecovery = false;
    session.pendingDelivery = false;
    session.lastAiResponse = undefined; // CRITICAL: Clear cached response after successful delivery
    session.recoveryAttempts = 0;
    session.lastRecoveryAt = undefined;
    session.consecutiveRecoveryFailures = 0;
    session.responseDelivered = true;
    session.updatedAt = new Date().toISOString();
    saveSession(session);
    logger.info(`[Session] Delivery confirmed for session ${sessionId}`);
  }
}

/**
 * Calculate exponential backoff delay for recovery attempts.
 * Returns delay in ms, or -1 if max attempts exceeded.
 *
 * Backoff schedule: 1s, 4s, 16s, 64s, 256s (5 attempts max)
 */
export function calculateRecoveryBackoff(sessionId: string): number {
  const session = sessions.get(sessionId);
  if (!session) return -1;

  const failures = session.consecutiveRecoveryFailures || 0;
  const MAX_FAILURES = 5;

  if (failures >= MAX_FAILURES) {
    logger.warn(`[Session] Recovery permanently failed for ${sessionId} after ${failures} attempts`);
    return -1;
  }

  session.consecutiveRecoveryFailures = failures + 1;
  session.lastRecoveryAt = new Date().toISOString();
  session.updatedAt = new Date().toISOString();
  saveSession(session);

  const delayMs = 1000 * Math.pow(4, failures); // 1s, 4s, 16s, 64s, 256s
  logger.debug(`[Session] Recovery backoff for ${sessionId}: attempt ${failures + 1}/${MAX_FAILURES}, delay ${delayMs}ms`);
  return delayMs;
}

/**
 * Get a summary of recent session messages for proactive task context injection.
 */
export function getSessionSummary(
  sessionId: string,
  maxMessages: number = 5,
  requesterId?: string
): string {
  const session = sessions.get(sessionId) || loadSession(sessionId);
  if (!session || session.messages.length === 0) return '';

  // [AUDIT FIX P-3] Permission check: verify requester has access to this session
  if (requesterId && session.userId && requesterId !== session.userId) {
    logger.warn(
      `[Session] Access denied: user ${requesterId} cannot access session ${sessionId} ` +
      `(owner: ${session.userId})`
    );
    return '';
  }

  const recent = session.messages.slice(-maxMessages);
  return recent
    .map(m => `[${m.role}] ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`)
    .join('\n');
}

/**
 * Mark response as delivered to user (for tracking purposes)
 */
export function markResponseDelivered(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.responseDelivered = true;
    session.updatedAt = new Date().toISOString();
    saveSession(session);
    logger.info(`[Session] 📤 Response delivered to user for ${sessionId}`);
  }
}

/**
 * Register a channel handler for proactive messaging
 */
export function registerChannelHandler(
  channel: string,
  handler: (sessionId: string, message: string) => Promise<void>
): void {
  channelHandlers.set(channel, handler);
}

/**
 * Compress old messages into a summary
 *
 * [PERF OPT] Optimized to use fast model + direct API call
 */
async function compressMessages(
  messages: SessionMessage[],
  keepRecent: number
): Promise<{ summary: string; recentMessages: SessionMessage[] }> {
  if (!agentConfig) {
    return { summary: '', recentMessages: messages.slice(-keepRecent) };
  }

  // [BUG FIX] Ensure no overlap between old and recent messages
  const splitIndex = Math.max(0, messages.length - keepRecent);
  const oldMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  logger.debug('[Session] 📊 Compression split:', {
    total: messages.length,
    oldMessages: oldMessages.length,
    recentMessages: recentMessages.length,
    splitIndex,
    keepRecent,
  });

  if (oldMessages.length === 0) {
    return { summary: '', recentMessages };
  }

  // Build conversation text for summarization
  const conversationText = oldMessages
    .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');

  try {
    // [PERF OPT] Use fast model + direct API call instead of Agent
    const fastModelConfig = getFastModelFromConfig();
    const compressionModel = fastModelConfig?.model || agentConfig.model;
    const compressionMaxTokens = fastModelConfig?.maxTokens || 200;

    logger.info(`[Session] 🗜️ Compressing ${oldMessages.length} messages using ${compressionModel}...`);

    const response = await getBeeAIClient().callAI({
      provider: toProviderConfig(agentConfig.provider),
      model: compressionModel,
      messages: [
        {
          role: 'system',
          content: '你是一个对话摘要助手。请用简洁的中文总结以下对话的关键信息，包括：讨论的主题、用户的需求、重要的结论或决定。控制在100字以内。',
        },
        {
          role: 'user',
          content: `请总结以下对话：\n\n${conversationText}`,
        },
      ],
      maxTokens: compressionMaxTokens,
      temperature: 0.3,
    });

    const summary = response.choices?.[0]?.message?.content || '';

    if (summary) {
      logger.info(`[Session] ✅ Compressed ${oldMessages.length} messages into ${summary.length} chars summary`);
    } else {
      logger.warn('[Session] ⚠️ Compression returned empty summary');
    }

    return { summary, recentMessages };
  } catch (error) {
    logger.error('[Session] ❌ Failed to compress messages:', error);
    return { summary: '', recentMessages: messages };
  }
}

/**
 * Create or get a session (with persistence)
 */
export function getOrCreateSession(options: SessionOptions): Session {
  // Check memory cache first
  const cached = sessions.get(options.sessionId);
  if (cached) {
    cached.updatedAt = new Date().toISOString();
    return cached;
  }

  // Try to load from disk
  const loaded = loadSession(options.sessionId);
  if (loaded) {
    sessions.set(options.sessionId, loaded);
    logger.info('[Session] Loaded from disk:', options.sessionId, `(${loaded.messages.length} messages)`);
    pruneProcessedMessages(loaded);
    return loaded;
  }

  // Create new session
  const session: Session = {
    id: options.sessionId,
    userId: options.userId || 'default-user',
    channel: options.channel,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: options.metadata,
  };

  sessions.set(options.sessionId, session);
  saveSession(session);

  // Trigger session_start hook (async, fire-and-forget)
  try {
    const hookRunner = getHookRunnerPort();
    if (hookRunner) {
      Promise.resolve().then(() => {
        hookRunner.runSessionStart({
          sessionId: session.id,
          userId: session.userId,
          channel: session.channel,
          metadata: session.metadata,
          timestamp: session.createdAt,
        });
      });
    }
  } catch {
    // Plugin system not initialized, ignore
  }

  return session;
}

/**
 * Get a session by ID
 */
export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

/**
 * List all active sessions
 */
export function listSessions(filter?: { channel?: string; userId?: string }): Session[] {
  const all = Array.from(sessions.values());

  if (!filter) return all;

  return all.filter(s => {
    if (filter.channel && s.channel !== filter.channel) return false;
    if (filter.userId && s.userId !== filter.userId) return false;
    return true;
  });
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);

  if (session) {
    // Trigger session_end hook before deletion (async, fire-and-forget)
    try {
      const hookRunner = getHookRunnerPort();
      if (hookRunner) {
        Promise.resolve().then(() => {
          hookRunner.runSessionEnd({
            sessionId: session.id,
            userId: session.userId,
            channel: session.channel,
            messageCount: session.messages.length,
            createdAt: session.createdAt,
            endedAt: new Date().toISOString(),
            timestamp: new Date().toISOString(),
          });
        });
      }
    } catch (error) {
      logger.debug('Plugin system not initialized:', error);
    }
  }

  _deleteSessionFile(sessionId, sessionConfig.storagePath);
  return sessions.delete(sessionId);
}

/**
 * Generate a consistent session ID for a channel user
 */
export function generateSessionId(channel: string, ...identifiers: string[]): string {
  return `${channel}-${identifiers.join('-')}`;
}

/**
 * Send a proactive message (with concurrency control)
 */
export async function sendProactiveMessage(options: ProactiveMessageOptions): Promise<ProactiveMessageResult> {
  // BUG #1 FIX: Use per-session queue to prevent concurrent processing of same session
  const queue = SessionMessageQueue.getInstance();
  const sessionId = options.sessionId || `proactive-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return queue.enqueue(sessionId, () => _sendProactiveMessageInternal(options));
}

/**
 * Internal implementation of proactive message sending
 */
async function _sendProactiveMessageInternal(options: ProactiveMessageOptions): Promise<ProactiveMessageResult> {
  if (!agentConfig) {
    return { success: false, error: 'Session manager not initialized' };
  }

  const channel = options.channel || 'cli';
  const sessionId = options.sessionId || `proactive-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // [PERF OPT] 提前创建 streaming controller，立即显示"正在思考..."
  // TODO: [CR-Layer] StreamingMessageController is still accessed via dynamic import for deep Feishu integration
  // Full port abstraction would require significant refactoring of the streaming protocol
  let streamingController: IMessageController | null = null;

  try {
    const feishuConfig = agentConfig?.feishuConfig;
    const useCardV2 = feishuConfig?.useCardV2 ?? false;

    // Card V2 requires either parentMessageId (reply mode) or chatId (proactive mode)
    const hasChatId = !!options.context?.chatId;
    const canUseCardV2 = channel === 'feishu' && useCardV2 && hasChatId;

    if (canUseCardV2) {
      const controllerFactory = getMessageControllerFactory();
      const channelClient = getChannelClientPort();

      if (controllerFactory && channelClient) {
        streamingController = controllerFactory({
          client: channelClient,
          parentMessageId: options.context?.parentMessageId as string | undefined,
          chatId: (options.context?.chatId as string) || '',
          debounceMs: 500,
        });

        // 【参考 agentara】立即发送初始 Card，显示 "Thinking..." 占位符
        await streamingController.pushContent({
          type: 'thinking',
          thinking: 'Thinking...',
        });
        logger.info('[Session] ⚡ Card V2 initialized with early "Thinking..." placeholder', {
          mode: options.context?.parentMessageId ? 'reply' : 'proactive',
        });
      }
    }
  } catch (error) {
    logger.warn('[Session] Failed to create streaming controller:', error);
  }

  try {
    // Create or load session
    const session = getOrCreateSession({
      sessionId,
      userId: options.userId || 'proactive-user',
      channel,
      metadata: options.context,
    });

    // Set deep analysis context for tools that need it
    const chatId = (options.context?.chatId as string) || '';
    const messageId = (options.context?.messageId as string) || '';
    const openId = (options.context?.openId as string) || options.userId || '';
    const messageString = typeof options.message === 'string'
      ? options.message
      : '[Multimodal message]';
    setDeepAnalysisContext({
      sessionId,
      userId: options.userId || 'proactive-user',
      chatId,
      originalMessage: messageString,
    });

    // [SAFETY] Await any in-progress compression before processing new message
    const pendingCompression = compressionLocks.get(sessionId);
    if (pendingCompression) {
      await pendingCompression;
      compressionLocks.delete(sessionId);
    }

    // [PERF OPT] Async compression - don't block user message processing
    if (session.messages.length >= sessionConfig.maxMessages) {
      if (compressionLocks.has(sessionId)) {
        logger.debug(`[Session] ⏭️ Compression already in progress for ${sessionId}, skipping`);
      } else {
        const compressionPromise = (async () => {
          try {
            logger.info(`[Session] 🗜️ Starting background compression for ${sessionId} (${session.messages.length} messages)`);

            const messageCountAtStart = session.messages.length;

            const { summary, recentMessages } = await compressMessages(
              session.messages,
              sessionConfig.keepRecent
            );

            const latestSession = sessions.get(sessionId) || loadSession(sessionId);
            if (!latestSession) {
              logger.warn(`[Session] Session ${sessionId} disappeared during compression`);
              return;
            }

            latestSession.summary = summary;

            logger.debug('[Session] 📝 Updated summary:', {
              summaryLength: summary.length,
              summaryPreview: summary.substring(0, 100) + '...',
              recentMessagesKept: recentMessages.length,
            });

            const newMessagesDuringCompression = latestSession.messages.slice(messageCountAtStart);
            latestSession.messages = [...recentMessages, ...newMessagesDuringCompression];
            latestSession.updatedAt = new Date().toISOString();

            saveSession(latestSession);
            sessions.set(sessionId, latestSession);

            logger.info(`[Session] ✅ Background compression completed for ${sessionId}`);
          } catch (error) {
            logger.error(`[Session] ❌ Background compression failed for ${sessionId}:`, error);
          } finally {
            compressionLocks.delete(sessionId);
          }
        })();

        compressionLocks.set(sessionId, compressionPromise);
      }
    }

    // Build system prompt with core memory
    let systemPrompt = agentConfig.systemPrompt || SYSTEM_PROMPTS.default;

    // Add conversation summary if exists
    if (session.summary) {
      logger.debug('[Session] ⚠️ Adding summary to system prompt:', {
        summaryLength: session.summary.length,
        summaryPreview: session.summary.substring(0, 100) + '...',
        messageCount: session.messages.length,
        recentMessages: session.messages.slice(-3).map(m => ({
          role: m.role,
          contentPreview: m.content.substring(0, 50),
        })),
      });

      systemPrompt += `\n\n## 历史对话摘要\n${session.summary}`;
    }

    // [AUDIT FIX M-05] Consume lastMessageSource for context-aware behavior
    if (session.lastMessageSource === 'proactive') {
      systemPrompt += '\n\n注意：上一条消息来自定时主动任务的执行结果。如果用户提问与之相关，请引用该信息。';
    } else if (session.lastMessageSource === 'recovery') {
      systemPrompt += '\n\n注意：此回复为崩溃恢复后的重新处理，请确保回复完整准确。';
    }

    try {
      const memoryStore = getMemoryStore();
      const coreContext = memoryStore.getCoreContext();

      // Add available skills to context (OpenClaw-style)
      let skillsPrompt = '';
      try {
        const skillStore = getSkillStore();
        const skills = skillStore.list();
        if (skills.length > 0) {
          skillsPrompt = formatSkillsForPrompt(
            skills.map(s => ({
              name: s.name,
              description: s.description,
              triggers: s.triggers,
            }))
          );
        }
      } catch (error) {
        logger.debug('SkillStore not initialized:', error);
      }

      systemPrompt = buildSystemPrompt(systemPrompt, {
        ...coreContext,
        skills: skillsPrompt,
      });
    } catch (error) {
      logger.debug('Memory store not initialized:', error);
    }

    // [AUDIT FIX M-03] Configurable two-stage vision processing
    // DEFAULT_VISION_CONFIG is statically imported at the top

    const visionConfig = {
      ...DEFAULT_VISION_CONFIG,
      textModel: agentConfig.model,
      ...(agentConfig.visionConfig || {}),
    };

    let selectedModel = agentConfig.model;
    const selectedProvider = agentConfig.provider;
    let imageDescription: string | undefined;
    let originalMultimodalMessage: MultimodalContent[] | undefined;

    const hasMultimodalContent = Array.isArray(options.message) &&
      options.message.some(part => part.type === 'image_url');

    if (hasMultimodalContent) {
      // STAGE 1: Pure vision recognition
      logger.info(`[Session] 🖼️ Stage 1: Vision recognition using ${visionConfig.visionModel}`);

      let retries = 0;
      while (retries <= visionConfig.maxRetries) {
        try {
          const visionAgent = createAgent({
            provider: selectedProvider,
            model: visionConfig.visionModel,
            systemPrompt: visionConfig.visionSystemPrompt,
            tools: undefined,
            loadCoreMemory: false,
          });

          imageDescription = await visionAgent.chat(options.message);
          logger.debug('[Session] 📝 Vision result:', imageDescription?.substring(0, 100));
          break;
        } catch (error) {
          retries++;
          logger.error(`[Session] Vision model attempt ${retries} failed:`, error instanceof Error ? error.message : error);
          if (retries > visionConfig.maxRetries) {
            if (visionConfig.fallbackOnError === 'placeholder') {
              imageDescription = '[图片识别失败 - 视觉模型不可用]';
            } else if (visionConfig.fallbackOnError === 'description') {
              imageDescription = '[图片] 无法识别内容，请用文字描述图片中的内容。';
            }
            logger.error('[Session] Vision processing exhausted retries, using fallback');
          }
        }
      }

      originalMultimodalMessage = Array.isArray(options.message) ? options.message : undefined;

      // STAGE 2: Intent detection with text model
      selectedModel = visionConfig.textModel;
      options.message = imageDescription || '[图片识别失败]';
      logger.info(`[Session] 🧠 Stage 2: Intent detection with ${selectedModel}`);
    } else {
      selectedModel = agentConfig.model;
      logger.info(`[Session] 📝 Using text model (${selectedModel}) for text message`);
    }

    // Check if this is a recovery - don't duplicate the user message
    const isRecovery = options.context?.isRecovery === true;

    // Create agent
    const agent = createAgent({
      provider: selectedProvider,
      model: selectedModel,
      systemPrompt,
      tools: agentConfig.useTools ? getAllToolsForAI() : undefined,
      loadCoreMemory: false,
      autoRefreshMemory: true,
      tokenStatsConfig: agentConfig.tokenStatsConfig,
      params: agentConfig.params,
      ...(options.agentOptions?.blockedTools ? { blockedTools: options.agentOptions.blockedTools } : {}),
    });

    // Replay conversation history
    logger.debug('[Session] ⚠️ Replaying conversation history:', {
      messageCount: session.messages.length,
      messages: session.messages.map(m => ({
        role: m.role,
        contentPreview: m.content.substring(0, 50),
        hasSummary: !!session.summary,
      })),
    });

    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      if (msg.role === 'user') {
        if (msg._meta?.originalType === 'multimodal' && msg._meta.visionDescription) {
          agent.addMessage({
            role: 'user',
            content: `[用户发送了图片，以下是图片内容描述] ${msg._meta.visionDescription}` +
              (msg.content.includes('[图片]') ? '' : `\n用户附言: ${msg.content}`),
          });
        } else {
          agent.addMessage({ role: 'user', content: msg.content });
        }
      } else if (msg.role === 'assistant') {
        agent.addMessage({ role: 'assistant', content: msg.content });
      }
    }

    // Prepare user message content
    let userContentString: string;

    if (isRecovery) {
      const lastUserMessage = session.messages[session.messages.length - 1];
      userContentString = lastUserMessage?.content || '';
      logger.debug('[Session] 🔄 Recovery mode - skipping user message save');
    } else if (originalMultimodalMessage) {
      const textPart = originalMultimodalMessage.find(p => p.type === 'text');
      const userText = textPart && 'text' in textPart ? textPart.text : '';
      userContentString = `[图片] ${userText || '(图片)'} [处理中...]`;
    } else if (typeof options.message === 'string') {
      userContentString = options.message;
    } else if (Array.isArray(options.message)) {
      const textPart = options.message.find(p => p.type === 'text');
      const userText = textPart && 'text' in textPart ? textPart.text : '';
      userContentString = userText || '[Multimodal message]';
    } else {
      userContentString = 'unknown';
    }

    // Check for HITL recovery BEFORE processing new message
    const hitlResult = await handleHITLResponse(sessionId, userContentString);

    if (hitlResult !== null) {
      logger.info('[Session] 🔄 HITL response detected, resuming conversation');
      return {
        success: true,
        response: hitlResult,
        usedCardV2: (session.metadata as any)?.usedCardV2 || false,
      };
    }

    // Save user message immediately (before AI processing)
    if (!isRecovery) {
      session.messages.push({
        role: 'user',
        content: userContentString,
        timestamp: new Date().toISOString(),
        _meta: originalMultimodalMessage ? {
          originalType: 'multimodal',
          visionDescription: imageDescription,
          source: (options.context?.source as 'user' | 'proactive' | 'recovery' | 'system') || 'user',
        } : {
          originalType: 'text',
          source: (options.context?.source as 'user' | 'proactive' | 'recovery' | 'system') || 'user',
        },
      });
      session.pendingRecovery = true;
      session.lastMessageSource = (options.context?.source as string || 'user');
      session.updatedAt = new Date().toISOString();
      saveSession(session);

      logger.debug('[Session] 📨 User message saved (recovery-ready)');
    } else {
      session.pendingRecovery = true;
      session.updatedAt = new Date().toISOString();
      saveSession(session);

      logger.debug('[Session] 🔄 Recovery mode - using existing user message');
    }

    // Get response with smart timeout
    let response: string | undefined;
    let timeoutError: Error | undefined;

    const smartTimeout = new SmartTimeout({
      inactivityTimeoutMs: parseInt(
        process.env.AGENT_INACTIVITY_TIMEOUT_MS || '600000',
        10
      ),
      checkIntervalMs: 30000,
      onTimeout: (inactiveMs) => {
        const stats = smartTimeout.getMonitor().getStats();
        logger.error(
          `[Session] Agent inactive for ${Math.round(inactiveMs / 1000)}s\n` +
          `  Total runtime: ${Math.round(smartTimeout.getRuntimeMs() / 1000)}s\n` +
          `  Total events: ${stats.totalEvents}\n` +
          `  Last activity: ${stats.lastActivity.toLocaleTimeString()}`
        );

        timeoutError = new Error(
          `Agent 无活动超时（${Math.round(inactiveMs / 1000)}秒无响应）`
        );
      },
      onActivity: (type, details) => {
        if (
          process.env.DEBUG_SESSION_ACTIVITY === 'true' &&
          (type === 'tool_call' || type === 'subagent')
        ) {
          logger.debug(`[Session] Agent activity: ${type}${details ? ` (${details})` : ''}`);
        }
      },
    });

    smartTimeout.start();

    try {
      const messageForAgent = isRecovery ? userContentString : options.message;

      const userContextForTools = {
        openId,
        chatId,
        messageId,
        userId: options.userId,
        sessionId,
      };

      const chatPromise = agent.chat(messageForAgent, {
        onContentBlock: (block: any) => {
          logger.debug('[Session] 📦 Received content block:', JSON.stringify(block, null, 2));
          streamingController?.pushContent(block).catch((err: any) => {
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (!errorMsg.includes('withdrawn')) {
              logger.warn('[Session] Failed to push content block:', errorMsg);
            }
          });
        },
        userContext: userContextForTools,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        const checkInterval = setInterval(() => {
          if (timeoutError) {
            clearInterval(checkInterval);
            reject(timeoutError);
          }
        }, 1000);
      });

      response = await Promise.race([chatPromise, timeoutPromise]);

      // Finish streaming controller
      if (streamingController) {
        try {
          await streamingController.finish();
          logger.info('[Session] ✅ Card V2 streaming completed');
        } catch (error) {
          logger.warn('[Session] Failed to finish streaming:', error);
        }
      }

      smartTimeout.recordActivity('progress', 'response completed');

      const runtime = Math.round(smartTimeout.getRuntimeMs() / 1000);
      if (runtime > 30) {
        logger.info(
          `[Session] Agent completed in ${runtime}s\n` +
          smartTimeout.getMonitor().formatReport()
        );
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (streamingController) {
        try {
          await streamingController.finish();
        } catch (streamError) {
          logger.warn('[Session] Failed to finish streaming on error:', streamError);
        }
      }

      if (timeoutError) {
        return {
          success: false,
          error: `AI 长时间无响应，可能遇到了问题。请稍后重试或简化任务。\n\n${errorMsg}`
        };
      } else {
        throw error;
      }
    } finally {
      smartTimeout.stop();
    }

    // Validate response
    if (!response || response.trim().length === 0) {
      logger.error('[Session] Agent returned empty response');
      return { success: false, error: 'AI 返回了空响应' };
    }

    // Update messages with final content
    let assistantContentString: string;

    if (originalMultimodalMessage && imageDescription) {
      const textPart = originalMultimodalMessage.find(p => p.type === 'text');
      const userText = textPart && 'text' in textPart ? textPart.text : '';

      const lastUserMessage = session.messages[session.messages.length - 1];
      if (lastUserMessage && lastUserMessage.role === 'user') {
        lastUserMessage.content = `[图片] ${userText || '(图片)'}\n[识别结果]: ${imageDescription}`;
        logger.debug('[Session] 📷 User message updated with image recognition result');
      }

      assistantContentString = response;
    } else {
      assistantContentString = response;
    }

    const lastToolCalls = agent.getLastToolCalls?.() || [];
    logger.debug('[Session] Tool calls from agent:', lastToolCalls.length, lastToolCalls);

    session.messages.push({
      role: 'assistant',
      content: assistantContentString,
      timestamp: new Date().toISOString(),
      toolCalls: lastToolCalls.length > 0 ? lastToolCalls : undefined,
    });

    session.pendingDelivery = true;
    session.lastAiResponse = assistantContentString;
    logger.debug('[Session] ✓ AI responded, set pendingDelivery=true for safe recovery');

    if (session.pendingRecovery) {
      session.pendingRecovery = false;
      logger.debug('[Session] ✓ Cleared pendingRecovery flag');
    }

    session.updatedAt = new Date().toISOString();
    saveSession(session);

    // Trigger knowledge extraction (background)
    runExtractionInBackground(session);

    // Notify channel handler
    const handler = channelHandlers.get(channel);
    if (handler) {
      await handler(sessionId, response);
    }

    clearDeepAnalysisContext();

    return {
      success: true,
      sessionId,
      response,
      usedCardV2: !!streamingController,
    };
  } catch (error) {
    clearDeepAnalysisContext();

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    logger.error('[Session] ❌ sendProactiveMessage failed:', errorMessage);
    logger.error('[Session] Stack:', errorStack);
    logger.error('[Session] SessionId:', options.sessionId);
    logger.error('[Session] Message:', typeof options.message === 'string'
      ? options.message.substring(0, 100)
      : '[Multimodal content]');
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Continue a conversation in an existing session
 */
export async function continueConversation(
  sessionId: string,
  message: string
): Promise<ProactiveMessageResult> {
  return sendProactiveMessage({
    sessionId,
    message,
  });
}

/**
 * Get session statistics
 */
export function getSessionStats(): {
  total: number;
  byChannel: Record<string, number>;
  oldestSession?: string;
  newestSession?: string;
} {
  const all = Array.from(sessions.values());
  const byChannel: Record<string, number> = {};

  for (const session of all) {
    byChannel[session.channel] = (byChannel[session.channel] || 0) + 1;
  }

  const sorted = all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return {
    total: all.length,
    byChannel,
    oldestSession: sorted[0]?.id,
    newestSession: sorted[sorted.length - 1]?.id,
  };
}

/**
 * Run knowledge extraction in background
 */
async function runExtractionInBackground(session: Session): Promise<void> {
  try {
    const extractionManager = getExtractionManager();

    const messages: ChatMessage[] = session.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const lastMessage = session.messages[session.messages.length - 1];
    const isConversationEnd = lastMessage?.role === 'user' &&
      extractionManager.shouldTrigger(messages, { isConversationEnd: false }).reason.includes('Trigger phrase');

    const result = await extractionManager.extract(messages, {
      isConversationEnd,
    });

    if (result.triggered && result.notifications.length > 0) {
      logger.debug('[Session] Extraction notifications:', result.notifications);
    }
  } catch (error) {
    logger.error('[Session] Background extraction failed:', error);
  }
}

/**
 * Get extraction manager (for external use)
 */
export function getExtraction(): ExtractionManager | null {
  try {
    return getExtractionManager();
  } catch {
    return null;
  }
}

/**
 * Reset extraction manager
 */
export function resetExtraction(): void {
  resetExtractionManager();
}

// Export recovery module
export * from './recovery';
