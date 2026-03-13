/**
 * Entry Adapter Infrastructure
 *
 * 统一的入口适配器接口，支持 CLI、Feishu、Web、企业微信等多种入口
 */

import type { AppConfig, AIProvider } from '../config/schema';
import type { MessageGateway } from '../../app/gateway-channel';
import type { TaskDispatcher } from '../../app/dispatcher';
import type { createAgent } from '../../domain/agent';

/**
 * 入口适配器接口
 * 所有入口（CLI、Feishu、Web、企业微信等）都实现此接口
 */
export interface EntryAdapter {
  /** 适配器名称（唯一标识） */
  readonly name: string;

  /** 适配器类型 */
  readonly type: 'cli' | 'bot' | 'web' | 'daemon' | 'wecom' | 'dingtalk' | 'slack';

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
 */
export interface EntryContext {
  config: AppConfig;
  agent: ReturnType<typeof createAgent>;
  provider: AIProvider;
  model: string;
  gateway: MessageGateway;
  dispatcher: TaskDispatcher;
}

/**
 * 适配器状态
 */
export interface AdapterStatus {
  running: boolean;
  uptime?: number;
  connections?: number;
  errors?: string[];
  metadata?: Record<string, any>;
}

/**
 * Adapter 配置（在 beeclaw.json 中）
 */
export interface AdapterConfig {
  enabled: boolean;
  type: string;
  [key: string]: any;
}
