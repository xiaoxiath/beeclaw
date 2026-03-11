/**
 * Tushare Provider Tests
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { TushareProvider } from '../../providers/tushare';

describe('TushareProvider', () => {
  let provider: TushareProvider;

  beforeEach(() => {
    provider = new TushareProvider();
  });

  describe('constructor', () => {
    it('should create provider with default config', () => {
      expect(provider).toBeDefined();
      expect(provider.name).toBe('tushare');
    });

    it('should create provider with token', () => {
      const tokenProvider = new TushareProvider({ token: 'test-token' });
      expect(tokenProvider.isConfigured()).toBe(true);
    });

    it('should create provider with custom timeout', () => {
      const customProvider = new TushareProvider({ timeout: 5000, token: 'test' });
      expect(customProvider).toBeDefined();
    });
  });

  describe('isConfigured', () => {
    it('should return false without token', () => {
      expect(provider.isConfigured()).toBe(false);
    });

    it('should return true with token', () => {
      provider.setToken('test-token');
      expect(provider.isConfigured()).toBe(true);
    });
  });

  describe('setToken', () => {
    it('should set token', () => {
      provider.setToken('new-token');
      expect(provider.isConfigured()).toBe(true);
    });
  });

  describe('getQuote', () => {
    it('should throw error without token', async () => {
      expect(provider.getQuote({ symbol: '600000' })).rejects.toThrow(
        'Tushare token not configured'
      );
    });
  });

  describe('getHistory', () => {
    it('should throw error without token', async () => {
      expect(provider.getHistory({ symbol: '600000' })).rejects.toThrow(
        'Tushare token not configured'
      );
    });
  });

  describe('getFinancial', () => {
    it('should throw error without token', async () => {
      expect(provider.getFinancial({ symbol: '600000', report_type: 'income' })).rejects.toThrow(
        'Tushare token not configured'
      );
    });
  });

  describe('getInfo', () => {
    it('should throw error without token', async () => {
      expect(provider.getInfo({ symbol: '600000' })).rejects.toThrow(
        'Tushare token not configured'
      );
    });
  });
});
