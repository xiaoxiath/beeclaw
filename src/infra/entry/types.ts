/**
 * Entry Adapter Infrastructure
 *
 * 统一的入口适配器接口，支持 CLI、Feishu、Web、企业微信等多种入口
 */

import type { AppConfig, AIProvider } from '../config/schema';
import type { MessageChannel, ChannelType } from '../../types/channel';
import type { FeishuConfig } from '../config/schema';

// ---------------------------------------------------------------------------
// Lightweight interfaces that mirror app-layer concrete types without
// importing them.  Adapters only need these minimal contracts.
// ---------------------------------------------------------------------------

/**
 * Generic message-gateway interface.
 * Mirrors the public surface of MultiChannelMessageGateway that adapters use.
 */
export interface MessageGateway {
  registerChannel(channel: MessageChannel): void;
  unregisterChannel(channelType: ChannelType): void;
}

/**
 * Generic task-dispatcher interface.
 * Kept intentionally minimal — adapters should not depend on concrete
 * TaskDispatcher implementation details.
 */
export interface TaskDispatcherLike {
  start(): void;
  stop(): void;
  submitTask(sessionId: string, type: string, payload: Record<string, unknown>, scheduledAt?: Date, cron?: string): Promise<string>;
  registerHandler(type: string, handler: (task: unknown) => Promise<void>): void;
  getStats(): Promise<unknown>;
}

/**
 * Feishu WebSocket initializer function type.
 * Injected via EntryContext so that adapter layer does not import app layer.
 */
export type FeishuWSInitializer = (config: FeishuConfig) => Promise<void>;

/**
 * 入口适配器接口
 * 所有入口（CLI、Feishu、Web、企业微信等）都实现此接口
 */
export interface EntryAdapter {
  /** 适配器名称（唯一标识） */
  readonly name: string;

  /** 适配器类型 */
  readonly type: 'cli' | 'bot' | 'web' | 'daemon';

  /** 初始化适配器 */
  initialize(context: EntryContext): Promise<void>;

  /** 启动适配器 */
  start(): Promise<void>;

  /** 停止适配器 */
  stop(): Promise<void>;

  /** 健康检查 */
  healthCheck(): Promise<boolean>;

  /** 获取适配器状态 */
  getStatus(): AdapterStatus;
}

/**
 * Adapter 初始化上下文
 *
 * Uses lightweight interfaces instead of concrete app/domain types so that
 * the infra layer never imports from app/ or domain/.
 */
export interface EntryContext {
  config: AppConfig;
  /** Agent instance — opaque to adapters, typed as `unknown`. */
  agent: unknown;
  provider: AIProvider;
  model: string;
  gateway?: MessageGateway;
  dispatcher?: TaskDispatcherLike;
  /** Injected Feishu WS initializer (set by app layer at bootstrap). */
  feishuWSInitializer?: FeishuWSInitializer;
}

/**
 * 适配器状态
 */
export interface AdapterStatus {
  running: boolean;
  uptime?: number;
  connections?: number;
  errors?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Adapter 配置（在 beeclaw.json 中）
 */
export interface AdapterConfig {
  enabled: boolean;
  type: string;
  [key: string]: unknown;
}
