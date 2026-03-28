/**
 * Extended tests for tool-icon-registry.ts
 * Covers all registered tool label generators including fallback paths
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { ToolIconRegistry } from '../tool-icon-registry';
import { IconToken } from '../types/styles';

describe('ToolIconRegistry Extended', () => {
  let registry: ToolIconRegistry;

  beforeEach(() => {
    registry = new ToolIconRegistry();
  });

  // =====================================================
  // web_search label fallbacks
  // =====================================================
  describe('web_search label', () => {
    test('uses query from input', () => {
      expect(registry.generateLabel('web_search', { query: 'test' })).toBe('Searching for "test"');
    });

    test('uses q fallback from input', () => {
      expect(registry.generateLabel('web_search', { q: 'fallback' })).toBe('Searching for "fallback"');
    });

    test('uses "web" default when no query/q', () => {
      expect(registry.generateLabel('web_search', {})).toBe('Searching for "web"');
    });

    test('uses "web" default when input is undefined', () => {
      expect(registry.generateLabel('web_search', undefined)).toBe('Searching for "web"');
    });
  });

  // =====================================================
  // Bash label fallbacks
  // =====================================================
  describe('Bash label', () => {
    test('uses command from input', () => {
      expect(registry.generateLabel('Bash', { command: 'ls' })).toBe('Running: ls');
    });

    test('uses cmd fallback', () => {
      expect(registry.generateLabel('Bash', { cmd: 'echo hi' })).toBe('Running: echo hi');
    });

    test('uses "command" default', () => {
      expect(registry.generateLabel('Bash', {})).toBe('Running: command');
    });

    test('truncates long commands at 50 chars', () => {
      const longCmd = 'x'.repeat(80);
      const label = registry.generateLabel('Bash', { command: longCmd });
      expect(label).toBe(`Running: ${'x'.repeat(50)}...`);
    });

    test('does not truncate 50-char commands', () => {
      const cmd = 'x'.repeat(50);
      const label = registry.generateLabel('Bash', { command: cmd });
      expect(label).toBe(`Running: ${cmd}`);
    });
  });

  // =====================================================
  // Read label fallbacks
  // =====================================================
  describe('Read label', () => {
    test('uses file_path from input', () => {
      expect(registry.generateLabel('Read', { file_path: '/a.ts' })).toBe('Reading /a.ts');
    });

    test('uses path fallback', () => {
      expect(registry.generateLabel('Read', { path: '/b.ts' })).toBe('Reading /b.ts');
    });

    test('uses "file" default', () => {
      expect(registry.generateLabel('Read', {})).toBe('Reading file');
    });
  });

  // =====================================================
  // Write label fallbacks
  // =====================================================
  describe('Write label', () => {
    test('uses file_path from input', () => {
      expect(registry.generateLabel('Write', { file_path: '/a.ts' })).toBe('Writing /a.ts');
    });

    test('uses path fallback', () => {
      expect(registry.generateLabel('Write', { path: '/b.ts' })).toBe('Writing /b.ts');
    });

    test('uses "file" default', () => {
      expect(registry.generateLabel('Write', {})).toBe('Writing file');
    });
  });

  // =====================================================
  // Edit label fallbacks
  // =====================================================
  describe('Edit label', () => {
    test('uses file_path from input', () => {
      expect(registry.generateLabel('Edit', { file_path: '/a.ts' })).toBe('Editing /a.ts');
    });

    test('uses path fallback', () => {
      expect(registry.generateLabel('Edit', { path: '/b.ts' })).toBe('Editing /b.ts');
    });

    test('uses "file" default', () => {
      expect(registry.generateLabel('Edit', {})).toBe('Editing file');
    });

    test('has Edit icon', () => {
      expect(registry.getIconToken('Edit')).toBe(IconToken.Edit);
    });
  });

  // =====================================================
  // Glob label fallbacks
  // =====================================================
  describe('Glob label', () => {
    test('uses pattern from input', () => {
      expect(registry.generateLabel('Glob', { pattern: '*.ts' })).toBe('Finding files matching "*.ts"');
    });

    test('uses "pattern" default', () => {
      expect(registry.generateLabel('Glob', {})).toBe('Finding files matching "pattern"');
    });
  });

  // =====================================================
  // Grep label fallbacks
  // =====================================================
  describe('Grep label', () => {
    test('uses pattern from input', () => {
      expect(registry.generateLabel('Grep', { pattern: 'TODO' })).toBe('Searching for "TODO" in files');
    });

    test('uses "pattern" default', () => {
      expect(registry.generateLabel('Grep', {})).toBe('Searching for "pattern" in files');
    });

    test('has Search icon', () => {
      expect(registry.getIconToken('Grep')).toBe(IconToken.Search);
    });
  });

  // =====================================================
  // Memory tools label fallbacks
  // =====================================================
  describe('memory_write label', () => {
    test('uses category from input', () => {
      expect(registry.generateLabel('memory_write', { category: 'preferences' })).toBe('Writing to preferences memory');
    });

    test('uses "memory" default', () => {
      expect(registry.generateLabel('memory_write', {})).toBe('Writing to memory memory');
    });
  });

  describe('memory_read label', () => {
    test('uses id from input', () => {
      expect(registry.generateLabel('memory_read', { id: 'mem_123' })).toBe('Reading memory mem_123');
    });

    test('uses "memory" default', () => {
      expect(registry.generateLabel('memory_read', {})).toBe('Reading memory memory');
    });
  });

  describe('memory_ls label', () => {
    test('uses category from input', () => {
      expect(registry.generateLabel('memory_ls', { category: 'facts' })).toBe('Listing facts memories');
    });

    test('uses "all" default', () => {
      expect(registry.generateLabel('memory_ls', {})).toBe('Listing all memories');
    });
  });

  describe('memory_grep label', () => {
    test('uses pattern from input', () => {
      expect(registry.generateLabel('memory_grep', { pattern: 'test' })).toBe('Searching memories for "test"');
    });

    test('uses "pattern" default', () => {
      expect(registry.generateLabel('memory_grep', {})).toBe('Searching memories for "pattern"');
    });
  });

  describe('memory_record label', () => {
    test('returns static label', () => {
      expect(registry.generateLabel('memory_record', {})).toBe('Recording new memory');
    });
  });

  // =====================================================
  // Skill tools label fallbacks
  // =====================================================
  describe('skill_get label', () => {
    test('uses name from input', () => {
      expect(registry.generateLabel('skill_get', { name: 'myskill' })).toBe('Loading skill: myskill');
    });

    test('uses "skill" default', () => {
      expect(registry.generateLabel('skill_get', {})).toBe('Loading skill: skill');
    });
  });

  describe('skill_list label', () => {
    test('returns static label', () => {
      expect(registry.generateLabel('skill_list', {})).toBe('Listing available skills');
    });
  });

  describe('skill_ensure label', () => {
    test('uses name from input', () => {
      expect(registry.generateLabel('skill_ensure', { name: 'myskill' })).toBe('Creating/updating skill: myskill');
    });

    test('uses "skill" default', () => {
      expect(registry.generateLabel('skill_ensure', {})).toBe('Creating/updating skill: skill');
    });
  });

  // =====================================================
  // Task tools label fallbacks
  // =====================================================
  describe('TaskCreate label', () => {
    test('uses subject from input', () => {
      expect(registry.generateLabel('TaskCreate', { subject: 'Fix bug' })).toBe('Creating task: Fix bug');
    });

    test('uses "task" default', () => {
      expect(registry.generateLabel('TaskCreate', {})).toBe('Creating task: task');
    });
  });

  describe('TaskUpdate label', () => {
    test('uses taskId from input', () => {
      expect(registry.generateLabel('TaskUpdate', { taskId: 'T-123' })).toBe('Updating task T-123');
    });

    test('uses "task" default', () => {
      expect(registry.generateLabel('TaskUpdate', {})).toBe('Updating task task');
    });
  });

  describe('TaskList label', () => {
    test('returns static label', () => {
      expect(registry.generateLabel('TaskList', {})).toBe('Listing tasks');
    });
  });

  describe('TaskGet label', () => {
    test('uses taskId from input', () => {
      expect(registry.generateLabel('TaskGet', { taskId: 'T-456' })).toBe('Getting task T-456');
    });

    test('uses "task" default', () => {
      expect(registry.generateLabel('TaskGet', {})).toBe('Getting task task');
    });
  });

  // =====================================================
  // WebFetch label fallbacks
  // =====================================================
  describe('WebFetch label', () => {
    test('uses url from input', () => {
      expect(registry.generateLabel('WebFetch', { url: 'https://ex.com' })).toBe('Fetching https://ex.com');
    });

    test('uses "URL" default', () => {
      expect(registry.generateLabel('WebFetch', {})).toBe('Fetching URL');
    });

    test('truncates long URLs', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(80);
      const label = registry.generateLabel('WebFetch', { url: longUrl });
      expect(label).toContain('...');
      expect(label.length).toBeLessThan(70);
    });

    test('does not truncate URLs <= 50 chars', () => {
      const url = 'https://example.com/short';
      const label = registry.generateLabel('WebFetch', { url });
      expect(label).toBe(`Fetching ${url}`);
    });

    test('has Globe icon', () => {
      expect(registry.getIconToken('WebFetch')).toBe(IconToken.Globe);
    });
  });

  // =====================================================
  // Agent label fallbacks
  // =====================================================
  describe('Agent label', () => {
    test('uses subagent_type from input', () => {
      expect(registry.generateLabel('Agent', { subagent_type: 'code' })).toBe('Launching code agent');
    });

    test('uses "agent" default', () => {
      expect(registry.generateLabel('Agent', {})).toBe('Launching agent agent');
    });

    test('has Robot icon', () => {
      expect(registry.getIconToken('Agent')).toBe(IconToken.Robot);
    });
  });

  // =====================================================
  // AskUserQuestion label
  // =====================================================
  describe('AskUserQuestion label', () => {
    test('returns static label', () => {
      expect(registry.generateLabel('AskUserQuestion', {})).toBe('Asking user for input');
    });

    test('has Chat icon', () => {
      expect(registry.getIconToken('AskUserQuestion')).toBe(IconToken.Chat);
    });
  });

  // =====================================================
  // Cron tools
  // =====================================================
  describe('CronCreate label', () => {
    test('uses cron from input', () => {
      expect(registry.generateLabel('CronCreate', { cron: '0 9 * * *' })).toBe('Creating schedule: 0 9 * * *');
    });

    test('uses "schedule" default', () => {
      expect(registry.generateLabel('CronCreate', {})).toBe('Creating schedule: schedule');
    });

    test('has Clock icon', () => {
      expect(registry.getIconToken('CronCreate')).toBe(IconToken.Clock);
    });
  });

  describe('CronDelete label', () => {
    test('uses id from input', () => {
      expect(registry.generateLabel('CronDelete', { id: 'cron_1' })).toBe('Deleting schedule cron_1');
    });

    test('uses "schedule" default', () => {
      expect(registry.generateLabel('CronDelete', {})).toBe('Deleting schedule schedule');
    });
  });

  describe('CronList label', () => {
    test('returns static label', () => {
      expect(registry.generateLabel('CronList', {})).toBe('Listing schedules');
    });
  });

  // =====================================================
  // Worktree tools
  // =====================================================
  describe('EnterWorktree label', () => {
    test('uses name from input', () => {
      expect(registry.generateLabel('EnterWorktree', { name: 'feature-x' })).toBe('Entering worktree: feature-x');
    });

    test('uses "worktree" default', () => {
      expect(registry.generateLabel('EnterWorktree', {})).toBe('Entering worktree: worktree');
    });
  });

  describe('ExitWorktree label', () => {
    test('returns static label', () => {
      expect(registry.generateLabel('ExitWorktree', {})).toBe('Exiting worktree');
    });
  });

  // =====================================================
  // Git tools
  // =====================================================
  describe('git_status label', () => {
    test('returns static label', () => {
      expect(registry.generateLabel('git_status', {})).toBe('Checking git status');
    });
  });

  describe('git_commit label', () => {
    test('returns static label', () => {
      expect(registry.generateLabel('git_commit', {})).toBe('Creating git commit');
    });
  });

  describe('git_push label', () => {
    test('returns static label', () => {
      expect(registry.generateLabel('git_push', {})).toBe('Pushing to remote');
    });

    test('has ArrowRight icon', () => {
      expect(registry.getIconToken('git_push')).toBe(IconToken.ArrowRight);
    });
  });

  // =====================================================
  // analyze_image
  // =====================================================
  describe('analyze_image label', () => {
    test('returns static label', () => {
      expect(registry.generateLabel('analyze_image', {})).toBe('Analyzing image');
    });
  });

  // =====================================================
  // MCP tools
  // =====================================================
  describe('mcp__web_reader__webReader label', () => {
    test('uses url from input', () => {
      expect(registry.generateLabel('mcp__web_reader__webReader', { url: 'https://x.com' }))
        .toBe('Reading https://x.com');
    });

    test('uses "URL" default', () => {
      expect(registry.generateLabel('mcp__web_reader__webReader', {})).toBe('Reading URL');
    });

    test('truncates long URLs', () => {
      const longUrl = 'https://example.com/' + 'b'.repeat(80);
      const label = registry.generateLabel('mcp__web_reader__webReader', { url: longUrl });
      expect(label).toContain('...');
    });

    test('has Globe icon', () => {
      expect(registry.getIconToken('mcp__web_reader__webReader')).toBe(IconToken.Globe);
    });
  });

  // =====================================================
  // default entry
  // =====================================================
  describe('default entry', () => {
    test('has default entry registered', () => {
      expect(registry.has('default')).toBe(true);
    });

    test('default entry has Code icon', () => {
      expect(registry.getIconToken('default')).toBe(IconToken.Code);
    });

    test('default entry label is static', () => {
      expect(registry.generateLabel('default', { anything: 'ignored' })).toBe('Executing tool');
    });
  });

  // =====================================================
  // get() method
  // =====================================================
  describe('get method', () => {
    test('returns entry for registered tool', () => {
      const entry = registry.get('web_search');
      expect(entry).toBeDefined();
      expect(entry?.iconToken).toBe(IconToken.Search);
    });

    test('returns undefined for unregistered tool', () => {
      const entry = registry.get('nonexistent');
      expect(entry).toBeUndefined();
    });
  });

  // =====================================================
  // generateLabel default path
  // =====================================================
  describe('generateLabel default for unknown', () => {
    test('returns Executing <toolName> for unknown tool', () => {
      expect(registry.generateLabel('some_unknown_tool', {})).toBe('Executing some_unknown_tool');
    });
  });
});
