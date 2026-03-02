import { z } from 'zod';
import type { ToolResult } from '../types';

// Re-export from config schema
export { MemoryConfigSchema } from '../config/schema';

// Memory configuration schema (local version for types)
export const MemoryConfigLocalSchema = z.object({
  type: z.literal('filesystem').default('filesystem'),
  path: z.string().default('./data/memory'),
  tools: z.object({
    enabled: z.array(z.string()).default(['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record']),
    autoRecord: z.boolean().default(true),
  }).default({}),
  retention: z.object({
    conversations: z.string().default('90d'),
    facts: z.string().default('forever'),
    decisions: z.string().default('forever'),
  }).default({}),
});

export type MemoryConfig = z.infer<typeof MemoryConfigLocalSchema>;

// Memory paths
export type MemoryCategory = 'conversations' | 'facts' | 'decisions' | 'skills';

// Conversation record structure
export interface ConversationEntry {
  timestamp: string;
  source: string;           // e.g., "cli", "lark:private:xxx"
  user: string;
  assistant: string;
  metadata?: {
    decision?: string;
    relatedFiles?: string[];
    skillTriggered?: string;
  };
}

// Fact structure
export interface Fact {
  category: 'user' | 'preferences' | 'projects' | 'general';
  key: string;
  value: string;
  updatedAt: string;
}

// Decision record structure
export interface DecisionRecord {
  id: string;
  title: string;
  context: string;
  decision: string;
  rationale: string;
  alternatives?: string[];
  createdAt: string;
}

// Skill structure
export interface Skill {
  name: string;
  description: string;
  tags: string[];
  triggers: string[];
  content: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  lastUsed?: string;
}

// Memory tool result - uses unified type
export type MemoryToolResult = ToolResult<string | object>;
