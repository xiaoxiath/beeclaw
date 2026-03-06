/**
 * Session Manager
 *
 * Manages conversation sessions with:
 * - Persistence to disk (survives restarts)
 * - History loading (continue previous conversations)
 * - Context compression (handle long conversations)
 * - Auto knowledge extraction
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { ChatMessage, MultimodalContent } from '../agent/types';
import { createAgent, SYSTEM_PROMPTS, getAllToolsForAI, buildSystemPrompt, formatSkillsForPrompt, type TokenStatsConfig } from '../agent';
import { getMemoryStore } from '../memory';
import { getSkillStore } from '../skills/store';
import { setDeepAnalysisContext, clearDeepAnalysisContext } from '../tools/deep-analysis';
import type { AIProvider, ExtractionConfigSchemaType } from '../config/schema';
import {
  initExtractionManager,
  getExtractionManager,
  resetExtractionManager,
  type ExtractionManager,
} from '../extraction';
import { getPluginRegistry } from '../plugins';
import { createHookRunner } from '../plugins/hook-runner';

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
}

export interface ProactiveMessageOptions {
  userId?: string;
  channel?: 'cli' | 'feishu' | 'webhook' | 'api';
  message: string | MultimodalContent[];  // Support both text and multimodal
  context?: Record<string, unknown>;
  sessionId?: string;
}

export interface ProactiveMessageResult {
  success: boolean;
  sessionId?: string;
  response?: string;
  error?: string;
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
} | null = null;

// Channel handlers
const channelHandlers: Map<string, (sessionId: string, message: string) => Promise<void>> = new Map();

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
}): void {
  agentConfig = config;

  // Ensure storage directory exists
  if (!existsSync(sessionConfig.storagePath)) {
    mkdirSync(sessionConfig.storagePath, { recursive: true });
  }

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
function saveSession(session: Session): void {
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
    } catch {
      // Plugin system not initialized
    }

    const filePath = getSessionFilePath(session.id);
    writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  } catch (error) {
    console.error('[Session] Failed to save session:', error);
  }
}

/**
 * Load session from disk
 */
function loadSession(sessionId: string): Session | null {
  try {
    const filePath = getSessionFilePath(sessionId);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as Session;
    }
  } catch (error) {
    console.error('[Session] Failed to load session:', error);
  }
  return null;
}

/**
 * Delete session from disk
 */
function deleteSessionFile(sessionId: string): void {
  try {
    const filePath = getSessionFilePath(sessionId);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (error) {
    console.error('[Session] Failed to delete session file:', error);
  }
}

/**
 * Compress old messages into a summary
 */
async function compressMessages(
  messages: SessionMessage[],
  keepRecent: number
): Promise<{ summary: string; recentMessages: SessionMessage[] }> {
  if (!agentConfig) {
    return { summary: '', recentMessages: messages.slice(-keepRecent) };
  }

  const oldMessages = messages.slice(0, -keepRecent);
  const recentMessages = messages.slice(-keepRecent);

  if (oldMessages.length === 0) {
    return { summary: '', recentMessages };
  }

  // Build conversation text for summarization
  const conversationText = oldMessages
    .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');

  // Create a summarization agent (always use text model for summarization)
  const agent = createAgent({
    provider: agentConfig.provider,
    model: 'glm-5',  // Use text model for summarization (faster and cheaper)
    systemPrompt: '你是一个对话摘要助手。请用简洁的中文总结以下对话的关键信息，包括：讨论的主题、用户的需求、重要的结论或决定。控制在100字以内。',
    loadCoreMemory: false,
  });

  try {
    const summary = await agent.chat(`请总结以下对话：\n\n${conversationText}`);
    console.log('[Session] Compressed', oldMessages.length, 'messages into summary');
    return { summary, recentMessages };
  } catch (error) {
    console.error('[Session] Failed to compress messages:', error);
    return { summary: '', recentMessages };
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
    } catch {
      // Plugin system not initialized
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
 * Send a proactive message
 */
export async function sendProactiveMessage(options: ProactiveMessageOptions): Promise<ProactiveMessageResult> {
  if (!agentConfig) {
    return { success: false, error: 'Session manager not initialized' };
  }

  try {
    const channel = options.channel || 'cli';
    const sessionId = options.sessionId || `proactive-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Create or load session
    const session = getOrCreateSession({
      sessionId,
      userId: options.userId || 'proactive-user',
      channel,
      metadata: options.context,
    });

    // Set deep analysis context for tools that need it
    const chatId = (options.context?.chatId as string) || '';
    const messageString = typeof options.message === 'string'
      ? options.message
      : '[Multimodal message]';
    setDeepAnalysisContext({
      sessionId,
      userId: options.userId || 'proactive-user',
      chatId,
      originalMessage: messageString,
    });

    // Check if compression is needed
    if (session.messages.length >= sessionConfig.maxMessages) {
      console.log('[Session] Compressing session', sessionId, `(${session.messages.length} messages)`);
      const { summary, recentMessages } = await compressMessages(
        session.messages,
        sessionConfig.keepRecent
      );
      session.summary = session.summary
        ? `${session.summary}\n\n[更早的对话摘要]\n${summary}`
        : summary;
      session.messages = recentMessages;
    }

    // Build system prompt with core memory
    let systemPrompt = agentConfig.systemPrompt || SYSTEM_PROMPTS.default;

    // Add conversation summary if exists
    if (session.summary) {
      systemPrompt += `\n\n## 历史对话摘要\n${session.summary}`;
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
      } catch {
        // SkillStore not initialized
      }

      systemPrompt = buildSystemPrompt(systemPrompt, {
        ...coreContext,
        skills: skillsPrompt,
      });
    } catch {
      // Memory store not initialized
    }

    // Smart model selection: Two-stage processing for images
    let selectedModel = agentConfig.model;
    let selectedProvider = agentConfig.provider;
    let imageDescription: string | undefined;
    let originalMultimodalMessage: MultimodalContent[] | undefined;

    const hasMultimodalContent = Array.isArray(options.message) &&
      options.message.some(part => part.type === 'image_url');

    if (hasMultimodalContent) {
      // ========================================
      // STAGE 1: Pure vision recognition (no tools, no skill context)
      // This prevents vision model from auto-triggering skills
      // ========================================
      console.log('[Session] 🖼️ Stage 1: Pure vision recognition (no tools)');
      
      const visionAgent = createAgent({
        provider: selectedProvider,
        model: 'GLM-4.6V',
        systemPrompt: '请识别并详细描述这张图片的内容。如果是食物，列出所有可见的食材和菜品名称。如果是其他内容（代码截图、文档、风景等），也请详细描述。',
        tools: undefined,  // No tools for vision-only task!
        loadCoreMemory: false,
      });

      imageDescription = await visionAgent.chat(options.message);
      console.log('[Session] 📝 Vision result:', imageDescription?.substring(0, 100));

      // Save original multimodal message for later storage
      originalMultimodalMessage = options.message;
      
      // ========================================
      // STAGE 2: Intent detection with text model
      // Text model decides whether to call skills based on image description
      // ========================================
      selectedModel = 'glm-5';
      options.message = imageDescription || '[图片识别失败]';
      console.log('[Session] 🧠 Stage 2: Intent detection with text model');
    } else {
      // Text-only message
      selectedModel = 'glm-5';
      console.log('[Session] 📝 Using text model (glm-5) for text message');
    }

    // Check if this is a recovery - don't duplicate the user message
    const isRecovery = options.context?.isRecovery === true;

    // Create agent (loadCoreMemory: false because we already built the system prompt above)
    const agent = createAgent({
      provider: selectedProvider,
      model: selectedModel,
      systemPrompt,
      tools: agentConfig.useTools ? getAllToolsForAI() : undefined,
      loadCoreMemory: false,
      autoRefreshMemory: true,
      tokenStatsConfig: agentConfig.tokenStatsConfig,
    });

    // Replay conversation history
    // NOTE: Skip the last user message since it was just saved and will be added by agent.chat()
    for (let i = 0; i < session.messages.length - 1; i++) {
      const msg = session.messages[i];
      // For multimodal messages, replay the text description (not the base64)
      // This preserves context about what was discussed
      if (msg.role === 'user') {
        agent.addMessage({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        agent.addMessage({ role: 'assistant', content: msg.content });
      }
    }

    // ========================================
    // CRITICAL: Save user message BEFORE processing
    // This ensures recovery system can detect unanswered messages if bot restarts
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

    // Save user message immediately (before AI processing)
    // BUT skip in recovery mode to avoid duplicates
    if (!isRecovery) {
      session.messages.push({
        role: 'user',
        content: userContentString,
        timestamp: new Date().toISOString(),
      });
      session.pendingRecovery = true;  // Mark for recovery
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
    const { SmartTimeout } = await import('../utils/smart-timeout.js');

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

    try {
      // Wrap agent.chat() with activity monitoring
      // CRITICAL: In recovery mode, use the full message from session (userContentString)
      // because options.message might be truncated (recovery.ts passes only first 100 chars)
      const messageForAgent = isRecovery ? userContentString : options.message;
      const chatPromise = agent.chat(messageForAgent);

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

    // Save assistant response
    session.messages.push({
      role: 'assistant',
      content: assistantContentString,
      timestamp: new Date().toISOString(),
    });

    // CRITICAL FIX: Clear pendingRecovery flag immediately after AI responds
    // This prevents recovery from reprocessing already-answered messages
    // (Previously this was only cleared after Feishu delivery, which caused race conditions)
    if (session.pendingRecovery) {
      session.pendingRecovery = false;
      console.log('[Session] ✓ AI responded, cleared pendingRecovery flag');
    }

    // NOTE: responseDelivered flag is for tracking Feishu delivery status
    // It's set separately after successful Feishu send (see routes/proactive.ts)
    session.updatedAt = new Date().toISOString();

    // Save session to disk
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

    return { success: true, sessionId, response };
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

  let loaded = 0;
  const files = readdirSync(sessionConfig.storagePath).filter(f => f.endsWith('.json'));

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

// Export recovery module
export * from './recovery';
