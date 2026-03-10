# Beeclaw 架构升级技术方案设计

> **版本**: v1.0  
> **日期**: 2026-03-10  
> **范围**: P0 MessageChannel/Gateway 抽象 · P0 统一 TaskDispatcher · P1 SQLite + Drizzle ORM

---

## 目录

- [一、背景与目标](#一背景与目标)
- [二、RFC-01: MessageChannel / Gateway 多通道消息抽象](#二rfc-01-messagechannel--gateway-多通道消息抽象)
  - [2.1 现状分析](#21-现状分析)
  - [2.2 目标架构](#22-目标架构)
  - [2.3 核心接口设计](#23-核心接口设计)
  - [2.4 MessageGateway 实现](#24-messagegateway-实现)
  - [2.5 现有通道适配](#25-现有通道适配)
  - [2.6 流式输出支持](#26-流式输出支持)
  - [2.7 迁移策略](#27-迁移策略)
  - [2.8 文件结构](#28-文件结构)
- [三、RFC-02: 统一 TaskDispatcher + per-session 串行锁](#三rfc-02-统一-taskdispatcher--per-session-串行锁)
  - [3.1 现状分析](#31-现状分析)
  - [3.2 目标架构](#32-目标架构)
  - [3.3 核心类设计](#33-核心类设计)
  - [3.4 per-session 串行锁原理](#34-per-session-串行锁原理)
  - [3.5 Handler 路由注册](#35-handler-路由注册)
  - [3.6 Cron Job 调度](#36-cron-job-调度)
  - [3.7 与现有模块整合](#37-与现有模块整合)
  - [3.8 迁移策略](#38-迁移策略)
  - [3.9 文件结构](#39-文件结构)
- [四、RFC-03: 引入 SQLite + Drizzle ORM](#四rfc-03-引入-sqlite--drizzle-orm)
  - [4.1 现状分析](#41-现状分析)
  - [4.2 目标架构](#42-目标架构)
  - [4.3 DataConnection 设计](#43-dataconnection-设计)
  - [4.4 Schema 设计](#44-schema-设计)
  - [4.5 Migration 策略](#45-migration-策略)
  - [4.6 SessionManager 改造](#46-sessionmanager-改造)
  - [4.7 与 TaskDispatcher 集成](#47-与-taskdispatcher-集成)
  - [4.8 与 JSONL 文件的分工](#48-与-jsonl-文件的分工)
  - [4.9 迁移策略](#49-迁移策略)
  - [4.10 文件结构](#410-文件结构)
- [五、三个 RFC 的依赖关系与实施路线](#五三个-rfc-的依赖关系与实施路线)
- [六、风险与缓解](#六风险与缓解)

---

## 一、背景与目标

Beeclaw 当前是一个支持 CLI 和飞书 Bot 双通道的 AI 助手，基于 Bun + TypeScript 构建。在实际运行中暴露出以下核心问题：

1. **通道耦合**：飞书集成硬编码在 `src/feishu/`，CLI 在 `src/cli/`，两者没有统一的消息抽象。新增通道（如 Slack、Telegram、微信）需要从头实现完整的消息收发、会话管理逻辑，代码复用率低。

2. **并发竞争**：虽然已有 `SessionMessageQueue` 做了基本的 per-session 加锁，但任务调度散落在 `src/queue/`（bunqueue 通用队列）和 `src/proactive/`（cron daemon）中，缺乏统一的分发入口和任务生命周期管理。

3. **持久化脆弱**：所有数据（Session、Memory、Queue）都依赖文件系统（JSON/JSONL），缺乏结构化索引。session 列表查询需要遍历目录，任务状态查询无法跨重启存活，无法为未来的 Web Dashboard 提供高效的数据支撑。

本次设计参考了 [Agentara](https://github.com/MagicCube/agentara) 在 MessageChannel/Gateway 抽象、TaskDispatcher per-session 串行锁、SQLite + Drizzle ORM 持久化三方面的优秀设计，结合 Beeclaw 自身的多 Provider 支持、Skills 进化体系、Plugin 系统等特色，给出渐进式的改造方案。

**设计原则**：

- **接口驱动**：先定义 TypeScript 接口/类型，再实现具体逻辑
- **渐进迁移**：每个 RFC 独立可交付，通过 adapter 层兼容旧代码
- **Beeclaw 特色保留**：多 Provider、Plugin Hooks、Skills 系统不受影响
- **零运行时新依赖**（除 Drizzle ORM 外）：充分利用 Bun 内置能力

---

## 二、RFC-01: MessageChannel / Gateway 多通道消息抽象

### 2.1 现状分析

当前 Beeclaw 的消息流如下：

```
飞书 WebSocket → src/feishu/ws-client.ts → src/routes/ → sendProactiveMessage()
CLI stdin     → src/cli/                  → sendProactiveMessage()
```

**问题清单**：

| # | 问题 | 影响 |
|---|------|------|
| 1 | 飞书消息发送 API（`sendTextMessage`、`sendCardMessage`、`editMessage`）直接在 `src/routes/` 里调用，与业务逻辑混合 | 新增通道时需要重写消息路由和发送逻辑 |
| 2 | CLI 和飞书的消息格式不统一 | `sendProactiveMessage()` 内部需要感知通道类型来做差异化处理 |
| 3 | 无流式消息更新 | 飞书支持 `editMessage`（patch），但当前只在 AI 完整响应后一次性发送 |
| 4 | `channelHandlers` 是一个裸 Map，注册/查找都依赖字符串 key，无类型安全 | 运行时错误风险 |
| 5 | 消息出站路由依赖 session 的 `channel` 字段（字符串），无编译时校验 | 通道不匹配时静默失败 |

### 2.2 目标架构

```
                   ┌─────────────────────────────────┐
                   │        MessageGateway            │
                   │  (EventEmitter + channel router) │
                   └───┬─────────────┬────────────┬───┘
                       │             │            │
               ┌───────▼───┐  ┌─────▼─────┐  ┌───▼──────────┐
               │ FeishuChannel │ CLIChannel │  │ Future: Slack │
               │ (WebSocket)   │ (stdin/out)│  │ Telegram ...  │
               └───────────┘  └───────────┘  └──────────────┘
                       ▲             ▲
                       │             │
                  message:inbound  message:inbound
                       │             │
                   ┌───┴─────────────┴───┐
                   │  Gateway 统一分发到    │
                   │  TaskDispatcher       │
                   └─────────────────────┘
```

### 2.3 核心接口设计

#### 2.3.1 消息类型

```typescript
// src/shared/messaging/types.ts

import { z } from "zod";

/** 消息角色 */
export type MessageRole = "user" | "assistant" | "system" | "tool";

/** 内容块：支持文本、图片、文件 */
export const ContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image"),
    url: z.string().optional(),
    base64: z.string().optional(),
    mime_type: z.string().optional(),
  }),
  z.object({
    type: z.literal("file"),
    url: z.string(),
    filename: z.string(),
    mime_type: z.string().optional(),
  }),
]);

export type ContentPart = z.infer<typeof ContentPartSchema>;

/** 统一消息内容：可以是纯文本或多模态内容 */
export type MessageContent = string | ContentPart[];

/** 入站用户消息 */
export interface UserMessage {
  /** 全局唯一消息 ID（由通道生成） */
  id: string;
  /** 该消息关联的 session ID */
  session_id: string;
  /** 通道类型（由 Gateway 自动注入） */
  channel_type?: string;
  /** 发送者标识 */
  sender: {
    id: string;
    name?: string;
    /** 通道原始 ID（飞书 open_id / CLI user 等） */
    raw_id?: string;
  };
  /** 消息内容 */
  content: MessageContent;
  /** 是否 @ 了 bot */
  mentioned?: boolean;
  /** 原始通道 metadata（飞书 chat_id, message_type 等） */
  metadata?: Record<string, unknown>;
  /** 消息创建时间 (epoch ms) */
  created_at: number;
}

/** 出站助手消息 */
export interface AssistantMessage {
  /** 消息 ID（发送后由通道回填） */
  id: string;
  /** 关联 session ID */
  session_id: string;
  /** 消息内容 */
  content: MessageContent;
  /** 是否为流式中间状态 */
  streaming?: boolean;
  /** 附加 metadata */
  metadata?: Record<string, unknown>;
  /** 消息创建时间 (epoch ms) */
  created_at: number;
}
```

#### 2.3.2 MessageChannel 接口

```typescript
// src/shared/messaging/message-channel.ts

import type EventEmitter from "eventemitter3";
import type { AssistantMessage, UserMessage } from "./types";

/** 通道事件类型 */
export interface MessageChannelEventTypes {
  "message:inbound": (message: UserMessage) => void;
}

/**
 * 抽象消息通道接口。
 *
 * 每个通道（飞书、CLI、Slack...）实现此接口。
 * 通道负责：
 *   1. 监听外部消息并发射 `message:inbound` 事件
 *   2. 发送出站消息（post / reply / update）
 *   3. 管理自身的连接生命周期
 */
export interface MessageChannel
  extends EventEmitter<MessageChannelEventTypes> {
  /** 通道类型标识符（如 "feishu"、"cli"、"slack"） */
  readonly type: string;

  /** 启动通道，开始监听入站消息 */
  start(): Promise<void>;

  /** 停止通道，释放资源 */
  stop(): Promise<void>;

  /**
   * 主动发送消息（非回复）
   * @returns 发送后的消息（含通道分配的 id）
   */
  postMessage(
    message: Omit<AssistantMessage, "id">
  ): Promise<AssistantMessage>;

  /**
   * 回复某条入站消息
   * @param inboundMessageId - 被回复的原始消息 ID
   * @param message - 出站消息体
   * @param options.streaming - 是否为流式模式（首次发送占位，后续 update）
   */
  replyMessage(
    inboundMessageId: string,
    message: Omit<AssistantMessage, "id">,
    options?: { streaming?: boolean }
  ): Promise<AssistantMessage>;

  /**
   * 更新已发送消息的内容（用于流式输出）
   * @param message - 含更新内容的完整消息
   * @param options.streaming - 是否仍在流式中（false 表示最终内容）
   */
  updateMessageContent(
    message: AssistantMessage,
    options?: { streaming?: boolean }
  ): Promise<void>;
}
```

#### 2.3.3 MessageGateway 接口

```typescript
// src/shared/messaging/message-gateway.ts

import type EventEmitter from "eventemitter3";
import type { MessageChannel } from "./message-channel";
import type { AssistantMessage, UserMessage } from "./types";

/** Gateway 事件类型 */
export interface MessageGatewayEventTypes {
  "message:inbound": (message: UserMessage) => void;
}

/**
 * 消息网关接口。
 *
 * 管理多个 MessageChannel，统一入站事件，
 * 基于 session 的 channel_type 路由出站消息。
 */
export interface MessageGateway
  extends EventEmitter<MessageGatewayEventTypes> {
  /** 注册消息通道 */
  registerChannel(channel: MessageChannel): void;

  /** 启动网关及所有已注册通道 */
  start(): Promise<void>;

  /** 停止网关及所有通道 */
  stop(): Promise<void>;

  /** 主动推送消息（路由到 session 对应的通道） */
  postMessage(
    message: Omit<AssistantMessage, "id">
  ): Promise<AssistantMessage>;

  /** 回复消息 */
  replyMessage(
    messageId: string,
    message: Omit<AssistantMessage, "id">,
    options?: { streaming?: boolean }
  ): Promise<AssistantMessage>;

  /** 更新消息内容 */
  updateMessageContent(
    message: AssistantMessage,
    options?: { streaming?: boolean }
  ): Promise<void>;
}
```

### 2.4 MessageGateway 实现

```typescript
// src/kernel/messaging/multi-channel-message-gateway.ts

import EventEmitter from "eventemitter3";
import type {
  AssistantMessage,
  MessageChannel,
  MessageGateway,
  MessageGatewayEventTypes,
  UserMessage,
} from "../../shared/messaging";
import { logger } from "../../utils/logger";

/**
 * MultiChannelMessageGateway
 *
 * 核心设计：
 *   1. 多通道注册：channels Map<type, channel>
 *   2. 入站统一：每个 channel 的 message:inbound 被网关捕获，
 *      注入 channel_type 后重新 emit
 *   3. 出站路由：通过 resolveChannel(sessionId) 查询
 *      session 元数据中的 channel_type，路由到正确通道
 *
 * 路由查找策略（渐进升级）：
 *   Phase 1: 内存 Map 缓存 sessionId → channelType
 *   Phase 2: 接入 SQLite 后从 sessions 表查 channel_type
 */
export class MultiChannelMessageGateway
  extends EventEmitter<MessageGatewayEventTypes>
  implements MessageGateway
{
  private _channels: Map<string, MessageChannel> = new Map();

  /**
   * Phase 1: 内存级 session → channel_type 映射。
   * 在 RFC-03 引入 SQLite 后，替换为数据库查询。
   */
  private _sessionChannelMap: Map<string, string> = new Map();

  /** 注册通道 */
  registerChannel(channel: MessageChannel): void {
    if (this._channels.has(channel.type)) {
      throw new Error(
        `Channel type "${channel.type}" is already registered.`
      );
    }
    this._channels.set(channel.type, channel);

    channel.on("message:inbound", (message: UserMessage) => {
      // 注入 channel_type
      message.channel_type = channel.type;
      // 缓存映射
      this._sessionChannelMap.set(message.session_id, channel.type);
      // 统一发射
      this.emit("message:inbound", message);
    });

    logger.info(`[Gateway] Registered channel: ${channel.type}`);
  }

  /** 绑定 session 到指定通道（供 SessionManager 调用） */
  bindSession(sessionId: string, channelType: string): void {
    this._sessionChannelMap.set(sessionId, channelType);
  }

  async start(): Promise<void> {
    for (const [type, channel] of this._channels) {
      logger.info(`[Gateway] Starting channel: ${type}`);
      await channel.start();
    }
    logger.info("[Gateway] Message gateway started");
  }

  async stop(): Promise<void> {
    for (const [type, channel] of this._channels) {
      logger.info(`[Gateway] Stopping channel: ${type}`);
      await channel.stop();
    }
    logger.info("[Gateway] Message gateway stopped");
  }

  async postMessage(
    message: Omit<AssistantMessage, "id">
  ): Promise<AssistantMessage> {
    const channel = this._resolveChannel(message.session_id);
    return channel.postMessage(message);
  }

  async replyMessage(
    messageId: string,
    message: Omit<AssistantMessage, "id">,
    options?: { streaming?: boolean }
  ): Promise<AssistantMessage> {
    const channel = this._resolveChannel(message.session_id);
    return channel.replyMessage(messageId, message, options);
  }

  async updateMessageContent(
    message: AssistantMessage,
    options?: { streaming?: boolean }
  ): Promise<void> {
    const channel = this._resolveChannel(message.session_id);
    await channel.updateMessageContent(message, options);
  }

  /** 解析 session 对应的通道 */
  private _resolveChannel(sessionId: string): MessageChannel {
    const channelType = this._sessionChannelMap.get(sessionId);
    if (!channelType) {
      throw new Error(
        `Cannot resolve channel for session "${sessionId}": no channel_type binding.`
      );
    }
    const channel = this._channels.get(channelType);
    if (!channel) {
      throw new Error(
        `Channel type "${channelType}" is not registered.`
      );
    }
    return channel;
  }
}
```

### 2.5 现有通道适配

#### 2.5.1 FeishuChannel 适配器

```typescript
// src/channels/feishu/feishu-channel.ts

import EventEmitter from "eventemitter3";
import type {
  MessageChannel,
  MessageChannelEventTypes,
  AssistantMessage,
  UserMessage,
} from "../../shared/messaging";
import type { FeishuWSConfig } from "../../feishu/ws-client";
import {
  FeishuWSClient,
  sendTextMessage,
  sendCardMessage,
  editMessage,
  replyMessage as feishuReply,
} from "../../feishu";
import { generateSessionId } from "../../session";
import { logger } from "../../utils/logger";

/**
 * 飞书消息通道实现。
 *
 * 底层复用现有的 `src/feishu/` 模块，
 * 将其消息事件转换为标准 MessageChannel 事件。
 */
export class FeishuChannel
  extends EventEmitter<MessageChannelEventTypes>
  implements MessageChannel
{
  readonly type = "feishu";

  private _wsClient: FeishuWSClient | null = null;
  private _config: FeishuWSConfig;

  /** 飞书 message_id → session_id 的反向映射，用于出站路由 */
  private _messageSessionMap: Map<string, string> = new Map();

  constructor(config: FeishuWSConfig) {
    super();
    this._config = config;
  }

  async start(): Promise<void> {
    this._wsClient = new FeishuWSClient(this._config);

    // 注册消息处理器：将飞书事件转换为标准 UserMessage
    this._wsClient.onMessage(async (event) => {
      const chatId = event.message.chat_id;
      const senderId = event.sender.sender_id?.open_id || "unknown";
      const senderName = event.sender.sender_id?.user_id || senderId;
      const messageId = event.message.message_id;

      const sessionId = generateSessionId("feishu", chatId);

      // 解析消息内容
      const content = this._parseFeishuContent(event);

      const userMessage: UserMessage = {
        id: messageId,
        session_id: sessionId,
        sender: {
          id: senderId,
          name: senderName,
          raw_id: senderId,
        },
        content,
        mentioned: event.message.mentions?.some(
          (m: any) => m.id?.open_id === this._config.botOpenId
        ),
        metadata: {
          chat_id: chatId,
          chat_type: event.message.chat_type,
          message_type: event.message.message_type,
          feishu_message_id: messageId,
        },
        created_at: Date.now(),
      };

      // 缓存 messageId → sessionId 映射
      this._messageSessionMap.set(messageId, sessionId);

      this.emit("message:inbound", userMessage);
    });

    await this._wsClient.start();
    logger.info("[FeishuChannel] Started");
  }

  async stop(): Promise<void> {
    if (this._wsClient) {
      await this._wsClient.close();
    }
    logger.info("[FeishuChannel] Stopped");
  }

  async postMessage(
    message: Omit<AssistantMessage, "id">
  ): Promise<AssistantMessage> {
    const chatId = this._resolveChatId(message.session_id);
    const text = typeof message.content === "string"
      ? message.content
      : this._contentPartsToText(message.content);

    const result = await sendTextMessage(chatId, "chat_id", text);

    return {
      ...message,
      id: result.message_id || `feishu_${Date.now()}`,
    } as AssistantMessage;
  }

  async replyMessage(
    inboundMessageId: string,
    message: Omit<AssistantMessage, "id">,
    options?: { streaming?: boolean }
  ): Promise<AssistantMessage> {
    const text = typeof message.content === "string"
      ? message.content
      : this._contentPartsToText(message.content);

    if (options?.streaming) {
      // 流式模式：先发送占位消息，后续通过 updateMessageContent 更新
      const result = await feishuReply(inboundMessageId, "⏳ 思考中...");
      return {
        ...message,
        id: result.message_id || `feishu_${Date.now()}`,
        streaming: true,
      } as AssistantMessage;
    }

    const result = await feishuReply(inboundMessageId, text);

    return {
      ...message,
      id: result.message_id || `feishu_${Date.now()}`,
    } as AssistantMessage;
  }

  async updateMessageContent(
    message: AssistantMessage,
    options?: { streaming?: boolean }
  ): Promise<void> {
    const text = typeof message.content === "string"
      ? message.content
      : this._contentPartsToText(message.content);

    // 使用飞书 editMessage API 更新已发送消息
    await editMessage(message.id, text);
  }

  /** 从 session_id 中恢复 chat_id */
  private _resolveChatId(sessionId: string): string {
    // sessionId 格式: feishu-{chatId}
    const parts = sessionId.split("-");
    if (parts.length >= 2) {
      return parts.slice(1).join("-");
    }
    throw new Error(`Cannot resolve chat_id from session: ${sessionId}`);
  }

  /** 将飞书事件转换为标准内容 */
  private _parseFeishuContent(event: any): string | import("../../shared/messaging").ContentPart[] {
    const messageType = event.message.message_type;
    const contentStr = event.message.content;

    if (messageType === "text") {
      const parsed = JSON.parse(contentStr);
      return parsed.text || "";
    }

    if (messageType === "image") {
      return [
        { type: "image" as const, url: event.message.image_key || "" },
      ];
    }

    // 其他类型暂时转为文本
    return contentStr || "[Unsupported message type]";
  }

  /** ContentPart[] → 纯文本（降级用） */
  private _contentPartsToText(parts: import("../../shared/messaging").ContentPart[]): string {
    return parts
      .map((p) => {
        if (p.type === "text") return p.text;
        if (p.type === "image") return "[图片]";
        if (p.type === "file") return `[文件: ${p.filename}]`;
        return "[未知内容]";
      })
      .join("");
  }
}
```

#### 2.5.2 CLIChannel 适配器

```typescript
// src/channels/cli/cli-channel.ts

import EventEmitter from "eventemitter3";
import type {
  MessageChannel,
  MessageChannelEventTypes,
  AssistantMessage,
  UserMessage,
} from "../../shared/messaging";

/**
 * CLI 消息通道实现。
 *
 * 监听 stdin，输出到 stdout。
 * 作为本地调试和开发的默认通道。
 */
export class CLIChannel
  extends EventEmitter<MessageChannelEventTypes>
  implements MessageChannel
{
  readonly type = "cli";

  private _sessionId = "cli-default";
  private _running = false;

  async start(): Promise<void> {
    this._running = true;
    this._listenStdin();
    console.log("[CLIChannel] Started. Type your message:");
  }

  async stop(): Promise<void> {
    this._running = false;
  }

  async postMessage(
    message: Omit<AssistantMessage, "id">
  ): Promise<AssistantMessage> {
    const text = typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);

    console.log(`\n🤖 ${text}\n`);

    return {
      ...message,
      id: `cli_${Date.now()}`,
    } as AssistantMessage;
  }

  async replyMessage(
    _inboundMessageId: string,
    message: Omit<AssistantMessage, "id">,
    _options?: { streaming?: boolean }
  ): Promise<AssistantMessage> {
    // CLI 模式下 reply 等同于 post
    return this.postMessage(message);
  }

  async updateMessageContent(
    message: AssistantMessage,
    options?: { streaming?: boolean }
  ): Promise<void> {
    if (!options?.streaming) {
      // 最终内容 — 输出完整响应
      const text = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
      // 清除上一行并重写（简单模式）
      process.stdout.write(`\r🤖 ${text}\n`);
    } else {
      // 流式中间状态 — 覆盖当前行
      const text = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
      process.stdout.write(`\r🤖 ${text}`);
    }
  }

  private _listenStdin(): void {
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "You: ",
    });

    rl.prompt();

    rl.on("line", (line: string) => {
      if (!this._running) return;

      const text = line.trim();
      if (!text) {
        rl.prompt();
        return;
      }

      const userMessage: UserMessage = {
        id: `cli_in_${Date.now()}`,
        session_id: this._sessionId,
        sender: { id: "cli-user", name: "CLI User" },
        content: text,
        created_at: Date.now(),
      };

      this.emit("message:inbound", userMessage);
      rl.prompt();
    });

    rl.on("close", () => {
      this._running = false;
    });
  }
}
```

### 2.6 流式输出支持

流式输出是 MessageChannel 抽象的核心增值功能。在当前 Beeclaw 中，AI 响应是在 `agent.chat()` 完成后一次性返回的。引入 Channel 抽象后，可以逐步启用流式输出：

**Phase 1（本次 RFC）**：接口层支持 streaming 参数，但实际行为仍然是等待完整响应后一次发送。

**Phase 2（后续迭代）**：当 `AgentRunner` 接口改为 `AsyncIterableIterator` 后，配合以下流程实现端到端流式输出：

```
AgentRunner.stream()
    │
    │  yield partial content
    ▼
TaskDispatcher handler
    │
    │  gateway.replyMessage(msgId, partialContent, { streaming: true })
    │  ... (首次创建占位消息)
    │
    │  gateway.updateMessageContent(updatedMsg, { streaming: true })
    │  ... (中间状态更新)
    │
    │  gateway.updateMessageContent(finalMsg, { streaming: false })
    │  ... (最终内容)
    ▼
FeishuChannel.updateMessageContent()
    │
    │  editMessage(feishu_message_id, newContent)
    ▼
飞书 API → 用户看到实时更新的消息
```

**流式节流策略**（飞书 API 限频保护）：

```typescript
// src/channels/feishu/stream-throttle.ts

/**
 * 流式更新节流器。
 *
 * 飞书 editMessage API 限频约 5 QPS/message。
 * 此节流器确保每条消息的更新间隔不小于 minIntervalMs。
 * 在间隔内的中间状态会被合并，仅发送最新内容。
 */
export class StreamThrottle {
  private _pending: Map<string, {
    message: AssistantMessage;
    timer: ReturnType<typeof setTimeout> | null;
  }> = new Map();

  constructor(
    private _minIntervalMs: number = 300,
    private _flushFn: (message: AssistantMessage) => Promise<void>
  ) {}

  /** 提交一次更新。节流器会确保不超过限频。 */
  async update(message: AssistantMessage): Promise<void> {
    const existing = this._pending.get(message.id);

    if (existing) {
      // 合并：替换内容，保留 timer
      existing.message = message;
      return;
    }

    // 首次：立即发送
    await this._flushFn(message);

    // 设置冷却期
    const entry = { message, timer: null as ReturnType<typeof setTimeout> | null };
    entry.timer = setTimeout(() => {
      const latest = this._pending.get(message.id);
      this._pending.delete(message.id);
      if (latest && latest.message !== message) {
        // 冷却期内有新内容，发送最新版本
        this._flushFn(latest.message);
      }
    }, this._minIntervalMs);

    this._pending.set(message.id, entry);
  }

  /** 强制刷新所有挂起的更新 */
  async flush(): Promise<void> {
    for (const [id, entry] of this._pending) {
      if (entry.timer) clearTimeout(entry.timer);
      await this._flushFn(entry.message);
    }
    this._pending.clear();
  }
}
```

### 2.7 迁移策略

| 阶段 | 内容 | 影响范围 |
|------|------|---------|
| **Step 1** | 新增 `src/shared/messaging/` 目录，定义类型和接口 | 纯增量，零破坏 |
| **Step 2** | 实现 `MultiChannelMessageGateway` | 纯增量 |
| **Step 3** | 实现 `FeishuChannel` 适配器，内部委托现有 `src/feishu/` | 纯增量 |
| **Step 4** | 实现 `CLIChannel` 适配器 | 纯增量 |
| **Step 5** | 在 `initApp()` 中创建 Gateway 并注册通道 | 修改 `src/app/index.ts` |
| **Step 6** | 将 `src/routes/` 中的消息发送调用替换为 `gateway.replyMessage()` | 修改路由层 |
| **Step 7** | 删除 `registerChannelHandler()` 和 `channelHandlers` Map | 清理旧代码 |

**向后兼容**：Step 5-6 可以通过 feature flag 控制，`USE_GATEWAY=true` 时走新路径，否则走旧路径，直到新路径稳定后移除旧代码。

### 2.8 文件结构

```
src/
├── shared/
│   └── messaging/
│       ├── index.ts                    # re-export
│       ├── types.ts                    # UserMessage, AssistantMessage, ContentPart
│       ├── message-channel.ts          # MessageChannel 接口
│       └── message-gateway.ts          # MessageGateway 接口
├── kernel/
│   └── messaging/
│       ├── index.ts
│       └── multi-channel-message-gateway.ts  # Gateway 实现
├── channels/
│   ├── feishu/
│   │   ├── feishu-channel.ts           # FeishuChannel 实现
│   │   └── stream-throttle.ts          # 流式节流器
│   └── cli/
│       └── cli-channel.ts              # CLIChannel 实现
```

---

## 三、RFC-02: 统一 TaskDispatcher + per-session 串行锁

### 3.1 现状分析

当前 Beeclaw 的任务处理散落在多个模块中：

| 模块 | 职责 | 问题 |
|------|------|------|
| `src/queue/manager.ts` | bunqueue 通用队列管理（search、skill、reminder 等 8 种队列） | 与消息处理无关，是后台任务队列 |
| `src/utils/session-lock.ts` | `SessionMessageQueue` — per-session 加锁 | 仅保护 `sendProactiveMessage()`，不覆盖后台任务 |
| `src/proactive/` | Daemon 定时任务（memory 压缩、目标检查、提醒） | 自成体系，与 queue 模块无关联 |
| `src/session/index.ts` | `sendProactiveMessage()` — 消息处理主入口 | 500+ 行巨型函数，混合了 Agent 调用、session 管理、消息发送 |
| `src/routes/` | 飞书事件路由，调用 `sendProactiveMessage()` | 直接耦合 session 和 feishu |

**核心问题**：

1. **没有统一的任务入口**：一条用户消息从飞书进入后，经历 `routes → sendProactiveMessage → agent.chat()`，整个链路是同步的函数调用，不经过队列。只有 deep analysis 等后台任务才进入 bunqueue。

2. **SessionMessageQueue 是应急方案**：它通过 Promise 链实现了 per-session 串行化，但仅在 `sendProactiveMessage()` 入口处生效，缺乏任务状态持久化和可观测性。

3. **任务生命周期不可查询**：`sendProactiveMessage()` 没有返回 taskId，无法跟踪一条消息从接收到处理完成的全过程。

### 3.2 目标架构

```
Gateway.on("message:inbound")
    │
    ▼
TaskDispatcher.dispatch(sessionId, { type: "inbound_message", ... })
    │
    │  bunqueue 入队
    │  SQLite 写入 tasks 表 (status: pending)
    │
    ▼
TaskDispatcher._processJob()
    │
    │  获取 per-session 串行锁
    │  等待该 session 前一个任务完成
    │
    ▼
Handler: "inbound_message"
    │
    │  1. resolveSession(sessionId)
    │  2. agent.chat(message)
    │  3. gateway.replyMessage(...)
    │  4. session.addMessage(response)
    │
    │  SQLite 更新 tasks 表 (status: completed)
    ▼
释放 per-session 锁，下一个任务开始
```

### 3.3 核心类设计

```typescript
// src/kernel/tasking/task-dispatcher.ts

import type { Job } from "bunqueue/client";
import { Queue, Worker } from "bunqueue/client";
import { logger } from "../../utils/logger";

// ============================================================
// 类型定义
// ============================================================

/**
 * 任务载荷基础接口。
 * 所有任务类型通过 `type` 字段进行区分。
 */
export interface TaskPayloadBase {
  type: string;
}

/** 入站消息任务 */
export interface InboundMessagePayload extends TaskPayloadBase {
  type: "inbound_message";
  /** 原始入站消息 */
  message: import("../../shared/messaging").UserMessage;
}

/** 主动推送任务 */
export interface ProactiveMessagePayload extends TaskPayloadBase {
  type: "proactive_message";
  /** 推送消息内容 */
  content: string;
  /** 目标用户 */
  userId?: string;
  /** 上下文 */
  context?: Record<string, unknown>;
}

/** Cron 定时任务 */
export interface CronjobPayload extends TaskPayloadBase {
  type: "cronjob";
  /** cron 表达式 */
  cron_pattern: string;
  /** 任务名称 */
  job_name: string;
  /** 任务参数 */
  params?: Record<string, unknown>;
}

/** 后台分析任务 */
export interface AnalysisPayload extends TaskPayloadBase {
  type: "analysis";
  /** 分析任务列表 */
  tasks: string[];
  /** 原始消息 */
  originalMessage: string;
  /** 上下文 */
  context?: string;
}

/** 联合任务载荷类型 */
export type TaskPayload =
  | InboundMessagePayload
  | ProactiveMessagePayload
  | CronjobPayload
  | AnalysisPayload;

/** 任务状态 */
export type TaskStatus = "pending" | "running" | "completed" | "failed";

/**
 * 任务处理函数类型。
 * @param taskId - bunqueue 分配的任务 ID
 * @param sessionId - 任务所属的 session
 * @param payload - 任务载荷
 */
export type TaskHandler<P extends TaskPayload = TaskPayload> = (
  taskId: string,
  sessionId: string,
  payload: P,
) => Promise<void>;

// ============================================================
// Dispatcher 配置
// ============================================================

export interface TaskDispatcherOptions {
  /** Worker 并发数（跨 session），默认 4 */
  concurrency?: number;

  /** bunqueue 数据库路径 */
  queueDbPath?: string;

  /** 最大重试次数，默认 2 */
  maxRetries?: number;

  /**
   * 任务状态变更回调。
   * 在 RFC-03 引入 SQLite 前使用回调模式，
   * 引入后替换为直接数据库写入。
   */
  onTaskStatusChange?: (
    taskId: string,
    sessionId: string,
    status: TaskStatus,
    payload: TaskPayload
  ) => void;
}

// ============================================================
// TaskDispatcher 实现
// ============================================================

const QUEUE_NAME = "beeclaw:tasks";

/** 内部队列数据结构 */
interface TaskJobData {
  session_id: string;
  payload: TaskPayload;
}

/**
 * 统一任务调度器。
 *
 * 设计要点：
 *   1. 单一入口：所有异步任务（消息处理、定时任务、后台分析）
 *      都通过 dispatch() 进入队列
 *   2. per-session 串行锁：同一 session 的任务严格 FIFO，
 *      不同 session 并行处理
 *   3. 类型安全路由：通过 route() 注册 handler，
 *      payload.type 做分发
 *   4. 可观测性：任务状态变更通过回调通知外部
 *      （Phase 2 改为数据库写入）
 */
export class TaskDispatcher {
  private _queue: Queue<TaskJobData>;
  private _worker: Worker<TaskJobData> | undefined;
  private _handlers: Map<string, TaskHandler> = new Map();
  private _sessionLocks: Map<string, Promise<void>> = new Map();
  private _options: Required<TaskDispatcherOptions>;

  constructor(options: TaskDispatcherOptions = {}) {
    this._options = {
      concurrency: options.concurrency ?? 4,
      queueDbPath: options.queueDbPath ?? "./data/queue/beeclaw-tasks.db",
      maxRetries: options.maxRetries ?? 2,
      onTaskStatusChange: options.onTaskStatusChange ?? (() => {}),
    };

    this._queue = new Queue<TaskJobData>(QUEUE_NAME, {
      embedded: true,
      path: this._options.queueDbPath,
      defaultJobOptions: { attempts: this._options.maxRetries },
    });

    // 禁用 stall 检测（嵌入式模式下无意义，且会干扰 session lock 链）
    this._queue.setStallConfig({ enabled: false });
  }

  // ----------------------------------------------------------
  // Handler 注册
  // ----------------------------------------------------------

  /**
   * 注册任务处理函数。
   *
   * @example
   * ```ts
   * dispatcher
   *   .route("inbound_message", handleInboundMessage)
   *   .route("proactive_message", handleProactiveMessage)
   *   .route("cronjob", handleCronjob);
   * ```
   */
  route<T extends TaskPayload["type"]>(
    type: T,
    handler: TaskHandler<Extract<TaskPayload, { type: T }>>,
  ): this {
    if (this._handlers.has(type)) {
      throw new Error(`Handler already registered for task type: ${type}`);
    }
    this._handlers.set(type, handler as TaskHandler);
    return this;
  }

  // ----------------------------------------------------------
  // 任务分发
  // ----------------------------------------------------------

  /**
   * 分发任务到队列。
   *
   * @param sessionId - 任务所属 session
   * @param payload - 任务载荷
   * @returns bunqueue job ID
   */
  async dispatch(sessionId: string, payload: TaskPayload): Promise<string> {
    const jobData: TaskJobData = { session_id: sessionId, payload };
    const job = await this._queue.add(payload.type, jobData);

    // 通知状态变更
    this._options.onTaskStatusChange(
      job.id, sessionId, "pending", payload
    );

    logger.info(
      `[TaskDispatcher] Dispatched ${payload.type} for session ${sessionId}, taskId=${job.id}`
    );

    return job.id;
  }

  // ----------------------------------------------------------
  // Cron 调度
  // ----------------------------------------------------------

  /**
   * 注册或更新 cron 定时任务。
   * 使用 sessionId 作为 scheduler ID，保证幂等性。
   */
  async scheduleCronjob(
    sessionId: string,
    payload: CronjobPayload,
  ): Promise<void> {
    const jobData: TaskJobData = { session_id: sessionId, payload };
    await this._queue.upsertJobScheduler(
      sessionId,
      { pattern: payload.cron_pattern },
      { name: "cronjob", data: jobData },
    );
    logger.info(
      `[TaskDispatcher] Cronjob scheduled: ${payload.job_name} [${payload.cron_pattern}] for session ${sessionId}`
    );
  }

  /**
   * 移除 cron 定时任务
   */
  async removeCronjob(sessionId: string): Promise<void> {
    await this._queue.removeJobScheduler(sessionId);
    logger.info(`[TaskDispatcher] Cronjob removed for session ${sessionId}`);
  }

  /**
   * 获取所有活跃的 cron 任务
   */
  async getCronjobs(): Promise<unknown[]> {
    return this._queue.getJobSchedulers();
  }

  // ----------------------------------------------------------
  // Worker 生命周期
  // ----------------------------------------------------------

  /**
   * 启动 worker。在 app 启动时调用一次。
   */
  async start(): Promise<void> {
    this._worker = new Worker<TaskJobData>(
      QUEUE_NAME,
      (job) => this._processJob(job),
      {
        embedded: true,
        path: this._options.queueDbPath,
        concurrency: this._options.concurrency,
        useLocks: false, // 嵌入式模式不需要锁
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    );

    this._worker.on("error", (err) => {
      logger.error("[TaskDispatcher] Worker error:", err);
    });

    logger.info(
      `[TaskDispatcher] Started with concurrency=${this._options.concurrency}`
    );
  }

  /**
   * 优雅停机
   */
  async stop(): Promise<void> {
    if (this._worker) {
      await this._worker.close();
    }
    this._queue.close();
    logger.info("[TaskDispatcher] Stopped");
  }

  // ----------------------------------------------------------
  // per-session 串行执行
  // ----------------------------------------------------------

  /**
   * 处理队列中的任务。
   *
   * 核心机制：per-session Promise 链。
   *
   * 工作原理：
   *   1. 从 _sessionLocks 获取该 session 的上一个 Promise
   *   2. 将当前任务的处理 chain 到上一个 Promise 之后
   *   3. 更新 _sessionLocks
   *
   * 效果：
   *   - 同一 session 的任务严格顺序执行（FIFO）
   *   - 不同 session 的任务并行执行（受 concurrency 限制）
   *   - 无需显式锁/解锁，Promise 链自动管理
   */
  private async _processJob(job: Job<TaskJobData>): Promise<void> {
    const { session_id: sessionId, payload } = job.data;

    // 获取该 session 的前序 Promise（如果没有则为 resolved）
    const previous = this._sessionLocks.get(sessionId) ?? Promise.resolve();

    // 将当前任务 chain 到前序之后
    const current = previous.then(async () => {
      const handler = this._handlers.get(payload.type);
      if (!handler) {
        logger.warn(
          `[TaskDispatcher] No handler for task type: ${payload.type}`
        );
        return;
      }

      // 状态 → running
      this._options.onTaskStatusChange(
        job.id, sessionId, "running", payload
      );

      try {
        await handler(job.id, sessionId, payload);
        await job.updateProgress(100);

        // 状态 → completed
        this._options.onTaskStatusChange(
          job.id, sessionId, "completed", payload
        );
      } catch (err) {
        // 状态 → failed
        this._options.onTaskStatusChange(
          job.id, sessionId, "failed", payload
        );

        logger.error(
          `[TaskDispatcher] Task failed: ${payload.type} for session ${sessionId}`,
          err
        );
        throw err; // 让 bunqueue 处理重试
      }
    });

    // 更新 session 锁
    this._sessionLocks.set(sessionId, current);

    // 等待当前任务完成
    await current;

    // 清理：如果没有后续任务被追加，释放锁
    if (this._sessionLocks.get(sessionId) === current) {
      this._sessionLocks.delete(sessionId);
    }
  }
}
```

### 3.4 per-session 串行锁原理

这是整个 TaskDispatcher 最精巧的部分，值得详细说明。

**场景**：用户 A 在飞书快速发送了 3 条消息（M1, M2, M3），这 3 条消息几乎同时到达。

**期望行为**：M1 处理完毕 → M2 开始处理 → M2 完毕 → M3 开始处理。同一用户的消息必须串行处理，否则会出现上下文混乱。

**Promise 链机制**：

```
时间线 →

M1 到达:
  _sessionLocks["userA"] = undefined
  previous = Promise.resolve()
  current = previous.then(() => handleM1())    ← 立即开始执行
  _sessionLocks["userA"] = current

M2 到达（M1 还在处理中）:
  previous = _sessionLocks["userA"]           ← 指向 handleM1 的 Promise
  current = previous.then(() => handleM2())    ← 排队等 M1 完成
  _sessionLocks["userA"] = current

M3 到达（M1 还在处理中）:
  previous = _sessionLocks["userA"]           ← 指向 handleM2 的 Promise
  current = previous.then(() => handleM3())    ← 排队等 M2 完成
  _sessionLocks["userA"] = current

执行顺序: handleM1() → handleM2() → handleM3()
```

**与 SessionMessageQueue 的区别**：

| 特性 | 现有 SessionMessageQueue | 新 TaskDispatcher |
|------|------------------------|-------------------|
| 锁粒度 | 仅保护 `sendProactiveMessage` | 保护所有任务类型 |
| 任务入队 | 无（直接函数调用） | bunqueue 持久化队列 |
| 状态跟踪 | 无 | pending/running/completed/failed |
| 重试 | 无 | bunqueue 内置重试 |
| 跨重启 | 不支持 | bunqueue DB 持久化 |
| 并发控制 | 无限制 | `concurrency` 配置 |

### 3.5 Handler 路由注册

```typescript
// src/kernel/tasking/handlers/inbound-message-handler.ts

import type { TaskHandler, InboundMessagePayload } from "../task-dispatcher";
import type { MessageGateway } from "../../../shared/messaging";

/**
 * 创建入站消息处理函数。
 *
 * 这是 Beeclaw 最核心的 handler：接收用户消息 → Agent 处理 → 发送响应。
 *
 * 依赖注入设计：handler 不直接引用全局 singleton，
 * 而是通过工厂函数接收依赖，便于测试和解耦。
 */
export function createInboundMessageHandler(deps: {
  gateway: MessageGateway;
  resolveSession: (sessionId: string, channelType: string) => Promise<any>;
  createAgentForSession: (session: any) => Promise<any>;
}): TaskHandler<InboundMessagePayload> {
  return async (taskId, sessionId, payload) => {
    const { message } = payload;
    const { gateway, resolveSession, createAgentForSession } = deps;

    // 1. 解析或创建 session
    const session = await resolveSession(
      sessionId,
      message.channel_type || "cli"
    );

    // 2. 记录用户消息到 session
    session.messages.push({
      role: "user",
      content: typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
      timestamp: new Date().toISOString(),
    });

    // 3. 创建 Agent 并处理
    const agent = await createAgentForSession(session);
    const response = await agent.chat(message.content);

    // 4. 记录 AI 响应
    session.messages.push({
      role: "assistant",
      content: response,
      timestamp: new Date().toISOString(),
    });

    // 5. 通过 Gateway 回复消息
    await gateway.replyMessage(message.id, {
      session_id: sessionId,
      content: response,
      created_at: Date.now(),
    });

    // 6. 触发后台知识提取（fire-and-forget）
    // extractKnowledge(session).catch(() => {});
  };
}
```

### 3.6 Cron Job 调度

```typescript
// src/kernel/tasking/handlers/cronjob-handler.ts

import type { TaskHandler, CronjobPayload } from "../task-dispatcher";

/**
 * 创建 cron 任务处理函数。
 *
 * 整合现有的 proactive daemon 功能：
 *   - memory_compress: 每日凌晨压缩旧对话记忆
 *   - goal_check: 检查目标进度
 *   - reminder: 定时提醒
 */
export function createCronjobHandler(deps: {
  memoryCompressor: { run: () => Promise<void> };
  goalChecker: { check: () => Promise<void> };
  reminderExecutor: { execute: (params: any) => Promise<void> };
}): TaskHandler<CronjobPayload> {
  const jobMap: Record<string, (params?: any) => Promise<void>> = {
    memory_compress: () => deps.memoryCompressor.run(),
    goal_check: () => deps.goalChecker.check(),
    reminder: (params) => deps.reminderExecutor.execute(params),
  };

  return async (_taskId, _sessionId, payload) => {
    const handler = jobMap[payload.job_name];
    if (!handler) {
      throw new Error(`Unknown cronjob: ${payload.job_name}`);
    }
    await handler(payload.params);
  };
}
```

### 3.7 与现有模块整合

**入口改造**（`src/app/index.ts`）：

```typescript
// 伪代码：展示 initApp() 中的整合方式

import { TaskDispatcher } from "../kernel/tasking/task-dispatcher";
import { MultiChannelMessageGateway } from "../kernel/messaging/multi-channel-message-gateway";
import { FeishuChannel } from "../channels/feishu/feishu-channel";
import { CLIChannel } from "../channels/cli/cli-channel";
import { createInboundMessageHandler } from "../kernel/tasking/handlers/inbound-message-handler";
import { createCronjobHandler } from "../kernel/tasking/handlers/cronjob-handler";

export async function initApp() {
  // ... 现有初始化逻辑 ...

  // 1. 创建 Gateway
  const gateway = new MultiChannelMessageGateway();

  // 2. 注册通道
  if (config.feishu?.enabled) {
    gateway.registerChannel(new FeishuChannel(config.feishu));
  }
  if (config.cli?.enabled) {
    gateway.registerChannel(new CLIChannel());
  }

  // 3. 创建 TaskDispatcher
  const dispatcher = new TaskDispatcher({
    concurrency: config.tasking?.concurrency ?? 4,
    maxRetries: config.tasking?.maxRetries ?? 2,
  });

  // 4. 注册 Handlers
  dispatcher
    .route("inbound_message", createInboundMessageHandler({
      gateway,
      resolveSession: ...,
      createAgentForSession: ...,
    }))
    .route("proactive_message", createProactiveMessageHandler({ gateway }))
    .route("cronjob", createCronjobHandler({ ... }))
    .route("analysis", createAnalysisHandler({ ... }));

  // 5. 连接 Gateway → Dispatcher
  gateway.on("message:inbound", (message) => {
    dispatcher.dispatch(message.session_id, {
      type: "inbound_message",
      message,
    });
  });

  // 6. 启动
  await dispatcher.start();
  await gateway.start();

  // 7. 注册 cron 任务
  await dispatcher.scheduleCronjob("system-memory-compress", {
    type: "cronjob",
    cron_pattern: "0 3 * * *", // 每天凌晨 3 点
    job_name: "memory_compress",
  });
}
```

### 3.8 迁移策略

| 阶段 | 内容 | 风险 |
|------|------|------|
| **Step 1** | 定义 TaskPayload 联合类型和 TaskDispatcher 类 | 零风险（纯增量） |
| **Step 2** | 实现 inbound_message handler，将 `sendProactiveMessage()` 的核心逻辑迁入 | 中风险（重构核心流程） |
| **Step 3** | 修改 `initApp()` 串联 Gateway → Dispatcher → Handler | 中风险 |
| **Step 4** | 迁移 proactive daemon 到 cronjob handler | 低风险 |
| **Step 5** | 迁移 analysis jobs 到 analysis handler | 低风险 |
| **Step 6** | 移除旧的 `SessionMessageQueue` 和 `sendProactiveMessage()` | 清理 |

**回滚方案**：Step 2 是最大风险点。建议通过 feature flag `USE_TASK_DISPATCHER=true` 控制，在测试稳定后切换。

### 3.9 文件结构

```
src/
├── kernel/
│   └── tasking/
│       ├── index.ts                    # re-export
│       ├── task-dispatcher.ts          # 核心调度器
│       ├── types.ts                    # TaskPayload, TaskStatus 等
│       └── handlers/
│           ├── index.ts
│           ├── inbound-message-handler.ts
│           ├── proactive-message-handler.ts
│           ├── cronjob-handler.ts
│           └── analysis-handler.ts
```

---

## 四、RFC-03: 引入 SQLite + Drizzle ORM

### 4.1 现状分析

当前 Beeclaw 的数据持久化完全依赖文件系统：

| 数据类型 | 存储方式 | 文件位置 | 问题 |
|----------|---------|---------|------|
| Session 元数据 + 消息 | 单个 JSON 文件 | `data/memory/sessions/{id}.json` | 无索引，列表需遍历目录 |
| Memory 知识 | JSONL | `data/memory/` | 搜索效率低 |
| Queue 任务 | bunqueue SQLite | `data/queue/beeclaw.db` | 已有 SQLite，但与业务数据隔离 |
| Skills | Markdown 文件 | `skills/` | 适合当前用途 |
| Config | JSON | `beeclaw.json` | 适合当前用途 |

**问题清单**：

1. **Session 查询低效**：`listSessions()` 需要遍历目录读取所有 JSON 文件，O(n) 复杂度
2. **无法高效过滤**：按用户、按通道、按时间范围查 session 需全量加载
3. **任务状态不可持久化**：`TaskDispatcher` 的状态回调目前是内存操作，重启丢失
4. **JSON 文件原子性脆弱**：虽然有 `writeFileAtomic` 保护，但在高并发下仍有风险
5. **无 Dashboard 数据源**：未来 Web UI 需要高效的分页、排序、聚合查询

### 4.2 目标架构

```
                    ┌──────────────────────────┐
                    │      DataConnection       │
                    │  (bun:sqlite + Drizzle)   │
                    │                          │
                    │  PRAGMA journal_mode=WAL  │
                    │  PRAGMA foreign_keys=ON   │
                    └────┬───────────┬──────────┘
                         │           │
              ┌──────────▼──┐  ┌─────▼──────────┐
              │  sessions    │  │  tasks          │
              │  (元数据)     │  │  (任务生命周期)  │
              └─────────────┘  └────────────────┘
                    │
                    │  消息体仍存 JSONL（不入库）
                    ▼
          data/sessions/{id}.jsonl
```

**设计决策**：

- **Session 元数据入库，消息体留 JSONL**：元数据（id, user, channel, timestamps）需要高频查询和索引，放 SQLite。消息体可能很大且主要是追加写入和顺序读取，JSONL 更合适。
- **tasks 表与 bunqueue 双写**：bunqueue 管理队列调度，tasks 表管理业务状态查询。两者通过 job.id 关联。
- **WAL 模式**：支持并发读写，适合 Bun 单进程多异步的场景。

### 4.3 DataConnection 设计

```typescript
// src/data/data-connection.ts

import { Database as SQLiteDatabase } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { logger } from "../utils/logger";

/** Drizzle DB 实例类型 */
export type DrizzleDB<
  TSchema extends Record<string, unknown> = Record<string, unknown>
> = ReturnType<typeof drizzle<TSchema>>;

export interface DataConnectionOptions {
  /** 数据库文件路径 */
  dbPath: string;
  /** Drizzle schema 对象 */
  schemas: Record<string, unknown>;
  /** Migration 文件目录 */
  migrationsFolder: string;
}

/**
 * 中心化 SQLite 数据库连接。
 *
 * 封装 bun:sqlite + Drizzle ORM，提供：
 *   1. WAL 模式：提升并发读写性能
 *   2. 自动 Migration：启动时执行 drizzle-kit 生成的迁移文件
 *   3. 优雅关闭：确保数据写入完成
 *
 * 使用 bun:sqlite 内置 SQLite（无需额外安装 better-sqlite3）。
 */
export class DataConnection<
  TSchema extends Record<string, unknown> = Record<string, unknown>
> {
  private _sqlite: SQLiteDatabase;
  private _db: DrizzleDB<TSchema>;

  constructor(options: DataConnectionOptions) {
    const { dbPath, schemas, migrationsFolder } = options;

    // 确保目录存在
    const dir = join(dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // 打开 SQLite
    this._sqlite = new SQLiteDatabase(dbPath, { create: true });

    // 性能优化 PRAGMAs
    this._sqlite.run("PRAGMA journal_mode = WAL");
    this._sqlite.run("PRAGMA foreign_keys = ON");
    this._sqlite.run("PRAGMA busy_timeout = 5000");
    this._sqlite.run("PRAGMA synchronous = NORMAL");
    this._sqlite.run("PRAGMA cache_size = -8000"); // 8MB cache

    // 初始化 Drizzle
    this._db = drizzle(this._sqlite, { schema: schemas as TSchema });

    // 执行 Migration
    migrate(this._db, { migrationsFolder });

    logger.info(`[Database] Opened: ${dbPath}`);
  }

  /** 获取 Drizzle DB 实例 */
  get db(): DrizzleDB<TSchema> {
    return this._db;
  }

  /** 获取底层 SQLite 实例（用于高级操作） */
  get sqlite(): SQLiteDatabase {
    return this._sqlite;
  }

  /** 关闭数据库连接 */
  close(): void {
    this._sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
    this._sqlite.close();
    logger.info("[Database] Closed");
  }
}
```

### 4.4 Schema 设计

#### 4.4.1 Sessions 表

```typescript
// src/data/schema/sessions.ts

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Session 元数据表。
 *
 * 消息体仍然存储在 JSONL 文件中。
 * 此表仅记录 session 的 envelope 信息，
 * 支持高效的列表查询、过滤和排序。
 */
export const sessions = sqliteTable(
  "sessions",
  {
    /** 唯一 session ID */
    id: text("id").primaryKey(),

    /** 用户 ID */
    user_id: text("user_id").notNull().default("default-user"),

    /** 通道类型: "feishu" | "cli" | "slack" | ... */
    channel_type: text("channel_type").notNull().default("cli"),

    /** 首条消息内容（用于 session 列表预览） */
    first_message: text("first_message").notNull().default(""),

    /** 消息计数 */
    message_count: integer("message_count").notNull().default(0),

    /** 是否有待恢复的未回复消息 */
    pending_recovery: integer("pending_recovery", { mode: "boolean" })
      .notNull()
      .default(false),

    /** 对话摘要（压缩后的旧消息） */
    summary: text("summary"),

    /** 自定义 metadata (JSON) */
    metadata: text("metadata", { mode: "json" }),

    /** 最后一条消息时间 (epoch ms) */
    last_message_at: integer("last_message_at"),

    /** 创建时间 (epoch ms) */
    created_at: integer("created_at").notNull(),

    /** 更新时间 (epoch ms) */
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_sessions_user_id").on(table.user_id),
    index("idx_sessions_channel_type").on(table.channel_type),
    index("idx_sessions_updated_at").on(table.updated_at),
    index("idx_sessions_pending_recovery").on(table.pending_recovery),
  ]
);

/** TypeScript 类型推导 */
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
```

#### 4.4.2 Tasks 表

```typescript
// src/data/schema/tasks.ts

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 任务生命周期表。
 *
 * 与 bunqueue job 通过 id 关联。
 * bunqueue 管理队列调度，此表管理业务状态查询。
 * 设计上允许 bunqueue 中的 job 被清理后，
 * tasks 表仍保留完整的历史记录。
 */
export const tasks = sqliteTable(
  "tasks",
  {
    /** 唯一 ID，与 bunqueue job ID 一致 */
    id: text("id").primaryKey(),

    /** 所属 session ID */
    session_id: text("session_id").notNull(),

    /** 任务类型: "inbound_message" | "proactive_message" | "cronjob" | "analysis" */
    type: text("type").notNull(),

    /** 任务状态: "pending" | "running" | "completed" | "failed" */
    status: text("status").notNull().default("pending"),

    /** 完整任务载荷 (JSON) */
    payload: text("payload", { mode: "json" }).notNull(),

    /** 错误信息（如果 failed） */
    error_message: text("error_message"),

    /** 执行耗时 (ms) */
    duration_ms: integer("duration_ms"),

    /** 创建时间 (epoch ms) */
    created_at: integer("created_at").notNull(),

    /** 更新时间 (epoch ms) */
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_tasks_session_id").on(table.session_id),
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_type").on(table.type),
    index("idx_tasks_created_at").on(table.created_at),
  ]
);

/** TypeScript 类型推导 */
export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
```

#### 4.4.3 Schema 聚合

```typescript
// src/data/schema/index.ts

export * from "./sessions";
export * from "./tasks";

import { sessions } from "./sessions";
import { tasks } from "./tasks";

/** 完整 schema 对象，传入 DataConnection */
export const allSchemas = { sessions, tasks };
```

### 4.5 Migration 策略

```typescript
// drizzle.config.ts（项目根目录）

import type { Config } from "drizzle-kit";

export default {
  schema: "./src/data/schema/index.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/beeclaw.db",
  },
} satisfies Config;
```

**工作流**：

```bash
# 1. 修改 schema 后生成 migration
bunx drizzle-kit generate

# 2. 查看生成的 SQL
cat drizzle/0001_xxx.sql

# 3. 启动时自动执行（DataConnection 构造函数中已集成）
# migrate(db, { migrationsFolder: "./drizzle" });
```

**依赖安装**：

```bash
bun add drizzle-orm
bun add -d drizzle-kit
```

> `bun:sqlite` 是 Bun 内置模块，无需额外安装。Drizzle ORM 的 `bun-sqlite` driver 直接使用它。

### 4.6 SessionManager 改造

```typescript
// src/session/session-manager.ts (改造后)

import { and, desc, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../data/data-connection";
import { sessions, type SessionRow, type NewSessionRow } from "../data/schema";
import { logger } from "../utils/logger";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";

export interface SessionResolveOptions {
  userId?: string;
  channelType?: string;
  firstMessageContent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 改造后的 SessionManager。
 *
 * 变更点：
 *   1. 元数据存入 SQLite（查询走 DB）
 *   2. 消息体存入 JSONL（追加写入）
 *   3. 内存 Map 仅做热缓存（可选）
 *   4. 事件驱动写入（消息 → JSONL Writer + DB 更新）
 *
 * 兼容策略：
 *   - 首次启动时自动从旧 JSON 文件迁移元数据到 SQLite
 *   - JSONL 格式与旧版兼容
 */
export class SessionManager {
  private _db: DrizzleDB;
  private _sessionsDir: string;

  constructor(db: DrizzleDB, sessionsDir: string = "./data/sessions") {
    this._db = db;
    this._sessionsDir = sessionsDir;

    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }
  }

  // ----------------------------------------------------------
  // Session CRUD
  // ----------------------------------------------------------

  /**
   * 解析 Session：存在则恢复，不存在则创建。
   */
  resolveSession(
    sessionId: string,
    options?: SessionResolveOptions
  ): { isNew: boolean; session: SessionRow } {
    const existing = this._getById(sessionId);
    if (existing) {
      return { isNew: false, session: existing };
    }
    const session = this._create(sessionId, options);
    return { isNew: true, session };
  }

  /**
   * 创建新 Session
   */
  private _create(
    sessionId: string,
    options?: SessionResolveOptions
  ): SessionRow {
    const now = Date.now();
    const row: NewSessionRow = {
      id: sessionId,
      user_id: options?.userId ?? "default-user",
      channel_type: options?.channelType ?? "cli",
      first_message: options?.firstMessageContent ?? "",
      message_count: 0,
      pending_recovery: false,
      metadata: options?.metadata ?? null,
      last_message_at: null,
      created_at: now,
      updated_at: now,
    };

    this._db.insert(sessions).values(row).run();
    logger.info(`[SessionManager] Created session: ${sessionId}`);

    return this._getById(sessionId)!;
  }

  /**
   * 通过 ID 获取 Session
   */
  private _getById(sessionId: string): SessionRow | undefined {
    return this._db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
  }

  /**
   * 查询 Session 列表（分页、过滤、排序）
   */
  querySessions(options: {
    userId?: string;
    channelType?: string;
    pendingRecovery?: boolean;
    limit?: number;
    offset?: number;
  } = {}): SessionRow[] {
    const { userId, channelType, pendingRecovery, limit = 50, offset = 0 } = options;

    let query = this._db.select().from(sessions);

    const conditions = [];
    if (userId) conditions.push(eq(sessions.user_id, userId));
    if (channelType) conditions.push(eq(sessions.channel_type, channelType));
    if (pendingRecovery !== undefined) {
      conditions.push(eq(sessions.pending_recovery, pendingRecovery));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return (query as any)
      .orderBy(desc(sessions.updated_at))
      .limit(limit)
      .offset(offset)
      .all();
  }

  /**
   * 获取 Session 总数
   */
  countSessions(options?: {
    userId?: string;
    channelType?: string;
  }): number {
    const conditions = [];
    if (options?.userId) conditions.push(eq(sessions.user_id, options.userId));
    if (options?.channelType) conditions.push(eq(sessions.channel_type, options.channelType));

    const result = this._db
      .select({ count: sql<number>`count(*)` })
      .from(sessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get();

    return result?.count ?? 0;
  }

  // ----------------------------------------------------------
  // 消息管理
  // ----------------------------------------------------------

  /**
   * 追加消息到 Session 的 JSONL 文件
   */
  appendMessage(sessionId: string, message: {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp?: string;
  }): void {
    const filePath = join(this._sessionsDir, `${this._sanitize(sessionId)}.jsonl`);
    const line = JSON.stringify({
      ...message,
      timestamp: message.timestamp ?? new Date().toISOString(),
    });
    appendFileSync(filePath, line + "\n");

    // 更新 DB 元数据
    const now = Date.now();
    this._db
      .update(sessions)
      .set({
        message_count: sql`${sessions.message_count} + 1`,
        last_message_at: now,
        updated_at: now,
        // 如果是首条消息且 first_message 为空，写入
        ...(message.role === "user" ? {
          first_message: sql`CASE WHEN ${sessions.first_message} = '' THEN ${message.content.substring(0, 200)} ELSE ${sessions.first_message} END`,
        } : {}),
      })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  /**
   * 读取 Session 的消息历史
   */
  readMessages(sessionId: string): Array<{
    role: string;
    content: string;
    timestamp: string;
  }> {
    const filePath = join(this._sessionsDir, `${this._sanitize(sessionId)}.jsonl`);
    if (!existsSync(filePath)) return [];

    return readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  // ----------------------------------------------------------
  // 恢复相关
  // ----------------------------------------------------------

  /**
   * 标记 Session 为待恢复
   */
  markPendingRecovery(sessionId: string): void {
    this._db
      .update(sessions)
      .set({
        pending_recovery: true,
        updated_at: Date.now(),
      })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  /**
   * 确认消息已送达，清除恢复标记
   */
  confirmDelivery(sessionId: string): void {
    this._db
      .update(sessions)
      .set({
        pending_recovery: false,
        updated_at: Date.now(),
      })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  /**
   * 获取所有待恢复的 Session
   */
  getPendingRecoverySessions(): SessionRow[] {
    return this._db
      .select()
      .from(sessions)
      .where(eq(sessions.pending_recovery, true))
      .all();
  }

  // ----------------------------------------------------------
  // 删除 / 清理
  // ----------------------------------------------------------

  /**
   * 删除 Session（DB + JSONL）
   */
  deleteSession(sessionId: string): void {
    this._db.delete(sessions).where(eq(sessions.id, sessionId)).run();

    const filePath = join(this._sessionsDir, `${this._sanitize(sessionId)}.jsonl`);
    if (existsSync(filePath)) {
      require("fs").unlinkSync(filePath);
    }
  }

  /**
   * 清理过期 Session
   */
  cleanupOldSessions(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;

    const oldSessions = this._db
      .select({ id: sessions.id })
      .from(sessions)
      .where(sql`${sessions.updated_at} < ${cutoff}`)
      .all();

    for (const { id } of oldSessions) {
      this.deleteSession(id);
    }

    return oldSessions.length;
  }

  // ----------------------------------------------------------
  // 工具方法
  // ----------------------------------------------------------

  private _sanitize(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_");
  }
}
```

### 4.7 与 TaskDispatcher 集成

RFC-03 引入 SQLite 后，TaskDispatcher 的 `onTaskStatusChange` 回调替换为直接数据库写入：

```typescript
// 改造后的 TaskDispatcher 构造方式

import { DataConnection } from "../data/data-connection";
import { tasks } from "../data/schema";
import { eq } from "drizzle-orm";

// 在 initApp() 中：
const dataConn = new DataConnection({
  dbPath: "./data/beeclaw.db",
  schemas: allSchemas,
  migrationsFolder: "./drizzle",
});

const dispatcher = new TaskDispatcher({
  concurrency: 4,
  onTaskStatusChange: (taskId, sessionId, status, payload) => {
    const now = Date.now();

    if (status === "pending") {
      // 新任务入库
      dataConn.db.insert(tasks).values({
        id: taskId,
        session_id: sessionId,
        type: payload.type,
        status: "pending",
        payload,
        created_at: now,
        updated_at: now,
      }).run();
    } else {
      // 状态更新
      dataConn.db
        .update(tasks)
        .set({ status, updated_at: now })
        .where(eq(tasks.id, taskId))
        .run();
    }
  },
});
```

**任务查询 API**（为 Dashboard 准备）：

```typescript
// src/data/queries/task-queries.ts

import { desc, eq, sql, and, gte, lte } from "drizzle-orm";
import type { DrizzleDB } from "../data-connection";
import { tasks, type TaskRow } from "../schema";

export class TaskQueries {
  constructor(private _db: DrizzleDB) {}

  /** 分页查询任务 */
  list(options: {
    sessionId?: string;
    type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): TaskRow[] {
    const { sessionId, type, status, limit = 50, offset = 0 } = options;

    const conditions = [];
    if (sessionId) conditions.push(eq(tasks.session_id, sessionId));
    if (type) conditions.push(eq(tasks.type, type));
    if (status) conditions.push(eq(tasks.status, status));

    let query = this._db.select().from(tasks);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return (query as any)
      .orderBy(desc(tasks.created_at))
      .limit(limit)
      .offset(offset)
      .all();
  }

  /** 统计各状态任务数 */
  stats(): Record<string, number> {
    const result = this._db
      .select({
        status: tasks.status,
        count: sql<number>`count(*)`,
      })
      .from(tasks)
      .groupBy(tasks.status)
      .all();

    return Object.fromEntries(result.map((r) => [r.status, r.count]));
  }

  /** 获取某 session 的最近任务 */
  recentBySession(sessionId: string, limit: number = 10): TaskRow[] {
    return this._db
      .select()
      .from(tasks)
      .where(eq(tasks.session_id, sessionId))
      .orderBy(desc(tasks.created_at))
      .limit(limit)
      .all();
  }
}
```

### 4.8 与 JSONL 文件的分工

| 数据 | 存储位置 | 原因 |
|------|---------|------|
| Session ID, user_id, channel_type, timestamps | SQLite `sessions` 表 | 需要索引、过滤、排序 |
| first_message, message_count, summary | SQLite `sessions` 表 | 查询热数据 |
| pending_recovery 标记 | SQLite `sessions` 表 | 启动时快速扫描 |
| 完整消息历史 | JSONL 文件 | 追加写入高效，消息体可能很大 |
| Task 状态和载荷 | SQLite `tasks` 表 | 需要按状态/类型/时间查询 |

**读取模式**：

```
列表页面: SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 20
           → 仅查 DB，不读文件

详情页面: SELECT * FROM sessions WHERE id = ?
           → DB 读元数据
           + readFileSync("sessions/{id}.jsonl")
           → 文件读消息历史
```

### 4.9 迁移策略

#### 4.9.1 旧数据迁移

```typescript
// src/data/migration/migrate-from-json.ts

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { DrizzleDB } from "../data-connection";
import { sessions } from "../schema";
import { logger } from "../../utils/logger";

/**
 * 将旧版 JSON session 文件迁移到 SQLite。
 *
 * 仅在首次启动时执行（检查 sessions 表是否为空）。
 * 迁移完成后旧文件保留（不删除），可手动清理。
 */
export function migrateFromJsonSessions(
  db: DrizzleDB,
  oldSessionsPath: string = "./data/memory/sessions"
): number {
  // 检查是否需要迁移
  const count = db
    .select({ count: require("drizzle-orm").sql<number>`count(*)` })
    .from(sessions)
    .get();

  if ((count?.count ?? 0) > 0) {
    logger.info("[Migration] Sessions table already has data, skipping");
    return 0;
  }

  if (!existsSync(oldSessionsPath)) {
    logger.info("[Migration] No old sessions directory found");
    return 0;
  }

  const files = readdirSync(oldSessionsPath).filter(
    (f) => f.endsWith(".json") && !f.endsWith(".bak") && !f.endsWith(".tmp")
  );

  let migrated = 0;
  const now = Date.now();

  for (const file of files) {
    try {
      const content = readFileSync(join(oldSessionsPath, file), "utf-8");
      const session = JSON.parse(content);

      db.insert(sessions)
        .values({
          id: session.id,
          user_id: session.userId || "default-user",
          channel_type: session.channel || "cli",
          first_message: session.messages?.[0]?.content?.substring(0, 200) ?? "",
          message_count: session.messages?.length ?? 0,
          pending_recovery: session.pendingRecovery ?? false,
          summary: session.summary ?? null,
          metadata: session.metadata ?? null,
          last_message_at: session.updatedAt
            ? new Date(session.updatedAt).getTime()
            : now,
          created_at: session.createdAt
            ? new Date(session.createdAt).getTime()
            : now,
          updated_at: session.updatedAt
            ? new Date(session.updatedAt).getTime()
            : now,
        })
        .run();

      migrated++;
    } catch (error) {
      logger.error(`[Migration] Failed to migrate ${file}:`, error);
    }
  }

  logger.info(`[Migration] Migrated ${migrated}/${files.length} sessions from JSON to SQLite`);
  return migrated;
}
```

#### 4.9.2 实施步骤

| 阶段 | 内容 | 风险 |
|------|------|------|
| **Step 1** | `bun add drizzle-orm && bun add -d drizzle-kit` | 零风险 |
| **Step 2** | 创建 `src/data/` 目录，定义 schema 和 DataConnection | 纯增量 |
| **Step 3** | `bunx drizzle-kit generate` 生成首个 migration | 纯增量 |
| **Step 4** | 在 `initApp()` 中初始化 DataConnection | 低风险 |
| **Step 5** | 实现旧数据迁移脚本，在首次启动时自动执行 | 中风险（需充分测试） |
| **Step 6** | 改造 SessionManager，元数据查询切换到 SQLite | 中风险 |
| **Step 7** | 集成 TaskDispatcher 的 `onTaskStatusChange` | 低风险 |
| **Step 8** | 移除旧的 `loadAllSessions()` 目录遍历逻辑 | 清理 |

### 4.10 文件结构

```
src/
├── data/
│   ├── index.ts                        # re-export DataConnection
│   ├── data-connection.ts              # SQLite + Drizzle 封装
│   ├── schema/
│   │   ├── index.ts                    # 聚合所有 schema
│   │   ├── sessions.ts                 # sessions 表
│   │   └── tasks.ts                    # tasks 表
│   ├── queries/
│   │   ├── session-queries.ts          # Session 查询
│   │   └── task-queries.ts             # Task 查询
│   └── migration/
│       └── migrate-from-json.ts        # 旧数据迁移
drizzle/                                # drizzle-kit 生成的 migration 文件
├── 0000_initial.sql
├── meta/
│   └── _journal.json
drizzle.config.ts                       # drizzle-kit 配置
```

---

## 五、三个 RFC 的依赖关系与实施路线

```
          Week 1          Week 2          Week 3          Week 4
          ──────          ──────          ──────          ──────

RFC-03    ██████████                                        SQLite + Drizzle
(基础层)   Schema 设计     Migration       DataConnection
           drizzle-kit     旧数据迁移       集成到 initApp

RFC-01                    ██████████████                    MessageChannel/Gateway
(消息层)                   接口定义         FeishuChannel
                          Gateway 实现     CLIChannel
                                          路由层改造

RFC-02                                    ██████████████    TaskDispatcher
(调度层)                                   Dispatcher 实现   Handler 迁移
                                          per-session 锁    整合 Gateway
                                                           Cron 迁移
```

**依赖关系**：

```
RFC-03 (SQLite)
  ↓
  ├── RFC-01 (Gateway) 的 _resolveChannelForSession 查 DB
  │     ↓
  │     └── RFC-02 (Dispatcher) 的 inbound_message handler 调用 Gateway
  │
  └── RFC-02 (Dispatcher) 的 onTaskStatusChange 写 tasks 表
```

**建议实施顺序**：RFC-03 → RFC-01 → RFC-02。先打好数据层基础，再建消息抽象，最后统一调度。

---

## 六、风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| SQLite 文件锁冲突（bunqueue DB vs beeclaw DB） | 两个 DB 文件不会冲突 | 低 | 分开路径：`data/queue/` vs `data/beeclaw.db` |
| 旧数据迁移失败 | Session 历史丢失 | 中 | 迁移前自动备份 `data/memory/sessions/`；旧文件保留不删除 |
| `sendProactiveMessage` 重构影响核心流程 | 消息处理中断 | 高 | Feature flag 控制新旧路径；充分的集成测试覆盖 |
| 飞书 editMessage API 限频 | 流式更新被拒 | 中 | StreamThrottle 节流器；降级为一次性发送 |
| Drizzle ORM 与 Bun 兼容性 | 编译/运行时错误 | 低 | Drizzle 官方已支持 `bun-sqlite` driver |
| 内存泄漏（_sessionLocks Map 增长） | 长期运行内存上涨 | 低 | 任务完成后自动清理 Map entry；定期 GC |
| 并发压力下 WAL 文件过大 | 磁盘空间 | 低 | 定期 `PRAGMA wal_checkpoint(TRUNCATE)` |

---

> **下一步**：完成 RFC-03 (SQLite) 的实现后，可以开始 RFC-04 (Hono API Server) 和 RFC-05 (Web Dashboard) 的设计，利用结构化的 DB 数据源为前端提供高效的 REST API。
