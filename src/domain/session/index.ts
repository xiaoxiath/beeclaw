/**
 * Session Manager
 *
 * Manages conversation sessions with:
 * - Persistence to disk (survives restarts)
 * - History loading (continue previous conversations)
 * - Context compression (handle long conversations)
 * - Auto knowledge extraction
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { ChatMessage, MultimodalContent } from '../agent/types';
import { createAgent, SYSTEM_PROMPTS, getAllToolsForAI, buildSystemPrompt, formatSkillsForPrompt, type TokenStatsConfig } from '../agent';
import { callAI } from '../agent/api';
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
// TODO: [CR-Layer] Move getPluginRegistry to domain port interface
import { getPluginRegistry } from '../../adapter/plugins';
// TODO: [CR-Layer] Move createHookRunner to domain port interface
import { createHookRunner } from '../../adapter/plugins/hook-runner';
import { logger } from '../../infra/observability/logger';
import { SessionMessageQueue } from '../../infra/resilience/session-lock';
import type { SessionMessageQueueOptions } from '../../infra/resilience/session-lock';
import { writeFileAtomic, readFileWithRecovery, cleanupTempFiles } from '../../infra/utils/atomic-fs';
import { getDataConnection } from '../../infra/db';
import { sessions as sessionsTable } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';
// TODO: [CR-Layer] StreamingMessageController is a Feishu adapter concern; inject via port
import { StreamingMessageController } from '../../adapter/feishu/card-v2';
// TODO: [CR-Layer] getFeishuWSClient is a Feishu adapter concern; inject via port
import { getFeishuWSClient } from '../../adapter/feishu';
import { getConfig_ } from '../../app';
import { SmartTimeout } from '../../infra/resilience/smart-timeout';
import { handleHITLResponse } from './hitl-manager';
import { resolveConfig, type ResilienceConfig } from '../../infra/config/resilience-config';

// Phase 4: Extracted proactive message steps
import {
  prepareProactiveContext,
  resolveProactiveRecipients,
  formatProactiveMessage,
  deliverProactiveMessage,
  handleProactiveResult,
} from './proactive-steps';

// Phase 4: Re-export extracted proactive message steps
export {
  prepareProactiveContext,
  resolveProactiveRecipients,
  formatProactiveMessage,
  deliverProactiveMessage,
  handleProactiveResult,
  type ProactiveContext,
} from './proactive-steps';

export interface SessionOptions {
  sessionId: string;
  userId?: string;
  channel: 'cli' | 'feishu' | 'webhook' | 'api';
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
   * [BUG FIX] Set of processed message IDs for permanent deduplication
   * Key: messageId, Value: true (presence = processed)
   *
   * Storage: Permanent (no TTL cleanup)
   * Reason: Feishu message IDs are globally unique (UUID-like)
   * Impact: ~5 KB/month for medium usage (50 msgs/day)
   */
  processedMessageIds?: Record<string, boolean>;
}

export interface ProactiveMessageOptions {
  userId?: string;
  channel?: 'cli' | 'feishu' | 'webhook' | 'api';
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

// Feature flag for SQLite (dual-mode)
const USE_SQLITE = process.env.USE_SQLITE_SESSIONS === 'true';

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
} | null = null;

// Channel handlers
const channelHandlers: Map<string, (sessionId: string, message: string) => Promise<void>> = new Map();

// [PERF OPT] Track ongoing compression to prevent duplicates
const compressionLocks: Map<string, Promise<void>> = new Map();

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
    `[SessionManager] Queue configured with maxWaitTime: ${Math.round(queueOptions.maxWaitTime / 1000)}s ` +
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
      console.log('[Session] Extraction manager initialized');
    } catch (error) {
      console.error('[Session] Failed to initialize extraction manager:', error);
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
    console.log(`[Session] 📤 Response delivered, recovery flag cleared for ${sessionId}`);
  }
}

/**
 * Confirm that a message has been successfully delivered to the channel.
 *
 * This replaces both clearRecoveryFlag() and markResponseDelivered() from
 * the original code. It's called ONLY after the Feishu reply (or CLI output)
 * has succeeded.
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
    console.log(`[Session] Delivery confirmed for session ${sessionId}`);
  }
}

/**
 * [BUG FIX] Check if a message has already been processed in this session.
 *
 * This provides persistent deduplication across restarts by checking the session's
 * processedMessageIds set. Since Feishu message IDs are globally unique (UUID-like),
 * we keep them permanently to ensure 100% deduplication.
 *
 * Storage impact:
 * - Low usage (10 msgs/day): ~1 KB/day = 360 KB/year
 * - Medium usage (50 msgs/day): ~5 KB/day = 1.8 MB/year
 * - High usage (200 msgs/day): ~20 KB/day = 7.2 MB/year
 *
 * @param sessionId - Session ID
 * @param messageId - Feishu message ID to check
 * @returns true if message was already processed, false otherwise
 */
export function isMessageProcessed(sessionId: string, messageId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || !session.processedMessageIds) {
    return false;
  }

  return messageId in session.processedMessageIds;
}

/**
 * [BUG FIX] Mark a message as processed in the session.
 *
 * This should be called AFTER successfully processing and replying to a message.
 * The message ID will be stored permanently for deduplication.
 *
 * @param sessionId - Session ID
 * @param messageId - Feishu message ID to record
 */
export function markMessageProcessed(sessionId: string, messageId: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  if (!session.processedMessageIds) {
    session.processedMessageIds = {};
  }

  // Store as boolean (presence = processed)
  session.processedMessageIds[messageId] = true;
  session.updatedAt = new Date().toISOString();
  saveSession(session);

  console.log(`[Session] ✓ Marked message as processed: ${messageId}`);
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
    console.warn(`[Session] Recovery permanently failed for ${sessionId} after ${failures} attempts`);
    return -1;
  }
  
  session.consecutiveRecoveryFailures = failures + 1;
  session.lastRecoveryAt = new Date().toISOString();
  session.updatedAt = new Date().toISOString();
  saveSession(session);
  
  const delayMs = 1000 * Math.pow(4, failures); // 1s, 4s, 16s, 64s, 256s
  console.log(`[Session] Recovery backoff for ${sessionId}: attempt ${failures + 1}/${MAX_FAILURES}, delay ${delayMs}ms`);
  return delayMs;
}

/**
 * Get a summary of recent session messages for proactive task context injection.
 * Returns a formatted string with the last N messages.
 *
 * @param sessionId - The session ID to retrieve
 * @param maxMessages - Maximum number of recent messages to include (default: 5)
 * @param requesterId - Optional user ID for permission check. If provided, must match session.userId
 * @returns Formatted summary string, or empty string if no access or no messages
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
    console.warn(
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
 * This is separate from pendingRecovery - it's just for status tracking
 */
export function markResponseDelivered(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.responseDelivered = true;
    session.updatedAt = new Date().toISOString();
    saveSession(session);
    console.log(`[Session] 📤 Response delivered to user for ${sessionId}`);
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
 * Get session file path
 */
function getSessionFilePath(sessionId: string): string {
  // Sanitize session ID for filesystem
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(sessionConfig.storagePath, `${safeId}.json`);
}

/**
 * Save session to disk
 */
export function saveSession(session: Session): void {
  try {
    // Trigger before_message_write hook (synchronous)
    try {
      const registry = getPluginRegistry();
      const hookRunner = createHookRunner(registry);

      const modifiedSession = hookRunner.runBeforeMessageWrite({
        sessionId: session.id,
        messages: session.messages,
        metadata: session.metadata,
        timestamp: new Date().toISOString(),
      });

      // Use modified data if returned
      if (modifiedSession) {
        session.messages = modifiedSession.messages || session.messages;
        session.metadata = modifiedSession.metadata || session.metadata;
      }
    } catch (error) {
      logger.debug('Plugin system not initialized:', error);
    }

    // Save to JSON (always for backward compatibility)
    const filePath = getSessionFilePath(session.id);
    // BUG #3 FIX: Use atomic write instead of writeFileSync
    writeFileAtomic(filePath, JSON.stringify(session, null, 2));

    // Save to SQLite if enabled (dual-mode)
    saveSessionToSQLite(session);
  } catch (error) {
    console.error('[Session] Failed to save session:', error);
  }
}

/**
 * Load session from disk
 */
function loadSession(sessionId: string): Session | null {
  // Try SQLite first if enabled (RFC-03)
  if (USE_SQLITE) {
    const sqliteSession = loadSessionFromSQLite(sessionId);
    if (sqliteSession) {
      console.log(`[Session] Loaded from SQLite: ${sessionId}`);
      return sqliteSession;
    }
  }

  // Fallback to JSON file
  try {
    const filePath = getSessionFilePath(sessionId);

    // BUG #3 FIX: Use readFileWithRecovery with structure validation
    const data = readFileWithRecovery<Session>(filePath, isValidSession);

    if (!data) {
      console.warn(`[Session] Failed to load session ${sessionId} (corrupted or missing)`);
      return null;
    }

    return data;
  } catch (error) {
    console.error('[Session] Failed to load session:', error);
    return null;
  }
}

/**
 * Validate session structure after loading.
 */
function isValidSession(data: unknown): data is Session {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  // Must have id and either messages or conversationHistory
  if (typeof obj.id !== 'string') return false;
  if (!Array.isArray(obj.messages)) return false;
  return true;
}

/**
 * Load session from SQLite database (RFC-03)
 */
function loadSessionFromSQLite(sessionId: string): Session | null {
  if (!USE_SQLITE) return null;

  try {
    const db = getDataConnection();
    const results = db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1)
      .all();

    if (results.length === 0) return null;

    const row = results[0];
    const session: Session = {
      id: row.id,
      channel: row.channel,
      userId: row.userId,
      messages: row.messages as SessionMessage[],
      metadata: row.metadata || undefined,
      pendingRecovery: row.needsRecovery || undefined,
      recoveredAt: row.recoveredAt?.toISOString() || undefined,
      createdAt: row.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: row.updatedAt?.toISOString() || new Date().toISOString(),
    };

    return session;
  } catch (error) {
    console.error('[Session] Failed to load from SQLite:', error);
    return null;
  }
}

/**
 * Save session to SQLite database (RFC-03)
 */
function saveSessionToSQLite(session: Session): void {
  if (!USE_SQLITE) return;

  try {
    const db = getDataConnection();
    const now = new Date();

    // Upsert session
    const existing = db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, session.id))
      .limit(1)
      .all();

    if (existing.length === 0) {
      // Insert
      db.insert(sessionsTable).values({
        id: session.id,
        channel: session.channel,
        userId: session.userId,
        messages: session.messages,
        metadata: session.metadata || null,
        needsRecovery: session.pendingRecovery || false,
        recoveredAt: session.recoveredAt ? new Date(session.recoveredAt) : null,
        createdAt: new Date(session.createdAt),
        updatedAt: now,
      }).run();
    } else {
      // Update
      db.update(sessionsTable)
        .set({
          channel: session.channel,
          userId: session.userId,
          messages: session.messages,
          metadata: session.metadata || null,
          needsRecovery: session.pendingRecovery || false,
          recoveredAt: session.recoveredAt ? new Date(session.recoveredAt) : null,
          updatedAt: now,
        })
        .where(eq(sessionsTable.id, session.id))
        .run();
    }
  } catch (error) {
    console.error('[Session] Failed to save to SQLite:', error);
  }
}

/**
 * Delete session from disk
 */
function deleteSessionFile(sessionId: string): void {
  // Delete JSON file
  try {
    const filePath = getSessionFilePath(sessionId);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (error) {
    console.error('[Session] Failed to delete session file:', error);
  }

  // Delete from SQLite if enabled
  if (USE_SQLITE) {
    try {
      const db = getDataConnection();
      db.delete(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .run();
    } catch (error) {
      console.error('[Session] Failed to delete session from SQLite:', error);
    }
  }
}

/**
 * Compress old messages into a summary
 *
 * [PERF OPT] Optimized to use fast model + direct API call
 * - Bypasses Agent layer to avoid unnecessary initialization
 * - Uses fast model (e.g., glm-5-turbo) instead of main model
 * - Reduces compression time from ~18s to ~1-2s
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

  console.log('[Session] 📊 Compression split:', {
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
    // Priority: fast model > main model from config
    const compressionModel = fastModelConfig?.model || agentConfig.model;
    const compressionMaxTokens = fastModelConfig?.maxTokens || 200;

    console.log(`[Session] 🗜️ Compressing ${oldMessages.length} messages using ${compressionModel}...`);

    const response = await callAI({
      provider: agentConfig.provider,
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
      maxTokens: compressionMaxTokens,  // Use config value
      temperature: 0.3,  // Lower temperature for more focused output
    });

    // Extract content from response
    const summary = response.choices?.[0]?.message?.content || '';

    if (summary) {
      console.log(`[Session] ✅ Compressed ${oldMessages.length} messages into ${summary.length} chars summary`);
    } else {
      console.warn('[Session] ⚠️ Compression returned empty summary');
    }

    return { summary, recentMessages };
  } catch (error) {
    console.error('[Session] ❌ Failed to compress messages:', error);
    // Fallback: keep all messages if compression fails
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
    console.log('[Session] Loaded from disk:', options.sessionId, `(${loaded.messages.length} messages)`);
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
    const registry = getPluginRegistry();
    const hookRunner = createHookRunner(registry);

    // Fire-and-forget to avoid blocking
    Promise.resolve().then(() => {
      hookRunner.runSessionStart({
        sessionId: session.id,
        userId: session.userId,
        channel: session.channel,
        metadata: session.metadata,
        timestamp: session.createdAt,
      });
    });
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
      const registry = getPluginRegistry();
      const hookRunner = createHookRunner(registry);

      // Fire-and-forget to avoid blocking
      Promise.resolve().then(() => {
        hookRunner.runSessionEnd({
          sessionId: session.id,
          userId: session.userId,
          channel: session.channel,
          messageCount: session.messages.length,
          createdAt: session.createdAt,
          endedAt: new Date().toISOString(),
        });
      });
    } catch (error) {
      logger.debug('Plugin system not initialized:', error);
    }
  }

  deleteSessionFile(sessionId);
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

  // [PERF OPT] 提前创建 StreamingMessageController，立即显示"正在思考..."
  // 在所有耗时操作之前，让用户立即看到响应
  let streamingController: StreamingMessageController | null = null;

  try {
    const config = getConfig_();
    const feishuConfig = config?.feishu;
    const useCardV2 = feishuConfig?.useCardV2 ?? false;

    if (channel === 'feishu' && useCardV2 && options.context?.parentMessageId) {
      const feishuClient = getFeishuWSClient();
      if (feishuClient) {
        streamingController = new StreamingMessageController({
          client: feishuClient,
          parentMessageId: options.context.parentMessageId as string,
          chatId: (options.context.chatId as string) || '',
          debounceMs: 500,
        });

        // 【参考 agentara】立即发送初始 Card，显示 "Thinking..." 占位符
        // 这样用户能立即看到反馈，而不是等到 agent 开始输出
        await streamingController.pushContent({
          type: 'thinking',
          thinking: 'Thinking...',
        });
        console.log('[Session] ⚡ Card V2 initialized with early "Thinking..." placeholder');
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
    // Check if compression is needed
    if (session.messages.length >= sessionConfig.maxMessages) {
      // Skip if already compressing this session
      if (compressionLocks.has(sessionId)) {
        console.log(`[Session] ⏭️ Compression already in progress for ${sessionId}, skipping`);
      } else {
        // Start async compression (fire-and-forget)
        const compressionPromise = (async () => {
          try {
            console.log(`[Session] 🗜️ Starting background compression for ${sessionId} (${session.messages.length} messages)`);

            // Record message count before compression to detect messages added during async work
            const messageCountAtStart = session.messages.length;

            const { summary, recentMessages } = await compressMessages(
              session.messages,
              sessionConfig.keepRecent
            );

            // Reload session to get latest state (might have changed during compression)
            const latestSession = sessions.get(sessionId) || loadSession(sessionId);
            if (!latestSession) {
              console.warn(`[Session] Session ${sessionId} disappeared during compression`);
              return;
            }

            // Update session with compressed data
            // [BUG FIX] Don't accumulate summaries - replace with latest to avoid duplication
            latestSession.summary = summary;

            console.log('[Session] 📝 Updated summary:', {
              summaryLength: summary.length,
              summaryPreview: summary.substring(0, 100) + '...',
              recentMessagesKept: recentMessages.length,
            });

            // Preserve messages added during compression
            const newMessagesDuringCompression = latestSession.messages.slice(messageCountAtStart);
            latestSession.messages = [...recentMessages, ...newMessagesDuringCompression];
            latestSession.updatedAt = new Date().toISOString();

            // Save compressed session
            saveSession(latestSession);
            sessions.set(sessionId, latestSession);

            console.log(`[Session] ✅ Background compression completed for ${sessionId}`);
          } catch (error) {
            console.error(`[Session] ❌ Background compression failed for ${sessionId}:`, error);
          } finally {
            // Always clean up lock
            compressionLocks.delete(sessionId);
          }
        })();

        // Track compression promise
        compressionLocks.set(sessionId, compressionPromise);

        // Don't await - let it run in background
        // User message processing continues immediately
      }
    }

    // Build system prompt with core memory
    let systemPrompt = agentConfig.systemPrompt || SYSTEM_PROMPTS.default;

    // Add conversation summary if exists
    if (session.summary) {
      console.log('[Session] ⚠️ Adding summary to system prompt:', {
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
    // Replaces hardcoded model names with VisionConfig
    const { DEFAULT_VISION_CONFIG } = await import('../agent/types');

    // Build visionConfig with smart defaults:
    // 1. User-provided visionConfig (highest priority)
    // 2. DEFAULT_VISION_CONFIG defaults
    // 3. Use agent's model as textModel default (instead of hardcoded 'glm-5')
    const visionConfig = {
      ...DEFAULT_VISION_CONFIG,
      // Override textModel default to use agent's model
      textModel: agentConfig.model, // ← Use configured model, not hardcoded 'glm-5'
      ...(agentConfig.visionConfig || {}), // User config takes precedence
    };

    let selectedModel = agentConfig.model;
    const selectedProvider = agentConfig.provider;
    let imageDescription: string | undefined;
    let originalMultimodalMessage: MultimodalContent[] | undefined;

    const hasMultimodalContent = Array.isArray(options.message) &&
      options.message.some(part => part.type === 'image_url');

    if (hasMultimodalContent) {
      // ========================================
      // STAGE 1: Pure vision recognition (no tools, no skill context)
      // [AUDIT FIX M-03] Now uses configurable model and prompt
      // ========================================
      console.log(`[Session] 🖼️ Stage 1: Vision recognition using ${visionConfig.visionModel}`);
      
      let retries = 0;
      while (retries <= visionConfig.maxRetries) {
        try {
          const visionAgent = createAgent({
            provider: selectedProvider,
            model: visionConfig.visionModel,
            systemPrompt: visionConfig.visionSystemPrompt,
            tools: undefined,  // No tools for vision-only task!
            loadCoreMemory: false,
          });

          imageDescription = await visionAgent.chat(options.message);
          console.log('[Session] 📝 Vision result:', imageDescription?.substring(0, 100));
          break; // Success
        } catch (error) {
          retries++;
          console.error(`[Session] Vision model attempt ${retries} failed:`, error instanceof Error ? error.message : error);
          if (retries > visionConfig.maxRetries) {
            // [AUDIT FIX M-03] Structured fallback on vision failure
            if (visionConfig.fallbackOnError === 'placeholder') {
              imageDescription = '[图片识别失败 - 视觉模型不可用]';
            } else if (visionConfig.fallbackOnError === 'description') {
              imageDescription = '[图片] 无法识别内容，请用文字描述图片中的内容。';
            }
            console.error('[Session] Vision processing exhausted retries, using fallback');
          }
        }
      }

      // Save original multimodal message for later storage
      originalMultimodalMessage = options.message;
      
      // ========================================
      // STAGE 2: Intent detection with text model
      // [AUDIT FIX M-03] Uses configurable text model
      // ========================================
      selectedModel = visionConfig.textModel;
      options.message = imageDescription || '[图片识别失败]';
      console.log(`[Session] 🧠 Stage 2: Intent detection with ${selectedModel}`);
    } else {
      // Text-only message — use agent's configured model
      selectedModel = agentConfig.model;
      console.log(`[Session] 📝 Using text model (${selectedModel}) for text message`);
    }

    // Check if this is a recovery - don't duplicate the user message
    const isRecovery = options.context?.isRecovery === true;

    // Create agent (loadCoreMemory: false because we already built the system prompt above)
    // [AUDIT FIX M-06] Pass blockedTools from proactive task options
    const agent = createAgent({
      provider: selectedProvider,
      model: selectedModel,
      systemPrompt,
      tools: agentConfig.useTools ? getAllToolsForAI() : undefined,
      loadCoreMemory: false,
      autoRefreshMemory: true,
      tokenStatsConfig: agentConfig.tokenStatsConfig,
      // Pass resolved params from three-layer configuration
      params: agentConfig.params,
      ...(options.agentOptions?.blockedTools ? { blockedTools: options.agentOptions.blockedTools } : {}),
    });

    // Replay conversation history
    // NOTE: Skip the last user message since it was just saved and will be added by agent.chat()
    // [AUDIT FIX M-03] Preserve multimodal semantic markers during replay
    // [BUG FIX] Load ALL messages except the last one (which will be added by agent.chat)
    // IMPORTANT: This loop assumes session.messages does NOT include the new user message yet
    // The new user message is added AFTER this loop (see line 1043)

    console.log('[Session] ⚠️ Replaying conversation history:', {
      messageCount: session.messages.length,
      messages: session.messages.map(m => ({
        role: m.role,
        contentPreview: m.content.substring(0, 50),
        hasSummary: !!session.summary,
      })),
    });

    for (let i = 0; i < session.messages.length; i++) {  // ← Changed from length-1 to length
      const msg = session.messages[i];
      if (msg.role === 'user') {
        // [AUDIT FIX M-03] If original was multimodal with vision description, add semantic marker
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

    // ========================================
    // CRITICAL: Prepare user message content
    // ========================================
    let userContentString: string;

    if (isRecovery) {
      // Recovery mode: user message already exists in session
      // Extract content from last user message for processing
      const lastUserMessage = session.messages[session.messages.length - 1];
      userContentString = lastUserMessage?.content || '';

      console.log('[Session] 🔄 Recovery mode - skipping user message save');
    } else if (originalMultimodalMessage) {
      // Image was processed in two stages - will be updated after response
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

    // ========================================
    // CRITICAL: Check for HITL recovery BEFORE processing new message
    // ========================================
    const hitlResult = await handleHITLResponse(sessionId, userContentString);

    if (hitlResult !== null) {
      console.log('[Session] 🔄 HITL response detected, resuming conversation');
      return {
        success: true,
        response: hitlResult,
        usedCardV2: session.metadata?.usedCardV2 || false,
      };
    }

    // Save user message immediately (before AI processing)
    // BUT skip in recovery mode to avoid duplicates
    if (!isRecovery) {
      session.messages.push({
        role: 'user',
        content: userContentString,
        timestamp: new Date().toISOString(),
        // [AUDIT FIX M-03] Preserve multimodal metadata for future replay
        _meta: originalMultimodalMessage ? {
          originalType: 'multimodal',
          visionDescription: imageDescription,
          source: (options.context?.source as 'user' | 'proactive' | 'recovery' | 'system') || 'user',
        } : {
          originalType: 'text',
          source: (options.context?.source as 'user' | 'proactive' | 'recovery' | 'system') || 'user',
        },
      });
      session.pendingRecovery = true;  // Mark for recovery
      session.lastMessageSource = (options.context?.source as string || 'user');
      session.updatedAt = new Date().toISOString();
      saveSession(session);

      console.log('[Session] 📨 User message saved (recovery-ready)');
    } else {
      // Recovery mode: message already exists in session
      // Ensure pendingRecovery is still true (might have been cleared if response was partially sent)
      session.pendingRecovery = true;
      session.updatedAt = new Date().toISOString();
      saveSession(session);

      console.log('[Session] 🔄 Recovery mode - using existing user message');
    }

    // Get response with smart timeout (inactivity-based)
    // Only timeout when agent is truly stuck (no activity for 10 minutes)
    //
    // Configuration:
    //   AGENT_INACTIVITY_TIMEOUT_MS - inactivity timeout (default: 600000 = 10 minutes)
    //   DEBUG_SESSION_ACTIVITY - log all activities (default: false)
    //
    // Why 10 minutes?
    // - Deep research: Multi-step research with gaps between steps
    // - Complex reasoning: Long thinking time before output
    // - Tool chains: Multiple tool calls with preparation time
    // - Network issues: API latency can be 2-5 minutes
    // - Real "stuck" is rare: Most tasks either complete or fail with error
    //
    // This replaces fixed timeout because:
    // - Simple tasks: complete in seconds, no waiting
    // - Complex tasks: can run for hours as long as agent is active
    // - Truly stuck: detected by 10 minutes of NO activity
    //

    let response: string | undefined;
    let timeoutError: Error | undefined;

    const smartTimeout = new SmartTimeout({
      inactivityTimeoutMs: parseInt(
        process.env.AGENT_INACTIVITY_TIMEOUT_MS || '600000',  // 10 minutes
        10
      ),
      checkIntervalMs: 30000,  // Check every 30 seconds
      onTimeout: (inactiveMs) => {
        const stats = smartTimeout.getMonitor().getStats();
        console.error(
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
        // Log significant activities
        if (
          process.env.DEBUG_SESSION_ACTIVITY === 'true' &&
          (type === 'tool_call' || type === 'subagent')
        ) {
          console.log(`[Session] Agent activity: ${type}${details ? ` (${details})` : ''}`);
        }
      },
    });

    smartTimeout.start();

    // [PERF OPT] StreamingMessageController 已经在函数开始时创建
    // 这里不需要重复创建，直接使用前面创建的 streamingController

    try {
      // Wrap agent.chat() with activity monitoring
      // CRITICAL: In recovery mode, use the full message from session (userContentString)
      // because options.message might be truncated (recovery.ts passes only first 100 chars)
      const messageForAgent = isRecovery ? userContentString : options.message;

      // Build user context for tool execution
      const userContextForTools = {
        openId,
        chatId,
        messageId,
        userId: options.userId,
        sessionId,  // Add sessionId for HITL callbacks
      };

      const chatPromise = agent.chat(messageForAgent, {
        onContentBlock: (block) => {
          console.log('[Session] 📦 Received content block:', JSON.stringify(block, null, 2));
          streamingController?.pushContent(block).catch(err => {
            // Silently handle message withdrawn errors
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (!errorMsg.includes('withdrawn')) {
              logger.warn('[Session] Failed to push content block:', errorMsg);
            }
          });
        },
        userContext: userContextForTools,
      });

      // Create a promise that rejects on timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        const checkInterval = setInterval(() => {
          if (timeoutError) {
            clearInterval(checkInterval);
            reject(timeoutError);
          }
        }, 1000);
      });

      // Race between chat completion and timeout
      response = await Promise.race([chatPromise, timeoutPromise]);

      // Finish streaming controller
      if (streamingController) {
        try {
          await streamingController.finish();
          console.log('[Session] ✅ Card V2 streaming completed');
        } catch (error) {
          logger.warn('[Session] Failed to finish streaming:', error);
        }
      }

      // Record final activity
      smartTimeout.recordActivity('progress', 'response completed');

      // Success
      const runtime = Math.round(smartTimeout.getRuntimeMs() / 1000);
      if (runtime > 30) {
        console.log(
          `[Session] Agent completed in ${runtime}s\n` +
          smartTimeout.getMonitor().formatReport()
        );
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Finish streaming controller on error
      if (streamingController) {
        try {
          await streamingController.finish();
        } catch (streamError) {
          logger.warn('[Session] Failed to finish streaming on error:', streamError);
        }
      }

      if (timeoutError) {
        // Inactivity timeout
        return {
          success: false,
          error: `AI 长时间无响应，可能遇到了问题。请稍后重试或简化任务。\n\n${errorMsg}`
        };
      } else {
        // Other errors (network, API, etc.)
        // These will be handled by retry mechanism
        throw error;
      }
    } finally {
      smartTimeout.stop();
    }

    // Validate response
    if (!response || response.trim().length === 0) {
      console.error('[Session] Agent returned empty response');
      return { success: false, error: 'AI 返回了空响应' };
    }

    // Update messages with final content
    // For multimodal (image) messages, update the user message with recognition result
    // This preserves image context for future conversations
    let assistantContentString: string;

    if (originalMultimodalMessage && imageDescription) {
      // Image was processed in two stages - update user message with recognition result
      const textPart = originalMultimodalMessage.find(p => p.type === 'text');
      const userText = textPart && 'text' in textPart ? textPart.text : '';

      // Update the last user message (already saved before processing)
      const lastUserMessage = session.messages[session.messages.length - 1];
      if (lastUserMessage && lastUserMessage.role === 'user') {
        lastUserMessage.content = `[图片] ${userText || '(图片)'}\n[识别结果]: ${imageDescription}`;
        console.log('[Session] 📷 User message updated with image recognition result');
      }

      assistantContentString = response;
    } else {
      assistantContentString = response;
    }

    // Get tool calls from agent if available
    const lastToolCalls = agent.getLastToolCalls?.() || [];
    console.log('[Session] Tool calls from agent:', lastToolCalls.length, lastToolCalls);

    // Save assistant response with tool calls
    session.messages.push({
      role: 'assistant',
      content: assistantContentString,
      timestamp: new Date().toISOString(),
      toolCalls: lastToolCalls.length > 0 ? lastToolCalls : undefined,
    });

    // CRITICAL FIX #1: Set pendingDelivery BEFORE attempting delivery
    // This ensures that if the bot crashes or delivery fails, the response is cached
    // and can be re-delivered on next recovery without reprocessing
    session.pendingDelivery = true;
    session.lastAiResponse = assistantContentString;
    console.log('[Session] ✓ AI responded, set pendingDelivery=true for safe recovery');

    // CRITICAL FIX #2: Clear pendingRecovery flag immediately after AI responds
    // This prevents recovery from reprocessing already-answered messages
    // (Previously this was only cleared after Feishu delivery, which caused race conditions)
    if (session.pendingRecovery) {
      session.pendingRecovery = false;
      console.log('[Session] ✓ Cleared pendingRecovery flag');
    }

    // NOTE: responseDelivered flag is for tracking Feishu delivery status
    // It's set separately after successful Feishu send (see routes/proactive.ts)
    session.updatedAt = new Date().toISOString();

    // Save session to disk (with pendingDelivery=true)
    saveSession(session);

    // Trigger knowledge extraction (background)
    runExtractionInBackground(session);

    // Notify channel handler
    const handler = channelHandlers.get(channel);
    if (handler) {
      await handler(sessionId, response);
    }

    // Clear deep analysis context
    clearDeepAnalysisContext();

    return {
      success: true,
      sessionId,
      response,
      usedCardV2: !!streamingController, // Indicate if Card V2 was used
    };
  } catch (error) {
    // Clear deep analysis context on error too
    clearDeepAnalysisContext();

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('[Session] ❌ sendProactiveMessage failed:', errorMessage);
    console.error('[Session] Stack:', errorStack);
    console.error('[Session] SessionId:', options.sessionId);
    console.error('[Session] Message:', typeof options.message === 'string'
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
 * Load all sessions from disk (call on startup)
 */
export function loadAllSessions(): number {
  if (!existsSync(sessionConfig.storagePath)) {
    return 0;
  }

  // BUG #3 FIX: Clean up leftover temp files from crashes
  cleanupTempFiles(sessionConfig.storagePath);

  let loaded = 0;
  const files = readdirSync(sessionConfig.storagePath).filter(
    f => f.endsWith('.json') && !f.endsWith('.bak') && !f.endsWith('.tmp')
  );

  for (const file of files) {
    try {
      const content = readFileSync(join(sessionConfig.storagePath, file), 'utf-8');
      const session = JSON.parse(content) as Session;
      sessions.set(session.id, session);
      loaded++;
    } catch (error) {
      console.error('[Session] Failed to load', file, error);
    }
  }

  console.log(`[Session] Loaded ${loaded} sessions from disk`);
  return loaded;
}

/**
 * Clear old sessions (cleanup)
 */
export function clearOldSessions(daysOld: number = 30): number {
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  let cleared = 0;

  for (const [id, session] of sessions) {
    if (new Date(session.updatedAt).getTime() < cutoff) {
      deleteSession(id);
      cleared++;
    }
  }

  return cleared;
}

/**
 * Run knowledge extraction in background
 */
async function runExtractionInBackground(session: Session): Promise<void> {
  try {
    const extractionManager = getExtractionManager();

    // Convert session messages to ChatMessage format
    const messages: ChatMessage[] = session.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Check for conversation end signals
    const lastMessage = session.messages[session.messages.length - 1];
    const isConversationEnd = lastMessage?.role === 'user' &&
      extractionManager.shouldTrigger(messages, { isConversationEnd: false }).reason.includes('Trigger phrase');

    // Run extraction
    const result = await extractionManager.extract(messages, {
      isConversationEnd,
    });

    if (result.triggered && result.notifications.length > 0) {
      console.log('[Session] Extraction notifications:', result.notifications);
      // TODO: Send notifications to user via channel handler
    }
  } catch (error) {
    // Extraction errors should not affect the main conversation
    console.error('[Session] Background extraction failed:', error);
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

/**
 * Save all active sessions to disk (for graceful shutdown)
 */
export function saveAllSessions(): void {
  let saved = 0;
  for (const session of sessions.values()) {
    try {
      saveSession(session);
      saved++;
    } catch (error) {
      console.error(`[Session] Failed to save session ${session.id}:`, error);
    }
  }
  console.log(`[Session] Saved ${saved} sessions to disk`);
}

// Export recovery module
export * from './recovery';

/**
 * [AUDIT FIX M-02] Inject proactive task result into a user's active session.
 *
 * This enables bidirectional context flow between scheduled tasks and user conversations.
 * When a proactive task completes, its result can be injected into the user's session
 * so the user can reference it in subsequent interactions.
 */
export function injectProactiveResult(
  targetSessionId: string,
  result: { source: string; content: string; timestamp?: number }
): boolean {
  const session = sessions.get(targetSessionId);
  if (!session) {
    console.warn(`[Session] Cannot inject proactive result: session ${targetSessionId} not found`);
    return false;
  }

  const ts = result.timestamp ? new Date(result.timestamp).toISOString() : new Date().toISOString();

  session.messages.push({
    role: 'system',
    content: `[定时任务结果 - ${result.source}]\n${result.content}`,
    timestamp: ts,
    _meta: {
      source: 'proactive',
    },
  });

  session.updatedAt = ts;
  saveSession(session);

  console.log(`[Session] 📥 Proactive result injected into session ${targetSessionId} from ${result.source}`);
  return true;
}

/**
 * [AUDIT FIX M-02] Load recent conversation history for a session.
 * Used by proactive task handlers to inherit user context.
 */
export function getRecentSessionHistory(
  sessionId: string,
  maxMessages: number = 10
): SessionMessage[] {
  const session = sessions.get(sessionId) || loadSession(sessionId);
  if (!session || session.messages.length === 0) return [];

  return session.messages.slice(-maxMessages);
}
