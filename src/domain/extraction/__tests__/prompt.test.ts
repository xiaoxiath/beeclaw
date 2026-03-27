/**
 * Knowledge Extraction Tests
 *
 * 测试知识提取功能
 */

import { describe, test, expect, vi } from 'vitest';
import {
  parseExtractionResult,
  validateExtraction,
  formatConversationForExtraction,
} from '../prompt';
import type { ExtractionItem } from '../types';

describe('Extraction Prompt Utils', () => {
  describe('parseExtractionResult', () => {
    test('should parse valid JSON extraction result', () => {
      const jsonStr = JSON.stringify({
        extractions: [
          {
            category: 'family',
            key: 'wife.company',
            value: 'A司',
            confidence: 0.95,
            reason: '用户明确提到',
          },
        ],
      });

      const result = parseExtractionResult(jsonStr);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        category: 'family',
        key: 'wife.company',
        value: 'A司',
        confidence: 0.95,
        reason: '用户明确提到',
      });
    });

    test('should parse JSON from markdown code block', () => {
      const markdownStr = `
\`\`\`json
{
  "extractions": [
    {
      "category": "personal",
      "key": "name",
      "value": "张三",
      "confidence": 1.0,
      "reason": "用户自我介绍"
    }
  ]
}
\`\`\`
      `;

      const result = parseExtractionResult(markdownStr);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('personal');
      expect(result[0].key).toBe('name');
    });

    test('should return empty array for invalid JSON', () => {
      const invalidStr = 'not valid json';

      const result = parseExtractionResult(invalidStr);

      expect(result).toEqual([]);
    });

    test('should handle empty extractions', () => {
      const jsonStr = JSON.stringify({ extractions: [] });

      const result = parseExtractionResult(jsonStr);

      expect(result).toEqual([]);
    });

    test('should extract JSON from mixed content', () => {
      const mixedStr = `
Here is the extraction result:
\`\`\`json
{"extractions": [{"category": "work", "key": "company", "value": "TechCorp", "confidence": 0.9, "reason": "test"}]}
\`\`\`
That's all.
      `;

      const result = parseExtractionResult(mixedStr);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('work');
    });
  });

  describe('validateExtraction', () => {
    test('should validate correct extraction item', () => {
      const item: ExtractionItem = {
        category: 'personal',
        key: 'name',
        value: '张三',
        confidence: 0.9,
        reason: '用户自我介绍',
      };

      const result = validateExtraction(item);

      expect(result).toBe(true);
    });

    test('should reject empty category', () => {
      const item = {
        category: '' as any,
        key: 'name',
        value: '张三',
        confidence: 0.9,
        reason: 'test',
      };

      const result = validateExtraction(item);

      expect(result).toBe(false);
    });

    test('should reject empty key', () => {
      const item: ExtractionItem = {
        category: 'personal',
        key: '',
        value: '张三',
        confidence: 0.9,
        reason: 'test',
      };

      const result = validateExtraction(item);

      expect(result).toBe(false);
    });

    test('should reject empty value', () => {
      const item: ExtractionItem = {
        category: 'personal',
        key: 'name',
        value: '',
        confidence: 0.9,
        reason: 'test',
      };

      const result = validateExtraction(item);

      expect(result).toBe(false);
    });

    test('should reject invalid confidence (< 0)', () => {
      const item: ExtractionItem = {
        category: 'personal',
        key: 'name',
        value: '张三',
        confidence: -0.1,
        reason: 'test',
      };

      const result = validateExtraction(item);

      expect(result).toBe(false);
    });

    test('should reject invalid confidence (> 1)', () => {
      const item: ExtractionItem = {
        category: 'personal',
        key: 'name',
        value: '张三',
        confidence: 1.5,
        reason: 'test',
      };

      const result = validateExtraction(item);

      expect(result).toBe(false);
    });

    test('should accept item without reason (not validated)', () => {
      const item = {
        category: 'personal',
        key: 'name',
        value: '张三',
        confidence: 0.9,
        reason: undefined as any,
      };

      const result = validateExtraction(item);

      expect(result).toBe(true);
    });

    test('should accept edge case confidence values (0 and 1)', () => {
      const item1: ExtractionItem = {
        category: 'personal',
        key: 'name',
        value: '张三',
        confidence: 0,
        reason: 'test',
      };

      const item2: ExtractionItem = {
        category: 'personal',
        key: 'name',
        value: '李四',
        confidence: 1,
        reason: 'test',
      };

      expect(validateExtraction(item1)).toBe(true);
      expect(validateExtraction(item2)).toBe(true);
    });
  });

  describe('formatConversationForExtraction', () => {
    test('should format simple conversation', () => {
      const messages = [
        { role: 'user' as const, content: '你好' },
        { role: 'assistant' as const, content: '你好！有什么可以帮你的吗？' },
      ];

      const result = formatConversationForExtraction(messages);

      expect(result).toContain('[用户] 你好');
      expect(result).toContain('[助手] 你好！有什么可以帮你的吗？');
    });

    test('should truncate long conversation', () => {
      const longContent = 'x'.repeat(5000);
      const messages = [
        { role: 'user' as const, content: longContent },
        { role: 'assistant' as const, content: longContent },
      ];

      const result = formatConversationForExtraction(messages, 1000);

      // Result should be close to 1000, but not exact
      // Allow some buffer for formatting
      expect(result.length).toBeLessThanOrEqual(1100);
    });

    test('should handle empty messages', () => {
      const messages: any[] = [];

      const result = formatConversationForExtraction(messages);

      expect(result).toBe('');
    });

    test('should handle messages with empty content', () => {
      const messages = [
        { role: 'user' as const, content: '' },
        { role: 'assistant' as const, content: '  ' },
      ];

      const result = formatConversationForExtraction(messages);

      // formatConversationForExtraction still outputs role prefixes for empty content
      expect(result).toContain('[用户]');
      expect(result).toContain('[助手]');
    });

    test('should format multi-turn conversation', () => {
      const messages = [
        { role: 'user' as const, content: '我叫张三' },
        { role: 'assistant' as const, content: '你好张三！' },
        { role: 'user' as const, content: '我在A司工作' },
        { role: 'assistant' as const, content: '好的，记住了。' },
      ];

      const result = formatConversationForExtraction(messages);

      expect(result).toContain('[用户] 我叫张三');
      expect(result).toContain('[用户] 我在A司工作');
      expect(result).toContain('[助手] 你好张三！');
      expect(result).toContain('[助手] 好的，记住了。');
    });
  });
});

describe('ExtractionItem Type Validation', () => {
  test('should have valid knowledge categories', () => {
    const validCategories = [
      'personal',
      'family',
      'work',
      'finance',
      'health',
      'preferences',
      'events',
      'lessons',
      'goals',
      'relationships',
      'skills',
      'decisions',
    ];

    validCategories.forEach((category) => {
      const item: ExtractionItem = {
        category: category as any,
        key: 'test',
        value: 'test',
        confidence: 0.9,
        reason: 'test',
      };

      expect(validateExtraction(item)).toBe(true);
    });
  });
});

describe('Edge Cases', () => {
  test('should handle malformed JSON gracefully', () => {
    const malformed = '{ "extractions": [ { "category": "personal" } ]'; // Missing closing bracket

    const result = parseExtractionResult(malformed);

    expect(result).toEqual([]);
  });

  test('should handle extractions with extra fields', () => {
    const jsonStr = JSON.stringify({
      extractions: [
        {
          category: 'personal',
          key: 'name',
          value: '张三',
          confidence: 0.9,
          reason: 'test',
          extraField: 'should be ignored',
        },
      ],
    });

    const result = parseExtractionResult(jsonStr);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      category: 'personal',
      key: 'name',
      value: '张三',
      confidence: 0.9,
      reason: 'test',
    });
  });

  test('should handle unicode in extraction values', () => {
    const jsonStr = JSON.stringify({
      extractions: [
        {
          category: 'personal',
          key: 'name',
          value: '张三 🎉',
          confidence: 0.9,
          reason: '测试 unicode',
        },
      ],
    });

    const result = parseExtractionResult(jsonStr);

    expect(result[0].value).toBe('张三 🎉');
    expect(result[0].reason).toBe('测试 unicode');
  });

  test('should handle very long values', () => {
    const longValue = 'x'.repeat(1000);
    const item: ExtractionItem = {
      category: 'personal',
      key: 'bio',
      value: longValue,
      confidence: 0.9,
      reason: 'test',
    };

    const result = validateExtraction(item);

    expect(result).toBe(true);
  });
});
