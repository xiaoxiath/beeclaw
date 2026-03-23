/**
 * Integration tests for Feishu CLI
 *
 * These tests require feishu-cli to be installed and configured
 * Run with: bun test tests/integration/feishu-cli.test.ts
 *
 * TODO: Update or remove - cli-runner module no longer exists
 */

import { describe, it, expect } from 'bun:test';

describe.skip('Feishu CLI Integration', () => {
  it('placeholder - module not implemented', () => {
    expect(true).toBe(true);
  });
});

describe('Feishu CLI Integration', () => {
  let runner: FeishuCLIRunner;
  let cliAvailable: boolean;

  beforeAll(async () => {
    // Check if feishu-cli is available
    const config: FeishuCLIConfig = {
      cliPath: process.env.FEISHU_CLI_PATH || 'feishu',
      env: {
        FEISHU_APP_ID: process.env.FEISHU_APP_ID || '',
        FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || '',
      },
      timeout: 10000,
      retries: 0,
    };

    runner = new FeishuCLIRunner(config);
    cliAvailable = await runner.checkBinary();
  });

  describe('CLI Availability', () => {
    it('should detect if CLI is available', async () => {
      if (!cliAvailable) {
        console.log('⚠️  feishu-cli not found, skipping CLI tests');
        console.log('To install: curl -fsSL https://raw.githubusercontent.com/riba2534/feishu-cli/main/install.sh | bash');
      }

      // This test passes regardless, just logs the status
      expect(typeof cliAvailable).toBe('boolean');
    });
  });

  describe('Authentication', () => {
    it('should authenticate with app credentials', async () => {
      if (!cliAvailable) {
        return; // Skip if CLI not available
      }

      // Try a simple command that requires authentication
      const result = await runner.execute('wiki', ['spaces'], {
        json: true,
        timeout: 5000,
      });

      // If auth fails, should return proper error
      if (!result.success) {
        expect(result.errorType).toBeDefined();
        console.log('Auth result:', result.error);
      } else {
        expect(result.data).toBeDefined();
      }
    });
  });

  describe('Command Execution', () => {
    it('should execute version command', async () => {
      if (!cliAvailable) {
        return;
      }

      const result = await runner.execute('version', [], { timeout: 5000 });

      expect(result.success).toBe(true);
    });

    it('should handle invalid commands gracefully', async () => {
      if (!cliAvailable) {
        return;
      }

      const result = await runner.execute('invalid_command_xyz', [], {
        timeout: 5000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle timeout correctly', async () => {
      if (!cliAvailable) {
        return;
      }

      // Try a command with very short timeout
      const result = await runner.execute('wiki', ['spaces'], {
        timeout: 1, // 1ms - should timeout
      });

      expect(result.success).toBe(false);
      expect(result.errorType).toBe(FeishuCLIError.PROCESS_TIMEOUT);
    }, 10000);
  });
});
