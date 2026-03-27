/**
 * Tests for types/index.ts
 */
import { describe, it, expect } from 'bun:test';

import {
  ToolResultSchema,
  formatError,
  notFoundError,
  invalidParamError,
  DEFAULT_MEMORY_BASE_PATH,
} from '../index';

describe('types/index', () => {
  describe('ToolResultSchema', () => {
    it('validates a success result', () => {
      const result = ToolResultSchema.parse({
        success: true,
        data: { key: 'value' },
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ key: 'value' });
    });

    it('validates a failure result with error', () => {
      const result = ToolResultSchema.parse({
        success: false,
        error: 'something went wrong',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('something went wrong');
    });

    it('validates result with _contentBlock flag', () => {
      const result = ToolResultSchema.parse({
        success: true,
        _contentBlock: true,
      });
      expect(result._contentBlock).toBe(true);
    });

    it('rejects missing success field', () => {
      expect(() => ToolResultSchema.parse({ data: 'x' })).toThrow();
    });

    it('rejects non-boolean success', () => {
      expect(() => ToolResultSchema.parse({ success: 'yes' })).toThrow();
    });

    it('allows optional fields to be missing', () => {
      const result = ToolResultSchema.parse({ success: true });
      expect(result.data).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result._contentBlock).toBeUndefined();
    });

    it('accepts any data type', () => {
      expect(ToolResultSchema.parse({ success: true, data: 42 }).data).toBe(42);
      expect(ToolResultSchema.parse({ success: true, data: [1, 2] }).data).toEqual([1, 2]);
      expect(ToolResultSchema.parse({ success: true, data: null }).data).toBeNull();
    });
  });

  describe('DEFAULT_MEMORY_BASE_PATH', () => {
    it('is defined as a string', () => {
      expect(typeof DEFAULT_MEMORY_BASE_PATH).toBe('string');
      expect(DEFAULT_MEMORY_BASE_PATH).toBe('./data/memory');
    });
  });

  describe('formatError', () => {
    it('formats context and message', () => {
      expect(formatError('DB', 'connection lost')).toBe('DB: connection lost');
    });

    it('handles empty strings', () => {
      expect(formatError('', '')).toBe(': ');
    });
  });

  describe('notFoundError', () => {
    it('formats type and id', () => {
      expect(notFoundError('User', '123')).toBe('User not found: 123');
    });
  });

  describe('invalidParamError', () => {
    it('formats param and reason', () => {
      expect(invalidParamError('age', 'must be positive')).toBe(
        "Invalid parameter 'age': must be positive"
      );
    });
  });
});
