/**
 * Tests for event-types.ts
 *
 * This file only exports interfaces and types. We verify the exports exist
 * and the shapes are usable at the type level via runtime assertions on
 * constructed objects.
 */
import { describe, it, expect } from 'bun:test';

import type {
  FeishuUserId,
  FeishuOperator,
  FeishuSender,
  FeishuMember,
  BaseFeishuEvent,
  FeishuReceiveIdType,
} from '../event-types';

describe('event-types', () => {
  describe('FeishuUserId', () => {
    it('can construct a valid FeishuUserId object', () => {
      const uid: FeishuUserId = { open_id: 'ou_123', user_id: 'u_456', union_id: 'un_789' };
      expect(uid.open_id).toBe('ou_123');
    });

    it('all fields are optional', () => {
      const uid: FeishuUserId = {};
      expect(uid.open_id).toBeUndefined();
    });
  });

  describe('FeishuOperator', () => {
    it('has operator_id of FeishuUserId', () => {
      const op: FeishuOperator = { operator_id: { open_id: 'ou_1' } };
      expect(op.operator_id.open_id).toBe('ou_1');
    });
  });

  describe('FeishuSender', () => {
    it('can construct sender with all fields', () => {
      const sender: FeishuSender = {
        sender_id: { open_id: 'ou_1' },
        sender_type: 'user',
        tenant_key: 'tk_1',
      };
      expect(sender.sender_type).toBe('user');
    });

    it('all fields are optional', () => {
      const sender: FeishuSender = {};
      expect(sender.sender_type).toBeUndefined();
    });
  });

  describe('FeishuMember', () => {
    it('has member_id and optional name/tenant_key', () => {
      const member: FeishuMember = {
        member_id: { user_id: 'u_1' },
        name: 'Alice',
        tenant_key: 'tk_1',
      };
      expect(member.name).toBe('Alice');
    });
  });

  describe('BaseFeishuEvent', () => {
    it('all fields are optional', () => {
      const event: BaseFeishuEvent = {};
      expect(event.event_id).toBeUndefined();
    });

    it('can be fully populated', () => {
      const event: BaseFeishuEvent = {
        event_id: 'ev_1',
        token: 'tok',
        create_time: '1234567890',
        event_type: 'im.message.receive_v1',
        tenant_key: 'tk',
        ts: '1234',
        uuid: 'uuid-1',
        type: 'event_callback',
        app_id: 'app_1',
      };
      expect(event.event_type).toBe('im.message.receive_v1');
    });
  });

  describe('FeishuReceiveIdType', () => {
    it('accepts valid receive id types', () => {
      const types: FeishuReceiveIdType[] = ['open_id', 'user_id', 'union_id', 'email', 'chat_id'];
      expect(types).toHaveLength(5);
    });
  });
});
