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
// Collapsible Panel Header
// ============================================

/**
 * Header for collapsible panel (no tag field, but nested elements have tags)
 * Based on Feishu Card Schema 2.0 specification
 */
export const CollapsiblePanelHeaderSchema = z.object({
  /**
   * Header title (PlainText or Markdown)
   */
  title: z.union([PlainTextElementSchema, MarkdownElementSchema]).optional(),

  /**
   * Header icon
   */
  icon: StandardIconElementSchema.optional(),

  /**
   * Icon position
   */
  icon_position: z.enum(['left', 'right', 'follow_text']).optional(),

  /**
   * Icon rotation angle when expanded
   */
  icon_expanded_angle: z.number().optional(),

  /**
   * Background color
   */
  background_color: z.string().optional(),

  /**
   * Vertical alignment
   */
  vertical_align: z.enum(['top', 'center', 'bottom']).optional(),

  /**
   * Padding
   */
  padding: z.string().optional(),

  /**
   * Position (top or bottom)
   */
  position: z.enum(['top', 'bottom']).optional(),

  /**
   * Width
   */
  width: z.string().optional(),
});

export type CollapsiblePanelHeader = z.infer<typeof CollapsiblePanelHeaderSchema>;

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
   * Panel header (no tag field, but nested elements have tags)
   */
  header: CollapsiblePanelHeaderSchema,

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
   * Direction (vertical or horizontal)
   */
  direction: z.enum(['vertical', 'horizontal']).optional(),

  /**
   * Vertical spacing
   */
  vertical_spacing: z.string().optional(),

  /**
   * Horizontal spacing
   */
  horizontal_spacing: z.string().optional(),

  /**
   * Vertical alignment
   */
  vertical_align: z.enum(['top', 'center', 'bottom']).optional(),

  /**
   * Horizontal alignment
   */
  horizontal_align: z.enum(['left', 'center', 'right']).optional(),

  /**
   * Padding
   */
  padding: z.string().optional(),

  /**
   * Margin
   */
  margin: z.string().optional(),

  /**
   * Background color
   */
  background_color: z.string().optional(),

  /**
   * Border style
   */
  border: z.object({
    color: z.string().optional(),
    corner_radius: z.string().optional(),
  }).optional(),

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
// Button Element
// ============================================

/**
 * Button element for interactive actions
 */
export const ButtonElementSchema = z.object({
  tag: z.literal('button'),
  text: z.union([PlainTextElementSchema, MarkdownElementSchema]),
  type: z.enum(['primary', 'default', 'danger']).optional(),
  size: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
  width: z.enum(['default', 'fill']).optional(),
  icon: StandardIconElementSchema.optional(),
  value: z.record(z.unknown()).optional(),
  url: z.string().optional(),
  enabled: z.boolean().optional(),
});

export type ButtonElement = z.infer<typeof ButtonElementSchema>;

// ============================================
// Select Static Element
// ============================================

/**
 * Static select dropdown element
 */
export const SelectOptionSchema = z.object({
  text: z.union([PlainTextElementSchema, MarkdownElementSchema]),
  value: z.string(),
});

export type SelectOption = z.infer<typeof SelectOptionSchema>;

export const SelectStaticElementSchema = z.object({
  tag: z.literal('select_static'),
  placeholder: z.union([PlainTextElementSchema, MarkdownElementSchema]).optional(),
  multiple: z.boolean().optional(),
  options: z.array(SelectOptionSchema),
  value: z.record(z.unknown()).optional(),
  initial_option: z.string().optional(),
  initial_options: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  size: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
  width: z.enum(['default', 'fill']).optional(),
});

export type SelectStaticElement = z.infer<typeof SelectStaticElementSchema>;

// ============================================
// Action Element
// ============================================

/**
 * Action element container for buttons and selects
 */
export const ActionElementSchema = z.object({
  tag: z.literal('action'),
  actions: z.array(z.union([ButtonElementSchema, SelectStaticElementSchema])),
  horizontal_spacing: z.string().optional(),
  vertical_spacing: z.string().optional(),
  horizontal_align: z.enum(['left', 'center', 'right']).optional(),
  vertical_align: z.enum(['top', 'center', 'bottom']).optional(),
  padding: z.string().optional(),
  margin: z.string().optional(),
});

export type ActionElement = z.infer<typeof ActionElementSchema>;

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
  ActionElementSchema,
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
 * Create a Collapsible Panel Header (no tag field, but nested elements have tags)
 */
export function createCollapsiblePanelHeader(options: {
  title?: PlainTextElement | MarkdownElement;
  icon?: StandardIconElement;
  icon_position?: 'left' | 'right' | 'follow_text';
  icon_expanded_angle?: number;
  background_color?: string;
  vertical_align?: 'top' | 'center' | 'bottom';
  padding?: string;
  position?: 'top' | 'bottom';
  width?: string;
}): CollapsiblePanelHeader {
  return CollapsiblePanelHeaderSchema.parse(options);
}

/**
 * Create a Collapsible Panel
 */
export function createCollapsiblePanel(options: {
  header: CollapsiblePanelHeader;
  elements: unknown[];
  expanded?: boolean;
  direction?: 'vertical' | 'horizontal';
  vertical_spacing?: string;
  horizontal_spacing?: string;
  vertical_align?: 'top' | 'center' | 'bottom';
  horizontal_align?: 'left' | 'center' | 'right';
  padding?: string;
  margin?: string;
  background_color?: string;
  border?: { color?: string; corner_radius?: string };
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

/**
 * Create a Button element
 */
export function createButtonElement(options: {
  text: PlainTextElement | MarkdownElement;
  type?: 'primary' | 'default' | 'danger';
  value?: Record<string, unknown>;
  url?: string;
  icon?: StandardIconElement;
  size?: 'tiny' | 'small' | 'medium' | 'large';
  width?: 'default' | 'fill';
  enabled?: boolean;
}): ButtonElement {
  return ButtonElementSchema.parse({
    tag: 'button',
    ...options,
  });
}

/**
 * Create a Select Static element
 */
export function createSelectStaticElement(options: {
  placeholder?: PlainTextElement | MarkdownElement;
  multiple?: boolean;
  options: SelectOption[];
  value?: Record<string, unknown>;
  initial_option?: string;
  initial_options?: string[];
  enabled?: boolean;
  size?: 'tiny' | 'small' | 'medium' | 'large';
  width?: 'default' | 'fill';
}): SelectStaticElement {
  return SelectStaticElementSchema.parse({
    tag: 'select_static',
    ...options,
  });
}

/**
 * Create an Action element
 */
export function createActionElement(options: {
  actions: Array<ButtonElement | SelectStaticElement>;
  horizontal_spacing?: string;
  vertical_spacing?: string;
  horizontal_align?: 'left' | 'center' | 'right';
  vertical_align?: 'top' | 'center' | 'bottom';
  padding?: string;
  margin?: string;
}): ActionElement {
  return ActionElementSchema.parse({
    tag: 'action',
    ...options,
  });
}
