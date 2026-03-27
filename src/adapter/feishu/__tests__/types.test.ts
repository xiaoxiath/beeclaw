/**
 * Tests for types.ts
 *
 * Primarily type/interface definitions with Zod schemas.
 * We verify schema validation and type exports.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  FeishuAuthConfigSchema,
  TenantAccessTokenResponseSchema,
  TextContentSchema,
  PostContentSchema,
  SendMessageRequestSchema,
  SendMessageResponseSchema,
  UrlVerificationEventSchema,
  MessageEventSchema,
  EventEnvelopeSchema,
  UserInfoResponseSchema,
} from '../types';

import type {
  FeishuAuthConfig,
  TenantAccessTokenResponse,
  FeishuMessageType,
  TextContent,
  PostContent,
  ReceiveIdType,
  SendMessageRequest,
  SendMessageResponse,
  UrlVerificationEvent,
  MessageEvent,
  EventEnvelope,
  UserInfoResponse,
  TokenCache,
} from '../types';

describe('types', () => {
  describe('FeishuAuthConfigSchema', () => {
    it('validates a correct config', () => {
      const result = FeishuAuthConfigSchema.safeParse({
        appId: 'app_123',
        appSecret: 'secret_456',
        enabled: true,
      });
      expect(result.success).toBe(true);
    });

    it('defaults enabled to true', () => {
      const result = FeishuAuthConfigSchema.parse({
        appId: 'app_123',
        appSecret: 'secret_456',
      });
      expect(result.enabled).toBe(true);
    });

    it('fails without appId', () => {
      const result = FeishuAuthConfigSchema.safeParse({
        appSecret: 'secret',
      });
      expect(result.success).toBe(false);
    });

    it('fails without appSecret', () => {
      const result = FeishuAuthConfigSchema.safeParse({
        appId: 'app',
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional encryptKey and verificationToken', () => {
      const result = FeishuAuthConfigSchema.safeParse({
        appId: 'app',
        appSecret: 'secret',
        encryptKey: 'ek',
        verificationToken: 'vt',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('TenantAccessTokenResponseSchema', () => {
    it('validates correct response', () => {
      const result = TenantAccessTokenResponseSchema.safeParse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tat_123',
        expire: 7200,
      });
      expect(result.success).toBe(true);
    });

    it('fails with missing fields', () => {
      const result = TenantAccessTokenResponseSchema.safeParse({
        code: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('TextContentSchema', () => {
    it('validates text content', () => {
      const result = TextContentSchema.safeParse({ text: 'Hello' });
      expect(result.success).toBe(true);
    });

    it('fails without text', () => {
      const result = TextContentSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('PostContentSchema', () => {
    it('validates post content with zh_cn', () => {
      const result = PostContentSchema.safeParse({
        zh_cn: {
          title: 'Title',
          content: [[{ tag: 'text', text: 'Hello' }]],
        },
      });
      expect(result.success).toBe(true);
    });

    it('validates empty post content', () => {
      const result = PostContentSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('SendMessageRequestSchema', () => {
    it('validates a complete send message request', () => {
      const result = SendMessageRequestSchema.safeParse({
        receive_id_type: 'chat_id',
        receive_id: 'oc_123',
        msg_type: 'text',
        content: '{"text":"Hello"}',
      });
      expect(result.success).toBe(true);
    });

    it('fails with invalid receive_id_type', () => {
      const result = SendMessageRequestSchema.safeParse({
        receive_id_type: 'invalid',
        receive_id: 'oc_123',
        msg_type: 'text',
        content: '{}',
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional uuid', () => {
      const result = SendMessageRequestSchema.safeParse({
        receive_id_type: 'open_id',
        receive_id: 'ou_123',
        msg_type: 'text',
        content: '{}',
        uuid: 'uuid-1',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('SendMessageResponseSchema', () => {
    it('validates response with data', () => {
      const result = SendMessageResponseSchema.safeParse({
        code: 0,
        msg: 'ok',
        data: { message_id: 'msg_1' },
      });
      expect(result.success).toBe(true);
    });

    it('validates response without data', () => {
      const result = SendMessageResponseSchema.safeParse({
        code: 99999,
        msg: 'error',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('UrlVerificationEventSchema', () => {
    it('validates url verification event', () => {
      const result = UrlVerificationEventSchema.safeParse({
        challenge: 'abc',
        token: 'tok',
        type: 'url_verification',
      });
      expect(result.success).toBe(true);
    });

    it('fails with wrong type', () => {
      const result = UrlVerificationEventSchema.safeParse({
        challenge: 'abc',
        token: 'tok',
        type: 'other',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MessageEventSchema', () => {
    it('validates a message event', () => {
      const result = MessageEventSchema.safeParse({
        schema: '2.0',
        header: {
          event_id: 'ev_1',
          token: 'tok',
          create_time: '123',
          event_type: 'im.message.receive_v1',
          tenant_key: 'tk',
          app_id: 'app',
        },
        event: {
          sender: {
            sender_id: { open_id: 'ou_1' },
            sender_type: 'user',
            tenant_key: 'tk',
          },
          message: {
            message_id: 'msg_1',
            create_time: '123',
            chat_id: 'oc_1',
            chat_type: 'p2p',
            message_type: 'text',
            content: '{"text":"hi"}',
          },
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('EventEnvelopeSchema', () => {
    it('validates generic event envelope', () => {
      const result = EventEnvelopeSchema.safeParse({
        schema: '2.0',
        header: {
          event_id: 'ev_1',
          token: 'tok',
          create_time: '123',
          event_type: 'im.message.receive_v1',
          tenant_key: 'tk',
          app_id: 'app',
        },
        event: {},
      });
      expect(result.success).toBe(true);
    });

    it('validates minimal envelope', () => {
      const result = EventEnvelopeSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('UserInfoResponseSchema', () => {
    it('validates user info response', () => {
      const result = UserInfoResponseSchema.safeParse({
        code: 0,
        msg: 'ok',
        data: {
          user: {
            open_id: 'ou_1',
            name: 'Alice',
          },
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('type exports', () => {
    it('FeishuMessageType includes known types', () => {
      const types: FeishuMessageType[] = ['text', 'post', 'image', 'file', 'audio', 'media', 'sticker', 'interactive'];
      expect(types).toHaveLength(8);
    });

    it('ReceiveIdType includes known types', () => {
      const types: ReceiveIdType[] = ['open_id', 'user_id', 'union_id', 'email', 'chat_id'];
      expect(types).toHaveLength(5);
    });

    it('TokenCache shape is constructible', () => {
      const cache: TokenCache = { accessToken: 'tok', expiresAt: Date.now() + 3600000 };
      expect(cache.accessToken).toBe('tok');
    });
  });
});
