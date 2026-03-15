/**
 * Feishu Integration Module
 *
 * Provides complete integration with Feishu/Lark Open Platform
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

// CLI Runner (feishu-cli mode)
export {
  FeishuCLIRunner,
  initFeishuCLIRunner,
  getFeishuCLIRunner,
  resetFeishuCLIRunner,
  FeishuCLIError,
} from './cli-runner';

export type {
  FeishuCLIConfig,
  CLIExecutionOptions,
  CLIResult,
} from './cli-runner';

// CLI Response Types (simplified)
export {
  cliFileToFeishuFile,
  cliSpaceToFeishuSpace,
  cliNodeToFeishuNode,
  cliCalendarToFeishuCalendar,
  cliEventToFeishuEvent,
} from './cli-types';

export type {
  CLIFileResponse,
  CLIWikiSpacesResponse,
  CLIWikiNodesResponse,
  CLICalendarListResponse,
  CLIEventListResponse,
} from './cli-types';

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

// Message Sending
export {
  sendTextMessage,
  sendPostMessage,
  sendMarkdownMessage,
  sendCardMessage,
  sendMarkdownCard,
  editMessage,
  replyMessage,
  getMessage,
} from './send';

export type {
  MentionTarget,
  PostContentElement as SendPostContentElement,
  FeishuCard,
  CardAction,
  FeishuMessage,
} from './send';

// Media Upload
export {
  uploadImage,
  uploadFile,
  downloadImage,
  downloadMessageResource,
  sendImageMessage,
  sendFileMessage,
  sendMedia,
} from './media';

// Card Builder
export {
  CardBuilder,
  createCard,
  buildMarkdownCard,
  buildTextCard,
  buildFormCard,
  buildListCard,
} from './card';

export type {
  CardConfig as CardConfigType,
  CardHeader as CardHeaderType,
  CardElement as CardElementType,
  CardAction as CardActionType,
  FeishuCard as FeishuCardType,
} from './card';

// Mention System
export {
  extractMentionTargets,
  isMentionForwardRequest,
  extractMessageBody,
  formatMentionForText,
  formatMentionForCard,
  formatMentionAllForText,
  formatMentionAllForCard,
  buildMentionedMessage,
  buildMentionedCardContent,
  parseMentionsFromText,
  parseMentionsFromCard,
  stripMentions,
} from './mention';

export type {
  MentionTarget as MentionTargetType,
  FeishuMessageEvent,
} from './mention';

// Feishu tools are now handled by feishu-cli-toolkit skill
// All tool operations are delegated to the skill for complete functionality
// See: /skills/skills/feishu-cli-toolkit/SKILL.md
