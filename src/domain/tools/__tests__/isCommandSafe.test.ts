/**
 * isCommandSafe.test.ts — 测试命令白名单验证逻辑（使用 shell-quote）
 */

import { describe, test, expect, vi } from 'vitest';
import { isCommandSafe } from '../builtin';

// Note: We're testing the actual isCommandSafe function from builtin.ts
// which uses shell-quote for robust parsing

describe('isCommandSafe - Basic Commands', () => {
  test('should allow simple whitelisted commands', () => {
    expect(isCommandSafe('ls')).toEqual({ safe: true });
    expect(isCommandSafe('pwd')).toEqual({ safe: true });
    expect(isCommandSafe('git status')).toEqual({ safe: true });
    expect(isCommandSafe('cd /tmp')).toEqual({ safe: true });
  });

  test('should reject blocked commands', () => {
    expect(isCommandSafe('rm -rf /').safe).toBe(false);
    expect(isCommandSafe('sudo apt update').safe).toBe(false);
    expect(isCommandSafe('docker ps').safe).toBe(false);
    expect(isCommandSafe('npm install -g package').safe).toBe(false);
  });

  test('should allow safe file operations', () => {
    // rm with safe patterns is allowed
    expect(isCommandSafe('rm file.txt').safe).toBe(true);
    expect(isCommandSafe('rm -rf ./node_modules').safe).toBe(true);
    // rm -rf / is blocked
    expect(isCommandSafe('rm -rf /').safe).toBe(false);
  });

  test('should reject dangerous patterns', () => {
    expect(isCommandSafe('echo $(whoami)').safe).toBe(false);
    expect(isCommandSafe('echo `whoami`').safe).toBe(false);
    expect(isCommandSafe('ls | bash').safe).toBe(false);
    expect(isCommandSafe('ls > /dev/null').safe).toBe(false);
  });
});

describe('isCommandSafe - Compound Commands (&&, ||, ;)', () => {
  test('should allow chained git commands with &&', () => {
    const result = isCommandSafe('cd /proj && git status');
    expect(result.safe).toBe(true);
  });

  test('should allow multiple cd commands with ;', () => {
    const result = isCommandSafe('cd /tmp; cd /home');
    expect(result.safe).toBe(true);
  });

  test('should validate each sub-command in chain', () => {
    // First command is safe (cd), second is blocked (sudo)
    const result = isCommandSafe('cd /tmp && sudo rm file.txt');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Blocked');
  });

  test('should reject if any sub-command is not whitelisted', () => {
    const result = isCommandSafe('ls && unknowncommand');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Command not in allowed whitelist');
  });

  test('should handle || operator', () => {
    const result = isCommandSafe('cd /proj || git status');
    expect(result.safe).toBe(true);
  });

  test('should handle complex chains', () => {
    const result = isCommandSafe('cd /proj && git status && git log');
    expect(result.safe).toBe(true);
  });
});

describe('isCommandSafe - Pipe Chains', () => {
  test('should allow pipe to grep', () => {
    const result = isCommandSafe('git log | grep fix');
    expect(result.safe).toBe(true);
  });

  test('should allow pipe to head/tail', () => {
    expect(isCommandSafe('git log | head -10').safe).toBe(true);
    expect(isCommandSafe('git log | tail -20').safe).toBe(true);
  });

  test('should reject pipe to shell', () => {
    const result = isCommandSafe('ls | sh');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('sh');
  });

  test('should reject pipe to bash', () => {
    const result = isCommandSafe('ls | bash');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('bash');
  });

  test('should validate all pipe segments against blocklist', () => {
    // First command is safe (ls), but second segment contains blocked command (sudo)
    const result = isCommandSafe('ls | sudo tee file');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Blocked');
  });

  test('should validate lead command against whitelist', () => {
    // Lead command (unknowncommand) is not in whitelist
    const result = isCommandSafe('unknowncommand | grep test');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Command not in allowed whitelist');
  });
});

describe('isCommandSafe - PM2 Commands', () => {
  test('should allow pm2 commands', () => {
    expect(isCommandSafe('pm2 list').safe).toBe(true);
    expect(isCommandSafe('pm2 status').safe).toBe(true);
    expect(isCommandSafe('pm2 logs').safe).toBe(true);
  });

  test('should allow pm2 with cd chain', () => {
    const result = isCommandSafe('cd /proj && pm2 status');
    expect(result.safe).toBe(true);
  });
});

describe('isCommandSafe - Edge Cases', () => {
  test('should handle extra whitespace', () => {
    const result = isCommandSafe('  cd   /tmp   &&   git   status  ');
    expect(result.safe).toBe(true);
  });

  test('should handle empty commands', () => {
    const result = isCommandSafe('');
    // Empty command has no sub-commands, so it should pass
    expect(result.safe).toBe(true);
  });

  test('should handle only whitespace', () => {
    const result = isCommandSafe('   ');
    expect(result.safe).toBe(true);
  });

  test('should handle single &&', () => {
    const result = isCommandSafe('&&');
    // After filtering, there are no non-empty sub-commands
    expect(result.safe).toBe(true);
  });
});

describe('isCommandSafe - Quote Handling (Now Fixed)', () => {
  test('should CORRECTLY handle && inside quotes', () => {
    // This is now FIXED with shell-quote
    const result = isCommandSafe('echo "a && b"');
    expect(result.safe).toBe(true);
  });

  test('should CORRECTLY handle ; inside quotes', () => {
    // This is now FIXED with shell-quote
    const result = isCommandSafe('echo "a; b"');
    expect(result.safe).toBe(true);
  });

  test('should CORRECTLY handle git commit with special chars in message', () => {
    const result = isCommandSafe('git commit -m "fix: resolve && and || issues"');
    expect(result.safe).toBe(true);
  });

  test('should handle commands without quotes correctly', () => {
    // Commands without special chars in quotes work fine
    const result = isCommandSafe('echo hello world');
    expect(result.safe).toBe(true);
  });

  test('should handle nested quotes', () => {
    const result = isCommandSafe('echo "hello \'world\'"');
    expect(result.safe).toBe(true);
  });

  test('should handle escaped quotes', () => {
    const result = isCommandSafe('echo "hello \\"world\\""');
    expect(result.safe).toBe(true);
  });
});

describe('isCommandSafe - Security Tests', () => {
  test('should reject command substitution in sub-commands', () => {
    const result = isCommandSafe('cd $(pwd)');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Command substitution');
  });

  test('should reject backtick substitution', () => {
    const result = isCommandSafe('ls `pwd`');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Backtick');
  });

  test('should reject device file access', () => {
    const result = isCommandSafe('ls > /dev/null');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Device file access');
  });

  test('should not be bypassed with case variations', () => {
    const result = isCommandSafe('SUDO ls');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Blocked');
  });
});

describe('isCommandSafe - CLI Tools', () => {
  test('should allow feishu-cli commands', () => {
    expect(isCommandSafe('feishu-cli --help').safe).toBe(true);
    expect(isCommandSafe('feishu-cli doc --help').safe).toBe(true);
    expect(isCommandSafe('feishu-cli doc create').safe).toBe(true);
    expect(isCommandSafe('feishu-cli sheet read').safe).toBe(true);
  });

  test('should allow feishu-cli with arguments', () => {
    expect(isCommandSafe('feishu-cli doc list --space-id 123').safe).toBe(true);
    expect(isCommandSafe('feishu-cli sheet export --output csv').safe).toBe(true);
    expect(isCommandSafe('feishu-cli bitable list --app-token abc').safe).toBe(true);
  });
});
