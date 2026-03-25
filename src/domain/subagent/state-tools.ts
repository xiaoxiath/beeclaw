/**
 * State Management Tools — Parameter Interfaces & Re-exports
 *
 * The individual tool object definitions (stateSetTool, stateGetTool, etc.)
 * have been removed. They were superseded by the consolidated tools in
 * `./state-tools-consolidated.ts`. Consumers that still reference the old
 * tool objects should migrate to the consolidated versions.
 *
 * This file retains:
 * - Parameter interfaces (still referenced by state-executor.ts and builtin.ts)
 * - Re-exports of formatStateEntry / formatStateStats from the consolidated module
 */

import type { StateEntry } from './state';

export interface StateSetParams { key: string; value: any; ttl?: number; }
export interface StateGetParams { key: string; }
export interface StateDeleteParams { key: string; }
export interface StateUpdateParams { key: string; value: any; merge?: boolean; ttl?: number; }
export interface StateExistsParams { key: string; }
export interface StateListParams { prefix?: string; }
export interface StateSubscribeParams { key: string; events?: string[]; }
export interface StateLockParams { key: string; ttl?: number; }
export interface StateUnlockParams { key: string; }

export { formatStateEntry, formatStateStats } from './state-tools-consolidated';
