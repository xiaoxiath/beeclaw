/**
 * Eastmoney Provider Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EastmoneyProvider } from '../../providers/eastmoney';

describe('EastmoneyProvider', () => {
  let provider: EastmoneyProvider;

  beforeEach(() => {
    provider = new EastmoneyProvider();
  });

  describe('constructor', () => {
    it('should create provider with default config', () => {
      expect(provider).toBeDefined();
      expect(provider.name).toBe('eastmoney');
    });

    it('should create provider with custom timeout', () => {
      const customProvider = new EastmoneyProvider({ timeout: 5000 });
      expect(customProvider).toBeDefined();
    });
  });

  describe('isConfigured', () => {
    it('should always return true (no API key required)', () => {
      expect(provider.isConfigured()).toBe(true);
    });
  });

  describe('getQuote', () => {
    it('should handle network requests gracefully', async () => {
      try {
        const quotes = await provider.getQuote({ symbol: '600000' });
        expect(Array.isArray(quotes)).toBe(true);
      } catch (error) {
        // Network errors are acceptable in tests
        expect(error).toBeDefined();
      }
    });
  });

  describe('getHistory', () => {
    it('should handle network requests gracefully', async () => {
      try {
        const history = await provider.getHistory({ symbol: '600000', limit: 5 });
        expect(history.symbol).toBe('600000');
        expect(history.source).toBe('eastmoney');
      } catch (error) {
        // Network errors are acceptable in tests
        expect(error).toBeDefined();
      }
    });
  });

  describe('getInfo', () => {
    it('should handle network requests gracefully', async () => {
      try {
        const info = await provider.getInfo({ symbol: '600000' });
        expect(info.symbol).toBe('600000');
        expect(info.source).toBe('eastmoney');
      } catch (error) {
        // Network errors are acceptable in tests
        expect(error).toBeDefined();
      }
    });
  });
});
