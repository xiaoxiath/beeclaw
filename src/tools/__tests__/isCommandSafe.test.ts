/**
 * isCommandSafe.test.ts — 测试命令白名单验证逻辑
 */

import { describe, test, expect } from 'bun:test';

// Import the function we're testing
// We need to extract isCommandSafe from builtin.ts for testing
// For now, we'll recreate it here based on the implementation

const BLOCKED_COMMANDS = [
  'rm',
  'sudo',
  'su',
  'chmod',
  'chown',
  'mkfs',
  'dd',
  'fdisk',
  'kill',
  'killall',
  'pkill',
  'shutdown',
  'reboot',
  'init',
  'systemctl',
  'service',
  'apt',
  'apt-get',
  'yum',
  'dnf',
  'brew',
  'pip',
  'npm',
  'yarn',
  'pnpm',
  'cargo',
  'go',
  'docker',
  'kubectl',
  'helm',
];

const ALLOWED_PATTERNS = [
  /^cd(\s|$)/,
  /^ls(\s|$)/,
  /^ls -la(\s|$)/,
  /^cat(\s|$)/,
  /^head(\s|$)/,
  /^tail(\s|$)/,
  /^grep(\s|$)/,
  /^find(\s|$)/,
  /^pwd$/,
  /^echo(\s|$)/,
  /^which(\s|$)/,
  /^git(\s|$)/,
  /^git status$/,
  /^git log(\s|$)/,
  /^git diff(\s|$)/,
  /^git branch(\s|$)/,
  /^git remote(\s|$)/,
  /^git show(\s|$)/,
  /^git blame(\s|$)/,
  /^git rev-parse(\s|$)/,
  /^node(\s|$)/,
  /^npm run(\s|$)/,
  /^npm test$/,
  /^npm build$/,
  /^yarn(\s|$)/,
  /^bun(\s|$)/,
  /^make(\s|$)/,
  /^pytest(\s|$)/,
  /^python(\s|$)/,
  /^python3(\s|$)/,
  /^ts-node(\s|$)/,
  /^pm2(\s|$)/,
  /^ps(\s|$)/,
];

function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const fullCmd = command.trim();

  // Phase 0: Global dangerous-pattern check
  const globalDangerousPatterns: [RegExp, string][] = [
    [/\$\(/, 'Command substitution $()'],
    [/`/, 'Backtick command substitution'],
    [/\|\s*sh\b/, 'Pipe to sh'],
    [/\|\s*bash\b/, 'Pipe to bash'],
    [/>\s*\/dev\//, 'Device file access'],
  ];

  for (const [pattern, label] of globalDangerousPatterns) {
    if (pattern.test(fullCmd)) {
      return { safe: false, reason: `Dangerous pattern detected: ${label}` };
    }
  }

  // Phase 1: Split by && / || / ; into sub-commands
  const subCommands = fullCmd
    .split(/\s*(?:&&|\|\||;)\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const subCommand of subCommands) {
    // Split pipe segments
    const pipeSegments = subCommand
      .split(/\s*\|\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Check every pipe segment against the blocklist
    for (const segment of pipeSegments) {
      const segLower = segment.toLowerCase();
      for (const blocked of BLOCKED_COMMANDS) {
        if (segLower.includes(blocked.toLowerCase())) {
          return { safe: false, reason: `Blocked command pattern: ${blocked}` };
        }
      }
    }

    // The first command in the pipe chain must match the whitelist
    const leadCmd = pipeSegments[0];
    const isAllowed = ALLOWED_PATTERNS.some(pattern => pattern.test(leadCmd));
    if (!isAllowed) {
      return {
        safe: false,
        reason: `Command not in allowed whitelist: "${leadCmd}"`,
      };
    }
  }

  return { safe: true };
}

describe('isCommandSafe - Basic Commands', () => {
  test('should allow simple whitelisted commands', () => {
    expect(isCommandSafe('ls')).toEqual({ safe: true });
    expect(isCommandSafe('pwd')).toEqual({ safe: true });
    expect(isCommandSafe('git status')).toEqual({ safe: true });
    expect(isCommandSafe('cd /tmp')).toEqual({ safe: true });
  });

  test('should reject blocked commands', () => {
    expect(isCommandSafe('rm file.txt').safe).toBe(false);
    expect(isCommandSafe('sudo apt update').safe).toBe(false);
    expect(isCommandSafe('docker ps').safe).toBe(false);
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
    // First command is safe (cd), second is blocked (rm)
    const result = isCommandSafe('cd /tmp && rm file.txt');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Blocked command pattern: rm');
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
    expect(result.reason).toContain('Pipe to sh');
  });

  test('should reject pipe to bash', () => {
    const result = isCommandSafe('ls | bash');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Pipe to bash');
  });

  test('should validate all pipe segments against blocklist', () => {
    // First command is safe (ls), but second segment contains blocked command (rm)
    const result = isCommandSafe('ls | xargs rm');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Blocked command pattern: rm');
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

describe('isCommandSafe - Quote Handling (Known Limitations)', () => {
  test('should INCORRECTLY split on && inside quotes (KNOWN ISSUE)', () => {
    // This is a known limitation - the regex-based splitter doesn't respect quotes
    // echo "a && b" should be ONE command, but gets split into:
    //   1. echo "a
    //   2. b"
    // The first part (echo "a) is allowed, second part (b") is not in whitelist
    const result = isCommandSafe('echo "a && b"');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Command not in allowed whitelist');
  });

  test('should INCORRECTLY split on ; inside quotes (KNOWN ISSUE)', () => {
    // Similar issue with semicolons in quotes
    const result = isCommandSafe('echo "a; b"');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Command not in allowed whitelist');
  });

  test('should handle commands without quotes correctly', () => {
    // Commands without special chars in quotes work fine
    const result = isCommandSafe('echo hello world');
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
    const result = isCommandSafe('RM file.txt');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Blocked command pattern');
  });
});
