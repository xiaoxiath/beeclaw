/**
 * State Tool Executor
 *
 * Execute state management tools from the builtin tools system
 */

import { getSharedState } from './state';
import type {
  StateSetParams,
  StateGetParams,
  StateDeleteParams,
  StateUpdateParams,
  StateExistsParams,
  StateListParams,
  StateLockParams,
  StateUnlockParams,
} from './state-tools-consolidated';
import { formatStateEntry, formatStateStats } from './state-tools-consolidated';
import type { ToolResult } from '../tools/builtin';

/**
 * Execute state_set tool
 */
export async function executeStateSet(params: StateSetParams): Promise<ToolResult> {
  try {
    const state = getSharedState();

    await state.set(params.key, params.value, params.ttl, params.metadata);

    const entry = await state.getEntry(params.key);

    return {
      success: true,
      output: `✅ Value stored successfully\n\n${formatStateEntry(params.key, entry!)}`,
      data: { key: params.key, ttl: params.ttl },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[StateTool] Error in state_set:', errorMsg);

    return {
      success: false,
      output: `Failed to set state: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

/**
 * Execute state_get tool
 */
export async function executeStateGet(params: StateGetParams): Promise<ToolResult> {
  try {
    const state = getSharedState();

    const entry = await state.getEntry(params.key);

    if (!entry) {
      return {
        success: true,
        output: `Key "${params.key}" not found or has expired`,
        data: { found: false },
      };
    }

    return {
      success: true,
      output: formatStateEntry(params.key, entry),
      data: { value: entry.value, found: true },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[StateTool] Error in state_get:', errorMsg);

    return {
      success: false,
      output: `Failed to get state: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

/**
 * Execute state_delete tool
 */
export async function executeStateDelete(params: StateDeleteParams): Promise<ToolResult> {
  try {
    const state = getSharedState();

    const existed = await state.delete(params.key);

    return {
      success: true,
      output: existed
        ? `✅ Key "${params.key}" deleted successfully`
        : `⚠️ Key "${params.key}" did not exist`,
      data: { existed },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[StateTool] Error in state_delete:', errorMsg);

    return {
      success: false,
      output: `Failed to delete state: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

/**
 * Execute state_update tool
 */
export async function executeStateUpdate(params: StateUpdateParams): Promise<ToolResult> {
  try {
    const state = getSharedState();

    let updater: (current: any) => any;

    switch (params.operation) {
      case 'increment':
        updater = (current) => (current || 0) + (params.value || 1);
        break;

      case 'decrement':
        updater = (current) => (current || 0) - (params.value || 1);
        break;

      case 'append':
        updater = (current) => [...(current || []), params.value];
        break;

      case 'prepend':
        updater = (current) => [params.value, ...(current || [])];
        break;

      case 'merge':
        updater = (current) => ({ ...(current || {}), ...params.value });
        break;

      case 'replace':
        updater = () => params.value;
        break;

      default:
        throw new Error(`Unknown operation: ${params.operation}`);
    }

    await state.guardedUpdate(params.key, updater, params.ttl);

    const entry = await state.getEntry(params.key);

    return {
      success: true,
      output: `✅ Value updated successfully (${params.operation})\n\n${formatStateEntry(params.key, entry!)}`,
      data: { key: params.key, operation: params.operation },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[StateTool] Error in state_update:', errorMsg);

    return {
      success: false,
      output: `Failed to update state: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

/**
 * Execute state_exists tool
 */
export async function executeStateExists(params: StateExistsParams): Promise<ToolResult> {
  try {
    const state = getSharedState();

    const exists = await state.exists(params.key);

    return {
      success: true,
      output: exists
        ? `✅ Key "${params.key}" exists`
        : `⚠️ Key "${params.key}" does not exist or has expired`,
      data: { exists },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[StateTool] Error in state_exists:', errorMsg);

    return {
      success: false,
      output: `Failed to check state: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

/**
 * Execute state_list tool
 */
export async function executeStateList(params: StateListParams): Promise<ToolResult> {
  try {
    const state = getSharedState();

    const allKeys = await state.keys();

    const keys = params.prefix
      ? allKeys.filter(k => k.startsWith(params.prefix!))
      : allKeys;

    if (keys.length === 0) {
      return {
        success: true,
        output: params.prefix
          ? `No keys found with prefix "${params.prefix}"`
          : 'No keys in state store',
        data: { keys: [], total: 0 },
      };
    }

    const lines: string[] = [];
    lines.push(`## State Keys (${keys.length} total)\n`);

    for (const key of keys.sort()) {
      const entry = await state.getEntry(key);
      if (entry) {
        const preview = JSON.stringify(entry.value).substring(0, 50);
        lines.push(`- **${key}**: ${preview}${preview.length >= 50 ? '...' : ''}`);
      }
    }

    return {
      success: true,
      output: lines.join('\n'),
      data: { keys, total: keys.length },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[StateTool] Error in state_list:', errorMsg);

    return {
      success: false,
      output: `Failed to list state: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

/**
 * Execute state_stats tool
 */
export async function executeStateStats(): Promise<ToolResult> {
  try {
    const state = getSharedState();

    const stats = await state.getStats();

    return {
      success: true,
      output: formatStateStats(stats),
      data: stats,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[StateTool] Error in state_stats:', errorMsg);

    return {
      success: false,
      output: `Failed to get stats: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

/**
 * Track acquired locks (for cleanup)
 */
const acquiredLocks: Map<string, () => void> = new Map();

/**
 * Execute state_lock tool
 */
export async function executeStateLock(params: StateLockParams): Promise<ToolResult> {
  try {
    const state = getSharedState();

    const release = await state.acquireLock(params.key, params.owner, params.timeout);

    // Store release function for later
    acquiredLocks.set(params.key, release);

    return {
      success: true,
      output: `🔒 Lock acquired on "${params.key}"${params.owner ? ` (owner: ${params.owner})` : ''}`,
      data: { key: params.key, owner: params.owner },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[StateTool] Error in state_lock:', errorMsg);

    return {
      success: false,
      output: `Failed to acquire lock: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

/**
 * Execute state_unlock tool
 */
export async function executeStateUnlock(params: StateUnlockParams): Promise<ToolResult> {
  try {
    const release = acquiredLocks.get(params.key);

    if (!release) {
      return {
        success: false,
        output: `⚠️ No lock found for "${params.key}"`,
        error: 'Lock not found',
      };
    }

    release();
    acquiredLocks.delete(params.key);

    return {
      success: true,
      output: `🔓 Lock released on "${params.key}"`,
      data: { key: params.key },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[StateTool] Error in state_unlock:', errorMsg);

    return {
      success: false,
      output: `Failed to release lock: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

// ============================================================================
// Consolidated Tool Executors
// ============================================================================

import type {
  StateManageParams,
  StateQueryParams,
  StateLockManageParams,
} from './state-tools-consolidated';

/**
 * Execute consolidated state_manage tool
 */
export async function executeStateManage(params: StateManageParams): Promise<ToolResult> {
  switch (params.action) {
    case 'set':
      return executeStateSet({
        key: params.key,
        value: params.value!,
        ttl: params.ttl,
        metadata: params.metadata,
      });

    case 'get':
      return executeStateGet({ key: params.key });

    case 'update':
      return executeStateUpdate({
        key: params.key,
        operation: params.operation!,
        value: params.value,
        ttl: params.ttl,
      });

    case 'delete':
      return executeStateDelete({ key: params.key });

    default:
      return {
        success: false,
        output: `Unknown action: ${(params as any).action}`,
        error: 'Invalid action',
      };
  }
}

/**
 * Execute consolidated state_query tool
 */
export async function executeStateQuery(params: StateQueryParams): Promise<ToolResult> {
  switch (params.action) {
    case 'list':
      return executeStateList({ prefix: params.prefix });

    case 'exists':
      return executeStateExists({ key: params.key! });

    case 'stats':
      return executeStateStats();

    default:
      return {
        success: false,
        output: `Unknown action: ${(params as any).action}`,
        error: 'Invalid action',
      };
  }
}

/**
 * Execute consolidated state_lock_manage tool
 */
export async function executeStateLockManage(params: StateLockManageParams): Promise<ToolResult> {
  switch (params.action) {
    case 'acquire':
      return executeStateLock({
        key: params.key,
        owner: params.owner,
        timeout: params.timeout,
      });

    case 'release':
      return executeStateUnlock({ key: params.key });

    default:
      return {
        success: false,
        output: `Unknown action: ${(params as any).action}`,
        error: 'Invalid action',
      };
  }
}
