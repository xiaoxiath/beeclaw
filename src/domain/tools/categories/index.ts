/**
 * Tool Categories — Modular re-export layer for src/tools/builtin.ts
 *
 * This provides logical grouping of the 35+ builtin tools without
 * physically splitting the monolithic file (which would be high-risk).
 *
 * Usage:
 *   import { webSearchTool } from './categories/search';
 *   import { shellTool } from './categories/shell';
 *   import * as FinanceTools from './categories/finance';
 */
export * from './search';
export * from './shell';
export * from './finance';
export * from './utility';
export * from './subagent';

// Phase 4: Additional category modules
export * from './research-tools';
export * from './file-tools';
export * from './code-tools';
export * from './state-tools';
export * from './memory-tools';
