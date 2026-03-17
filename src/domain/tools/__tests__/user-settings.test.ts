/**
 * User Settings Tool Tests
 *
 * Tests for user settings update functionality
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  updateUserSettingsTool,
  executeUpdateUserSettings,
} from '../user-settings';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_CONFIG_PATH = join(process.cwd(), 'test-beeclaw.json');

describe('User Settings Tool', () => {
  beforeEach(() => {
    // Clean up test config if it exists
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH);
    }
  });

  afterEach(() => {
    // Clean up test config after each test
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH);
    }
  });

  describe('Tool Definition', () => {
    test('has correct name', () => {
      expect(updateUserSettingsTool.name).toBe('update_user_settings');
    });

    test('has description', () => {
      expect(updateUserSettingsTool.description).toBeDefined();
      expect(typeof updateUserSettingsTool.description).toBe('string');
      expect(updateUserSettingsTool.description.length).toBeGreaterThan(0);
    });

    test('has parameters defined', () => {
      expect(updateUserSettingsTool.parameters).toBeDefined();
      expect(updateUserSettingsTool.parameters.type).toBe('object');
      expect(updateUserSettingsTool.parameters.properties).toBeDefined();
    });

    test('location parameter is required', () => {
      expect(updateUserSettingsTool.parameters.required).toContain('location');
    });

    test('timezone parameter is optional', () => {
      const props = updateUserSettingsTool.parameters.properties;
      expect(props.timezone).toBeDefined();
      expect(updateUserSettingsTool.parameters.required).not.toContain('timezone');
    });
  });

  describe('executeUpdateUserSettings', () => {
    test('returns error when location is missing', async () => {
      const result = await executeUpdateUserSettings({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Location is required');
    });

    test('returns error when location is null', async () => {
      const result = await executeUpdateUserSettings({ location: null as any });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Location is required');
    });

    test('returns error when location is empty string', async () => {
      const result = await executeUpdateUserSettings({ location: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Location is required');
    });

    test('succeeds with location only', async () => {
      const result = await executeUpdateUserSettings({ location: '上海' });

      expect(result.success).toBe(true);
      expect(result.data?.location).toBe('上海');
      expect(result.data?.message).toContain('位置已更新');
    });

    test('succeeds with location and timezone', async () => {
      const result = await executeUpdateUserSettings({
        location: 'New York',
        timezone: 'America/New_York',
      });

      expect(result.success).toBe(true);
      expect(result.data?.location).toBe('New York');
      expect(result.data?.timezone).toBe('America/New_York');
      expect(result.data?.message).toContain('位置已更新');
      expect(result.data?.message).toContain('时区已更新');
    });

    test('auto-derives timezone when not provided', async () => {
      const result = await executeUpdateUserSettings({
        location: '北京',
      });

      expect(result.success).toBe(true);
      expect(result.data?.location).toBe('北京');
      // Timezone should be auto-derived (either from API or default)
      expect(result.data?.timezone).toBeDefined();
    });

    test('uses default timezone when derivation fails', async () => {
      const result = await executeUpdateUserSettings({
        location: 'InvalidLocation12345',
      });

      expect(result.success).toBe(true);
      expect(result.data?.timezone).toBe('Asia/Shanghai'); // Default fallback
    });

    test('handles Chinese location names', async () => {
      const result = await executeUpdateUserSettings({
        location: '深圳',
      });

      expect(result.success).toBe(true);
      expect(result.data?.location).toBe('深圳');
    });

    test('handles English location names', async () => {
      const result = await executeUpdateUserSettings({
        location: 'San Francisco',
      });

      expect(result.success).toBe(true);
      expect(result.data?.location).toBe('San Francisco');
    });

    test('handles location with country', async () => {
      const result = await executeUpdateUserSettings({
        location: 'Tokyo, Japan',
      });

      expect(result.success).toBe(true);
      expect(result.data?.location).toBe('Tokyo, Japan');
    });

    test('message includes both location and timezone when both are updated', async () => {
      const result = await executeUpdateUserSettings({
        location: 'London',
        timezone: 'Europe/London',
      });

      expect(result.success).toBe(true);
      expect(result.data?.message).toContain('位置已更新');
      expect(result.data?.message).toContain('时区已更新');
      expect(result.data?.message).toContain('配置已保存');
    });

    test('message includes restart notification', async () => {
      const result = await executeUpdateUserSettings({
        location: '北京',
      });

      expect(result.success).toBe(true);
      expect(result.data?.message).toContain('重启后生效');
    });
  });

  describe('Input Validation', () => {
    test('accepts various timezone formats', async () => {
      const timezones = [
        'Asia/Shanghai',
        'America/New_York',
        'Europe/London',
        'Asia/Tokyo',
        'Australia/Sydney',
      ];

      for (const tz of timezones) {
        const result = await executeUpdateUserSettings({
          location: 'Test City',
          timezone: tz,
        });

        expect(result.success).toBe(true);
        expect(result.data?.timezone).toBe(tz);
      }
    });

    test('accepts various location formats', async () => {
      const locations = [
        '北京',
        'Shanghai',
        'New York City',
        'San Francisco, CA',
        'Tokyo, Japan',
        'London, UK',
      ];

      for (const location of locations) {
        const result = await executeUpdateUserSettings({
          location,
        });

        expect(result.success).toBe(true);
        expect(result.data?.location).toBe(location);
      }
    });
  });

  describe('Error Handling', () => {
    test('handles invalid parameter types gracefully', async () => {
      const result = await executeUpdateUserSettings({
        location: 123 as any,
      });

      // Should either fail or handle gracefully
      expect(result.success !== undefined).toBe(true);
    });

    test('handles missing parameters object', async () => {
      const result = await executeUpdateUserSettings({} as any);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Tool Interface Compliance', () => {
    test('returns BuiltinToolResult type', async () => {
      const result = await executeUpdateUserSettings({ location: '北京' });

      // Check that result has expected shape
      expect(typeof result.success).toBe('boolean');
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data?.message).toBeDefined();
        expect(result.data?.location).toBeDefined();
      } else {
        expect(result.error).toBeDefined();
      }
    });

    test('success result has correct data structure', async () => {
      const result = await executeUpdateUserSettings({
        location: '上海',
        timezone: 'Asia/Shanghai',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(typeof result.data?.message).toBe('string');
      expect(typeof result.data?.location).toBe('string');
      expect(typeof result.data?.timezone).toBe('string');
    });

    test('failure result has error message', async () => {
      const result = await executeUpdateUserSettings({});

      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.error!.length).toBeGreaterThan(0);
    });
  });
});
