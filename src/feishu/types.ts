/**
 * Feishu API Types
 *
 * Type definitions for Feishu/Lark Open Platform API
 */

import { z } from 'zod';

// ============================================================
// Authentication Types
// ============================================================

export const FeishuAuthConfigSchema = z.object({
  appId: z.string().describe('Feishu App ID'),
  appSecret: z.string().describe('Feishu App Secret'),
  enabled: z.boolean().default(true),
  encryptKey: z.string().optional().describe('Encryption key for message decryption'),
  verificationToken: z.string().optional().describe('Verification token for webhook'),
});

export type FeishuAuthConfig = z.infer<typeof FeishuAuthConfigSchema>;

// Tenant access token response
export const TenantAccessTokenResponseSchema = z.object({
  code: z.number(),
  msg: z.string(),
  tenant_access_token: z.string(),
  expire: z.number(),
});

export type TenantAccessTokenResponse = z.infer<typeof TenantAccessTokenResponseSchema>;

// ============================================================
// Message Types
// ============================================================

export type FeishuMessageType = 'text' | 'post' | 'image' | 'file' | 'audio' | 'media' | 'sticker' | 'interactive';

// Text message content
export const TextContentSchema = z.object({
  text: z.string(),
});

export type TextContent = z.infer<typeof TextContentSchema>;

// Post message content (rich text)
export const PostContentSchema = z.object({
  zh_cn: z.object({
    title: z.string(),
    content: z.array(z.array(z.object({
      tag: z.string(),
      text: z.string().optional(),
      href: z.string().optional(),
    }))),
  }).optional(),
  en_us: z.object({
    title: z.string(),
    content: z.array(z.array(z.object({
      tag: z.string(),
      text: z.string().optional(),
      href: z.string().optional(),
    }))),
  }).optional(),
});

export type PostContent = z.infer<typeof PostContentSchema>;

// Message receive ID type
export type ReceiveIdType = 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id';

// Send message request
export const SendMessageRequestSchema = z.object({
  receive_id_type: z.enum(['open_id', 'user_id', 'union_id', 'email', 'chat_id']),
  receive_id: z.string(),
  msg_type: z.enum(['text', 'post', 'image', 'file', 'audio', 'media', 'sticker', 'interactive']),
  content: z.string(), // JSON string of message content
  uuid: z.string().optional(),
});

export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

// Send message response
export const SendMessageResponseSchema = z.object({
  code: z.number(),
  msg: z.string(),
  data: z.object({
    message_id: z.string(),
  }).optional(),
});

export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

// ============================================================
// Event Types (Webhook)
// ============================================================

// URL verification event
export const UrlVerificationEventSchema = z.object({
  challenge: z.string(),
  token: z.string(),
  type: z.literal('url_verification'),
});

export type UrlVerificationEvent = z.infer<typeof UrlVerificationEventSchema>;

// Message event
export const MessageEventSchema = z.object({
  schema: z.string().optional(),
  header: z.object({
    event_id: z.string(),
    token: z.string(),
    create_time: z.string(),
    event_type: z.string(),
    tenant_key: z.string(),
    app_id: z.string(),
  }).optional(),
  event: z.object({
    sender: z.object({
      sender_id: z.object({
        open_id: z.string().optional(),
        user_id: z.string().optional(),
        union_id: z.string().optional(),
      }),
      sender_type: z.string(),
      tenant_key: z.string(),
    }),
    message: z.object({
      message_id: z.string(),
      root_id: z.string().optional(),
      parent_id: z.string().optional(),
      create_time: z.string(),
      chat_id: z.string(),
      chat_type: z.enum(['p2p', 'group', 'topic']),
      message_type: z.string(),
      content: z.string(),
      mentions: z.array(z.object({
        key: z.string(),
        id: z.object({
          open_id: z.string().optional(),
          user_id: z.string().optional(),
          union_id: z.string().optional(),
        }),
        name: z.string().optional(),
      })).optional(),
    }),
  }),
});

export type MessageEvent = z.infer<typeof MessageEventSchema>;

// Generic event envelope
export const EventEnvelopeSchema = z.object({
  type: z.string().optional(),
  challenge: z.string().optional(),
  token: z.string().optional(),
  schema: z.string().optional(),
  header: z.object({
    event_id: z.string(),
    token: z.string(),
    create_time: z.string(),
    event_type: z.string(),
    tenant_key: z.string(),
    app_id: z.string(),
  }).optional(),
  event: z.unknown().optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

// ============================================================
// User Info Types
// ============================================================

export const UserInfoResponseSchema = z.object({
  code: z.number(),
  msg: z.string(),
  data: z.object({
    user: z.object({
      open_id: z.string(),
      union_id: z.string().optional(),
      name: z.string(),
      en_name: z.string().optional(),
      nickname: z.string().optional(),
      avatar_url: z.string().optional(),
      email: z.string().optional(),
      mobile: z.string().optional(),
      gender: z.number().optional(),
      department_ids: z.array(z.string()).optional(),
      leader_user_id: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      work_station: z.string().optional(),
      join_time: z.number().optional(),
      employee_no: z.string().optional(),
      employee_type: z.number().optional(),
      positions: z.array(z.string()).optional(),
    }),
  }).optional(),
});

export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;

// ============================================================
// Token Cache
// ============================================================

export interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
}
