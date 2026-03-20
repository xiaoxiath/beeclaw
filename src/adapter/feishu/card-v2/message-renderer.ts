/**
 * Message Card Renderer
 *
 * Renders ContentBlock arrays into Card Schema 2.0 JSON.
 * Supports streaming mode with collapsible step panels.
 */

import type { ContentBlock, ToolUseBlock, TextBlock, ChartDataBlock } from '../../../types/content-block';
import { toolIconRegistry } from './tool-icon-registry';
import { renderHITLContentBlock } from './hitl-renderer';
import {
  createCard,
  createStreamingConfig,
  createCardBody,
  type Card
} from './types/card';
import {
  createMarkdownElement,
  createStandardIconElement,
  createPlainTextElement,
  createDivElement,
  createCollapsiblePanel,
  createHrElement,
  createChartElement,
  type CollapsiblePanel,
} from './types/elements';
import { IconToken, Color } from './types/styles';

/**
 * Render options
 */
export interface RenderOptions {
  /**
   * Enable streaming mode
   * When true, steps panels are expanded by default
   */
  streaming?: boolean;

  /**
   * Card summary (shown in collapsed state)
   */
  summary?: string;
}

/**
 * Render ContentBlocks into Card JSON
 */
export function renderMessageCard(
  blocks: ContentBlock[],
  options?: RenderOptions
): Card {
  const { streaming = false, summary } = options || {};

  // Separate blocks by type
  const steps = blocks.filter(
    (block) => block.type === 'thinking' || block.type === 'tool_use'
  );
  const hitlBlocks = blocks.filter(
    (block) => block.type === 'confirmation_request' || block.type === 'user_input_request'
  );
  const finalAnswer = blocks.find((block) => block.type === 'text');
  const images = blocks.filter((block) => block.type === 'image');
  const charts = blocks.filter((block) => block.type === 'chart_data');

  // Build card elements
  const elements: any[] = [];

  // Add HITL blocks first (if any)
  hitlBlocks.forEach((block) => {
    const hitlElements = renderHITLContentBlock(block);
    if (hitlElements && hitlElements.length > 0) {
      elements.push(...hitlElements);
      elements.push(createHrElement());
    }
  });

  // Add steps panel if there are any steps
  if (steps.length > 0) {
    const stepsPanel = renderStepsPanel(steps, { streaming, summary });
    elements.push(stepsPanel);
  }

  // Add divider if there are both steps/HITL and final answer
  if ((steps.length > 0 || hitlBlocks.length > 0) && (finalAnswer || images.length > 0)) {
    elements.push(createHrElement());
  }

  // Add final answer
  if (finalAnswer) {
    const answerElement = renderFinalAnswer(finalAnswer);
    elements.push(answerElement);
  }

  // Add images
  images.forEach((_image) => {
    // TODO: Add image element when supported
    // For now, just add a note
    elements.push(
      createDivElement({
        text: createPlainTextElement('📷 Image'),
      })
    );
  });

  // Add charts
  charts.forEach((chart) => {
    if (chart.type === 'chart_data') {
      const chartElement = renderChartElement(chart);
      elements.push(chartElement);
    }
  });

  // Create card body
  const body = createCardBody(elements);

  // Create card config
  const config = streaming ? createStreamingConfig() : undefined;

  // Add summary for notification (参考 agentara)
  if (config && steps.length > 0) {
    const stepCount = steps.filter(s => s.type === 'tool_use').length;
    config.summary = {
      content: `Working on it (${stepCount} steps)`,
    };
  }

  return createCard(body, { config });
}

/**
 * Render steps panel (collapsible)
 */
export function renderStepsPanel(
  steps: ContentBlock[],
  options?: { streaming?: boolean; summary?: string }
): CollapsiblePanel {
  const { streaming = false, summary } = options || {};

  // Render step elements
  const stepElements: any[] = [];
  let stepCount = 0;

  steps.forEach((step) => {
    if (step.type === 'tool_use') {
      stepCount++;
      const stepElement = renderToolUseStep(step, stepCount);
      stepElements.push(stepElement);
    } else if (step.type === 'thinking') {
      const thinkingElement = renderThinkingStep(step);
      stepElements.push(thinkingElement);
    }
  });

  // Create panel header (following agentara structure)
  const headerText = streaming
    ? `Working on it (${stepCount} steps)`  // Streaming: show progress
    : summary || `Show ${stepCount} steps`;  // Completed: show summary or steps

  // Create collapsible panel following agentara pattern
  const panel = createCollapsiblePanel({
    header: {
      title: {
        tag: 'plain_text',
        content: headerText,
        text_color: 'grey',
        text_size: 'notation',
      },
      icon: {
        tag: 'standard_icon',
        token: 'right_outlined',
        color: 'grey',
      },
      icon_position: 'right',
      icon_expanded_angle: 90,
    },
    elements: stepElements,
    expanded: streaming, // Expanded during streaming, collapsed after completion
    border: {
      color: 'grey-300',
      corner_radius: '6px',
    },
    vertical_spacing: '2px',
  });

  // During streaming, add loading indicator at the end
  if (streaming && stepElements.length > 0) {
    // Add loading indicator
    panel.elements.push(
      createDivElement({
        icon: createStandardIconElement('more_outlined', { color: 'grey' }),
        text: createPlainTextElement(''),
      })
    );
  }

  return panel;
}

/**
 * Render a single tool use step
 */
export function renderToolUseStep(block: ToolUseBlock, stepNumber: number): DivElement {
  // Get tool icon and label
  const iconToken = toolIconRegistry.getIconToken(block.name);
  const label = toolIconRegistry.generateLabel(block.name, block.input);

  // Create step element with icon and label
  return createDivElement({
    text: createPlainTextElement(`${stepNumber}. ${label}`),
    icon: createStandardIconElement(iconToken, {
      color: Color.TextPrimary,
      size: 'small',
    }),
  });
}

/**
 * Render a thinking step (agent's reasoning process)
 * 参考 agentara：使用 robot_outlined 图标，灰色小号字体
 */
export function renderThinkingStep(block: ThinkingBlock): DivElement {
  return {
    tag: 'div',
    icon: {
      tag: 'standard_icon',
      token: 'robot_outlined',
      color: 'grey',
    },
    text: {
      tag: 'plain_text',
      text_color: 'grey',
      text_size: 'notation',
      content: block.thinking,
    },
  };
}

/**
 * Simplify markdown content if it has too many tables
 * Feishu Card limit: ~3 tables
 */
function simplifyMarkdownTables(content: string, maxTables: number = 3): string {
  // Split content by table blocks
  const lines = content.split('\n');
  const segments: Array<{ type: 'text' | 'table'; content: string }> = [];

  let currentText: string[] = [];
  let currentTable: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const isTableRow = line.trim().startsWith('|');
    const isTableSeparator = /^\|[\s\-:|]+\|$/.test(line.trim());

    if (isTableRow || isTableSeparator) {
      if (!inTable) {
        // Save previous text segment
        if (currentText.length > 0) {
          segments.push({ type: 'text', content: currentText.join('\n') });
          currentText = [];
        }
        inTable = true;
      }
      currentTable.push(line);
    } else {
      if (inTable) {
        // Save table segment
        segments.push({ type: 'table', content: currentTable.join('\n') });
        currentTable = [];
        inTable = false;
      }
      currentText.push(line);
    }
  }

  // Save last segment
  if (inTable && currentTable.length > 0) {
    segments.push({ type: 'table', content: currentTable.join('\n') });
  } else if (currentText.length > 0) {
    segments.push({ type: 'text', content: currentText.join('\n') });
  }

  // Count tables
  const tableSegments = segments.filter(s => s.type === 'table');
  if (tableSegments.length <= maxTables) {
    return content; // No need to simplify
  }

  console.log(`[MessageRenderer] 📊 Simplifying ${tableSegments.length} tables to ${maxTables}`);

  // Keep first maxTables tables, convert rest to lists or remove
  let tableCount = 0;
  const simplifiedSegments = segments.map(segment => {
    if (segment.type === 'table') {
      tableCount++;
      if (tableCount <= maxTables) {
        return segment.content;
      } else {
        // Convert table to simple list or skip
        const lines = segment.content.split('\n').filter(l => l.trim() && !/^\|[\s\-:|]+\|$/.test(l.trim()));
        if (lines.length <= 2) {
          return ''; // Skip small tables
        }

        // Try to extract key-value pairs from first 2 rows
        const headerRow = lines[0];
        const valueRow = lines[1] || '';

        const headers = headerRow.split('|').filter(h => h.trim());
        const values = valueRow.split('|').filter(v => v.trim());

        if (headers.length === values.length && headers.length <= 4) {
          // Convert to bullet list
          const items = headers.map((h, i) => `- **${h.trim()}**: ${values[i].trim()}`);
          return items.join('\n');
        }

        return ''; // Skip complex tables
      }
    }
    return segment.content;
  });

  return simplifiedSegments.filter(s => s.trim()).join('\n\n');
}

/**
 * Render final answer (markdown)
 * NOTE: Feishu has limits on table count in cards (ErrCode: 11310)
 * If content has too many tables, we need to simplify it
 */
export function renderFinalAnswer(block: TextBlock): any {
  let content = block.text;

  // Simplify tables if needed (Feishu limit is around 3 tables)
  content = simplifyMarkdownTables(content, 3);

  return createMarkdownElement(content);
}

/**
 * Render empty card (for initial state)
 */
export function renderEmptyCard(message?: string): Card {
  const body = createCardBody([
    createDivElement({
      text: createPlainTextElement(message || 'Agent is thinking...'),
      icon: createStandardIconElement(IconToken.Robot, { color: Color.Blue }),
    }),
  ]);

  return createCard(body, { config: createStreamingConfig() });
}

/**
 * Render error card
 */
// SECURITY: [CR-Sec] Error messages may contain user input; sanitize before interpolation
export function renderErrorCard(error: string): Card {
  const body = createCardBody([
    createDivElement({
      text: createPlainTextElement(`❌ Error: ${error}`),
      icon: createStandardIconElement(IconToken.Error, { color: Color.Red }),
    }),
  ]);

  return createCard(body);
}

/**
 * Update existing card with new blocks
 */
export function updateMessageCard(
  _existingCard: Card,
  blocks: ContentBlock[],
  options?: RenderOptions
): Card {
  // Simply re-render with new blocks
  return renderMessageCard(blocks, options);
}

/**
 * Render chart element from ChartDataBlock
 */
export function renderChartElement(block: ChartDataBlock): any {
  // Build VChart spec from block data
  const chartSpec: Record<string, unknown> = {
    type: block.chartType,
    data: {
      values: block.data,
    },
    ...block.spec, // Merge additional spec options
  };

  // Add title if provided
  if (block.title) {
    chartSpec.title = { text: block.title };
  }

  return createChartElement({
    chartSpec,
    aspectRatio: block.aspectRatio,
    colorTheme: block.colorTheme,
  });
}

// Re-export Card type for convenience
export { type Card } from './types/card';
