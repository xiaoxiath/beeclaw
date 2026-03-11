/**
 * Finance Base Provider Tests
 */

import { describe, it, expect } from 'bun:test';
import { FinanceDataProvider } from '../base';
import type { StockQuoteRequest } from '../types';

// Create a concrete implementation for testing
class TestProvider extends FinanceDataProvider {
  name = 'test' as const;

  isConfigured(): boolean {
    return true;
  }

  async getQuote(request: StockQuoteRequest) {
    return [];
  }
}

describe('FinanceDataProvider', () => {
  const provider = new TestProvider();

  describe('normalizeSymbol', () => {
    it('should normalize symbol without prefix', () => {
      // Access protected method via type assertion
      const result = (provider as unknown as { normalizeSymbol: (s: string) => string }).normalizeSymbol('600000');
      expect(result).toBe('600000');
    });

    it('should normalize symbol with sh prefix', () => {
      const result = (provider as unknown as { normalizeSymbol: (s: string) => string }).normalizeSymbol('sh600000');
      expect(result).toBe('600000');
    });

    it('should normalize symbol with sh. prefix', () => {
      const result = (provider as unknown as { normalizeSymbol: (s: string) => string }).normalizeSymbol('sh.600000');
      expect(result).toBe('600000');
    });

    it('should normalize symbol with .SH suffix', () => {
      const result = (provider as unknown as { normalizeSymbol: (s: string) => string }).normalizeSymbol('600000.SH');
      expect(result).toBe('600000');
    });

    it('should normalize symbol with sz prefix', () => {
      const result = (provider as unknown as { normalizeSymbol: (s: string) => string }).normalizeSymbol('sz000001');
      expect(result).toBe('000001');
    });
  });

  describe('getMarket', () => {
    it('should return SH for 6xx codes', () => {
      const result = (provider as unknown as { getMarket: (s: string) => string }).getMarket('600000');
      expect(result).toBe('SH');
    });

    it('should return SH for 5xx codes', () => {
      const result = (provider as unknown as { getMarket: (s: string) => string }).getMarket('500001');
      expect(result).toBe('SH');
    });

    it('should return SZ for 0xx codes', () => {
      const result = (provider as unknown as { getMarket: (s: string) => string }).getMarket('000001');
      expect(result).toBe('SZ');
    });

    it('should return SZ for 3xx codes', () => {
      const result = (provider as unknown as { getMarket: (s: string) => string }).getMarket('300001');
      expect(result).toBe('SZ');
    });

    it('should return BJ for 4xx codes', () => {
      const result = (provider as unknown as { getMarket: (s: string) => string }).getMarket('430001');
      expect(result).toBe('BJ');
    });

    it('should return BJ for 8xx codes', () => {
      const result = (provider as unknown as { getMarket: (s: string) => string }).getMarket('830001');
      expect(result).toBe('BJ');
    });
  });

  describe('formatSymbolWithMarket', () => {
    it('should format SH symbol correctly', () => {
      const result = (provider as unknown as { formatSymbolWithMarket: (s: string) => string }).formatSymbolWithMarket('600000');
      expect(result).toBe('sh600000');
    });

    it('should format SZ symbol correctly', () => {
      const result = (provider as unknown as { formatSymbolWithMarket: (s: string) => string }).formatSymbolWithMarket('000001');
      expect(result).toBe('sz000001');
    });
  });
});
