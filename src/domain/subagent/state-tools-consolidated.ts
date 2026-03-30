/**
 * Consolidated State Management Tools
 *
 * Merged version of state tools to reduce tool count.
 * Old tools are kept for backward compatibility but marked as deprecated.
 */

import type { StateEntry } from './state';

// ---------------------------------------------------------------------------
// Parameter interfaces (merged from former state-tools.ts — D-P1-05)
// ---------------------------------------------------------------------------

export interface StateSetParams { key: string; value: any; ttl?: number; metadata?: Record<string, unknown>; }
export interface StateGetParams { key: string; }
export interface StateDeleteParams { key: string; }
export interface StateUpdateParams { key: string; value: any; merge?: boolean; ttl?: number; operation?: 'increment' | 'decrement' | 'append' | 'prepend' | 'merge' | 'replace'; }
export interface StateExistsParams { key: string; }
export interface StateListParams { prefix?: string; }
export interface StateSubscribeParams { key: string; events?: string[]; }
export interface StateLockParams { key: string; ttl?: number; owner?: string; timeout?: number; }
export interface StateUnlockParams { key: string; }

/**
 * Consolidated state management tool
 *
 * Combines: state_set, state_get, state_update, state_delete
 */
export const stateManageTool = {
  name: 'state_manage',
  description: `Manage shared state values with a unified interface.

**Actions:**
- **set**: Store a value (replaces state_set)
- **get**: Retrieve a value (replaces state_get)
- **update**: Atomically update a value (replaces state_update)
- **delete**: Remove a value (replaces state_delete)

**Best practices:**
1. Use descriptive, namespaced keys (e.g., "research:react19:features")
2. Set appropriate TTL for temporary data
3. Include metadata for context

**Examples:**
\`\`\`javascript
// Set a value
state_manage({
  action: "set",
  key: "research:react19:features",
  value: { hooks: ["useOptimistic"], serverComponents: true },
  ttl: 3600000
})

// Get a value
state_manage({ action: "get", key: "research:react19:features" })

// Update a value atomically
state_manage({
  action: "update",
  key: "counter",
  operation: "increment",
  value: 1
})

// Delete a value
state_manage({ action: "delete", key: "temp:cache:123" })
\`\`\``,

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['set', 'get', 'update', 'delete'],
        description: 'Action to perform',
      },
      key: {
        type: 'string',
        description: 'State key (use namespaces like "category:subcategory:item")',
      },
      value: {
        description: 'Value to store (for set/update actions)',
      },
      operation: {
        type: 'string',
        enum: ['increment', 'decrement', 'append', 'prepend', 'merge', 'replace'],
        description: 'Update operation (for update action only)',
      },
      ttl: {
        type: 'number',
        description: 'Time-to-live in milliseconds (optional)',
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata (optional, for set action)',
      },
    },
    required: ['action', 'key'],
  },
};

export interface StateManageParams {
  action: 'set' | 'get' | 'update' | 'delete';
  key: string;
  value?: any;
  operation?: 'increment' | 'decrement' | 'append' | 'prepend' | 'merge' | 'replace';
  ttl?: number;
  metadata?: Record<string, any>;
}

/**
 * Consolidated state query tool
 *
 * Combines: state_list, state_stats, state_exists
 */
export const stateQueryTool = {
  name: 'state_query',
  description: `Query shared state information.

**Actions:**
- **list**: List all keys or filter by prefix (replaces state_list)
- **exists**: Check if a key exists (replaces state_exists)
- **stats**: Get state statistics (replaces state_stats)

**Examples:**
\`\`\`javascript
// List all keys
state_query({ action: "list" })

// List keys with prefix
state_query({ action: "list", prefix: "research:" })

// Check if key exists
state_query({ action: "exists", key: "research:react19:features" })

// Get statistics
state_query({ action: "stats" })
\`\`\``,

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'exists', 'stats'],
        description: 'Query action to perform',
      },
      key: {
        type: 'string',
        description: 'State key (for exists action)',
      },
      prefix: {
        type: 'string',
        description: 'Filter keys by prefix (for list action)',
      },
    },
    required: ['action'],
  },
};

export interface StateQueryParams {
  action: 'list' | 'exists' | 'stats';
  key?: string;
  prefix?: string;
}

/**
 * Consolidated state lock tool
 *
 * Combines: state_lock, state_unlock
 */
export const stateLockManageTool = {
  name: 'state_lock_manage',
  description: `Manage locks on state keys for exclusive access.

**Actions:**
- **acquire**: Acquire a lock (replaces state_lock)
- **release**: Release a lock (replaces state_unlock)

Use locks when you need to perform multiple operations atomically.
Always release locks when done.

**Examples:**
\`\`\`javascript
// Acquire a lock
state_lock_manage({
  action: "acquire",
  key: "critical_resource",
  timeout: 5000
})

// Release a lock
state_lock_manage({ action: "release", key: "critical_resource" })
\`\`\``,

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['acquire', 'release'],
        description: 'Lock action to perform',
      },
      key: {
        type: 'string',
        description: 'State key to lock/unlock',
      },
      owner: {
        type: 'string',
        description: 'Lock owner identifier (optional, for acquire)',
      },
      timeout: {
        type: 'number',
        description: 'Lock acquisition timeout in ms (default: 5000, for acquire)',
      },
    },
    required: ['action', 'key'],
  },
};

export interface StateLockManageParams {
  action: 'acquire' | 'release';
  key: string;
  owner?: string;
  timeout?: number;
}

/**
 * Format state entry for display (reused from original)
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
 * Format state stats for display (reused from original)
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
