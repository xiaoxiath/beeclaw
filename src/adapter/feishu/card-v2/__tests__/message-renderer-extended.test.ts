import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
const { mockRenderHITL, mockGetIconToken, mockGenerateLabel, mockLogger, mockSanitizeForCard } = vi.hoisted(() => ({
  mockRenderHITL: vi.fn(),
  mockGetIconToken: vi.fn(),
  mockGenerateLabel: vi.fn(),
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  mockSanitizeForCard: vi.fn(),
}));

vi.mock('../hitl-renderer', () => ({
  renderHITLContentBlock: (...a: any[]) => mockRenderHITL(...a),
}));

vi.mock('../../../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

vi.mock('../../../../infra/utils', () => ({
  sanitizeForCard: (...a: any[]) => mockSanitizeForCard(...a),
}));

vi.mock('../tool-icon-registry', () => ({
  toolIconRegistry: {
    getIconToken: (...a: any[]) => mockGetIconToken(...a),
    generateLabel: (...a: any[]) => mockGenerateLabel(...a),
  },
}));

import {
  renderMessageCard,
  renderStepsPanel,
  renderToolUseStep,
  renderThinkingStep,
  renderFinalAnswer,
  renderEmptyCard,
  renderErrorCard,
  updateMessageCard,
  renderChartElement,
} from '../message-renderer';
import type { ContentBlock, ThinkingBlock, ToolUseBlock, TextBlock, ChartDataBlock } from '../../../../types/content-block';

// Helper factories
function makeToolUse(id: string, name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { type: 'tool_use', id, name, input };
}

function makeText(text: string): TextBlock {
  return { type: 'text', text };
}

function makeThinking(thinking: string): ThinkingBlock {
  return { type: 'thinking', thinking };
}

function makeImage(): ContentBlock {
  return { type: 'image', source: { type: 'url', mediaType: 'image/png', data: 'https://example.com/img.png' } } as ContentBlock;
}

function makeConfirmationRequest(): ContentBlock {
  return {
    type: 'confirmation_request',
    toolCallId: 'tc_1',
    toolName: 'Bash',
    params: { command: 'rm -rf /' },
    riskLevel: 'critical',
    message: 'Dangerous command',
  } as ContentBlock;
}

function makeUserInputRequest(): ContentBlock {
  return {
    type: 'user_input_request',
    question: 'Which option?',
    options: ['A', 'B'],
  } as ContentBlock;
}

function makeChart(chartType: string, data: Array<Record<string, unknown>>, opts?: Partial<ChartDataBlock>): ChartDataBlock {
  return {
    type: 'chart_data',
    chartType: chartType as any,
    data,
    ...opts,
  } as ChartDataBlock;
}

describe('MessageRenderer Extended', () => {
  beforeEach(() => {
    mockGetIconToken.mockReturnValue('default_outlined');
    mockGenerateLabel.mockReturnValue('Tool action');
    mockRenderHITL.mockReturnValue([]);
    mockSanitizeForCard.mockImplementation((s: string) => s);
  });

  // ================================================================
  // renderMessageCard: HITL blocks
  // ================================================================
  describe('renderMessageCard - HITL blocks', () => {
    test('should render confirmation_request blocks via renderHITLContentBlock', () => {
      const hitlElement = { tag: 'div', text: { tag: 'plain_text', content: 'Confirm?' } };
      mockRenderHITL.mockReturnValue([hitlElement]);

      const blocks: ContentBlock[] = [makeConfirmationRequest(), makeText('Done')];
      const card = renderMessageCard(blocks);

      expect(mockRenderHITL).toHaveBeenCalledWith(expect.objectContaining({ type: 'confirmation_request' }));
      // Should have: HITL element, hr (after HITL), hr (before answer), answer
      const tags = card.body.elements.map((e: any) => e.tag);
      expect(tags).toContain('hr');
    });

    test('should render user_input_request blocks via renderHITLContentBlock', () => {
      const hitlElement = { tag: 'div', text: { tag: 'plain_text', content: 'Input?' } };
      mockRenderHITL.mockReturnValue([hitlElement]);

      const blocks: ContentBlock[] = [makeUserInputRequest(), makeText('Result')];
      const card = renderMessageCard(blocks);

      expect(mockRenderHITL).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_input_request' }));
    });

    test('should skip HITL rendering when renderHITLContentBlock returns empty array', () => {
      mockRenderHITL.mockReturnValue([]);

      const blocks: ContentBlock[] = [makeConfirmationRequest(), makeText('Result')];
      const card = renderMessageCard(blocks);

      // Empty HITL should not add hr after HITL
      // Only answer element (and maybe divider before answer if hitlBlocks.length > 0)
      expect(mockRenderHITL).toHaveBeenCalled();
    });

    test('should skip HITL rendering when renderHITLContentBlock returns null', () => {
      mockRenderHITL.mockReturnValue(null);

      const blocks: ContentBlock[] = [makeConfirmationRequest(), makeText('Result')];
      const card = renderMessageCard(blocks);

      // Should still have at least the final answer
      const tags = card.body.elements.map((e: any) => e.tag);
      expect(tags).toContain('markdown');
    });

    test('should add divider when HITL blocks present and final answer exists (no steps)', () => {
      const hitlElement = { tag: 'div', text: { tag: 'plain_text', content: 'Confirm?' } };
      mockRenderHITL.mockReturnValue([hitlElement]);

      const blocks: ContentBlock[] = [makeConfirmationRequest(), makeText('Answer')];
      const card = renderMessageCard(blocks);

      const tags = card.body.elements.map((e: any) => e.tag);
      // HITL element, hr (after HITL), hr (divider because hitlBlocks > 0 and finalAnswer), markdown
      expect(tags.filter(t => t === 'hr').length).toBeGreaterThanOrEqual(1);
    });

    test('should handle multiple HITL blocks', () => {
      const hitlElement1 = { tag: 'div', text: { tag: 'plain_text', content: 'Confirm 1' } };
      const hitlElement2 = { tag: 'div', text: { tag: 'plain_text', content: 'Input 2' } };
      mockRenderHITL
        .mockReturnValueOnce([hitlElement1])
        .mockReturnValueOnce([hitlElement2]);

      const blocks: ContentBlock[] = [makeConfirmationRequest(), makeUserInputRequest()];
      const card = renderMessageCard(blocks);

      expect(mockRenderHITL).toHaveBeenCalledTimes(2);
    });
  });

  // ================================================================
  // renderMessageCard: Image blocks
  // ================================================================
  describe('renderMessageCard - Image blocks', () => {
    test('should render image placeholder for image blocks', () => {
      const blocks: ContentBlock[] = [makeImage()];
      const card = renderMessageCard(blocks);

      const imgElement = card.body.elements.find((e: any) =>
        e.tag === 'div' && e.text?.content?.includes('Image')
      );
      expect(imgElement).toBeDefined();
    });

    test('should add divider before images when steps exist', () => {
      const blocks: ContentBlock[] = [makeToolUse('c1', 'Bash', { command: 'ls' }), makeImage()];
      const card = renderMessageCard(blocks);

      const tags = card.body.elements.map((e: any) => e.tag);
      expect(tags).toContain('hr');
      expect(tags).toContain('collapsible_panel');
    });

    test('should render multiple images', () => {
      const blocks: ContentBlock[] = [makeImage(), makeImage(), makeImage()];
      const card = renderMessageCard(blocks);

      const imgElements = card.body.elements.filter((e: any) =>
        e.tag === 'div' && e.text?.content?.includes('Image')
      );
      expect(imgElements).toHaveLength(3);
    });
  });

  // ================================================================
  // renderMessageCard: Chart blocks
  // ================================================================
  describe('renderMessageCard - Chart blocks', () => {
    test('should render chart_data blocks via renderChartElement', () => {
      const chartBlock = makeChart('bar', [{ name: 'A', value: 10 }]);
      const blocks: ContentBlock[] = [chartBlock];
      const card = renderMessageCard(blocks);

      const chartEl = card.body.elements.find((e: any) => e.tag === 'chart');
      expect(chartEl).toBeDefined();
    });

    test('should render charts alongside final answer', () => {
      const blocks: ContentBlock[] = [
        makeText('Here are charts'),
        makeChart('line', [{ x: 1, y: 2 }]),
      ];
      const card = renderMessageCard(blocks);

      const tags = card.body.elements.map((e: any) => e.tag);
      expect(tags).toContain('markdown');
      expect(tags).toContain('chart');
    });
  });

  // ================================================================
  // renderMessageCard: Streaming config & summary
  // ================================================================
  describe('renderMessageCard - streaming config summary', () => {
    test('should add summary to config when streaming with steps', () => {
      const blocks: ContentBlock[] = [
        makeToolUse('c1', 'Bash', { command: 'ls' }),
        makeToolUse('c2', 'Read', { file_path: '/test' }),
        makeText('Done'),
      ];
      const card = renderMessageCard(blocks, { streaming: true });

      // config.summary is set in code but stripped by Zod CardConfigSchema.parse()
      // Verify that streaming config is present and steps panel rendered
      expect(card.config?.streaming_mode).toBe(true);
      const panel = card.body.elements.find((e: any) => e.tag === 'collapsible_panel') as any;
      expect(panel).toBeDefined();
      expect(panel.header.title.content).toContain('2 steps');
    });

    test('should not add summary when not streaming', () => {
      const blocks: ContentBlock[] = [
        makeToolUse('c1', 'Bash', { command: 'ls' }),
        makeText('Done'),
      ];
      const card = renderMessageCard(blocks);

      expect(card.config).toBeUndefined();
    });

    test('should not add summary when streaming with no steps', () => {
      const blocks: ContentBlock[] = [makeText('Done')];
      const card = renderMessageCard(blocks, { streaming: true });

      expect(card.config?.streaming_mode).toBe(true);
      // No steps, so summary should not be added
      expect(card.config?.summary).toBeUndefined();
    });

    test('should count only tool_use steps (not thinking) in summary', () => {
      const blocks: ContentBlock[] = [
        makeThinking('Thinking...'),
        makeToolUse('c1', 'Bash', { command: 'ls' }),
        makeText('Done'),
      ];
      const card = renderMessageCard(blocks, { streaming: true });

      // config.summary is stripped by Zod, but the steps panel header reflects the count
      expect(card.config?.streaming_mode).toBe(true);
      const panel = card.body.elements.find((e: any) => e.tag === 'collapsible_panel') as any;
      expect(panel).toBeDefined();
      // Only 1 tool_use step counted (thinking excluded)
      expect(panel.header.title.content).toContain('1 steps');
    });
  });

  // ================================================================
  // renderMessageCard: no final answer, no divider
  // ================================================================
  describe('renderMessageCard - edge cases', () => {
    test('should handle empty blocks array', () => {
      const card = renderMessageCard([]);

      expect(card.schema).toBe('2.0');
      expect(card.body.elements).toHaveLength(0);
    });

    test('should not add divider when HITL present but no final answer or images', () => {
      mockRenderHITL.mockReturnValue([{ tag: 'div', text: { tag: 'plain_text', content: 'Confirm?' } }]);

      const blocks: ContentBlock[] = [makeConfirmationRequest()];
      const card = renderMessageCard(blocks);

      // HITL element + hr after HITL, but no additional divider since no answer/images
      const hrCount = card.body.elements.filter((e: any) => e.tag === 'hr').length;
      // hr after HITL = 1, no extra divider since no finalAnswer/images
      expect(hrCount).toBe(1);
    });

    test('should handle only thinking blocks (no tool_use)', () => {
      const blocks: ContentBlock[] = [makeThinking('Let me think...')];
      const card = renderMessageCard(blocks);

      expect(card.body.elements).toHaveLength(1);
      expect(card.body.elements[0].tag).toBe('collapsible_panel');
    });
  });

  // ================================================================
  // renderStepsPanel: mixed steps
  // ================================================================
  describe('renderStepsPanel - mixed thinking and tool_use', () => {
    test('should render thinking steps alongside tool_use steps', () => {
      const steps: ContentBlock[] = [
        makeThinking('I need to search'),
        makeToolUse('c1', 'web_search', { query: 'test' }),
        makeThinking('Now let me read'),
        makeToolUse('c2', 'Read', { file_path: '/test' }),
      ];
      const panel = renderStepsPanel(steps);

      // 2 thinking + 2 tool_use = 4 step elements
      expect(panel.elements).toHaveLength(4);
    });

    test('should number only tool_use steps', () => {
      mockGenerateLabel.mockReturnValue('Action');

      const steps: ContentBlock[] = [
        makeThinking('Thinking...'),
        makeToolUse('c1', 'Bash', { command: 'ls' }),
      ];
      const panel = renderStepsPanel(steps);

      // Thinking element: has robot_outlined icon
      expect(panel.elements[0].icon?.token).toBe('robot_outlined');
      // Tool use element: should have "1." in content
      expect(panel.elements[1].text?.content).toContain('1.');
    });

    test('should add loading indicator during streaming', () => {
      const steps: ContentBlock[] = [makeToolUse('c1', 'Bash', { command: 'ls' })];
      const panel = renderStepsPanel(steps, { streaming: true });

      // Last element should be the loading indicator
      const lastEl = panel.elements[panel.elements.length - 1];
      expect(lastEl.icon?.token).toBe('more_outlined');
    });

    test('should not add loading indicator when not streaming', () => {
      const steps: ContentBlock[] = [makeToolUse('c1', 'Bash', { command: 'ls' })];
      const panel = renderStepsPanel(steps, { streaming: false });

      // Only 1 step, no loading indicator
      expect(panel.elements).toHaveLength(1);
    });

    test('should not add loading indicator when streaming but no steps', () => {
      const steps: ContentBlock[] = [];
      const panel = renderStepsPanel(steps, { streaming: true });

      // No step elements, so no loading indicator added
      expect(panel.elements).toHaveLength(0);
    });

    test('should use "Working on it" header during streaming', () => {
      const steps: ContentBlock[] = [
        makeToolUse('c1', 'Bash', { command: 'ls' }),
        makeToolUse('c2', 'Read', { file_path: '/test' }),
      ];
      const panel = renderStepsPanel(steps, { streaming: true });

      expect(panel.header.title.content).toContain('Working on it');
      expect(panel.header.title.content).toContain('2 steps');
    });

    test('should use "Show N steps" header when completed without custom summary', () => {
      const steps: ContentBlock[] = [makeToolUse('c1', 'Bash', { command: 'ls' })];
      const panel = renderStepsPanel(steps, { streaming: false });

      expect(panel.header.title.content).toContain('Show 1 steps');
    });

    test('should prefer custom summary over default when not streaming', () => {
      const steps: ContentBlock[] = [makeToolUse('c1', 'Bash', { command: 'ls' })];
      const panel = renderStepsPanel(steps, { streaming: false, summary: 'My Summary' });

      expect(panel.header.title.content).toBe('My Summary');
    });

    test('should use streaming header even with custom summary during streaming', () => {
      const steps: ContentBlock[] = [makeToolUse('c1', 'Bash', { command: 'ls' })];
      const panel = renderStepsPanel(steps, { streaming: true, summary: 'Custom' });

      // During streaming, header is always "Working on it (N steps)"
      expect(panel.header.title.content).toContain('Working on it');
    });

    test('should default streaming to false and summary to undefined when options omitted', () => {
      const steps: ContentBlock[] = [makeToolUse('c1', 'Bash', { command: 'ls' })];
      const panel = renderStepsPanel(steps);

      expect(panel.expanded).toBe(false);
      expect(panel.header.title.content).toContain('Show');
    });
  });

  // ================================================================
  // renderThinkingStep
  // ================================================================
  describe('renderThinkingStep', () => {
    test('should render thinking block with robot icon and grey text', () => {
      const block = makeThinking('Let me analyze this problem');
      const step = renderThinkingStep(block);

      expect(step.tag).toBe('div');
      expect(step.icon?.tag).toBe('standard_icon');
      expect(step.icon?.token).toBe('robot_outlined');
      expect(step.icon?.color).toBe('grey');
      expect(step.text?.tag).toBe('plain_text');
      expect(step.text?.text_color).toBe('grey');
      expect(step.text?.text_size).toBe('notation');
      expect(step.text?.content).toBe('Let me analyze this problem');
    });
  });

  // ================================================================
  // simplifyMarkdownTables (tested via renderFinalAnswer)
  // ================================================================
  describe('renderFinalAnswer - table simplification', () => {
    test('should pass through content with 3 or fewer tables', () => {
      const markdown = `Text before
| A | B |
|---|---|
| 1 | 2 |

More text

| C | D |
|---|---|
| 3 | 4 |

| E | F |
|---|---|
| 5 | 6 |

End text`;
      const element = renderFinalAnswer(makeText(markdown));
      expect(element.content).toBe(markdown);
    });

    test('should simplify content with more than 3 tables', () => {
      const markdown = `Text
| A | B |
|---|---|
| 1 | 2 |

| C | D |
|---|---|
| 3 | 4 |

| E | F |
|---|---|
| 5 | 6 |

| G | H |
|---|---|
| 7 | 8 |`;
      const element = renderFinalAnswer(makeText(markdown));

      // First 3 tables should remain, 4th should be simplified
      expect(element.content).not.toBe(markdown);
      // The logger should have been called for simplification
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    test('should convert overflow table with key-value pairs to bullet list', () => {
      // 4th table needs 3+ non-separator rows to avoid the <= 2 skip,
      // and <= 4 columns to trigger bullet list conversion
      const markdown = `| A | B |
|---|---|
| 1 | 2 |

| C | D |
|---|---|
| 3 | 4 |

| E | F |
|---|---|
| 5 | 6 |

| Key | Value |
|---|---|
| name | John |
| age | 30 |
| city | NYC |`;
      const element = renderFinalAnswer(makeText(markdown));

      // 4th table has 4 non-separator rows (header + 3 data), > 2 lines
      // headers=[Key,Value], values=[name,John] => 2 cols <= 4 => bullet list
      expect(element.content).toContain('**');
      expect(element.content).toContain('Key');
    });

    test('should skip small overflow tables (2 rows or less after filtering)', () => {
      // Create 4 tables, last one is very small (only separator + header = filtered out)
      const markdown = `| A | B |
|---|---|
| 1 | 2 |

| C | D |
|---|---|
| 3 | 4 |

| E | F |
|---|---|
| 5 | 6 |

| G |
|---|`;
      const element = renderFinalAnswer(makeText(markdown));

      // 4th table is small (1 data row after filter), should be skipped
      expect(element.tag).toBe('markdown');
    });

    test('should skip complex overflow tables with many columns', () => {
      // Create 4 tables, last has >4 columns and >2 data rows
      const markdown = `| A | B |
|---|---|
| 1 | 2 |

| C | D |
|---|---|
| 3 | 4 |

| E | F |
|---|---|
| 5 | 6 |

| Col1 | Col2 | Col3 | Col4 | Col5 |
|------|------|------|------|------|
| a    | b    | c    | d    | e    |
| f    | g    | h    | i    | j    |
| k    | l    | m    | n    | o    |`;
      const element = renderFinalAnswer(makeText(markdown));

      // Complex table should be skipped (empty string)
      expect(element.tag).toBe('markdown');
    });

    test('should handle content with no tables', () => {
      const markdown = 'Just plain text\nWith multiple lines';
      const element = renderFinalAnswer(makeText(markdown));
      expect(element.content).toBe(markdown);
    });

    test('should handle content ending with a table', () => {
      const markdown = `Text
| A | B |
|---|---|
| 1 | 2 |`;
      const element = renderFinalAnswer(makeText(markdown));
      expect(element.content).toBe(markdown);
    });

    test('should handle content that is only tables', () => {
      const markdown = `| A | B |
|---|---|
| 1 | 2 |
| C | D |
|---|---|
| 3 | 4 |`;
      const element = renderFinalAnswer(makeText(markdown));
      // Only 1 contiguous table block (it's all table rows), so count <= 3
      expect(element.content).toBe(markdown);
    });
  });

  // ================================================================
  // inferFieldMappings + renderChartElement
  // ================================================================
  describe('renderChartElement', () => {
    test('should render bar chart with auto-detected fields', () => {
      const block = makeChart('bar', [
        { month: 'Jan', sales: 100 },
        { month: 'Feb', sales: 200 },
      ]);
      const el = renderChartElement(block);

      expect(el.tag).toBe('chart');
      expect(el.chart_spec.type).toBe('bar');
      expect(el.chart_spec.xField).toBe('month');
      expect(el.chart_spec.yField).toBe('sales');
    });

    test('should render line chart with auto-detected fields', () => {
      const block = makeChart('line', [
        { date: '2024-01', value: 50 },
        { date: '2024-02', value: 75 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.type).toBe('line');
      expect(el.chart_spec.xField).toBe('date');
      expect(el.chart_spec.yField).toBe('value');
    });

    test('should render area chart', () => {
      const block = makeChart('area', [
        { time: '10:00', count: 5 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.type).toBe('area');
      expect(el.chart_spec.xField).toBe('time');
      expect(el.chart_spec.yField).toBe('count');
    });

    test('should render scatter chart', () => {
      const block = makeChart('scatter', [
        { x: 1, y: 2 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.type).toBe('scatter');
      expect(el.chart_spec.xField).toBe('x');
      expect(el.chart_spec.yField).toBe('y');
    });

    test('should fallback xField to first field when no pattern matches', () => {
      const block = makeChart('bar', [
        { foo: 'A', bar: 10 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.xField).toBe('foo');
    });

    test('should fallback yField to first numeric non-xField when no pattern matches', () => {
      const block = makeChart('bar', [
        { category: 'A', qty: 10 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.xField).toBe('category');
      // qty is numeric and not xField
      expect(el.chart_spec.yField).toBe('qty');
    });

    test('should use ultimate fallback for yField when no numeric fields', () => {
      const block = makeChart('bar', [
        { label: 'A', desc: 'text' },
      ]);
      const el = renderChartElement(block);

      // yField: no pattern match, no numeric field, fallback to fields[1] || fields[0]
      expect(el.chart_spec.yField).toBe('desc');
    });

    test('should use fields[0] as ultimate yField fallback for single-field data', () => {
      const block = makeChart('bar', [
        { label: 'A' },
      ]);
      const el = renderChartElement(block);

      // xField = label (matches pattern), yField fallback = fields[1] || fields[0] = 'label'
      expect(el.chart_spec.yField).toBe('label');
    });

    test('should render pie chart with category and value fields', () => {
      const block = makeChart('pie', [
        { name: 'Slice A', value: 40 },
        { name: 'Slice B', value: 60 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.type).toBe('pie');
      expect(el.chart_spec.categoryField).toBe('name');
      expect(el.chart_spec.valueField).toBe('value');
    });

    test('should render radar chart', () => {
      const block = makeChart('radar', [
        { category: 'Speed', score: 80 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.type).toBe('radar');
      expect(el.chart_spec.categoryField).toBe('category');
      expect(el.chart_spec.valueField).toBe('score');
    });

    test('should fallback pie categoryField to first non-numeric field', () => {
      const block = makeChart('pie', [
        { item: 'A', amount: 10 },
      ]);
      const el = renderChartElement(block);

      // 'item' doesn't match categoryPatterns (name, type, category, label)
      // Fallback: first non-numeric field
      expect(el.chart_spec.categoryField).toBe('item');
    });

    test('should fallback pie categoryField to fields[0] when all numeric', () => {
      const block = makeChart('pie', [
        { x: 1, y: 2 },
      ]);
      const el = renderChartElement(block);

      // No non-numeric field, fallback to fields[0]
      expect(el.chart_spec.categoryField).toBe('x');
    });

    test('should fallback pie valueField to first numeric field', () => {
      const block = makeChart('pie', [
        { label: 'A', qty: 5 },
      ]);
      const el = renderChartElement(block);

      // 'qty' doesn't match valuePatterns (value, count, amount, sales, total)
      // Fallback: first numeric field
      expect(el.chart_spec.valueField).toBe('qty');
    });

    test('should fallback pie valueField to fields[1] when no numeric fields', () => {
      const block = makeChart('pie', [
        { label: 'A', desc: 'text' },
      ]);
      const el = renderChartElement(block);

      // No numeric fields, fallback to fields[1] || fields[0]
      expect(el.chart_spec.valueField).toBe('desc');
    });

    test('should render linearProgress chart', () => {
      const block = makeChart('linearProgress', [
        { value: 75, total: 100 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.type).toBe('linearProgress');
      expect(el.chart_spec.valueField).toBe('value');
      expect(el.chart_spec.totalField).toBe('total');
    });

    test('should render circularProgress with category field', () => {
      const block = makeChart('circularProgress', [
        { value: 60, total: 100, name: 'Progress A' },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.type).toBe('circularProgress');
      expect(el.chart_spec.valueField).toBe('value');
      expect(el.chart_spec.totalField).toBe('total');
      expect(el.chart_spec.categoryField).toBe('name');
    });

    test('should fallback circularProgress categoryField to first string field', () => {
      const block = makeChart('circularProgress', [
        { value: 60, total: 100, desc: 'Progress' },
      ]);
      const el = renderChartElement(block);

      // 'desc' doesn't match categoryPatterns, fallback: first string field not value/total
      expect(el.chart_spec.categoryField).toBe('desc');
    });

    test('should not set circularProgress categoryField if no string fields', () => {
      const block = makeChart('circularProgress', [
        { value: 60, total: 100, extra: 42 },
      ]);
      const el = renderChartElement(block);

      // No string fields besides value/total, no categoryField
      expect(el.chart_spec.categoryField).toBeUndefined();
    });

    test('should render linearProgress without total field', () => {
      const block = makeChart('linearProgress', [
        { value: 50 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.valueField).toBe('value');
      expect(el.chart_spec.totalField).toBeUndefined();
    });

    test('should render funnel chart', () => {
      const block = makeChart('funnel', [
        { name: 'Visit', value: 1000 },
        { name: 'Click', value: 500 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.type).toBe('funnel');
      expect(el.chart_spec.categoryField).toBe('name');
      expect(el.chart_spec.valueField).toBe('value');
    });

    test('should fallback funnel categoryField to first string field', () => {
      const block = makeChart('funnel', [
        { step: 'Visit', count: 1000 },
      ]);
      const el = renderChartElement(block);

      // 'step' doesn't match categoryPatterns, fallback: first string field
      expect(el.chart_spec.categoryField).toBe('step');
    });

    test('should fallback funnel categoryField to fields[0] when all numeric', () => {
      const block = makeChart('funnel', [
        { x: 1, y: 2 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.categoryField).toBe('x');
    });

    test('should fallback funnel valueField to first numeric field', () => {
      const block = makeChart('funnel', [
        { name: 'Visit', qty: 1000 },
      ]);
      const el = renderChartElement(block);

      // 'qty' doesn't match valuePatterns, fallback: first numeric
      expect(el.chart_spec.valueField).toBe('qty');
    });

    test('should fallback funnel valueField to fields[1] when no numeric', () => {
      const block = makeChart('funnel', [
        { name: 'Visit', desc: 'first' },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.valueField).toBe('desc');
    });

    test('should return empty mappings for unknown chart type', () => {
      const block = makeChart('common', [
        { a: 1, b: 2 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.type).toBe('common');
      // No auto-detected fields
      expect(el.chart_spec.xField).toBeUndefined();
      expect(el.chart_spec.categoryField).toBeUndefined();
    });

    test('should return empty mappings for empty data', () => {
      const block = makeChart('bar', []);
      const el = renderChartElement(block);

      expect(el.chart_spec.xField).toBeUndefined();
      expect(el.chart_spec.yField).toBeUndefined();
    });

    test('should use spec overrides over auto-detected fields', () => {
      const block = makeChart('bar', [
        { month: 'Jan', sales: 100 },
      ], { spec: { xField: 'custom_x', yField: 'custom_y' } });
      const el = renderChartElement(block);

      expect(el.chart_spec.xField).toBe('custom_x');
      expect(el.chart_spec.yField).toBe('custom_y');
    });

    test('should merge additional spec options', () => {
      const block = makeChart('bar', [
        { month: 'Jan', sales: 100 },
      ], { spec: { color: 'blue', legend: { visible: true } } });
      const el = renderChartElement(block);

      expect(el.chart_spec.color).toBe('blue');
      expect(el.chart_spec.legend).toEqual({ visible: true });
    });

    test('should add title when provided', () => {
      const block = makeChart('bar', [
        { month: 'Jan', sales: 100 },
      ], { title: 'Monthly Sales' });
      const el = renderChartElement(block);

      expect(el.chart_spec.title).toEqual({ text: 'Monthly Sales' });
    });

    test('should not add title when not provided', () => {
      const block = makeChart('bar', [
        { month: 'Jan', sales: 100 },
      ]);
      const el = renderChartElement(block);

      expect(el.chart_spec.title).toBeUndefined();
    });

    test('should pass aspectRatio to chart element', () => {
      const block = makeChart('bar', [{ month: 'Jan', sales: 100 }], { aspectRatio: '16:9' });
      const el = renderChartElement(block);

      expect(el.aspect_ratio).toBe('16:9');
    });

    test('should pass colorTheme to chart element', () => {
      const block = makeChart('pie', [{ name: 'A', value: 1 }], { colorTheme: 'rainbow' });
      const el = renderChartElement(block);

      expect(el.color_theme).toBe('rainbow');
    });
  });

  // ================================================================
  // renderEmptyCard & renderErrorCard
  // ================================================================
  describe('renderEmptyCard - extended', () => {
    test('should have streaming config enabled', () => {
      const card = renderEmptyCard();
      expect(card.config?.streaming_mode).toBe(true);
    });

    test('should use custom message', () => {
      const card = renderEmptyCard('Loading data...');
      const el = card.body.elements[0] as any;
      expect(el.text.content).toBe('Loading data...');
    });
  });

  describe('renderErrorCard - extended', () => {
    test('should sanitize error message', () => {
      mockSanitizeForCard.mockReturnValue('safe_error');

      const card = renderErrorCard('<script>alert(1)</script>');

      expect(mockSanitizeForCard).toHaveBeenCalledWith('<script>alert(1)</script>');
      const el = card.body.elements[0] as any;
      expect(el.text.content).toContain('safe_error');
    });

    test('should not have streaming config', () => {
      const card = renderErrorCard('Error');
      expect(card.config?.streaming_mode).toBeUndefined();
    });
  });

  // ================================================================
  // updateMessageCard
  // ================================================================
  describe('updateMessageCard', () => {
    test('should re-render with new blocks', () => {
      const existingCard = renderMessageCard([makeText('Old')]);
      const newBlocks: ContentBlock[] = [
        makeToolUse('c1', 'Bash', { command: 'ls' }),
        makeText('New answer'),
      ];
      const updatedCard = updateMessageCard(existingCard, newBlocks);

      expect(updatedCard.schema).toBe('2.0');
      const tags = updatedCard.body.elements.map((e: any) => e.tag);
      expect(tags).toContain('collapsible_panel');
      expect(tags).toContain('markdown');
    });

    test('should pass options through to renderMessageCard', () => {
      const existingCard = renderMessageCard([makeText('Old')]);
      const updatedCard = updateMessageCard(
        existingCard,
        [makeText('New')],
        { streaming: true }
      );

      expect(updatedCard.config?.streaming_mode).toBe(true);
    });
  });

  // ================================================================
  // renderToolUseStep - extended
  // ================================================================
  describe('renderToolUseStep - extended', () => {
    test('should call toolIconRegistry.getIconToken with tool name', () => {
      mockGetIconToken.mockReturnValue('search_outlined');
      mockGenerateLabel.mockReturnValue('Searching for test');

      const block = makeToolUse('c1', 'web_search', { query: 'test' });
      const step = renderToolUseStep(block, 3);

      expect(mockGetIconToken).toHaveBeenCalledWith('web_search');
      expect(mockGenerateLabel).toHaveBeenCalledWith('web_search', { query: 'test' });
      expect(step.text.content).toContain('3.');
      expect(step.text.content).toContain('Searching for test');
      expect(step.icon.token).toBe('search_outlined');
    });
  });
});
