/**
 * Card Schema 2.0 - Root Card Structure
 *
 * Based on Feishu/Lark Interactive Card Schema 2.0 specification.
 * Supports streaming updates with message.patch API.
 */

import { z } from 'zod';
import { ElementSchema, StandardIconElementSchema } from './elements';

// ============================================
// Card Config
// ============================================

/**
 * Card configuration options
 */
export const CardConfigSchema = z.object({
  /**
   * Enable streaming mode for real-time updates
   * When true, card can be updated via message.patch
   */
  streaming_mode: z.boolean().optional(),

  /**
   * Card width mode
   * - 'fit': Fit to content
   * - 'fill': Fill container width
   */
  width_mode: z.enum(['fit', 'fill']).optional(),

  /**
   * Summary for notification display
   */
  summary: z.object({
    content: z.string(),
  }).optional(),
});

export type CardConfig = z.infer<typeof CardConfigSchema>;

// ============================================
// Card Header
// ============================================

export const CardHeaderSchema = z.object({
  /**
   * Header title template
   */
  template: z.string().optional(),

  /**
   * Header icon
   */
  icon: StandardIconElementSchema.optional(),
});

export type CardHeader = z.infer<typeof CardHeaderSchema>;

// ============================================
// Card Body
// ============================================

/**
 * Card body container
 */
export const CardBodySchema = z.object({
  /**
   * List of card elements
   */
  elements: z.array(ElementSchema),
});

export type CardBody = z.infer<typeof CardBodySchema>;

// ============================================
// Card Root
// ============================================

/**
 * Card Schema 2.0 root structure
 */
export const CardSchema = z.object({
  /**
   * Schema version - must be "2.0" for Card Schema 2.0
   */
  schema: z.literal('2.0'),

  /**
   * Card configuration
   */
  config: CardConfigSchema.optional(),

  /**
   * Card header (optional)
   */
  header: CardHeaderSchema.optional(),

  /**
   * Card body with elements
   */
  body: CardBodySchema,
});

export type Card = z.infer<typeof CardSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * Create a basic Card structure
 */
export function createCard(
  body: CardBody,
  options?: {
    config?: CardConfig;
    header?: CardHeader;
  }
): Card {
  return CardSchema.parse({
    schema: '2.0',
    config: options?.config,
    header: options?.header,
    body,
  });
}

/**
 * Create streaming-enabled Card config
 */
export function createStreamingConfig(): CardConfig {
  return {
    streaming_mode: true,
    width_mode: 'fill',
  };
}

/**
 * Create Card body with elements
 */
export function createCardBody(elements: z.infer<typeof ElementSchema>[]): CardBody {
  return CardBodySchema.parse({ elements });
}
