/**
 * Feishu Integration Module
 *
 * Provides integration with Feishu/Lark Open Platform
 * Supports both Webhook and WebSocket (long connection) modes
 */

// Types
export type {
  FeishuAuthConfig,
  TenantAccessTokenResponse,
  SendMessageRequest,
  SendMessageResponse,
  TokenCache,
  TextContent,
  PostContent,
  ReceiveIdType,
  UserInfoResponse,
  MessageEvent,
  EventEnvelope,
  UrlVerificationEvent,
} from './types';

// HTTP Client (Webhook mode)
export {
  FeishuClient,
  initFeishuClient,
  getFeishuClient,
  resetFeishuClient,
} from './client';

// WebSocket Client (Long connection mode)
export {
  FeishuWSClient,
  initFeishuWSClient,
  getFeishuWSClient,
  resetFeishuWSClient,
} from './ws-client';

export type {
  FeishuWSConfig,
  MessageHandler,
  MessageEventData,
  MessageReadHandler,
  MessageReadEventData,
  MessageRecalledHandler,
  MessageRecalledEventData,
  ReactionHandler,
  ReactionEventData,
  ChatDisbandedHandler,
  ChatDisbandedEventData,
  ChatUpdatedHandler,
  ChatUpdatedEventData,
  ChatMemberAddedHandler,
  ChatMemberAddedEventData,
  ChatMemberDeletedHandler,
  ChatMemberDeletedEventData,
  BotAddedHandler,
  BotAddedEventData,
  BotDeletedHandler,
  BotDeletedEventData,
  P2PChatCreatedHandler,
  P2PChatCreatedEventData,
  P2PChatEnteredHandler,
  P2PChatEnteredEventData,
  // Rich text types
  PostContentElement,
  PostContentBlock,
  PostContentBody,
  PostTextElement,
  PostLinkElement,
  PostAtElement,
  PostImageElement,
  PostEmotionElement,
  PostMdElement,
  PostCodeBlockElement,
  PostHrElement,
  // Card types
  CardConfig,
  CardElement,
  CardHeader,
  CardPlainText,
  CardMarkdownText,
  CardDivElement,
  CardMarkdownElement,
  CardHrElement,
  CardNoteElement,
  CardActionElement,
  CardButtonElement,
} from './ws-client';
