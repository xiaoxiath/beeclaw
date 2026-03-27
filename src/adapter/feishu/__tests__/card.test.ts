/**
 * Tests for card.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  }),
}));

// Mock sanitizeForCard
vi.mock('../../../infra/utils', () => ({
  sanitizeForCard: (input: string) => {
    if (!input) return '';
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },
}));

// Mock sendCardMessage
const { mockSendCardMessage } = vi.hoisted(() => ({
  mockSendCardMessage: vi.fn(() => Promise.resolve({ messageId: 'msg_card' })),
}));

vi.mock('../send', () => ({
  sendCardMessage: mockSendCardMessage,
}));

import {
  CardBuilder,
  createCard,
  buildMarkdownCard,
  buildTextCard,
  buildFormCard,
  buildListCard,
} from '../card';

describe('card', () => {
  beforeEach(() => {
    mockSendCardMessage.mockClear();
    mockSendCardMessage.mockResolvedValue({ messageId: 'msg_card' });
  });

  // ===================== createCard =====================
  describe('createCard', () => {
    it('returns a CardBuilder instance', () => {
      const builder = createCard();
      expect(builder).toBeInstanceOf(CardBuilder);
    });
  });

  // ===================== CardBuilder =====================
  describe('CardBuilder', () => {
    it('builds an empty card', () => {
      const card = createCard().build();
      expect(card.type).toBe('interactive');
    });

    it('sets config', () => {
      const card = createCard()
        .setConfig({ wide_screen_mode: true, enable_forward: false })
        .build();
      expect(card.config?.wide_screen_mode).toBe(true);
      expect(card.config?.enable_forward).toBe(false);
    });

    it('sets header with title', () => {
      const card = createCard()
        .setHeader('Title')
        .build();
      expect(card.header?.title.content).toBe('Title');
      expect(card.header?.template).toBe('blue');
    });

    it('sets header with title and subtitle', () => {
      const card = createCard()
        .setHeader('Title', 'Subtitle')
        .build();
      expect(card.header?.subtitle?.content).toBe('Subtitle');
    });

    it('adds markdown section', () => {
      const card = createCard()
        .addMarkdown('**bold**')
        .build();
      expect(card.elements).toHaveLength(1);
      expect(card.elements![0].tag).toBe('markdown');
      expect(card.elements![0].content).toBe('**bold**');
    });

    it('adds text section', () => {
      const card = createCard()
        .addText('Hello', { size: 'typography_text_title', color: 'blue' })
        .build();
      expect(card.elements).toHaveLength(1);
      expect(card.elements![0].text?.content).toBe('Hello');
    });

    it('adds divider', () => {
      const card = createCard()
        .addDivider()
        .build();
      expect(card.elements![0].tag).toBe('hr');
    });

    it('adds note', () => {
      const card = createCard()
        .addNote('Note text')
        .build();
      expect(card.elements![0].tag).toBe('note');
    });

    it('adds image', () => {
      const card = createCard()
        .addImage('img_key', { alt: 'Alt text', preview: true, mode: 'crop_center' })
        .build();
      expect(card.elements![0].tag).toBe('img');
      expect(card.elements![0].img_key).toBe('img_key');
    });

    it('adds action buttons', () => {
      const card = createCard()
        .addActions([{
          tag: 'button',
          text: { tag: 'plain_text', content: 'Click' },
          type: 'primary',
          value: { action: 'click' },
        }])
        .build();
      expect(card.elements![0].tag).toBe('action');
      expect(card.elements![0].actions).toHaveLength(1);
    });

    it('adds button to existing action group', () => {
      const card = createCard()
        .addActions([{
          tag: 'button',
          text: { tag: 'plain_text', content: 'Btn1' },
          type: 'default',
          value: { a: 1 },
        }])
        .addButton('Btn2', { b: 2 }, { type: 'danger' })
        .build();
      expect(card.elements![0].actions).toHaveLength(2);
    });

    it('creates new action group when adding button after non-action', () => {
      const card = createCard()
        .addMarkdown('text')
        .addButton('Btn', { a: 1 })
        .build();
      expect(card.elements).toHaveLength(2);
      expect(card.elements![1].tag).toBe('action');
    });

    it('adds button with URL', () => {
      const card = createCard()
        .addButton('Link', { a: 1 }, { url: 'https://example.com' })
        .build();
      const action = card.elements![0].actions![0];
      expect(action.url).toBe('https://example.com');
    });

    it('adds select menu', () => {
      const card = createCard()
        .addSelectMenu('Choose', [
          { text: 'A', value: 'a' },
          { text: 'B', value: 'b' },
        ])
        .build();
      expect(card.elements![0].tag).toBe('action');
    });

    it('appends select menu to existing action group', () => {
      const card = createCard()
        .addButton('Btn', { x: 1 })
        .addSelectMenu('Pick', [{ text: 'X', value: 'x' }])
        .build();
      expect(card.elements![0].actions).toHaveLength(2);
    });

    it('sends card via send method', async () => {
      const builder = createCard().addMarkdown('Hello');
      const result = await builder.send({} as any, 'oc_1', 'chat_id');
      expect(mockSendCardMessage).toHaveBeenCalledTimes(1);
      expect(result.messageId).toBe('msg_card');
    });

    it('chains methods fluently', () => {
      const card = createCard()
        .setConfig({ wide_screen_mode: true })
        .setHeader('Title', 'Sub')
        .addMarkdown('text')
        .addDivider()
        .addText('txt')
        .addNote('note')
        .addButton('btn', { v: 1 })
        .build();
      expect(card.elements!.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ===================== buildMarkdownCard =====================
  describe('buildMarkdownCard', () => {
    it('builds card with markdown content', () => {
      const card = buildMarkdownCard('**hello**');
      expect(card.type).toBe('interactive');
      expect(card.config?.wide_screen_mode).toBe(true);
      const mdElem = card.elements!.find(e => e.tag === 'markdown');
      expect(mdElem).toBeDefined();
    });

    it('includes sanitized title', () => {
      const card = buildMarkdownCard('body', { title: '<script>alert</script>' });
      const titleElem = card.elements!.find(e => e.text?.tag === 'lark_md');
      expect(titleElem?.text?.content).not.toContain('<script>');
    });

    it('defaults wideScreen and enableForward', () => {
      const card = buildMarkdownCard('x');
      expect(card.config?.wide_screen_mode).toBe(true);
      expect(card.config?.enable_forward).toBe(true);
    });

    it('respects wideScreen=false', () => {
      const card = buildMarkdownCard('x', { wideScreen: false });
      expect(card.config?.wide_screen_mode).toBe(false);
    });
  });

  // ===================== buildTextCard =====================
  describe('buildTextCard', () => {
    it('builds card with title and content', () => {
      const card = buildTextCard('Title', 'Content');
      expect(card.elements!.length).toBeGreaterThanOrEqual(2);
    });

    it('includes icon in title', () => {
      const card = buildTextCard('Title', 'Content', { icon: '🔔' });
      const titleElem = card.elements![0];
      expect(titleElem.text?.content).toContain('🔔');
    });

    it('sanitizes title and content', () => {
      const card = buildTextCard('<b>Title</b>', '<script>x</script>');
      expect(card.elements![0].text?.content).not.toContain('<b>');
      expect(card.elements![1].text?.content).not.toContain('<script>');
    });
  });

  // ===================== buildFormCard =====================
  describe('buildFormCard', () => {
    it('builds form with input fields', () => {
      const card = buildFormCard('Form', [
        { name: 'field1', type: 'input', placeholder: 'Enter' },
      ]);
      expect(card.elements!.length).toBeGreaterThanOrEqual(3); // title + field + submit
    });

    it('builds form with textarea', () => {
      const card = buildFormCard('Form', [
        { name: 'field1', type: 'textarea' },
      ]);
      const inputs = card.elements!.filter(e => e.tag === 'input');
      expect(inputs.length).toBeGreaterThanOrEqual(1);
    });

    it('builds form with select', () => {
      const card = buildFormCard('Form', [
        { name: 'field1', type: 'select', options: [{ text: 'A', value: 'a' }] },
      ]);
      const inputs = card.elements!.filter(e => e.tag === 'input');
      expect(inputs.length).toBeGreaterThanOrEqual(1);
    });

    it('uses custom submit text', () => {
      const card = buildFormCard('F', [], 'Send');
      const submitAction = card.elements!.find(e => e.tag === 'action');
      expect(submitAction?.actions![0].text?.content).toBe('Send');
    });

    it('defaults to input type when type is undefined', () => {
      const card = buildFormCard('F', [{ name: 'x' }]);
      expect(card.elements!.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ===================== buildListCard =====================
  describe('buildListCard', () => {
    it('builds list card with items', () => {
      const card = buildListCard('List', [
        { title: 'Item 1', description: 'Desc 1' },
        { title: 'Item 2', icon: '📌' },
        { title: 'Item 3' },
      ]);
      expect(card.type).toBe('interactive');
      // title + hr + 3 items = 5 elements
      expect(card.elements!.length).toBe(5);
    });

    it('includes icon in item title', () => {
      const card = buildListCard('L', [{ title: 'I', icon: '⭐' }]);
      const itemElem = card.elements![2]; // after title + hr
      expect(itemElem.text?.content).toContain('⭐');
    });

    it('sanitizes list item titles', () => {
      const card = buildListCard('L', [{ title: '<script>x</script>' }]);
      const itemElem = card.elements![2];
      expect(itemElem.text?.content).not.toContain('<script>');
    });
  });
});
