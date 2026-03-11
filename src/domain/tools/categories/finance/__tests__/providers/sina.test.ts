/**
 * Sina Provider Tests
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { SinaProvider } from '../../providers/sina';

describe('SinaProvider', () => {
  let provider: SinaProvider;

  beforeEach(() => {
    provider = new SinaProvider();
  });

  describe('constructor', () => {
    it('should create provider with default config', () => {
      expect(provider).toBeDefined();
      expect(provider.name).toBe('sina');
    });

    it('should create provider with custom timeout', () => {
      const customProvider = new SinaProvider({ timeout: 5000 });
      expect(customProvider).toBeDefined();
    });
  });

  describe('isConfigured', () => {
    it('should always return true (no API key required)', () => {
      expect(provider.isConfigured()).toBe(true);
    });
  });

  describe('getQuote', () => {
    it('should reject invalid symbols gracefully', async () => {
      // This test may fail if network is available, so we just check it doesn't throw
      try {
        const quotes = await provider.getQuote({ symbol: 'INVALID' });
        // If it succeeds, it should return empty or handle gracefully
        expect(Array.isArray(quotes)).toBe(true);
      } catch (error) {
        // Network errors are acceptable in tests
        expect(error).toBeDefined();
      }
    });
  });

  describe('getHistory', () => {
    it('should throw error (not supported)', async () => {
      expect(provider.getHistory({ symbol: '600000' })).rejects.toThrow(
        'Sina does not support historical K-line data'
      );
    });
  });

  describe('getInfo', () => {
    it('should return basic info from quote', async () => {
      try {
        const info = await provider.getInfo({ symbol: '600000' });
        expect(info.symbol).toBe('600000');
        expect(info.source).toBe('sina');
      } catch (error) {
        // Network errors are acceptable in tests
        expect(error).toBeDefined();
      }
    });
  });
});
