import { describe, test, expect } from 'bun:test';
import {
  renderMessageCard,
  renderStepsPanel,
  renderToolUseStep,
  renderFinalAnswer,
  renderEmptyCard,
  renderErrorCard,
} from '../message-renderer';
import {
  createToolUseBlock,
  createTextBlock,
  createThinkingBlock,
} from '../../../../types/content-block';

describe('MessageCardRenderer', () => {
  describe('renderMessageCard', () => {
    test('should render simple text message', () => {
      const blocks = [createTextBlock('Hello World')];
      const card = renderMessageCard(blocks);

      expect(card.schema).toBe('2.0');
      expect(card.body.elements).toHaveLength(1);
      expect(card.body.elements[0].tag).toBe('markdown');
    });

    test('should render message with tool use', () => {
      const blocks = [
        createToolUseBlock('call_1', 'web_search', { query: 'test' }),
        createTextBlock('Search results'),
      ];
      const card = renderMessageCard(blocks);

      expect(card.schema).toBe('2.0');
      expect(card.body.elements.length).toBeGreaterThan(1);
      // Should have steps panel + divider + answer
      expect(card.body.elements[0].tag).toBe('collapsible_panel');
    });

    test('should enable streaming mode when requested', () => {
      const blocks = [createTextBlock('Test')];
      const card = renderMessageCard(blocks, { streaming: true });

      expect(card.config?.streaming_mode).toBe(true);
    });

    test('should not enable streaming mode by default', () => {
      const blocks = [createTextBlock('Test')];
      const card = renderMessageCard(blocks);

      expect(card.config?.streaming_mode).toBeUndefined();
    });

    test('should use custom summary', () => {
      const blocks = [
        createToolUseBlock('call_1', 'Bash', { command: 'ls' }),
        createTextBlock('Done'),
      ];
      const card = renderMessageCard(blocks, { summary: 'Custom summary' });

      const panel = card.body.elements[0] as any;
      expect(panel.header.text.content).toBe('Custom summary');
    });

    test('should handle multiple tool calls', () => {
      const blocks = [
        createToolUseBlock('call_1', 'web_search', { query: 'test1' }),
        createToolUseBlock('call_2', 'Bash', { command: 'ls' }),
        createToolUseBlock('call_3', 'Read', { file_path: '/test.txt' }),
        createTextBlock('Final answer'),
      ];
      const card = renderMessageCard(blocks);

      const panel = card.body.elements[0] as any;
      expect(panel.tag).toBe('collapsible_panel');
      // Should have 3 steps
      expect(panel.elements.length).toBe(3);
    });

    test('should add divider between steps and answer', () => {
      const blocks = [
        createToolUseBlock('call_1', 'Bash', { command: 'test' }),
        createTextBlock('Answer'),
      ];
      const card = renderMessageCard(blocks);

      // Steps panel, divider, answer
      expect(card.body.elements.length).toBe(3);
      expect(card.body.elements[1].tag).toBe('hr');
    });

    test('should not add divider when no steps', () => {
      const blocks = [createTextBlock('Just answer')];
      const card = renderMessageCard(blocks);

      expect(card.body.elements).toHaveLength(1);
      expect(card.body.elements[0].tag).toBe('markdown');
    });

    test('should not add divider when no final answer', () => {
      const blocks = [createToolUseBlock('call_1', 'Bash', { command: 'test' })];
      const card = renderMessageCard(blocks);

      expect(card.body.elements).toHaveLength(1);
      expect(card.body.elements[0].tag).toBe('collapsible_panel');
    });
  });

  describe('renderStepsPanel', () => {
    test('should create collapsible panel', () => {
      const steps = [
        createToolUseBlock('call_1', 'Bash', { command: 'ls' }),
      ];
      const panel = renderStepsPanel(steps);

      expect(panel.tag).toBe('collapsible_panel');
      expect(panel.header).toBeDefined();
      expect(panel.elements).toHaveLength(1);
    });

    test('should expand panel during streaming', () => {
      const steps = [createToolUseBlock('call_1', 'Bash', { command: 'test' })];
      const panel = renderStepsPanel(steps, { streaming: true });

      expect(panel.expanded).toBe(true);
    });

    test('should collapse panel after completion', () => {
      const steps = [createToolUseBlock('call_1', 'Bash', { command: 'test' })];
      const panel = renderStepsPanel(steps, { streaming: false });

      expect(panel.expanded).toBe(false);
    });

    test('should use custom summary', () => {
      const steps = [createToolUseBlock('call_1', 'Bash', { command: 'test' })];
      const panel = renderStepsPanel(steps, { summary: 'Custom' });

      expect(panel.header.text.content).toBe('Custom');
    });

    test('should show step count in default summary', () => {
      const steps = [
        createToolUseBlock('call_1', 'Bash', { command: 'test1' }),
        createToolUseBlock('call_2', 'Read', { file_path: 'test' }),
      ];
      const panel = renderStepsPanel(steps);

      expect(panel.header.text.content).toContain('2 steps');
    });
  });

  describe('renderToolUseStep', () => {
    test('should render tool use with icon and label', () => {
      const block = createToolUseBlock('call_1', 'web_search', { query: 'test' });
      const step = renderToolUseStep(block, 1);

      expect(step.tag).toBe('div');
      expect(step.text).toBeDefined();
      expect(step.icon).toBeDefined();
      expect(step.text.content).toContain('1.');
      expect(step.text.content).toContain('Searching for');
    });

    test('should use correct icon for tool', () => {
      const block = createToolUseBlock('call_1', 'Bash', { command: 'test' });
      const step = renderToolUseStep(block, 1);

      expect(step.icon.token).toBe('terminal_outlined');
    });

    test('should increment step numbers', () => {
      const block1 = createToolUseBlock('call_1', 'Bash', { command: 'test' });
      const block2 = createToolUseBlock('call_2', 'Read', { file_path: 'test' });

      const step1 = renderToolUseStep(block1, 1);
      const step2 = renderToolUseStep(block2, 2);

      expect(step1.text.content).toContain('1.');
      expect(step2.text.content).toContain('2.');
    });
  });

  describe('renderFinalAnswer', () => {
    test('should render text as markdown', () => {
      const block = createTextBlock('# Hello\n\n**Bold text**');
      const element = renderFinalAnswer(block);

      expect(element.tag).toBe('markdown');
      expect(element.content).toBe('# Hello\n\n**Bold text**');
    });
  });

  describe('renderEmptyCard', () => {
    test('should render empty card with message', () => {
      const card = renderEmptyCard('Processing...');

      expect(card.schema).toBe('2.0');
      expect(card.config?.streaming_mode).toBe(true);
      expect(card.body.elements).toHaveLength(1);
    });

    test('should use default message if not provided', () => {
      const card = renderEmptyCard();

      const element = card.body.elements[0] as any;
      expect(element.text.content).toContain('thinking');
    });
  });

  describe('renderErrorCard', () => {
    test('should render error card', () => {
      const card = renderErrorCard('Something went wrong');

      expect(card.schema).toBe('2.0');
      expect(card.body.elements).toHaveLength(1);

      const element = card.body.elements[0] as any;
      expect(element.text.content).toContain('Error');
      expect(element.text.content).toContain('Something went wrong');
    });
  });

  describe('Card Structure Validation', () => {
    test('should produce valid Card JSON structure', () => {
      const blocks = [
        createToolUseBlock('call_1', 'web_search', { query: 'test' }),
        createTextBlock('Result'),
      ];
      const card = renderMessageCard(blocks);

      // Validate structure
      expect(card.schema).toBe('2.0');
      expect(card.body).toBeDefined();
      expect(Array.isArray(card.body.elements)).toBe(true);
    });

    test('should include all required fields in elements', () => {
      const blocks = [createTextBlock('Test')];
      const card = renderMessageCard(blocks);

      const element = card.body.elements[0];
      expect(element.tag).toBeDefined();
    });

    test('should handle complex markdown in final answer', () => {
      const markdown = `
# Heading

- List item 1
- List item 2

\`\`\`typescript
const x = 1;
\`\`\`

| Col1 | Col2 |
|------|------|
| A    | B    |
      `.trim();

      const blocks = [createTextBlock(markdown)];
      const card = renderMessageCard(blocks);

      const element = card.body.elements[0] as any;
      expect(element.tag).toBe('markdown');
      expect(element.content).toContain('# Heading');
      expect(element.content).toContain('```typescript');
    });
  });

  describe('Integration with ToolIconRegistry', () => {
    test('should use registered icons for tools', () => {
      const blocks = [
        createToolUseBlock('call_1', 'skill_get', { name: 'test-skill' }),
      ];
      const card = renderMessageCard(blocks);

      const panel = card.body.elements[0] as any;
      const step = panel.elements[0];
      expect(step.icon.token).toBe('robot_outlined');
    });

    test('should use registered label generators', () => {
      const blocks = [
        createToolUseBlock('call_1', 'skill_get', { name: 'my-skill' }),
      ];
      const card = renderMessageCard(blocks);

      const panel = card.body.elements[0] as any;
      const step = panel.elements[0];
      expect(step.text.content).toContain('Loading skill:');
      expect(step.text.content).toContain('my-skill');
    });
  });
});
