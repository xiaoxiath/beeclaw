/**
 * Feishu WebSocket Long Connection Client
 *
 * Uses official Lark SDK for WebSocket-based event subscription
 * No need for public IP, domain, or webhook configuration
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuAuthConfig } from './types';
import { logger } from '../../infra/observability/logger';
import { sendPostMessage, sendMarkdownMessage, sendMarkdownCard } from './send';
import type {
  FeishuUserId,
  FeishuOperator,
  FeishuSender,
  FeishuMember,
  BaseFeishuEvent,
  FeishuReceiveIdType,
} from './event-types';

// [P2 FIX 4.7] Re-export shared types for backward compatibility
export type {
  FeishuUserId,
  FeishuOperator,
  FeishuSender,
  FeishuMember,
  BaseFeishuEvent,
  FeishuReceiveIdType,
} from './event-types';

export interface FeishuWSConfig extends FeishuAuthConfig {
  loggerLevel?: 'debug' | 'info' | 'warn' | 'error';
}

// ============================================================
// Event Data Types
// ============================================================

// [P2 FIX 4.7] BaseEventData now extends shared BaseFeishuEvent
export interface BaseEventData extends BaseFeishuEvent {}

// [P2 FIX 4.7] SenderInfo now extends shared FeishuSender
export interface SenderInfo extends FeishuSender {}

// Message receive event (im.message.receive_v1)
export interface MessageEventData extends BaseEventData {
  sender: SenderInfo;
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    update_time?: string;
    chat_id: string;
    thread_id?: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: {
        union_id?: string;
        user_id?: string;
        open_id?: string;
      };
      name: string;
      tenant_key?: string;
    }>;
    user_agent?: string;
  };
}

// Message read event (im.message.message_read_v1)
export interface MessageReadEventData extends BaseEventData {
  reader: {
    reader_id: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
    read_time: string;
    tenant_key?: string;
  };
  message_id_list: string[];
}

// Message recalled event (im.message.recalled_v1)
export interface MessageRecalledEventData extends BaseEventData {
  sender: SenderInfo;
  message: {
    message_id: string;
    create_time: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    recall_time: string;
  };
}

// Reaction event (im.message.reaction.created_v1 / deleted_v1)
export interface ReactionEventData extends BaseEventData {
  sender: SenderInfo;
  reaction: {
    message_id: string;
    reaction_type: string;
    create_time?: string;
    delete_time?: string;
    operator: {
      operator_id: {
        union_id?: string;
        user_id?: string;
        open_id?: string;
      };
    };
  };
}

// Chat disbanded event (im.chat.disbanded_v1)
export interface ChatDisbandedEventData extends BaseEventData {
  chat_id: string;
  operator: {
    operator_id: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
  };
}

// Chat updated event (im.chat.updated_v1)
export interface ChatUpdatedEventData extends BaseEventData {
  chat_id: string;
  operator: {
    operator_id: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
  };
  old_chat_info?: Record<string, unknown>;
  new_chat_info?: Record<string, unknown>;
}

// Chat member user added event (im.chat.member.user.added_v1)
export interface ChatMemberAddedEventData extends BaseEventData {
  chat_id: string;
  operator: {
    operator_id: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
  };
  users: Array<{
    member_id: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
    name?: string;
    tenant_key?: string;
  }>;
}

// Chat member user deleted event (im.chat.member.user.deleted_v1)
export interface ChatMemberDeletedEventData extends BaseEventData {
  chat_id: string;
  operator: {
    operator_id: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
  };
  users: Array<{
    member_id: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
    name?: string;
    tenant_key?: string;
  }>;
}

// Bot added to chat event (im.chat.member.bot.added_v1)
export interface BotAddedEventData extends BaseEventData {
  chat_id: string;
  operator: {
    operator_id: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
  };
  bots: Array<{
    bot_id: string;
  }>;
}

// Bot deleted from chat event (im.chat.member.bot.deleted_v1)
export interface BotDeletedEventData extends BaseEventData {
  chat_id: string;
  operator: {
    operator_id: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
  };
  bots: Array<{
    bot_id: string;
  }>;
}

// P2P chat created event (p2p_chat_create)
export interface P2PChatCreatedEventData extends BaseEventData {
  chat_id: string;
  operator: {
    operator_id: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
  };
}

// P2P chat entered event (im.chat.access_event.bot_p2p_chat_entered_v1)
export interface P2PChatEnteredEventData extends BaseEventData {
  chat_id: string;
  user: {
    user_id: string;
    open_id?: string;
    union_id?: string;
  };
}

// Event handlers
export interface MessageHandler { (data: MessageEventData): Promise<void> | void; }
export interface MessageReadHandler { (data: MessageReadEventData): Promise<void> | void; }
export interface MessageRecalledHandler { (data: MessageRecalledEventData): Promise<void> | void; }
export interface ReactionHandler { (data: ReactionEventData): Promise<void> | void; }
export interface ChatDisbandedHandler { (data: ChatDisbandedEventData): Promise<void> | void; }
export interface ChatUpdatedHandler { (data: ChatUpdatedEventData): Promise<void> | void; }
export interface ChatMemberAddedHandler { (data: ChatMemberAddedEventData): Promise<void> | void; }
export interface ChatMemberDeletedHandler { (data: ChatMemberDeletedEventData): Promise<void> | void; }
export interface BotAddedHandler { (data: BotAddedEventData): Promise<void> | void; }
export interface BotDeletedHandler { (data: BotDeletedEventData): Promise<void> | void; }
export interface P2PChatCreatedHandler { (data: P2PChatCreatedEventData): Promise<void> | void; }
export interface P2PChatEnteredHandler { (data: P2PChatEnteredEventData): Promise<void> | void; }

// Rich text (post) message types
export interface PostTextElement {
  tag: 'text';
  text: string;
  style?: ('bold' | 'italic' | 'underline' | 'lineThrough')[];
}

export interface PostLinkElement {
  tag: 'a';
  text: string;
  href: string;
  style?: ('bold' | 'italic' | 'underline' | 'lineThrough')[];
}

export interface PostAtElement {
  tag: 'at';
  user_id: string;
  user_name?: string;
  style?: ('bold' | 'italic' | 'underline' | 'lineThrough')[];
}

export interface PostImageElement {
  tag: 'img';
  image_key: string;
}

export interface PostEmotionElement {
  tag: 'emotion';
  emoji_type: string;
}

export interface PostMdElement {
  tag: 'md';
  text: string;
}

export interface PostCodeBlockElement {
  tag: 'code_block';
  language?: string;
  text: string;
}

export interface PostHrElement {
  tag: 'hr';
}

export type PostContentElement =
  | PostTextElement
  | PostLinkElement
  | PostAtElement
  | PostImageElement
  | PostEmotionElement
  | PostMdElement
  | PostCodeBlockElement
  | PostHrElement;

export type PostContentBlock = PostContentElement[];

export interface PostContentBody {
  title?: string;
  content: PostContentBlock[];
}

export interface PostContent {
  zh_cn: PostContentBody;
  en_us?: PostContentBody;
}

// Card message types
export interface CardPlainText {
  tag: 'plain_text';
  content: string;
}

export interface CardMarkdownText {
  tag: 'lark_md' | 'markdown';
  content: string;
}

export interface CardDivElement {
  tag: 'div';
  text?: CardMarkdownText;
  extra?: { tag: 'plain_text'; content: string }[];
}

export interface CardMarkdownElement {
  tag: 'markdown';
  content: string;
}

export interface CardHrElement {
  tag: 'hr';
}

export interface CardNoteElement {
  tag: 'note';
  elements: CardMarkdownText[];
}

export interface CardActionElement {
  tag: 'action';
  actions: CardButtonElement[];
}

export interface CardButtonElement {
  tag: 'button';
  text: CardPlainText;
  type?: 'primary' | 'default' | 'danger';
  url?: string;
}

export type CardElement =
  | CardDivElement
  | CardMarkdownElement
  | CardHrElement
  | CardNoteElement
  | CardActionElement;

export interface CardHeader {
  title: CardPlainText;
  subtitle?: CardPlainText;
  template?: 'blue' | 'wathet' | 'turquoise' | 'green' | 'yellow' | 'orange' | 'red' | 'carmine' | 'violet' | 'purple' | 'indigo' | 'grey';
}

export interface CardConfig {
  config?: { wide_screen_mode?: boolean };
  header?: CardHeader;
  elements: CardElement[];
}

/**
 * Feishu WebSocket Client
 *
 * Manages WebSocket connection and event handling
 *
 * BUG #8 FIX: Added reconnection with exponential backoff
 */
export class FeishuWSClient {
  private config: FeishuWSConfig;
  private client: any = null; // SDK client for message sending only (tools use CLI runner)
  private wsClient: Lark.WSClient | null = null;
  private isConnected: boolean = false;

  // BUG #8 FIX: Reconnection properties
  private reconnectOptions: {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    maxAttempts: number;
    jitterFactor: number;
  } = {
    enabled: true,
    initialDelayMs: 1000,
    maxDelayMs: 60_000,
    backoffMultiplier: 2,
    maxAttempts: Infinity,
    jitterFactor: 0.1,
  };

  private reconnectState: {
    attempt: number;
    currentDelayMs: number;
    timer: ReturnType<typeof setTimeout> | null;
    connecting: boolean;
    intentionalStop: boolean;
  } = {
    attempt: 0,
    currentDelayMs: 1000,
    timer: null,
    connecting: false,
    intentionalStop: false,
  };

  // Cache for reconnection
  private _cachedBaseConfig: { appId: string; appSecret: string } | null = null;
  private _cachedEventDispatcher: any = null;
  private _cachedLoggerLevel: any = null;
  private _monitorInterval: ReturnType<typeof setInterval> | null = null;

  // Event handlers
  private messageHandlers: MessageHandler[] = [];
  private messageReadHandlers: MessageReadHandler[] = [];
  private messageRecalledHandlers: MessageRecalledHandler[] = [];
  private reactionCreatedHandlers: ReactionHandler[] = [];
  private reactionDeletedHandlers: ReactionHandler[] = [];
  private chatDisbandedHandlers: ChatDisbandedHandler[] = [];
  private chatUpdatedHandlers: ChatUpdatedHandler[] = [];
  private chatMemberAddedHandlers: ChatMemberAddedHandler[] = [];
  private chatMemberDeletedHandlers: ChatMemberDeletedHandler[] = [];
  private botAddedHandlers: BotAddedHandler[] = [];
  private botDeletedHandlers: BotDeletedHandler[] = [];
  private p2pChatCreatedHandlers: P2PChatCreatedHandler[] = [];
  private p2pChatEnteredHandlers: P2PChatEnteredHandler[] = [];

  // Track last active chat for proactive messaging
  private _lastActiveChatId: string | null = null;
  private _lastActiveUserId: string | null = null;

  constructor(config: FeishuWSConfig) {
    this.config = config;
  }

  /**
   * Check if client is enabled
   */
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get last active chat ID (for proactive messaging)
   */
  get lastActiveChatId(): string | null {
    return this._lastActiveChatId;
  }

  /**
   * Get last active user ID (for proactive messaging)
   */
  get lastActiveUserId(): string | null {
    return this._lastActiveUserId;
  }

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Remove a message handler
   */
  offMessage(handler: MessageHandler): void {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
    }
  }

  /**
   * Register a message read handler
   */
  onMessageRead(handler: MessageReadHandler): void {
    this.messageReadHandlers.push(handler);
  }

  /**
   * Remove a message read handler
   */
  offMessageRead(handler: MessageReadHandler): void {
    const index = this.messageReadHandlers.indexOf(handler);
    if (index > -1) {
      this.messageReadHandlers.splice(index, 1);
    }
  }

  /**
   * Register a message recalled handler
   */
  onMessageRecalled(handler: MessageRecalledHandler): void {
    this.messageRecalledHandlers.push(handler);
  }

  /**
   * Remove a message recalled handler
   */
  offMessageRecalled(handler: MessageRecalledHandler): void {
    const index = this.messageRecalledHandlers.indexOf(handler);
    if (index > -1) {
      this.messageRecalledHandlers.splice(index, 1);
    }
  }

  /**
   * Register a reaction created handler
   */
  onReactionCreated(handler: ReactionHandler): void {
    this.reactionCreatedHandlers.push(handler);
  }

  /**
   * Remove a reaction created handler
   */
  offReactionCreated(handler: ReactionHandler): void {
    const index = this.reactionCreatedHandlers.indexOf(handler);
    if (index > -1) {
      this.reactionCreatedHandlers.splice(index, 1);
    }
  }

  /**
   * Register a reaction deleted handler
   */
  onReactionDeleted(handler: ReactionHandler): void {
    this.reactionDeletedHandlers.push(handler);
  }

  /**
   * Remove a reaction deleted handler
   */
  offReactionDeleted(handler: ReactionHandler): void {
    const index = this.reactionDeletedHandlers.indexOf(handler);
    if (index > -1) {
      this.reactionDeletedHandlers.splice(index, 1);
    }
  }

  /**
   * Register a chat disbanded handler
   */
  onChatDisbanded(handler: ChatDisbandedHandler): void {
    this.chatDisbandedHandlers.push(handler);
  }

  /**
   * Register a chat updated handler
   */
  onChatUpdated(handler: ChatUpdatedHandler): void {
    this.chatUpdatedHandlers.push(handler);
  }

  /**
   * Register a chat member added handler
   */
  onChatMemberAdded(handler: ChatMemberAddedHandler): void {
    this.chatMemberAddedHandlers.push(handler);
  }

  /**
   * Register a chat member deleted handler
   */
  onChatMemberDeleted(handler: ChatMemberDeletedHandler): void {
    this.chatMemberDeletedHandlers.push(handler);
  }

  /**
   * Register a bot added handler
   */
  onBotAdded(handler: BotAddedHandler): void {
    this.botAddedHandlers.push(handler);
  }

  /**
   * Register a bot deleted handler
   */
  onBotDeleted(handler: BotDeletedHandler): void {
    this.botDeletedHandlers.push(handler);
  }

  /**
   * Register a P2P chat created handler
   */
  onP2PChatCreated(handler: P2PChatCreatedHandler): void {
    this.p2pChatCreatedHandlers.push(handler);
  }

  /**
   * Register a P2P chat entered handler
   */
  onP2PChatEntered(handler: P2PChatEnteredHandler): void {
    this.p2pChatEnteredHandlers.push(handler);
  }

  /**
   * Start the WebSocket connection
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[FeishuWS] Disabled, skipping connection');
      return;
    }

    if (!this.config.appId || !this.config.appSecret) {
      throw new Error('[FeishuWS] Missing appId or appSecret');
    }

    const baseConfig = {
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    };

    // Create SDK client for message sending (tools use CLI runner)
    this.client = new Lark.Client(baseConfig);

    // Create event dispatcher
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      // Message events
      'im.message.receive_v1': async (data: unknown) => {
        console.log('[FeishuWS] Message received');
        await this.handleMessage(data as MessageEventData);
      },
      'im.message.message_read_v1': async (data: unknown) => {
        console.log('[FeishuWS] Message read');
        await this.handleMessageRead(data as MessageReadEventData);
      },
      'im.message.recalled_v1': async (data: unknown) => {
        console.log('[FeishuWS] Message recalled');
        await this.handleMessageRecalled(data as MessageRecalledEventData);
      },

      // Reaction events
      'im.message.reaction.created_v1': async (data: unknown) => {
        console.log('[FeishuWS] Reaction created');
        await this.handleReactionCreated(data as ReactionEventData);
      },
      'im.message.reaction.deleted_v1': async (data: unknown) => {
        console.log('[FeishuWS] Reaction deleted');
        await this.handleReactionDeleted(data as ReactionEventData);
      },

      // Chat events
      'im.chat.disbanded_v1': async (data: unknown) => {
        console.log('[FeishuWS] Chat disbanded');
        await this.handleChatDisbanded(data as ChatDisbandedEventData);
      },
      'im.chat.updated_v1': async (data: unknown) => {
        console.log('[FeishuWS] Chat updated');
        await this.handleChatUpdated(data as ChatUpdatedEventData);
      },

      // Chat member events
      'im.chat.member.user.added_v1': async (data: unknown) => {
        console.log('[FeishuWS] Chat member added');
        await this.handleChatMemberAdded(data as ChatMemberAddedEventData);
      },
      'im.chat.member.user.deleted_v1': async (data: unknown) => {
        console.log('[FeishuWS] Chat member deleted');
        await this.handleChatMemberDeleted(data as ChatMemberDeletedEventData);
      },

      // Bot events
      'im.chat.member.bot.added_v1': async (data: unknown) => {
        console.log('[FeishuWS] Bot added to chat');
        await this.handleBotAdded(data as BotAddedEventData);
      },
      'im.chat.member.bot.deleted_v1': async (data: unknown) => {
        console.log('[FeishuWS] Bot deleted from chat');
        await this.handleBotDeleted(data as BotDeletedEventData);
      },

      // P2P chat events
      'p2p_chat_create': async (data: unknown) => {
        console.log('[FeishuWS] P2P chat created');
        await this.handleP2PChatCreated(data as P2PChatCreatedEventData);
      },
      'im.chat.access_event.bot_p2p_chat_entered_v1': async (data: unknown) => {
        console.log('[FeishuWS] User entered P2P chat');
        await this.handleP2PChatEntered(data as P2PChatEnteredEventData);
      },
    });

    // Map log level
    const loggerLevel = this.config.loggerLevel === 'debug'
      ? Lark.LoggerLevel.debug
      : this.config.loggerLevel === 'info'
        ? Lark.LoggerLevel.info
        : this.config.loggerLevel === 'warn'
          ? Lark.LoggerLevel.warn
          : Lark.LoggerLevel.error;

    // BUG #8 FIX: Cache config for reconnection
    this._cachedBaseConfig = baseConfig;
    this._cachedEventDispatcher = eventDispatcher;
    this._cachedLoggerLevel = loggerLevel;

    // BUG #8 FIX: Reset reconnect state
    this.reconnectState.intentionalStop = false;
    this.reconnectState.attempt = 0;
    this.reconnectState.currentDelayMs = this.reconnectOptions.initialDelayMs;

    // Create WebSocket client
    this.wsClient = new Lark.WSClient({
      ...baseConfig,
      loggerLevel,
    });

    // Start connection
    try {
      await this.wsClient.start({
        eventDispatcher,
      });
      this.isConnected = true;
      // BUG #8 FIX: Reset backoff on successful connection
      this.reconnectState.attempt = 0;
      this.reconnectState.currentDelayMs = this.reconnectOptions.initialDelayMs;
      console.log('[FeishuWS] Connected successfully');

      // BUG #8 FIX: Start connection monitor
      this._startConnectionMonitor();
    } catch (error) {
      console.error('[FeishuWS] Connection failed:', error);
      // BUG #8 FIX: Schedule reconnection on failure
      this._scheduleReconnect();
      throw error;
    }
  }

  /**
   * Stop the WebSocket connection
   */
  stop(): void {
    // BUG #8 FIX: Mark as intentional stop
    this.reconnectState.intentionalStop = true;

    // BUG #8 FIX: Cancel pending reconnection
    if (this.reconnectState.timer) {
      clearTimeout(this.reconnectState.timer);
      this.reconnectState.timer = null;
    }

    // BUG #8 FIX: Stop connection monitor
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
    }

    // Disconnect WebSocket
    if (this.wsClient) {
      this.wsClient = null;
    }

    this.client = null;
    this.isConnected = false;
    console.log('[FeishuWS] Disconnected (intentional)');
  }

  /**
   * BUG #8 FIX: Configure reconnection behavior
   */
  configureReconnect(options: {
    enabled?: boolean;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    maxAttempts?: number;
    jitterFactor?: number;
  }): void {
    this.reconnectOptions = { ...this.reconnectOptions, ...options };
    this.reconnectState.currentDelayMs = this.reconnectOptions.initialDelayMs;
  }

  /**
   * BUG #8 FIX: Internal: Establish WebSocket connection
   */
  private async _connectWebSocket(): Promise<void> {
    this.reconnectState.connecting = true;

    try {
      if (!this._cachedBaseConfig || !this._cachedEventDispatcher) {
        throw new Error('[FeishuWS] No cached configuration for reconnection');
      }

      this.wsClient = new Lark.WSClient({
        ...this._cachedBaseConfig,
        loggerLevel: this._cachedLoggerLevel,
      });

      await this.wsClient.start({
        eventDispatcher: this._cachedEventDispatcher,
      });
      this.isConnected = true;
      this.reconnectState.connecting = false;

      // Reset backoff on successful connection
      this.reconnectState.attempt = 0;
      this.reconnectState.currentDelayMs = this.reconnectOptions.initialDelayMs;

      console.log(`[FeishuWS] Reconnected after ${this.reconnectState.attempt} attempt(s)`);
    } catch (error) {
      this.isConnected = false;
      this.reconnectState.connecting = false;
      throw error;
    }
  }

  /**
   * BUG #8 FIX: Schedule a reconnection attempt with exponential backoff
   */
  private _scheduleReconnect(): void {
    if (!this.reconnectOptions.enabled) return;
    if (this.reconnectState.intentionalStop) return;
    if (this.reconnectState.connecting) return;
    if (this.reconnectState.timer) return;

    if (this.reconnectState.attempt >= this.reconnectOptions.maxAttempts) {
      console.error(
        `[FeishuWS] Max reconnection attempts reached (${this.reconnectOptions.maxAttempts}). Giving up.`
      );
      return;
    }

    // Calculate delay with jitter
    const baseDelay = this.reconnectState.currentDelayMs;
    const jitter = baseDelay * this.reconnectOptions.jitterFactor * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(baseDelay + jitter));

    this.reconnectState.attempt++;
    console.log(
      `[FeishuWS] Scheduling reconnection attempt ${this.reconnectState.attempt} ` +
      `in ${Math.round(delay / 1000)}s...`
    );

    this.reconnectState.timer = setTimeout(async () => {
      this.reconnectState.timer = null;

      if (this.reconnectState.intentionalStop) return;
      if (!this._cachedBaseConfig || !this._cachedEventDispatcher) {
        console.error('[FeishuWS] Cannot reconnect — no cached configuration.');
        return;
      }

      try {
        await this._connectWebSocket();
      } catch (error) {
        console.error(
          `[FeishuWS] Reconnection attempt ${this.reconnectState.attempt} failed:`,
          error
        );

        // Increase backoff delay
        this.reconnectState.currentDelayMs = Math.min(
          this.reconnectState.currentDelayMs * this.reconnectOptions.backoffMultiplier,
          this.reconnectOptions.maxDelayMs
        );

        // Schedule next attempt
        this._scheduleReconnect();
      }
    }, delay);
  }

  /**
   * BUG #8 FIX: Monitor connection health and trigger reconnection
   */
  private _startConnectionMonitor(): void {
    // Clear any existing monitor
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
    }

    this._monitorInterval = setInterval(() => {
      if (this.reconnectState.intentionalStop) {
        clearInterval(this._monitorInterval!);
        this._monitorInterval = null;
        return;
      }

      if (!this.isConnected && !this.reconnectState.connecting && !this.reconnectState.timer) {
        console.warn('[FeishuWS] Connection lost, triggering reconnection...');
        this._scheduleReconnect();
      }
    }, 30_000);

    if (this._monitorInterval.unref) {
      this._monitorInterval.unref();
    }
  }

  /**
   * BUG #8 FIX: Get reconnection status (useful for health checks / monitoring)
   */
  getReconnectStatus(): {
    connected: boolean;
    reconnecting: boolean;
    attempt: number;
    nextRetryMs: number | null;
    intentionalStop: boolean;
  } {
    return {
      connected: this.isConnected,
      reconnecting: this.reconnectState.connecting || this.reconnectState.timer !== null,
      attempt: this.reconnectState.attempt,
      nextRetryMs: this.reconnectState.timer ? this.reconnectState.currentDelayMs : null,
      intentionalStop: this.reconnectState.intentionalStop,
    };
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(data: MessageEventData): Promise<void> {
    // Track last active chat/user for proactive messaging
    if (data.message?.chat_id) {
      this._lastActiveChatId = data.message.chat_id;
    }
    if (data.sender?.sender_id?.union_id) {
      this._lastActiveUserId = data.sender.sender_id.union_id;
    }

    for (const handler of this.messageHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Message handler error:', error);
      }
    }
  }

  /**
   * Handle message read event
   */
  private async handleMessageRead(data: MessageReadEventData): Promise<void> {
    for (const handler of this.messageReadHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Message read handler error:', error);
      }
    }
  }

  /**
   * Handle message recalled event
   */
  private async handleMessageRecalled(data: MessageRecalledEventData): Promise<void> {
    for (const handler of this.messageRecalledHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Message recalled handler error:', error);
      }
    }
  }

  /**
   * Handle reaction created event
   */
  private async handleReactionCreated(data: ReactionEventData): Promise<void> {
    for (const handler of this.reactionCreatedHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Reaction created handler error:', error);
      }
    }
  }

  /**
   * Handle reaction deleted event
   */
  private async handleReactionDeleted(data: ReactionEventData): Promise<void> {
    for (const handler of this.reactionDeletedHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Reaction deleted handler error:', error);
      }
    }
  }

  /**
   * Handle chat disbanded event
   */
  private async handleChatDisbanded(data: ChatDisbandedEventData): Promise<void> {
    for (const handler of this.chatDisbandedHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Chat disbanded handler error:', error);
      }
    }
  }

  /**
   * Handle chat updated event
   */
  private async handleChatUpdated(data: ChatUpdatedEventData): Promise<void> {
    for (const handler of this.chatUpdatedHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Chat updated handler error:', error);
      }
    }
  }

  /**
   * Handle chat member added event
   */
  private async handleChatMemberAdded(data: ChatMemberAddedEventData): Promise<void> {
    for (const handler of this.chatMemberAddedHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Chat member added handler error:', error);
      }
    }
  }

  /**
   * Handle chat member deleted event
   */
  private async handleChatMemberDeleted(data: ChatMemberDeletedEventData): Promise<void> {
    for (const handler of this.chatMemberDeletedHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Chat member deleted handler error:', error);
      }
    }
  }

  /**
   * Handle bot added event
   */
  private async handleBotAdded(data: BotAddedEventData): Promise<void> {
    for (const handler of this.botAddedHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Bot added handler error:', error);
      }
    }
  }

  /**
   * Handle bot deleted event
   */
  private async handleBotDeleted(data: BotDeletedEventData): Promise<void> {
    for (const handler of this.botDeletedHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] Bot deleted handler error:', error);
      }
    }
  }

  /**
   * Handle P2P chat created event
   */
  private async handleP2PChatCreated(data: P2PChatCreatedEventData): Promise<void> {
    for (const handler of this.p2pChatCreatedHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] P2P chat created handler error:', error);
      }
    }
  }

  /**
   * Handle P2P chat entered event
   */
  private async handleP2PChatEntered(data: P2PChatEnteredEventData): Promise<void> {
    for (const handler of this.p2pChatEnteredHandlers) {
      try {
        await handler(data);
      } catch (error) {
        console.error('[FeishuWS] P2P chat entered handler error:', error);
      }
    }
  }

  /**
   * Send a text message
   */
  async sendTextMessage(
    receiveId: string,
    receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id',
    text: string
  ): Promise<void> {
    if (!this.client) {
      throw new Error('[FeishuWS] Client not initialized');
    }

    const response = await this.client.im.v1.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        content: JSON.stringify({ text }),
        msg_type: 'text',
      },
    });

    if (response.code !== 0) {
      console.error('[FeishuWS] Send message failed:', response.msg);
      throw new Error(`Send message failed: ${response.msg}`);
    }
  }

  /**
   * Send a post (rich text) message
   */
  async sendPostMessage(
    receiveId: string,
    receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id',
    content: string,
    options?: {
      title?: string;
    }
  ): Promise<void> {
    if (!this.client) {
      throw new Error('[FeishuWS] Client not initialized');
    }

    await sendPostMessage(this.client, receiveId, receiveIdType, content, options);
  }

  /**
   * Send markdown message (using md tag for proper rendering)
   */
  async sendMarkdownMessage(
    receiveId: string,
    receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id',
    markdown: string,
    options?: {
      title?: string;
    }
  ): Promise<void> {
    if (!this.client) {
      throw new Error('[FeishuWS] Client not initialized');
    }

    await sendMarkdownMessage(this.client, receiveId, receiveIdType, markdown, options);
  }

  /**
   * Send markdown card message (Schema 2.0)
   */
  async sendMarkdownCard(
    receiveId: string,
    receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id',
    markdown: string,
    options?: {
      title?: string;
      mentionTargets?: Array<{ openId: string; name?: string }>;
    }
  ): Promise<void> {
    if (!this.client) {
      throw new Error('[FeishuWS] Client not initialized');
    }

    await sendMarkdownCard(this.client, receiveId, receiveIdType, markdown, options);
  }

  /**
   * Reply to a message
   */
  async replyText(messageId: string, text: string): Promise<void> {
    if (!this.client) {
      throw new Error('[FeishuWS] Client not initialized');
    }

    const response = await this.client.im.v1.message.reply({
      path: {
        message_id: messageId,
      },
      data: {
        content: JSON.stringify({ text }),
        msg_type: 'text',
      },
    });

    if (response.code !== 0) {
      // Check if message was withdrawn (error code 230011 or 231003)
      if (response.code === 230011 || response.code === 231003) {
        logger.warn(`[FeishuWS] Message ${messageId} was withdrawn or not found, skipping reply`);
        return; // Exit gracefully without throwing
      }
      console.error('[FeishuWS] Reply message failed:', response.msg);
      throw new Error(`Reply message failed: ${response.msg}`);
    }
  }

  /**
   * Add a reaction to a message
   * @param messageId The message ID to react to
   * @param emojiType The emoji type (e.g., "SMILE", "THUMBSUP", "HEART", "OK")
   */
  async addReaction(messageId: string, emojiType: string): Promise<void> {
    if (!this.client) {
      throw new Error('[FeishuWS] Client not initialized');
    }

    const response = await this.client.im.v1.messageReaction.create({
      path: {
        message_id: messageId,
      },
      data: {
        reaction_type: {
          emoji_type: emojiType,
        },
      },
    });

    if (response.code !== 0) {
      console.error('[FeishuWS] Add reaction failed:', response.msg);
      // Don't throw - reaction failure is not critical
    }
  }

  /**
   * Reply with rich text (post) message
   * @param messageId The message ID to reply to
   * @param title Optional title
   * @param content Array of content blocks
   */
  async replyPost(
    messageId: string,
    content: { title?: string; blocks: PostContentBlock[] }
  ): Promise<void> {
    if (!this.client) {
      throw new Error('[FeishuWS] Client not initialized');
    }

    const postContent: PostContent = {
      zh_cn: {
        title: content.title || '',
        content: content.blocks,
      },
    };

    const response = await this.client.im.v1.message.reply({
      path: {
        message_id: messageId,
      },
      data: {
        content: JSON.stringify(postContent),
        msg_type: 'post',
      },
    });

    if (response.code !== 0) {
      // Check if message was withdrawn (error code 230011 or 231003)
      if (response.code === 230011 || response.code === 231003) {
        logger.warn(`[FeishuWS] Message ${messageId} was withdrawn or not found, skipping reply`);
        return; // Exit gracefully without throwing
      }
      console.error('[FeishuWS] Reply post failed:', response.msg);
      throw new Error(`Reply post failed: ${response.msg}`);
    }
  }

  /**
   * Reply with interactive card message
   * @param messageId The message ID to reply to
   * @param card Card configuration (Card Schema 2.0 or legacy)
   * @param options Optional parameters
   * @returns The created message ID
   */
  async replyCard(
    messageId: string,
    card: CardConfig | string,
    options?: { replyInThread?: boolean }
  ): Promise<string> {
    if (!this.client) {
      throw new Error('[FeishuWS] Client not initialized');
    }

    const cardContent = typeof card === 'string' ? card : JSON.stringify(card);

    // Debug: Log the card JSON being sent
    console.log('[FeishuWS] 📤 Sending card reply:', {
      messageId,
      cardPreview: cardContent.substring(0, 500),
    });

    const response = await this.client.im.v1.message.reply({
      path: {
        message_id: messageId,
      },
      data: {
        content: cardContent,
        msg_type: 'interactive',
      },
    });

    if (response.code !== 0) {
      // Check if message was withdrawn (error code 230011 or 231003)
      if (response.code === 230011 || response.code === 231003) {
        logger.warn(`[FeishuWS] Message ${messageId} was withdrawn or not found, skipping reply`);
        throw new Error(`Message withdrawn: ${response.code}`);
      }
      console.error('[FeishuWS] Reply card failed:', response.msg);
      throw new Error(`Reply card failed: ${response.msg}`);
    }

    // Return the message ID for streaming updates
    return response.data?.message_id || messageId;
  }

  /**
   * Update an existing card message using message.patch API
   * Used for streaming updates in Card Schema 2.0
   *
   * @param messageId The message ID to update
   * @param card Updated card configuration
   */
  async patchCard(
    messageId: string,
    card: CardConfig | string
  ): Promise<void> {
    if (!this.client) {
      throw new Error('[FeishuWS] Client not initialized');
    }

    const cardContent = typeof card === 'string' ? card : JSON.stringify(card);

    const response = await this.client.im.v1.message.patch({
      path: {
        message_id: messageId,
      },
      data: {
        content: cardContent,
      },
    });

    if (response.code !== 0) {
      // Check if message was withdrawn (error code 230011 or 231003)
      if (response.code === 230011 || response.code === 231003) {
        logger.warn(`[FeishuWS] Message ${messageId} was withdrawn or not found, cannot update`);
        throw new Error(`Message withdrawn: ${response.code}`);
      }
      logger.error('[FeishuWS] Patch card failed:', response.msg, 'code:', response.code);
      throw new Error(`Patch card failed: ${response.msg}`);
    }
  }

  /**
   * Build a simple card with title and content
   */
  buildSimpleCard(title: string, content: string, color?: string): string {
    return JSON.stringify({
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: title },
        template: color || 'blue',
      },
      elements: [
        {
          tag: 'markdown',
          content,
        },
      ],
    });
  }

  /**
   * Build a card with multiple sections
   */
  buildSectionCard(
    title: string,
    sections: { header?: string; content: string }[],
    color?: string
  ): string {
    const elements: CardElement[] = [];

    for (const section of sections) {
      if (section.header) {
        elements.push({
          tag: 'div',
          text: { tag: 'lark_md', content: `**${section.header}**` },
        });
      }
      elements.push({
        tag: 'markdown',
        content: section.content,
      });
      elements.push({ tag: 'hr' });
    }

    // Remove last hr
    if (elements.length > 0 && elements[elements.length - 1].tag === 'hr') {
      elements.pop();
    }

    return JSON.stringify({
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: title },
        template: color || 'blue',
      },
      elements,
    });
  }

  /**
   * Reply with markdown-formatted text (using post type with md tag)
   */
  async replyMarkdown(messageId: string, title: string, markdown: string): Promise<void> {
    const blocks: PostContentBlock[] = [
      [
        {
          tag: 'md',
          text: markdown,
        } as PostMdElement,
      ],
    ];

    await this.replyPost(messageId, { title, blocks });
  }

  /**
   * Reply with text, auto-detecting markdown and using rich text format
   * @param messageId The message ID to reply to
   * @param text The text content (may contain markdown)
   */
  async replyTextSmart(messageId: string, text: string): Promise<void> {
    // Detect if text contains markdown formatting
    const hasMarkdown = this.containsMarkdown(text);

    if (hasMarkdown) {
      // Use post format with md tag for markdown content
      await this.replyMarkdown(messageId, '', text);
    } else {
      // Use plain text for simple content
      await this.replyText(messageId, text);
    }
  }

  /**
   * Check if text contains markdown formatting
   */
  private containsMarkdown(text: string): boolean {
    // Check for common markdown patterns
    const markdownPatterns = [
      /\*\*.*?\*\*/,           // Bold **text**
      /\*.*?\*/,               // Italic *text* (but not just *)
      /~~.*?~~/,               // Strikethrough ~~text~~
      /`[^`]+`/,               // Inline code `code`
      /```[\s\S]*?```/,        // Code block ```code```
      /^\s*[-*+]\s/m,          // Unordered list - item
      /^\s*\d+\.\s/m,          // Ordered list 1. item
      /\[.*?\]\(.*?\)/,        // Link [text](url)
      /^>\s/m,                 // Blockquote > text
      /^#{1,6}\s/m,            // Heading # text
      /---|\*\*\*|___/,        // Horizontal rule
    ];

    return markdownPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Send an interactive card message
   */
  async sendCardMessage(
    receiveId: string,
    receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id',
    title: string,
    content: string
  ): Promise<void> {
    if (!this.client) {
      throw new Error('[FeishuWS] Client not initialized');
    }

    const response = await this.client.im.v1.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        content: Lark.messageCard.defaultCard({
          title,
          content,
        }),
        msg_type: 'interactive',
      },
    });

    if (response.code !== 0) {
      console.error('[FeishuWS] Send card failed:', response.msg);
      throw new Error(`Send card failed: ${response.msg}`);
    }
  }

  /**
   * Parse message content from event
   */
  parseMessageContent(data: MessageEventData): string {
    const content = data.message?.content;
    if (!content) return '';

    try {
      const parsed = JSON.parse(content);
      // Text message
      if (parsed.text) {
        return parsed.text;
      }
      // Rich text message
      if (parsed.title || parsed.content) {
        const texts: string[] = [];
        if (parsed.title) texts.push(parsed.title);
        if (Array.isArray(parsed.content)) {
          for (const block of parsed.content) {
            if (Array.isArray(block)) {
              for (const element of block) {
                if (element.text) texts.push(element.text);
              }
            }
          }
        }
        return texts.join('\n');
      }
      return content;
    } catch (error) {
      logger.debug('Failed to extract text from content, returning original:', error);
      return content;
    }
  }

  /**
   * Extract user ID from event
   */
  extractUserId(data: MessageEventData): string {
    return data.sender?.sender_id?.open_id
      || data.sender?.sender_id?.user_id
      || data.sender?.sender_id?.union_id
      || 'unknown';
  }

  /**
   * Extract chat ID from event
   */
  extractChatId(data: MessageEventData): string {
    return data.message?.chat_id || '';
  }

  /**
   * Extract message ID from event
   */
  extractMessageId(data: MessageEventData): string {
    return data.message?.message_id || '';
  }

  /**
   * Extract message type from event
   */
  extractMessageType(data: MessageEventData): string {
    return data.message?.message_type || 'text';
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let wsClientInstance: FeishuWSClient | null = null;

/**
 * Initialize the Feishu WebSocket client
 */
export function initFeishuWSClient(config: FeishuWSConfig): FeishuWSClient {
  wsClientInstance = new FeishuWSClient(config);
  return wsClientInstance;
}

/**
 * Get the Feishu WebSocket client instance
 */
export function getFeishuWSClient(): FeishuWSClient | null {
  return wsClientInstance;
}

/**
 * Reset the client instance (for testing)
 */
export function resetFeishuWSClient(): void {
  if (wsClientInstance) {
    wsClientInstance.stop();
  }
  wsClientInstance = null;
}
