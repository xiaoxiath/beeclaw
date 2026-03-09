/**
 * [P2 FIX 4.7] Shared Feishu Event Types
 *
 * Extracted from ws-client.ts to reduce redundancy.
 * Common patterns (user IDs, operators, senders) are defined once here.
 */

// ============================================================
// Common ID Types
// ============================================================

/** Feishu user ID (can be identified by open_id, user_id, or union_id) */
export interface FeishuUserId {
  union_id?: string;
  user_id?: string;
  open_id?: string;
}

/** Operator info (used in chat events) */
export interface FeishuOperator {
  operator_id: FeishuUserId;
}

/** Sender info (used in message events) */
export interface FeishuSender {
  sender_id?: FeishuUserId;
  sender_type?: string;
  tenant_key?: string;
}

/** Member info (used in chat member events) */
export interface FeishuMember {
  member_id: FeishuUserId;
  name?: string;
  tenant_key?: string;
}

// ============================================================
// Base Event
// ============================================================

/** Common fields across all Feishu events */
export interface BaseFeishuEvent {
  event_id?: string;
  token?: string;
  create_time?: string;
  event_type?: string;
  tenant_key?: string;
  ts?: string;
  uuid?: string;
  type?: string;
  app_id?: string;
}

// ============================================================
// Receive ID Type
// ============================================================

export type FeishuReceiveIdType = 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id';
