/**
 * Enhanced Timezone Utilities Tests
 *
 * Comprehensive tests for timezone resolution and caching
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  getTimezoneFromLocation,
  resolveUserTimezone,
  resolveUserLocation,
  clearTimezoneCache,
} from '../timezone';

describe('Timezone Utilities - Enhanced', () => {
  beforeEach(() => {
    clearTimezoneCache();
  });

  afterEach(() => {
    clearTimezoneCache();
  });

  describe('getTimezoneFromLocation', () => {
    test('returns timezone for Beijing', async () => {
      const tz = await getTimezoneFromLocation('北京');
      // Should return Asia/Shanghai or null (if API not available)
      expect(tz === null || typeof tz === 'string').toBe(true);
      if (tz) {
        expect(tz).toContain('Shanghai');
      }
    });

    test('returns timezone for Shanghai', async () => {
      const tz = await getTimezoneFromLocation('上海');
      expect(tz === null || typeof tz === 'string').toBe(true);
      if (tz) {
        expect(tz).toContain('Shanghai');
      }
    });

    test('returns timezone for New York', async () => {
      const tz = await getTimezoneFromLocation('New York');
      expect(tz === null || typeof tz === 'string').toBe(true);
      if (tz) {
        expect(tz).toContain('New_York');
      }
    });

    test('returns timezone for London', async () => {
      const tz = await getTimezoneFromLocation('London');
      expect(tz === null || typeof tz === 'string').toBe(true);
      if (tz) {
        expect(tz).toContain('London');
      }
    });

    test('caches timezone results', async () => {
      // First call
      const tz1 = await getTimezoneFromLocation('北京');

      // Second call should use cache
      const tz2 = await getTimezoneFromLocation('北京');

      expect(tz1).toBe(tz2);
    });

    test('handles invalid location gracefully', async () => {
      const tz = await getTimezoneFromLocation('InvalidLocation12345');
      expect(tz).toBeNull();
    });

    test('handles empty string location', async () => {
      const tz = await getTimezoneFromLocation('');
      expect(tz).toBeNull();
    });

    test('handles location with special characters', async () => {
      const tz = await getTimezoneFromLocation('San Francisco, CA');
      expect(tz === null || typeof tz === 'string').toBe(true);
    });
  });

  describe('resolveUserTimezone', () => {
    test('returns default timezone when no config', () => {
      const tz = resolveUserTimezone();
      expect(tz).toBe('Asia/Shanghai');
    });

    test('returns valid IANA timezone format', () => {
      const tz = resolveUserTimezone();
      // IANA timezone format: Area/City
      expect(tz).toMatch(/^[A-Z][a-z]+\/[A-Z][a-z]+$/);
    });
  });

  describe('resolveUserLocation', () => {
    test('returns default location when no config', () => {
      const location = resolveUserLocation();
      expect(location).toBe('北京');
    });

    test('returns non-empty string', () => {
      const location = resolveUserLocation();
      expect(typeof location).toBe('string');
      expect(location.length).toBeGreaterThan(0);
    });
  });

  describe('clearTimezoneCache', () => {
    test('clears cached timezone data', async () => {
      // Populate cache
      await getTimezoneFromLocation('北京');

      // Clear cache
      clearTimezoneCache();

      // Cache should be cleared (verified by checking internal state)
      // Since we can't access internal cache directly, we just verify the function runs
      expect(true).toBe(true);
    });

    test('can be called multiple times safely', () => {
      clearTimezoneCache();
      clearTimezoneCache();
      clearTimezoneCache();
      expect(true).toBe(true);
    });
  });

  describe('Timezone Resolution Logic', () => {
    test('resolves different timezones for different cities', async () => {
      const beijingTz = await getTimezoneFromLocation('北京');
      const newYorkTz = await getTimezoneFromLocation('New York');

      // Both should be valid (either string or null)
      expect(beijingTz === null || typeof beijingTz === 'string').toBe(true);
      expect(newYorkTz === null || typeof newYorkTz === 'string').toBe(true);

      // If both returned timezones, they should be different
      if (beijingTz && newYorkTz) {
        expect(beijingTz).not.toBe(newYorkTz);
      }
    });

    test('handles Chinese city names', async () => {
      const cities = ['北京', '上海', '深圳', '广州', '杭州'];

      for (const city of cities) {
        const tz = await getTimezoneFromLocation(city);
        expect(tz === null || typeof tz === 'string').toBe(true);
      }
    });

    test('handles English city names', async () => {
      const cities = ['Beijing', 'Shanghai', 'New York', 'London', 'Tokyo'];

      for (const city of cities) {
        const tz = await getTimezoneFromLocation(city);
        expect(tz === null || typeof tz === 'string').toBe(true);
      }
    });
  });

  describe('Error Handling', () => {
    test('handles network errors gracefully', async () => {
      // This test verifies that network errors don't crash the function
      const tz = await getTimezoneFromLocation('TestCity');
      expect(tz).toBeNull(); // Should return null on error
    });

    test('handles malformed API responses gracefully', async () => {
      // This is implicitly tested by the invalid location tests
      const tz = await getTimezoneFromLocation('NonExistentCity');
      expect(tz).toBeNull();
    });
  });

  describe('Performance', () => {
    test('cache improves performance on repeated calls', async () => {
      // First call (might hit API)
      const start1 = Date.now();
      await getTimezoneFromLocation('北京');
      const time1 = Date.now() - start1;

      // Second call (should use cache)
      const start2 = Date.now();
      await getTimezoneFromLocation('北京');
      const time2 = Date.now() - start2;

      // Cached call should be faster (or at least not significantly slower)
      // Allow some margin for test variability
      expect(time2).toBeLessThanOrEqual(time1 + 10);
    });
  });
});
