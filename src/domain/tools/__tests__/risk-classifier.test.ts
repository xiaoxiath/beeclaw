import { describe, it, expect, vi } from 'vitest';

import { ToolRiskClassifier, ToolRiskLevel } from '../risk-classifier';

describe('ToolRiskClassifier', () => {
  describe('with default config', () => {
    const classifier = new ToolRiskClassifier();

    it('should classify memory_read as LOW', () => {
      const result = classifier.classify('memory_read', {});
      expect(result.level).toBe(ToolRiskLevel.LOW);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('should classify memory_write as MEDIUM', () => {
      const result = classifier.classify('memory_write', {});
      expect(result.level).toBe(ToolRiskLevel.MEDIUM);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should classify shell as HIGH', () => {
      const result = classifier.classify('shell', {});
      expect(result.level).toBe(ToolRiskLevel.HIGH);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should classify file_delete as CRITICAL', () => {
      const result = classifier.classify('file_delete', {});
      expect(result.level).toBe(ToolRiskLevel.CRITICAL);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should classify unknown tools as MEDIUM', () => {
      const result = classifier.classify('my_custom_tool', {});
      expect(result.level).toBe(ToolRiskLevel.MEDIUM);
    });
  });

  describe('shell command classification', () => {
    const classifier = new ToolRiskClassifier();

    it('should classify rm -rf as CRITICAL', () => {
      const result = classifier.classify('shell', { command: 'rm -rf /tmp/data' });
      expect(result.level).toBe(ToolRiskLevel.CRITICAL);
    });

    it('should classify curl as HIGH', () => {
      const result = classifier.classify('shell', { command: 'curl https://example.com' });
      expect(result.level).toBe(ToolRiskLevel.HIGH);
    });

    it('should classify rm as HIGH', () => {
      const result = classifier.classify('shell', { command: 'rm file.txt' });
      expect(result.level).toBe(ToolRiskLevel.HIGH);
    });
  });

  describe('parameter-aware escalation', () => {
    const classifier = new ToolRiskClassifier();

    it('should escalate for production URLs', () => {
      const result = classifier.classify('web_fetch', { url: 'https://production.example.com/api' });
      expect(result.level).toBe(ToolRiskLevel.HIGH);
    });

    it('should escalate for glob delete patterns', () => {
      const result = classifier.classify('file_delete', { path: '**/*.log' });
      expect(result.level).toBe(ToolRiskLevel.CRITICAL);
    });

    it('should escalate for destructive SQL', () => {
      const result = classifier.classify('query', { sql: 'DROP TABLE users' });
      expect(result.level).toBe(ToolRiskLevel.CRITICAL);
    });

    it('should escalate for large batch sizes', () => {
      const result = classifier.classify('batch_action', { count: '500' });
      expect(result.level).toBe(ToolRiskLevel.HIGH);
    });
  });

  describe('HITL disabled', () => {
    it('should return LOW with no confirmation when disabled', () => {
      const classifier = new ToolRiskClassifier({ enabled: false, defaultStrategy: 'selective' });
      const result = classifier.classify('shell', { command: 'rm -rf /' });
      expect(result.level).toBe(ToolRiskLevel.LOW);
      expect(result.requiresConfirmation).toBe(false);
    });
  });

  describe('always strategy', () => {
    it('should always require confirmation', () => {
      const classifier = new ToolRiskClassifier({ enabled: true, defaultStrategy: 'always' });
      const result = classifier.classify('memory_read', {});
      expect(result.requiresConfirmation).toBe(true);
    });
  });

  describe('registerTool', () => {
    it('should override tool risk level', () => {
      const classifier = new ToolRiskClassifier();
      classifier.registerTool('my_tool', {
        level: ToolRiskLevel.CRITICAL,
        requiresConfirmation: true,
      });
      const result = classifier.classify('my_tool', {});
      expect(result.level).toBe(ToolRiskLevel.CRITICAL);
    });
  });

  describe('getRegisteredTools', () => {
    it('should return map of registered tools', () => {
      const classifier = new ToolRiskClassifier();
      const tools = classifier.getRegisteredTools();
      expect(tools).toBeInstanceOf(Map);
      expect(tools.size).toBeGreaterThan(0);
    });
  });
});
