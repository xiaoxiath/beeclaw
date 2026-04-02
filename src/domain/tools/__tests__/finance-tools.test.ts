/**
 * Tests for finance-tools.ts (deprecated stubs)
 *
 * All finance tools have been migrated to the beeclaw-hedge-fund-research skill.
 * This file tests the deprecated stub exports for backward compatibility.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  stockQuoteTool,
  executeStockQuote,
  stockHistoryTool,
  executeStockHistory,
  stockFinancialTool,
  executeStockFinancial,
  stockInfoTool,
  executeStockInfo,
  StockQuoteSchema,
  StockHistorySchema,
  StockFinancialSchema,
  StockInfoSchema,
  financeTools,
  FINANCE_TOOL_NAMES,
  FINANCE_MIGRATION_MESSAGE,
} from '../finance-tools';

describe('finance-tools (deprecated stubs)', () => {
  // ---- financeTools record ----
  describe('financeTools record', () => {
    it('is an empty record', () => {
      expect(financeTools).toEqual({});
      expect(Object.keys(financeTools)).toHaveLength(0);
    });
  });

  // ---- FINANCE_TOOL_NAMES ----
  describe('FINANCE_TOOL_NAMES', () => {
    it('lists migrated tool names', () => {
      expect(FINANCE_TOOL_NAMES).toContain('stock_quote');
      expect(FINANCE_TOOL_NAMES).toContain('stock_history');
      expect(FINANCE_TOOL_NAMES).toContain('stock_financial');
      expect(FINANCE_TOOL_NAMES).toContain('stock_info');
    });
  });

  // ---- FINANCE_MIGRATION_MESSAGE ----
  describe('FINANCE_MIGRATION_MESSAGE', () => {
    it('contains skill_ensure guidance', () => {
      expect(FINANCE_MIGRATION_MESSAGE).toContain('beeclaw-hedge-fund-research');
      expect(FINANCE_MIGRATION_MESSAGE).toContain('skill_ensure');
    });
  });

  // ---- Tool Definitions (deprecated stubs) ----
  describe('tool definitions (deprecated stubs)', () => {
    it('stockQuoteTool has correct name and migration message', () => {
      expect(stockQuoteTool.name).toBe('stock_quote');
      expect(stockQuoteTool.description).toContain('migrated');
      expect(stockQuoteTool.parameters).toBeDefined();
      expect(stockQuoteTool.parameters.required).toEqual([]);
    });

    it('stockHistoryTool has correct name and migration message', () => {
      expect(stockHistoryTool.name).toBe('stock_history');
      expect(stockHistoryTool.description).toContain('migrated');
      expect(stockHistoryTool.parameters).toBeDefined();
      expect(stockHistoryTool.parameters.required).toEqual([]);
    });

    it('stockFinancialTool has correct name and migration message', () => {
      expect(stockFinancialTool.name).toBe('stock_financial');
      expect(stockFinancialTool.description).toContain('migrated');
      expect(stockFinancialTool.parameters).toBeDefined();
      expect(stockFinancialTool.parameters.required).toEqual([]);
    });

    it('stockInfoTool has correct name and migration message', () => {
      expect(stockInfoTool.name).toBe('stock_info');
      expect(stockInfoTool.description).toContain('migrated');
      expect(stockInfoTool.parameters).toBeDefined();
      expect(stockInfoTool.parameters.required).toEqual([]);
    });
  });

  // ---- Schemas (deprecated stubs: {} as never) ----
  describe('schemas (deprecated stubs)', () => {
    it('StockQuoteSchema is an empty object (deprecated)', () => {
      expect(StockQuoteSchema).toEqual({});
    });

    it('StockHistorySchema is an empty object (deprecated)', () => {
      expect(StockHistorySchema).toEqual({});
    });

    it('StockFinancialSchema is an empty object (deprecated)', () => {
      expect(StockFinancialSchema).toEqual({});
    });

    it('StockInfoSchema is an empty object (deprecated)', () => {
      expect(StockInfoSchema).toEqual({});
    });
  });

  // ---- Executors (all return migration message) ----
  describe('executeStockQuote', () => {
    it('returns migration message', async () => {
      const result = await executeStockQuote({ symbol: '600000' });
      expect(result.success).toBe(false);
      expect(result.error).toBe(FINANCE_MIGRATION_MESSAGE);
    });

    it('returns migration message regardless of params', async () => {
      const result = await executeStockQuote({});
      expect(result.success).toBe(false);
      expect(result.error).toBe(FINANCE_MIGRATION_MESSAGE);
    });
  });

  describe('executeStockHistory', () => {
    it('returns migration message', async () => {
      const result = await executeStockHistory({ symbol: '600000' });
      expect(result.success).toBe(false);
      expect(result.error).toBe(FINANCE_MIGRATION_MESSAGE);
    });

    it('returns migration message regardless of params', async () => {
      const result = await executeStockHistory({});
      expect(result.success).toBe(false);
      expect(result.error).toBe(FINANCE_MIGRATION_MESSAGE);
    });
  });

  describe('executeStockFinancial', () => {
    it('returns migration message', async () => {
      const result = await executeStockFinancial({ symbol: '600000', report_type: 'income' });
      expect(result.success).toBe(false);
      expect(result.error).toBe(FINANCE_MIGRATION_MESSAGE);
    });

    it('returns migration message regardless of params', async () => {
      const result = await executeStockFinancial({});
      expect(result.success).toBe(false);
      expect(result.error).toBe(FINANCE_MIGRATION_MESSAGE);
    });
  });

  describe('executeStockInfo', () => {
    it('returns migration message', async () => {
      const result = await executeStockInfo({ symbol: '600000' });
      expect(result.success).toBe(false);
      expect(result.error).toBe(FINANCE_MIGRATION_MESSAGE);
    });

    it('returns migration message regardless of params', async () => {
      const result = await executeStockInfo({});
      expect(result.success).toBe(false);
      expect(result.error).toBe(FINANCE_MIGRATION_MESSAGE);
    });
  });
});
