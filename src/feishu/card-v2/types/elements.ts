/**
 * Card Schema 2.0 - Card Elements
 *
 * Interactive elements for Card Schema 2.0
 */

import { z } from 'zod';

// ============================================
// Text Styles
// ============================================

export const TextSizeSchema = z.enum(['normal', 'small', 'large', 'heading', 'markup']);
export type TextSize = z.infer<typeof TextSizeSchema>;

export const TextStyleSchema = z.object({
  size: TextSizeSchema.optional(),
  color: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  line_through: z.boolean().optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

// ============================================
// Markdown Element
// ============================================

/**
 * Markdown element for rich text rendering
 */
export const MarkdownElementSchema = z.object({
  /**
   * Element type
   */
  tag: z.literal('markdown'),

  /**
   * Markdown content
   */
  content: z.string(),

  /**
   * Text styles
   */
  text_styles: TextStyleSchema.optional(),
});

export type MarkdownElement = z.infer<typeof MarkdownElementSchema>;

// ============================================
// Standard Icon Element
// ============================================

/**
 * Standard icon from Feishu icon library
 */
export const StandardIconElementSchema = z.object({
  /**
   * Element type
   */
  tag: z.literal('standard_icon'),

  /**
   * Icon token (e.g., 'search_outlined', 'play_outlined')
   */
  token: z.string(),

  /**
   * Icon color (optional)
   */
  color: z.string().optional(),

  /**
   * Icon size (optional)
   */
  size: z.enum(['small', 'medium', 'large']).optional(),
});

export type StandardIconElement = z.infer<typeof StandardIconElementSchema>;

// ============================================
// Plain Text Element
// ============================================

export const PlainTextElementSchema = z.object({
  tag: z.literal('plain_text'),
  content: z.string(),
  text_styles: TextStyleSchema.optional(),
});

export type PlainTextElement = z.infer<typeof PlainTextElementSchema>;

// ============================================
// Div Element
// ============================================

/**
 * Div element for layout (icon + text)
 */
export const DivElementSchema = z.object({
  /**
   * Element type
   */
  tag: z.literal('div'),

  /**
   * Text content
   */
  text: PlainTextElementSchema.optional(),

  /**
   * Fields (multiple text elements)
   */
  fields: z.array(PlainTextElementSchema).optional(),

  /**
   * Icon
   */
  icon: StandardIconElementSchema.optional(),

  /**
   * Extra elements
   */
  extra: z.array(z.unknown()).optional(),
});

export type DivElement = z.infer<typeof DivElementSchema>;

// ============================================
// Collapsible Panel
// ============================================

/**
 * Collapsible panel for hiding/showing content
 * Key component for streaming message updates
 */
export const CollapsiblePanelSchema = z.object({
  /**
   * Element type
   */
  tag: z.literal('collapsible_panel'),

  /**
   * Panel header
   */
  header: DivElementSchema,

  /**
   * Panel content elements
   */
  elements: z.array(z.unknown()),

  /**
   * Whether panel is expanded
   * - true during streaming (show progress)
   * - false after completion (collapsed by default)
   */
  expanded: z.boolean().optional(),

  /**
   * Callback for panel toggle (optional)
   */
  callback: z.unknown().optional(),
});

export type CollapsiblePanel = z.infer<typeof CollapsiblePanelSchema>;

// ============================================
// Note Element
// ============================================

/**
 * Note element for displaying hints or tips
 */
export const NoteElementSchema = z.object({
  tag: z.literal('note'),
  elements: z.array(z.unknown()),
});

export type NoteElement = z.infer<typeof NoteElementSchema>;

// ============================================
// HR Element
// ============================================

/**
 * Horizontal rule divider
 */
export const HrElementSchema = z.object({
  tag: z.literal('hr'),
});

export type HrElementSchema = typeof HrElementSchema;
export type HrElement = z.infer<typeof HrElementSchema>;

// ============================================
// Element Union Type
// ============================================

/**
 * All supported Card elements
 */
export const ElementSchema = z.discriminatedUnion('tag', [
  MarkdownElementSchema,
  StandardIconElementSchema,
  PlainTextElementSchema,
  DivElementSchema,
  CollapsiblePanelSchema,
  NoteElementSchema,
  HrElementSchema,
]);

export type Element = z.infer<typeof ElementSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * Create a Markdown element
 */
export function createMarkdownElement(content: string, style?: TextStyle): MarkdownElement {
  return MarkdownElementSchema.parse({
    tag: 'markdown',
    content,
    text_styles: style,
  });
}

/**
 * Create a Standard Icon element
 */
export function createStandardIconElement(
  token: string,
  options?: { color?: string; size?: 'small' | 'medium' | 'large' }
): StandardIconElement {
  return StandardIconElementSchema.parse({
    tag: 'standard_icon',
    token,
    ...options,
  });
}

/**
 * Create a Plain Text element
 */
export function createPlainTextElement(content: string, style?: TextStyle): PlainTextElement {
  return PlainTextElementSchema.parse({
    tag: 'plain_text',
    content,
    text_styles: style,
  });
}

/**
 * Create a Div element
 */
export function createDivElement(options: {
  text?: PlainTextElement;
  fields?: PlainTextElement[];
  icon?: StandardIconElement;
  extra?: unknown[];
}): DivElement {
  return DivElementSchema.parse({
    tag: 'div',
    ...options,
  });
}

/**
 * Create a Collapsible Panel
 */
export function createCollapsiblePanel(options: {
  header: DivElement;
  elements: unknown[];
  expanded?: boolean;
}): CollapsiblePanel {
  return CollapsiblePanelSchema.parse({
    tag: 'collapsible_panel',
    ...options,
  });
}

/**
 * Create a Note element
 */
export function createNoteElement(elements: unknown[]): NoteElement {
  return NoteElementSchema.parse({
    tag: 'note',
    elements,
  });
}

/**
 * Create an HR element
 */
export function createHrElement(): HrElement {
  return { tag: 'hr' };
}
