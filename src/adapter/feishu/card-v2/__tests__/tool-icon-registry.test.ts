import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ToolIconRegistry, toolIconRegistry } from '../tool-icon-registry';
import { IconToken } from '../types/styles';

describe('ToolIconRegistry', () => {
  let registry: ToolIconRegistry;

  beforeEach(() => {
    registry = new ToolIconRegistry();
  });

  describe('Core Tool Registration', () => {
    test('should have web_search tool registered', () => {
      expect(registry.has('web_search')).toBe(true);
      const iconToken = registry.getIconToken('web_search');
      expect(iconToken).toBe(IconToken.Search);
    });

    test('should have Bash tool registered', () => {
      expect(registry.has('Bash')).toBe(true);
      const iconToken = registry.getIconToken('Bash');
      expect(iconToken).toBe(IconToken.Terminal);
    });

    test('should have Read tool registered', () => {
      expect(registry.has('Read')).toBe(true);
      const iconToken = registry.getIconToken('Read');
      expect(iconToken).toBe(IconToken.Folder);
    });

    test('should have Write tool registered', () => {
      expect(registry.has('Write')).toBe(true);
      const iconToken = registry.getIconToken('Write');
      expect(iconToken).toBe(IconToken.Edit);
    });

    test('should have memory tools registered', () => {
      expect(registry.has('memory_write')).toBe(true);
      expect(registry.has('memory_read')).toBe(true);
      expect(registry.has('memory_ls')).toBe(true);
      expect(registry.has('memory_grep')).toBe(true);
    });

    test('should have skill tools registered', () => {
      expect(registry.has('skill_get')).toBe(true);
      expect(registry.has('skill_list')).toBe(true);
      expect(registry.has('skill_ensure')).toBe(true);
    });

    test('should have task tools registered', () => {
      expect(registry.has('TaskCreate')).toBe(true);
      expect(registry.has('TaskUpdate')).toBe(true);
      expect(registry.has('TaskList')).toBe(true);
      expect(registry.has('TaskGet')).toBe(true);
    });
  });

  describe('Label Generation', () => {
    test('should generate label for web_search', () => {
      const label = registry.generateLabel('web_search', { query: 'hello world' });
      expect(label).toContain('Searching for');
      expect(label).toContain('hello world');
    });

    test('should generate label for Bash', () => {
      const label = registry.generateLabel('Bash', { command: 'ls -la' });
      expect(label).toContain('Running:');
      expect(label).toContain('ls -la');
    });

    test('should truncate long commands', () => {
      const longCmd = 'a'.repeat(100);
      const label = registry.generateLabel('Bash', { command: longCmd });
      expect(label.length).toBeLessThan(150); // Reasonable length
      expect(label).toContain('...');
    });

    test('should generate label for Read', () => {
      const label = registry.generateLabel('Read', { file_path: '/path/to/file.ts' });
      expect(label).toContain('Reading');
      expect(label).toContain('/path/to/file.ts');
    });

    test('should generate label for skill_get', () => {
      const label = registry.generateLabel('skill_get', { name: 'my-skill' });
      expect(label).toContain('Loading skill:');
      expect(label).toContain('my-skill');
    });

    test('should generate label for TaskCreate', () => {
      const label = registry.generateLabel('TaskCreate', { subject: 'Fix bug' });
      expect(label).toContain('Creating task:');
      expect(label).toContain('Fix bug');
    });

    test('should generate default label for unknown tool', () => {
      const label = registry.generateLabel('unknown_tool', {});
      expect(label).toContain('Executing');
    });
  });

  describe('Custom Registration', () => {
    test('should register custom tool', () => {
      registry.register('custom_tool', {
        iconToken: IconToken.Sparkles,
        label: (input) => `Custom: ${input.value}`,
      });

      expect(registry.has('custom_tool')).toBe(true);
      const iconToken = registry.getIconToken('custom_tool');
      expect(iconToken).toBe(IconToken.Sparkles);
    });

    test('should use custom label generator', () => {
      registry.register('custom_tool', {
        iconToken: IconToken.Robot,
        label: (input) => `Processing ${input.count} items`,
      });

      const label = registry.generateLabel('custom_tool', { count: 5 });
      expect(label).toBe('Processing 5 items');
    });

    test('should override existing tool', () => {
      // Register custom web_search
      registry.register('web_search', {
        iconToken: IconToken.Globe,
        label: () => 'Custom search',
      });

      const iconToken = registry.getIconToken('web_search');
      expect(iconToken).toBe(IconToken.Globe);

      const label = registry.generateLabel('web_search', {});
      expect(label).toBe('Custom search');
    });
  });

  describe('Icon Token Retrieval', () => {
    test('should return default icon for unknown tool', () => {
      const iconToken = registry.getIconToken('nonexistent_tool');
      expect(iconToken).toBe(IconToken.Code);
    });

    test('should return correct icon for registered tool', () => {
      const iconToken = registry.getIconToken('Glob');
      expect(iconToken).toBe(IconToken.Search);
    });
  });

  describe('Global Instance', () => {
    test('should have global registry instance', () => {
      expect(toolIconRegistry).toBeDefined();
      expect(toolIconRegistry).toBeInstanceOf(ToolIconRegistry);
    });

    test('should be able to use global registry', () => {
      const iconToken = toolIconRegistry.getIconToken('web_search');
      expect(iconToken).toBe(IconToken.Search);
    });
  });
});
