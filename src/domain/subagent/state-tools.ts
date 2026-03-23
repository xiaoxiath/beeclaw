/**
 * State Management Tools — COMPATIBILITY SHIM
 *
 * @deprecated Individual tool objects are superseded by consolidated tools
 * in `./state-tools-consolidated.ts`. This file is kept for backward compat.
 */

import type { StateEntry } from './state';

/** @deprecated */ export interface StateSetParams { key: string; value: any; ttl?: number; }
/** @deprecated */ export interface StateGetParams { key: string; }
/** @deprecated */ export interface StateDeleteParams { key: string; }
/** @deprecated */ export interface StateUpdateParams { key: string; value: any; merge?: boolean; ttl?: number; }
/** @deprecated */ export interface StateExistsParams { key: string; }
/** @deprecated */ export interface StateListParams { prefix?: string; }
/** @deprecated */ export interface StateSubscribeParams { key: string; events?: string[]; }
/** @deprecated */ export interface StateLockParams { key: string; ttl?: number; }
/** @deprecated */ export interface StateUnlockParams { key: string; }

export { formatStateEntry, formatStateStats } from './state-tools-consolidated';

/** @deprecated */ export const stateSetTool = { name: 'state_set', description: 'Store a value in shared state', parameters: { type: 'object' as const, properties: { key: { type: 'string' as const }, value: {}, ttl: { type: 'number' as const } }, required: ['key', 'value'] } };
/** @deprecated */ export const stateGetTool = { name: 'state_get', description: 'Retrieve a value from shared state', parameters: { type: 'object' as const, properties: { key: { type: 'string' as const } }, required: ['key'] } };
/** @deprecated */ export const stateDeleteTool = { name: 'state_delete', description: 'Delete a key from shared state', parameters: { type: 'object' as const, properties: { key: { type: 'string' as const } }, required: ['key'] } };
/** @deprecated */ export const stateUpdateTool = { name: 'state_update', description: 'Update a value in shared state', parameters: { type: 'object' as const, properties: { key: { type: 'string' as const }, value: {}, merge: { type: 'boolean' as const }, ttl: { type: 'number' as const } }, required: ['key', 'value'] } };
/** @deprecated */ export const stateExistsTool = { name: 'state_exists', description: 'Check if key exists', parameters: { type: 'object' as const, properties: { key: { type: 'string' as const } }, required: ['key'] } };
/** @deprecated */ export const stateListTool = { name: 'state_list', description: 'List keys', parameters: { type: 'object' as const, properties: { prefix: { type: 'string' as const } } } };
/** @deprecated */ export const stateStatsTool = { name: 'state_stats', description: 'Get stats', parameters: { type: 'object' as const, properties: {} } };
/** @deprecated */ export const stateLockTool = { name: 'state_lock', description: 'Acquire lock', parameters: { type: 'object' as const, properties: { key: { type: 'string' as const }, ttl: { type: 'number' as const } }, required: ['key'] } };
/** @deprecated */ export const stateUnlockTool = { name: 'state_unlock', description: 'Release lock', parameters: { type: 'object' as const, properties: { key: { type: 'string' as const } }, required: ['key'] } };
