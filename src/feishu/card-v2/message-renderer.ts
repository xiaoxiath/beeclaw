/**
 * Message Card Renderer
 *
 * Renders ContentBlock arrays into Card Schema 2.0 JSON.
 * Supports streaming mode with collapsible step panels.
 */

import type { ContentBlock, ToolUseBlock, TextBlock } from '../../types/content-block';
import { toolIconRegistry } from './tool-icon-registry';
import {
  createCard,
  createStreamingConfig,
  createCardBody,
  type Card,
  type CardBody,
} from './types/card';
import {
  createMarkdownElement,
  createStandardIconElement,
  createPlainTextElement,
  createDivElement,
  createCollapsiblePanel,
  createHrElement,
  type CollapsiblePanel,
  type DivElement,
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

  // Separate steps (thinking + tool use) from final answer (text)
  const steps = blocks.filter(
    (block) => block.type === 'thinking' || block.type === 'tool_use'
  );
  const finalAnswer = blocks.find((block) => block.type === 'text') as TextBlock | undefined;
  const images = blocks.filter((block) => block.type === 'image');

  // Build card elements
  const elements: any[] = [];

  // Add steps panel if there are any steps
  if (steps.length > 0) {
    const stepsPanel = renderStepsPanel(steps, { streaming, summary });
    elements.push(stepsPanel);
  }

  // Add divider if there are both steps and final answer
  if (steps.length > 0 && (finalAnswer || images.length > 0)) {
    elements.push(createHrElement());
  }

  // Add final answer
  if (finalAnswer) {
    const answerElement = renderFinalAnswer(finalAnswer);
    elements.push(answerElement);
  }

  // Add images
  images.forEach((image) => {
    // TODO: Add image element when supported
    // For now, just add a note
    elements.push(
      createDivElement({
        text: createPlainTextElement('📷 Image'),
      })
    );
  });

  // Create card body
  const body = createCardBody(elements);

  // Create card with optional streaming config
  const config = streaming ? createStreamingConfig() : undefined;
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
    }
    // TODO: Handle thinking blocks if needed
  });

  // Create panel header
  const headerText = summary || `Agent reasoning (${stepCount} steps)`;
  const header = createDivElement({
    text: createPlainTextElement(headerText),
    icon: createStandardIconElement(IconToken.Brain, { color: Color.Blue }),
  });

  // Create collapsible panel
  return createCollapsiblePanel({
    header,
    elements: stepElements,
    expanded: streaming, // Expanded during streaming, collapsed after completion
  });
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
 * Render final answer (markdown)
 */
export function renderFinalAnswer(block: TextBlock): any {
  return createMarkdownElement(block.text);
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
  existingCard: Card,
  blocks: ContentBlock[],
  options?: RenderOptions
): Card {
  // Simply re-render with new blocks
  return renderMessageCard(blocks, options);
}
