import { describe, test, expect } from 'bun:test';
import { FeishuConfigSchema } from '../../config/schema';

describe('FeishuConfig Schema', () => {
  test('should accept useCardV2 option', () => {
    const config = {
      enabled: true,
      appId: 'test_app',
      appSecret: 'test_secret',
      useCardV2: true,
    };

    const result = FeishuConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.useCardV2).toBe(true);
    }
  });

  test('should default useCardV2 to false', () => {
    const config = {
      enabled: true,
      appId: 'test_app',
      appSecret: 'test_secret',
    };

    const result = FeishuConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.useCardV2).toBe(false);
    }
  });

  test('should accept all existing options', () => {
    const config = {
      enabled: true,
      appId: 'test_app',
      appSecret: 'test_secret',
      encryptKey: 'test_key',
      verificationToken: 'test_token',
      logLevel: 'debug' as const,
      useCardV2: true,
    };

    const result = FeishuConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(config);
    }
  });

  test('should validate logLevel enum', () => {
    const config = {
      enabled: true,
      logLevel: 'invalid' as any,
    };

    const result = FeishuConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('should accept empty config with defaults', () => {
    const result = FeishuConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.logLevel).toBe('error');
      expect(result.data.useCardV2).toBe(false);
    }
  });
});
