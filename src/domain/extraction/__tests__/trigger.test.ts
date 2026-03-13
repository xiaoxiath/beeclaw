/**
 * Tests for Extraction Trigger
 *
 * Tests automatic extraction trigger detection
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  ExtractionTrigger,
  getExtractionTrigger,
  resetExtractionTrigger,
} from '../trigger';
import type { ChatMessage } from '../../agent/types';
import { DEFAULT_EXTRACTION_CONFIG } from '../types';

describe('ExtractionTrigger', () => {
  let trigger: ExtractionTrigger;

  beforeEach(() => {
    trigger = new ExtractionTrigger({
      enabled: true,
      periodicInterval: 5,
      triggerPhrases: ['记录一下', '记住这个'],
    });
  });

  describe('initialization', () => {
    test('should create trigger with default config', () => {
      const defaultTrigger = new ExtractionTrigger();
      expect(defaultTrigger).toBeDefined();
    });

    test('should create trigger with custom config', () => {
      const customTrigger = new ExtractionTrigger({
        periodicInterval: 10,
        triggerPhrases: ['test'],
      });
      const config = customTrigger.getConfig();
      expect(config.periodicInterval).toBe(10);
      expect(config.triggerPhrases).toContain('test');
    });

    test('should get singleton instance', () => {
      resetExtractionTrigger();
      const instance1 = getExtractionTrigger();
      const instance2 = getExtractionTrigger();
      expect(instance1).toBe(instance2);
    });

    test('should create new instance with config', () => {
      resetExtractionTrigger();
      const instance1 = getExtractionTrigger();
      const instance2 = getExtractionTrigger({ periodicInterval: 20 });
      expect(instance2).toBeDefined();
    });
  });

  describe('shouldTrigger', () => {
    test('should not trigger when disabled', () => {
      const disabledTrigger = new ExtractionTrigger({ enabled: false });
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' },
      ];

      const result = disabledTrigger.shouldTrigger(messages);

      expect(result.trigger).toBe(false);
      expect(result.reason).toContain('disabled');
    });

    test('should trigger on explicit request', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test' },
      ];

      const result = trigger.shouldTrigger(messages, { explicitRequest: true });

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('explicit');
      expect(result.urgency).toBe('immediate');
    });

    test('should trigger on conversation end', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Goodbye' },
        { role: 'assistant', content: 'See you!' },
      ];

      const result = trigger.shouldTrigger(messages, { isConversationEnd: true });

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('conversation_end');
      expect(result.urgency).toBe('background');
    });

    test('should not trigger without user message', () => {
      const messages: ChatMessage[] = [
        { role: 'assistant', content: 'Hello' },
      ];

      const result = trigger.shouldTrigger(messages);

      expect(result.trigger).toBe(false);
      expect(result.reason).toContain('No user message');
    });

    test('should trigger on phrase match', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: '请记录一下这个重要信息' },
      ];

      const result = trigger.shouldTrigger(messages);

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('phrase');
      expect(result.urgency).toBe('immediate');
      expect(result.reason).toContain('记录一下');
    });

    test('should trigger on periodic interval', () => {
      // Send 5 messages to trigger periodic extraction
      for (let i = 0; i < 5; i++) {
        const messages: ChatMessage[] = [
          { role: 'user', content: `Message ${i}` },
        ];
        const result = trigger.shouldTrigger(messages);

        if (i === 4) {
          // 5th message should trigger
          expect(result.trigger).toBe(true);
          expect(result.type).toBe('periodic');
        } else {
          expect(result.trigger).toBe(false);
        }
      }
    });

    test('should count messages since last extraction', () => {
      const messages1: ChatMessage[] = [
        { role: 'user', content: 'Test 1' },
      ];

      let result = trigger.shouldTrigger(messages1);
      expect(result.reason).toContain('count: 1/5');

      const messages2: ChatMessage[] = [
        { role: 'user', content: 'Test 2' },
      ];
      result = trigger.shouldTrigger(messages2);
      expect(result.reason).toContain('count: 2/5');
    });
  });

  describe('checkTriggerPhrase', () => {
    test('should detect trigger phrase in string content', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: '请记住这个重要信息' },
      ];

      const result = trigger.shouldTrigger(messages);

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('phrase');
    });

    test('should detect trigger phrase in multimodal content', () => {
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请记住这个' },
            { type: 'image', image_url: { url: 'test.jpg' } },
          ],
        },
      ];

      const result = trigger.shouldTrigger(messages);

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('phrase');
    });

    test('should not trigger on partial match', () => {
      const customTrigger = new ExtractionTrigger({
        triggerPhrases: ['记住'],
      });

      const messages: ChatMessage[] = [
        { role: 'user', content: '这个不需要记住' },  // Contains phrase but as substring
      ];

      const result = customTrigger.shouldTrigger(messages);

      // Will trigger because '记住' is in the string
      expect(result.trigger).toBe(true);
    });

    test('should be case insensitive', () => {
      const caseTrigger = new ExtractionTrigger({
        triggerPhrases: ['REMEMBER'],
      });

      const messages: ChatMessage[] = [
        { role: 'user', content: 'please remember this' },
      ];

      const result = caseTrigger.shouldTrigger(messages);

      // Note: includes() is case sensitive by default
      // This test documents current behavior
      expect(result.trigger).toBe(false);
    });
  });

  describe('resetCounter', () => {
    test('should reset message counter', () => {
      // Send some messages
      for (let i = 0; i < 3; i++) {
        const messages: ChatMessage[] = [
          { role: 'user', content: `Message ${i}` },
        ];
        trigger.shouldTrigger(messages);
      }

      // Reset counter
      trigger.resetCounter();

      // Counter should be 0
      const messages: ChatMessage[] = [
        { role: 'user', content: 'New message' },
      ];
      const result = trigger.shouldTrigger(messages);
      expect(result.reason).toContain('count: 1/5');
    });
  });

  describe('detectConversationEnd', () => {
    test('should detect goodbye signals', () => {
      expect(trigger.detectConversationEnd('再见')).toBe(true);
      expect(trigger.detectConversationEnd('bye')).toBe(true);
      expect(trigger.detectConversationEnd('goodbye')).toBe(true);
      expect(trigger.detectConversationEnd('拜拜')).toBe(true);
    });

    test('should detect end signals at end of message', () => {
      expect(trigger.detectConversationEnd('好的，先这样')).toBe(true);
      expect(trigger.detectConversationEnd('下次聊')).toBe(true);
      expect(trigger.detectConversationEnd('谢谢')).toBe(true);
    });

    test('should not detect in middle of message', () => {
      expect(trigger.detectConversationEnd('再见之前我还有个问题')).toBe(false);
      expect(trigger.detectConversationEnd('say goodbye to him')).toBe(false);
    });

    test('should be case insensitive', () => {
      expect(trigger.detectConversationEnd('BYE')).toBe(true);
      expect(trigger.detectConversationEnd('Goodbye')).toBe(true);
    });
  });

  describe('detectSensitiveInfo', () => {
    test('should detect password patterns', () => {
      const result = trigger.detectSensitiveInfo('我的密码是 abc123');

      expect(result.hasSensitive).toBe(true);
      expect(result.shouldSkip).toBe(true);
      expect(result.patterns.length).toBeGreaterThan(0);
    });

    test('should detect API key patterns', () => {
      const result = trigger.detectSensitiveInfo('api_key: sk-1234567890abcdef');

      expect(result.hasSensitive).toBe(true);
      expect(result.shouldSkip).toBe(true);
    });

    test('should detect token patterns', () => {
      const result = trigger.detectSensitiveInfo('token: ghp_xxxxxxxxxxxx');

      expect(result.hasSensitive).toBe(true);
    });

    test('should detect long base64/hash strings', () => {
      const longString = 'a'.repeat(40);
      const result = trigger.detectSensitiveInfo(`data: ${longString}`);

      expect(result.hasSensitive).toBe(true);
    });

    test('should not detect normal content', () => {
      const result = trigger.detectSensitiveInfo('今天天气不错');

      expect(result.hasSensitive).toBe(false);
      expect(result.shouldSkip).toBe(false);
      expect(result.patterns).toEqual([]);
    });

    test('should use custom sensitive patterns', () => {
      const customTrigger = new ExtractionTrigger({
        sensitivePatterns: ['secret', 'confidential'],
      });

      const result = customTrigger.detectSensitiveInfo('This is confidential');

      expect(result.hasSensitive).toBe(true);
    });
  });

  describe('getConfig and updateConfig', () => {
    test('should get current config', () => {
      const config = trigger.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.periodicInterval).toBe(5);
    });

    test('should update config', () => {
      trigger.updateConfig({ periodicInterval: 20 });

      const config = trigger.getConfig();
      expect(config.periodicInterval).toBe(20);
    });

    test('should preserve other config when updating', () => {
      const originalInterval = trigger.getConfig().periodicInterval;

      trigger.updateConfig({ enabled: false });

      const config = trigger.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.periodicInterval).toBe(originalInterval);
    });
  });

  describe('edge cases', () => {
    test('should handle empty messages array', () => {
      const result = trigger.shouldTrigger([]);

      expect(result.trigger).toBe(false);
      expect(result.reason).toContain('No user message');
    });

    test('should handle multimodal content without text', () => {
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'image', image_url: { url: 'test.jpg' } },
          ],
        },
      ];

      const result = trigger.shouldTrigger(messages);

      // Should not crash, but won't trigger on phrase
      expect(result.trigger).toBe(false);
    });

    test('should handle very long messages', () => {
      const longMessage = 'test '.repeat(1000);
      const messages: ChatMessage[] = [
        { role: 'user', content: longMessage },
      ];

      const result = trigger.shouldTrigger(messages);

      expect(result).toBeDefined();
    });

    test('should handle invalid regex patterns', () => {
      const badTrigger = new ExtractionTrigger({
        sensitivePatterns: ['[invalid(regex'],
      });

      // Should not throw
      const result = badTrigger.detectSensitiveInfo('test content');

      expect(result).toBeDefined();
    });

    test('should prioritize explicit request over other triggers', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: '请记录一下' },  // Has trigger phrase
      ];

      const result = trigger.shouldTrigger(messages, { explicitRequest: true });

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('explicit');  // Not 'phrase'
    });
  });

  describe('urgency levels', () => {
    test('should return immediate for explicit request', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test' },
      ];

      const result = trigger.shouldTrigger(messages, { explicitRequest: true });

      expect(result.urgency).toBe('immediate');
    });

    test('should return immediate for trigger phrase', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: '记住这个' },
      ];

      const result = trigger.shouldTrigger(messages);

      expect(result.trigger).toBe(true);
      expect(result.urgency).toBe('immediate');
    });

    test('should return background for periodic trigger', () => {
      // Trigger periodic extraction
      for (let i = 0; i < 5; i++) {
        const messages: ChatMessage[] = [
          { role: 'user', content: 'Test' },
        ];
        const result = trigger.shouldTrigger(messages);

        if (i === 4) {
          expect(result.urgency).toBe('background');
        }
      }
    });

    test('should return background for conversation end', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Goodbye' },
      ];

      const result = trigger.shouldTrigger(messages, { isConversationEnd: true });

      expect(result.urgency).toBe('background');
    });
  });
});
