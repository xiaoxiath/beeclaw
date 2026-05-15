/**
 * Pure helpers around the message data model.
 */

import { describe, test, expect } from 'vitest';
import { nextMessageId, type ChatMessage } from '../messages';

describe('nextMessageId', () => {
  test('returns 1 for an empty history', () => {
    expect(nextMessageId([])).toBe(1);
  });

  test('returns last id + 1 to keep ordering monotonic', () => {
    const history: ChatMessage[] = [
      { id: 1, role: 'user', content: 'a' },
      { id: 2, role: 'assistant', content: 'b' },
    ];
    expect(nextMessageId(history)).toBe(3);
  });

  test('handles non-contiguous ids (gaps allowed)', () => {
    const history: ChatMessage[] = [
      { id: 1, role: 'user', content: 'a' },
      { id: 7, role: 'assistant', content: 'b' },
    ];
    expect(nextMessageId(history)).toBe(8);
  });
});
