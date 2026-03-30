/**
 * Common Types
 *
 * Shared type definitions across all Beeclaw subsystems
 */

import { z } from 'zod';

// Re-export channel types
export type {
  ChannelType,
  MessageChannel,
  MessageContent,
  MultimodalContent,
  PostMessageOptions,
  ReplyMessageOptions,
  UpdateMessageOptions,
  MessageResult,
} from './channel';

// ============================================================
// Unified Tool Result Type
// ============================================================

/**
 * Standard result type for all tool executions
 * @template T - The type of data returned on success
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Human-readable output text (used by state tools and others) */
  output?: string;
  /**
   * Special marker to indicate this tool result contains a content block
   * that should be rendered in the message stream (e.g., chart_data)
   */
  _contentBlock?: boolean;
  /** HITL signal: the tool needs user input before completing */
  needsUserInput?: boolean;
  /** HITL: the question to ask the user */
  question?: string;
  /** HITL: available options for the user */
  options?: string[];
  /** HITL: additional context */
  context?: string;
  /** HITL: expected input type */
  inputType?: string;
  /** HITL: status message */
  message?: string;
  /** Alias for data — used in some tool results */
  result?: T;
}

// Generic tool result schemas
export const ToolResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  _contentBlock: z.boolean().optional(),
});

// ============================================================
// Common Enums
// ============================================================

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export type State = 'active' | 'paused' | 'completed' | 'cancelled';

// ============================================================
// Store Configuration
// ============================================================

export interface StoreConfig {
  basePath: string;
  autoInit?: boolean;
}

export const DEFAULT_MEMORY_BASE_PATH = './data/memory';

// ============================================================
// Utility Types
// ============================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type WithTimestamp<T> = T & {
  createdAt: string;
  updatedAt: string;
};

// ============================================================
// Error Formatting
// ============================================================

export function formatError(context: string, message: string): string {
  return `${context}: ${message}`;
}

export function notFoundError(type: string, id: string): string {
  return `${type} not found: ${id}`;
}

export function invalidParamError(param: string, reason: string): string {
  return `Invalid parameter '${param}': ${reason}`;
}
