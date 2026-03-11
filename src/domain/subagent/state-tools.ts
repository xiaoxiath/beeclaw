/**
 * State Management Tools
 *
 * Tools for LLM to interact with SharedState
 */

import type { StateEntry } from './state';

/**
 * Parameters for state_set tool
 */
export interface StateSetParams {
  /** State key */
  key: string;

  /** Value to store */
  value: any;

  /** Time-to-live in milliseconds (optional) */
  ttl?: number;

  /** Additional metadata (optional) */
  metadata?: Record<string, any>;
}

/**
 * Parameters for state_get tool
 */
export interface StateGetParams {
  /** State key */
  key: string;
}

/**
 * Parameters for state_delete tool
 */
export interface StateDeleteParams {
  /** State key */
  key: string;
}

/**
 * Parameters for state_update tool
 */
export interface StateUpdateParams {
  /** State key */
  key: string;

  /** Update function description (LLM provides logic) */
  operation: 'increment' | 'decrement' | 'append' | 'prepend' | 'merge' | 'replace';

  /** Value for the operation */
  value?: any;

  /** Optional TTL */
  ttl?: number;
}

/**
 * Parameters for state_exists tool
 */
export interface StateExistsParams {
  /** State key */
  key: string;
}

/**
 * Parameters for state_list tool
 */
export interface StateListParams {
  /** Filter keys by prefix (optional) */
  prefix?: string;
}

/**
 * Parameters for state_subscribe tool
 */
export interface StateSubscribeParams {
  /** State key (use '*' for all keys) */
  key: string;

  /** Subscription description */
  description?: string;
}

/**
 * Tool definition for state_set
 */
export const stateSetTool = {
  name: 'state_set',
  description: `Store a value in the shared state.

Use this tool to save data that can be accessed by other subagents or the main agent.
Supports optional TTL (time-to-live) for automatic expiration.

Best practices:
1. Use descriptive, namespaced keys (e.g., "research:react19:features")
2. Set appropriate TTL for temporary data
3. Include metadata for context

Example:
  state_set({
    key: "research:react19:features",
    value: { hooks: ["useOptimistic"], serverComponents: true },
    ttl: 3600000, // 1 hour
    metadata: { source: "official_docs" }
  })`,

  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'State key (use namespaces like "category:subcategory:item")',
      },
      value: {
        description: 'Value to store (can be any JSON-serializable type)',
      },
      ttl: {
        type: 'number',
        description: 'Time-to-live in milliseconds (optional)',
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata (optional)',
      },
    },
    required: ['key', 'value'],
  },
};

/**
 * Tool definition for state_get
 */
export const stateGetTool = {
  name: 'state_get',
  description: `Retrieve a value from the shared state.

Use this tool to access data stored by other subagents or previous operations.
Returns undefined if the key doesn't exist or has expired.

Example:
  state_get({ key: "research:react19:features" })`,

  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'State key to retrieve',
      },
    },
    required: ['key'],
  },
};

/**
 * Tool definition for state_delete
 */
export const stateDeleteTool = {
  name: 'state_delete',
  description: `Delete a value from the shared state.

Use this tool to remove data that is no longer needed.

Example:
  state_delete({ key: "temp:cache:123" })`,

  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'State key to delete',
      },
    },
    required: ['key'],
  },
};

/**
 * Tool definition for state_update
 */
export const stateUpdateTool = {
  name: 'state_update',
  description: `Update a value atomically using a predefined operation.

Use this tool to modify existing values safely without race conditions.

Available operations:
- increment: Add to a number
- decrement: Subtract from a number
- append: Append to an array
- prepend: Prepend to an array
- merge: Merge objects
- replace: Replace the entire value

Examples:
  state_update({ key: "counter", operation: "increment", value: 1 })
  state_update({ key: "items", operation: "append", value: "new_item" })`,

  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'State key to update',
      },
      operation: {
        type: 'string',
        enum: ['increment', 'decrement', 'append', 'prepend', 'merge', 'replace'],
        description: 'Update operation type',
      },
      value: {
        description: 'Value for the operation',
      },
      ttl: {
        type: 'number',
        description: 'Optional new TTL',
      },
    },
    required: ['key', 'operation'],
  },
};

/**
 * Tool definition for state_exists
 */
export const stateExistsTool = {
  name: 'state_exists',
  description: `Check if a key exists in the shared state.

Returns true if the key exists and hasn't expired.

Example:
  state_exists({ key: "research:react19:features" })`,

  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'State key to check',
      },
    },
    required: ['key'],
  },
};

/**
 * Tool definition for state_list
 */
export const stateListTool = {
  name: 'state_list',
  description: `List all keys in the shared state.

Optionally filter by prefix to find related keys.

Examples:
  state_list({}) // List all keys
  state_list({ prefix: "research:" }) // List only research keys`,

  parameters: {
    type: 'object',
    properties: {
      prefix: {
        type: 'string',
        description: 'Filter keys by prefix (optional)',
      },
    },
    required: [],
  },
};

/**
 * Tool definition for state_stats
 */
export const stateStatsTool = {
  name: 'state_stats',
  description: `Get statistics about the shared state.

Returns information about total entries, memory usage, locks, etc.

Example:
  state_stats({})`,

  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * Tool definition for state_lock
 */
export const stateLockTool = {
  name: 'state_lock',
  description: `Acquire a lock on a state key for exclusive access.

Use this when you need to perform multiple operations atomically.
Always release the lock when done by calling state_unlock.

Example:
  state_lock({ key: "critical_resource", timeout: 5000 })`,

  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'State key to lock',
      },
      owner: {
        type: 'string',
        description: 'Lock owner identifier (optional)',
      },
      timeout: {
        type: 'number',
        description: 'Lock acquisition timeout in milliseconds (default: 5000)',
      },
    },
    required: ['key'],
  },
};

/**
 * Parameters for state_lock tool
 */
export interface StateLockParams {
  /** State key to lock */
  key: string;

  /** Lock owner identifier (optional) */
  owner?: string;

  /** Lock acquisition timeout in milliseconds (default: 5000) */
  timeout?: number;
}

/**
 * Parameters for state_unlock tool
 */
export interface StateUnlockParams {
  /** State key to unlock */
  key: string;
}

/**
 * Tool definition for state_unlock
 */
export const stateUnlockTool = {
  name: 'state_unlock',
  description: `Release a lock on a state key.

Always release locks when you're done with exclusive operations.

Example:
  state_unlock({ key: "critical_resource" })`,

  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'State key to unlock',
      },
    },
    required: ['key'],
  },
};

/**
 * Format state entry for display
 */
export function formatStateEntry(key: string, entry: StateEntry): string {
  const lines: string[] = [];

  lines.push(`**Key**: ${key}`);
  lines.push(`**Created**: ${entry.createdAt.toISOString()}`);
  lines.push(`**Updated**: ${entry.updatedAt.toISOString()}`);

  if (entry.expiresAt) {
    const expires = entry.expiresAt.getTime() - Date.now();
    lines.push(`**Expires**: ${entry.expiresAt.toISOString()} (in ${Math.round(expires / 1000)}s)`);
  }

  if (entry.ttl) {
    lines.push(`**TTL**: ${entry.ttl}ms`);
  }

  if (entry.metadata && Object.keys(entry.metadata).length > 0) {
    lines.push(`**Metadata**: ${JSON.stringify(entry.metadata)}`);
  }

  lines.push(`\n**Value**:`);
  lines.push('```json');
  lines.push(JSON.stringify(entry.value, null, 2));
  lines.push('```');

  return lines.join('\n');
}

/**
 * Format state stats for display
 */
export function formatStateStats(stats: {
  totalEntries: number;
  lockedKeys: number;
  activeSubscriptions: number;
  expiredEntries: number;
  estimatedMemoryUsage: number;
}): string {
  const lines: string[] = [];

  lines.push(`## Shared State Statistics\n`);
  lines.push(`**Total Entries**: ${stats.totalEntries}`);
  lines.push(`**Locked Keys**: ${stats.lockedKeys}`);
  lines.push(`**Active Subscriptions**: ${stats.activeSubscriptions}`);
  lines.push(`**Expired Entries**: ${stats.expiredEntries}`);
  lines.push(`**Estimated Memory**: ${(stats.estimatedMemoryUsage / 1024).toFixed(2)} KB`);

  return lines.join('\n');
}
