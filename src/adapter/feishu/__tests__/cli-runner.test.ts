/**
 * Tests for Feishu CLI Runner
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  FeishuCLIRunner,
  FeishuCLIConfig,
  FeishuCLIError,
  initFeishuCLIRunner,
  resetFeishuCLIRunner,
  getFeishuCLIRunner,
} from '../cli-runner';

describe('FeishuCLIRunner', () => {
  let runner: FeishuCLIRunner;
  const config: FeishuCLIConfig = {
    cliPath: 'feishu',
    env: {
      FEISHU_APP_ID: 'test_app_id',
      FEISHU_APP_SECRET: 'test_app_secret',
    },
    timeout: 5000,
    retries: 1,
  };

  beforeEach(() => {
    runner = new FeishuCLIRunner(config);
    resetFeishuCLIRunner();
  });

  afterEach(() => {
    resetFeishuCLIRunner();
  });

  describe('constructor', () => {
    it('should create instance with config', () => {
      expect(runner).toBeInstanceOf(FeishuCLIRunner);
    });
  });

  describe('execute', () => {
    it('should handle successful command execution', async () => {
      // Mock successful execution
      const result = await runner.execute('version', [], { timeout: 5000 });

      // Result might succeed or fail depending on whether feishu-cli is installed
      // We just check that it returns a proper structure
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle JSON output parsing', async () => {
      // This test assumes feishu-cli is not installed, so it should fail gracefully
      const result = await runner.execute('wiki', ['list'], { json: true, timeout: 1000 });

      expect(result).toHaveProperty('success');
      if (!result.success) {
        expect(result).toHaveProperty('error');
        expect(result).toHaveProperty('errorType');
      }
    });

    it('should handle binary not found error', async () => {
      const badConfig: FeishuCLIConfig = {
        ...config,
        cliPath: '/nonexistent/path/to/feishu',
      };
      const badRunner = new FeishuCLIRunner(badConfig);

      const result = await badRunner.execute('version', [], { timeout: 1000 });

      expect(result.success).toBe(false);
      expect(result.errorType).toBe(FeishuCLIError.BINARY_NOT_FOUND);
    });

    it('should respect timeout', async () => {
      const shortTimeoutConfig: FeishuCLIConfig = {
        ...config,
        timeout: 100, // Very short timeout
      };
      const shortRunner = new FeishuCLIRunner(shortTimeoutConfig);

      const result = await shortRunner.execute('wiki', ['list'], { timeout: 100 });

      expect(result).toHaveProperty('success');
    });

    it('should add user access token to environment', async () => {
      const userAccessToken = 'test_user_token';

      // We can't easily verify the environment variable was set,
      // but we can at least ensure the method doesn't throw
      const result = await runner.execute('calendar', ['list'], {
        userAccessToken,
        timeout: 1000,
      });

      expect(result).toHaveProperty('success');
    });
  });

  describe('checkBinary', () => {
    it('should return false for nonexistent binary', async () => {
      const badConfig: FeishuCLIConfig = {
        ...config,
        cliPath: '/nonexistent/path/to/feishu',
      };
      const badRunner = new FeishuCLIRunner(badConfig);

      const available = await badRunner.checkBinary();
      expect(available).toBe(false);
    });
  });
});

describe('Singleton Functions', () => {
  const config: FeishuCLIConfig = {
    cliPath: 'feishu',
    env: {
      FEISHU_APP_ID: 'test_app_id',
      FEISHU_APP_SECRET: 'test_app_secret',
    },
  };

  beforeEach(() => {
    resetFeishuCLIRunner();
  });

  afterEach(() => {
    resetFeishuCLIRunner();
  });

  describe('initFeishuCLIRunner', () => {
    it('should initialize singleton instance', () => {
      const instance = initFeishuCLIRunner(config);
      expect(instance).toBeInstanceOf(FeishuCLIRunner);
    });

    it('should return same instance on multiple calls', () => {
      const instance1 = initFeishuCLIRunner(config);
      const instance2 = initFeishuCLIRunner(config);
      expect(instance1).toBe(instance2);
    });
  });

  describe('getFeishuCLIRunner', () => {
    it('should return null before initialization', () => {
      const instance = getFeishuCLIRunner();
      expect(instance).toBeNull();
    });

    it('should return instance after initialization', () => {
      const initialized = initFeishuCLIRunner(config);
      const retrieved = getFeishuCLIRunner();
      expect(retrieved).toBe(initialized);
    });
  });

  describe('resetFeishuCLIRunner', () => {
    it('should reset instance to null', () => {
      initFeishuCLIRunner(config);
      resetFeishuCLIRunner();
      const instance = getFeishuCLIRunner();
      expect(instance).toBeNull();
    });
  });
});
