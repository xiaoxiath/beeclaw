/**
 * Finance tools have been migrated to the beeclaw-hedge-fund-research skill.
 * Use `skill_ensure` to load the skill when finance capabilities are needed.
 * 
 * Migrated tools: stock_quote, stock_history, stock_financial, stock_info
 * @deprecated Since v0.5.0 - Use beeclaw-hedge-fund-research skill instead
 */

import type { BuiltinToolResult } from './builtin';

// Empty export for backward compatibility
export const financeTools: Record<string, never> = {};
export const FINANCE_TOOL_NAMES = ['stock_quote', 'stock_history', 'stock_financial', 'stock_info'] as const;
export const FINANCE_MIGRATION_MESSAGE = 'Finance tools have been migrated to the beeclaw-hedge-fund-research skill. Use skill_ensure({name: "beeclaw-hedge-fund-research"}) to load finance capabilities.';

// ---------------------------------------------------------------------------
// Deprecated stub exports — kept so that `builtin.ts` re-exports don't break
// at compile time. Each executor returns the migration message at runtime.
// ---------------------------------------------------------------------------

/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export const StockQuoteSchema = {} as never;
/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export const stockQuoteTool = { name: 'stock_quote' as const, description: FINANCE_MIGRATION_MESSAGE, parameters: { type: 'object' as const, properties: {}, required: [] } };
/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export async function executeStockQuote(_params: Record<string, unknown>): Promise<BuiltinToolResult> {
  return { success: false, error: FINANCE_MIGRATION_MESSAGE };
}

/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export const StockHistorySchema = {} as never;
/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export const stockHistoryTool = { name: 'stock_history' as const, description: FINANCE_MIGRATION_MESSAGE, parameters: { type: 'object' as const, properties: {}, required: [] } };
/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export async function executeStockHistory(_params: Record<string, unknown>): Promise<BuiltinToolResult> {
  return { success: false, error: FINANCE_MIGRATION_MESSAGE };
}

/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export const StockFinancialSchema = {} as never;
/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export const stockFinancialTool = { name: 'stock_financial' as const, description: FINANCE_MIGRATION_MESSAGE, parameters: { type: 'object' as const, properties: {}, required: [] } };
/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export async function executeStockFinancial(_params: Record<string, unknown>): Promise<BuiltinToolResult> {
  return { success: false, error: FINANCE_MIGRATION_MESSAGE };
}

/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export const StockInfoSchema = {} as never;
/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export const stockInfoTool = { name: 'stock_info' as const, description: FINANCE_MIGRATION_MESSAGE, parameters: { type: 'object' as const, properties: {}, required: [] } };
/** @deprecated Migrated to beeclaw-hedge-fund-research skill */
export async function executeStockInfo(_params: Record<string, unknown>): Promise<BuiltinToolResult> {
  return { success: false, error: FINANCE_MIGRATION_MESSAGE };
}
