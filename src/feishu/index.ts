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

// Message Sending
export {
  sendTextMessage,
  sendPostMessage,
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

// Calendar Tools
export {
  getCalendarList,
  getCalendar,
  createEvent,
  getEvent,
  listEvents,
  updateEvent,
  deleteEvent,
  searchEvents,
  getTodayEvents,
  createQuickEvent,
  executeCalendarTool,
  calendarToolDefinitions,
} from './tools/calendar';

export type {
  FeishuCalendar,
  FeishuEvent,
} from './tools/calendar';

// Document Tools
export {
  getBlock,
  listChildren,
  searchDocument,
  createBlock,
  batchCreateBlocks,
  updateBlock,
  deleteBlock,
  appendBlocks,
  insertBlocks,
  createTextBlock,
  createTable,
  insertTableRow,
  insertTableColumn,
  deleteTableRow,
  deleteTableColumn,
  executeDocxTool,
  docxToolDefinitions,
} from './tools/docx';

export type {
  BlockCreateRequest,
  TextContent,
  FeishuBlock,
} from './tools/docx';

// Drive Tools
export {
  getRootFolderToken,
  listFiles,
  getFileInfo,
  createFolder,
  moveFile,
  deleteFile,
  copyFile,
  renameFile,
  searchFiles,
  downloadFile as downloadFileFromDrive,
  uploadFile as uploadFileToDrive,
  getFilePermissions,
  createShareLink,
  executeDriveTool,
  driveToolDefinitions,
} from './tools/drive';

export type {
  FeishuFile,
  FeishuPermission,
} from './tools/drive';

// Bitable (Multi-dimensional Table) Tools
export {
  getBitableMeta,
  listTables,
  listFields,
  createField,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  createBitable,
  executeBitableTool,
  bitableToolDefinitions,
} from './tools/bitable';

export type {
  FeishuBitable,
  FeishuTable,
  FeishuField,
  FeishuRecord,
} from './tools/bitable';

// Wiki (Knowledge Base) Tools
export {
  listSpaces,
  getSpaceInfo,
  listNodes,
  getNodeInfo,
  createPage,
  moveNode,
  renameNode,
  deleteNode,
  copyNode,
  searchPages,
  getNodeTree,
  executeWikiTool,
  wikiToolDefinitions,
} from './tools/wiki';

export type {
  FeishuWikiSpace,
  FeishuWikiNode,
} from './tools/wiki';
