import { describe, test, expect } from 'bun:test';
import {
  CardSchema,
  CardConfigSchema,
  CardBodySchema,
  createCard,
  createStreamingConfig,
  createCardBody,
} from '../types/card';
import {
  MarkdownElementSchema,
  StandardIconElementSchema,
  DivElementSchema,
  CollapsiblePanelSchema,
  createMarkdownElement,
  createStandardIconElement,
  createPlainTextElement,
  createDivElement,
  createCollapsiblePanel,
} from '../types/elements';
import { IconToken, Color } from '../types/styles';

describe('Card Schema 2.0 Types', () => {
  describe('CardConfig', () => {
    test('should create streaming config', () => {
      const config = createStreamingConfig();
      expect(config.streaming_mode).toBe(true);
      expect(config.width_mode).toBe('fill');
    });

    test('should validate config', () => {
      const result = CardConfigSchema.safeParse({
        streaming_mode: true,
        width_mode: 'fit',
      });
      expect(result.success).toBe(true);
    });

    test('should allow optional fields', () => {
      const result = CardConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('Elements', () => {
    test('should create Markdown element', () => {
      const element = createMarkdownElement('# Hello World');
      expect(element.tag).toBe('markdown');
      expect(element.content).toBe('# Hello World');
    });

    test('should create Standard Icon element', () => {
      const element = createStandardIconElement(IconToken.Search, {
        color: Color.Blue,
        size: 'medium',
      });
      expect(element.tag).toBe('standard_icon');
      expect(element.token).toBe('search_outlined');
      expect(element.color).toBe('blue');
      expect(element.size).toBe('medium');
    });

    test('should create Div element with icon and text', () => {
      const element = createDivElement({
        text: createPlainTextElement('Search'),
        icon: createStandardIconElement(IconToken.Search),
      });
      expect(element.tag).toBe('div');
      expect(element.text?.content).toBe('Search');
      expect(element.icon?.token).toBe('search_outlined');
    });

    test('should create Collapsible Panel', () => {
      const header = createDivElement({
        text: createPlainTextElement('Step 1'),
        icon: createStandardIconElement(IconToken.Play),
      });
      const panel = createCollapsiblePanel({
        header,
        elements: [createMarkdownElement('Content')],
        expanded: true,
      });
      expect(panel.tag).toBe('collapsible_panel');
      expect(panel.expanded).toBe(true);
    });
  });

  describe('CardBody', () => {
    test('should create Card body with elements', () => {
      const elements = [
        createMarkdownElement('Test content'),
      ];
      const body = createCardBody(elements);
      expect(body.elements).toHaveLength(1);
    });
  });

  describe('Card', () => {
    test('should create basic Card', () => {
      const body = createCardBody([
        createMarkdownElement('Hello World'),
      ]);
      const card = createCard(body);
      expect(card.schema).toBe('2.0');
      expect(card.body.elements).toHaveLength(1);
    });

    test('should create Card with streaming config', () => {
      const body = createCardBody([
        createMarkdownElement('Streaming content'),
      ]);
      const card = createCard(body, {
        config: createStreamingConfig(),
      });
      expect(card.schema).toBe('2.0');
      expect(card.config?.streaming_mode).toBe(true);
    });

    test('should validate full Card structure', () => {
      const card = {
        schema: '2.0',
        config: {
          streaming_mode: true,
          width_mode: 'fill',
        },
        body: {
          elements: [
            {
              tag: 'markdown',
              content: 'Test',
            },
          ],
        },
      };
      const result = CardSchema.safeParse(card);
      expect(result.success).toBe(true);
    });

    test('should fail invalid schema version', () => {
      const card = {
        schema: '1.0', // Invalid version
        body: {
          elements: [],
        },
      };
      const result = CardSchema.safeParse(card);
      expect(result.success).toBe(false);
    });
  });

  describe('Element Validation', () => {
    test('should validate Markdown element', () => {
      const element = {
        tag: 'markdown',
        content: '**Bold text**',
      };
      const result = MarkdownElementSchema.safeParse(element);
      expect(result.success).toBe(true);
    });

    test('should validate Standard Icon element', () => {
      const element = {
        tag: 'standard_icon',
        token: 'search_outlined',
        color: 'blue',
      };
      const result = StandardIconElementSchema.safeParse(element);
      expect(result.success).toBe(true);
    });

    test('should validate Div element', () => {
      const element = {
        tag: 'div',
        text: {
          tag: 'plain_text',
          content: 'Text',
        },
      };
      const result = DivElementSchema.safeParse(element);
      expect(result.success).toBe(true);
    });

    test('should validate Collapsible Panel', () => {
      const element = {
        tag: 'collapsible_panel',
        header: {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: 'Header',
          },
        },
        elements: [],
        expanded: true,
      };
      const result = CollapsiblePanelSchema.safeParse(element);
      expect(result.success).toBe(true);
    });
  });
});
