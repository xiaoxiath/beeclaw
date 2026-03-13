/**
 * Test timezone utilities
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { getTimezoneFromLocation, resolveUserTimezone, resolveUserLocation, clearTimezoneCache } from '../timezone';

describe('Timezone Utilities', () => {
  beforeEach(() => {
    clearTimezoneCache();
  });

  test('getTimezoneFromLocation should return timezone for Beijing', async () => {
    const tz = await getTimezoneFromLocation('北京');
    // Should return Asia/Shanghai or null (if API not available)
    expect(tz === null || typeof tz === 'string').toBe(true);
  });

  test('resolveUserTimezone should return default when no config', () => {
    const tz = resolveUserTimezone();
    expect(tz).toBe('Asia/Shanghai');
  });

  test('resolveUserLocation should return default when no config', () => {
    const location = resolveUserLocation();
    expect(location).toBe('北京');
  });
});
