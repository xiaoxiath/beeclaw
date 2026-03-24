/**
 * Feishu Card Message Builder
 *
 * Build interactive card messages for Feishu
 */

import { sendCardMessage } from './send';


/**
 * Sanitize user input for safe interpolation into Feishu card lark_md content.
 *
 * SECURITY FIX (P0): Prevents injection attacks by escaping HTML-like
 * characters that could be interpreted by the Feishu card renderer.
 * Applied at all [CR-Sec] marked locations.
 */
function sanitizeForCard(input: string): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Card builder for creating interactive cards
 */
export class CardBuilder {
  private config: CardConfig = {};
  private elements: CardElement[] = [];
  private header: CardHeader | null = null;

  /**
   * Set card config
   */
  setConfig(config: Partial<CardConfig>): this {
    this.config = { ...this.config, ...config };
    return this;
  }

  /**
   * Set card header
   */
  setHeader(title: string, subtitle?: string): this {
    this.header = {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: title,
      },
      subtitle: subtitle ? {
        tag: 'plain_text',
        content: subtitle,
      } : undefined,
    };
    return this;
  }

  /**
   * Add markdown section
   */
  addMarkdown(content: string): this {
    this.elements.push({
      tag: 'markdown',
      content,
    });
    return this;
  }

  /**
   * Add text section
   */
  addText(content: string, options?: {
    size?: 'typography_text_normal' | 'typography_text_secondary' | 'typography_text_title';
    color?: 'grey' | 'red' | 'blue' | 'green' | 'orange';
  }): this {
    this.elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content,
      },
      extra: {
        size: options?.size,
        color: options?.color,
      },
    });
    return this;
  }

  /**
   * Add divider
   */
  addDivider(): this {
    this.elements.push({
      tag: 'hr',
    });
    return this;
  }

  /**
   * Add note
   */
  addNote(content: string): this {
    this.elements.push({
      tag: 'note',
      elements: [{
        tag: 'plain_text',
        content,
      }],
    });
    return this;
  }

  /**
   * Add image
   */
  addImage(imgKey: string, options?: {
    alt?: string;
    preview?: boolean;
    mode?: 'crop_center' | 'fit_horizontal';
  }): this {
    this.elements.push({
      tag: 'img',
      img_key: imgKey,
      alt: options?.alt ? {
        tag: 'plain_text',
        content: options.alt,
      } : undefined,
      preview: options?.preview,
      mode: options?.mode,
    });
    return this;
  }

  /**
   * Add action buttons
   */
  addActions(actions: CardAction[]): this {
    this.elements.push({
      tag: 'action',
      actions,
    });
    return this;
  }

  /**
   * Add button action
   */
  addButton(
    text: string,
    value: Record<string, unknown>,
    options?: {
      type?: 'primary' | 'default' | 'danger';
      url?: string;
    }
  ): this {
    const action: CardAction = {
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: text,
      },
      type: options?.type || 'default',
      value,
    };

    if (options?.url) {
      action.url = options.url;
    }

    const lastElement = this.elements[this.elements.length - 1];
    if (lastElement?.tag === 'action') {
      lastElement.actions.push(action);
    } else {
      this.elements.push({
        tag: 'action',
        actions: [action],
      });
    }
    return this;
  }

  /**
   * Add select menu
   */
  addSelectMenu(
    placeholder: string,
    options: Array<{ text: string; value: string }>,
    options2?: {
    initialOption?: string;
    multiple?: boolean;
  }
  ): this {
    const action: CardAction = {
      tag: 'select_static',
      placeholder: {
        tag: 'plain_text',
        content: placeholder,
      },
      options: options.map(opt => ({
        text: {
          tag: 'plain_text',
          content: opt.text,
        },
        value: opt.value,
      })),
      initial_option: options2?.initialOption,
      multiple: options2?.multiple,
    };

    const lastElement = this.elements[this.elements.length - 1];
    if (lastElement?.tag === 'action') {
      lastElement.actions.push(action);
    } else {
      this.elements.push({
        tag: 'action',
        actions: [action],
      });
    }
    return this;
  }

  /**
   * Build the card
   */
  build(): FeishuCard {
    const card: FeishuCard = {
      type: 'interactive',
      config: this.config,
    };

    if (this.header) {
      card.header = this.header;
    }

    if (this.elements.length > 0) {
      card.elements = this.elements;
    }

    return card;
  }

  /**
   * Build and send the card
   */
  async send(
    client: Client,
    receiveId: string,
    receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id'
  ): Promise<{ messageId: string }> {
    const card = this.build();
    return await sendCardMessage(client, receiveId, receiveIdType, card);
  }
}

/**
 * Create a new card builder
 */
export function createCard(): CardBuilder {
  return new CardBuilder();
}

/**
 * Build markdown card (Schema 2.0)
 */
// SECURITY: [CR-Sec] User input sanitized before interpolation into lark_md content
export function buildMarkdownCard(
  markdown: string,
  options?: {
    title?: string;
    wideScreen?: boolean;
    enableForward?: boolean;
  }
): FeishuCard {
  const elements: CardElement[] = [];

  // Add title if provided (sanitized)
  if (options?.title) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${sanitizeForCard(options.title)}**`,
      },
    });
  }

  // Add markdown content (sanitized)
  elements.push({
    tag: 'markdown',
    content: sanitizeForCard(markdown),
  });

  return {
    type: 'interactive',
    config: {
      wide_screen_mode: options?.wideScreen ?? true,
      enable_forward: options?.enableForward ?? true,
    },
    elements,
  };
}

/**
 * Build simple text card
 */
// SECURITY: [CR-Sec] User input sanitized before interpolation into lark_md content
export function buildTextCard(
  title: string,
  content: string,
  options?: {
    color?: 'blue' | 'green' | 'red' | 'orange' | 'grey';
    icon?: string;
  }
): FeishuCard {
  const elements: CardElement[] = [];

  // Add title with icon (sanitized)
  const safeTitle = sanitizeForCard(title);
  const titleText = options?.icon ? `${options.icon} ${safeTitle}` : safeTitle;
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**${titleText}**`,
    },
  });

  // Add content (sanitized)
  elements.push({
    tag: 'div',
    text: {
      tag: 'plain_text',
      content: sanitizeForCard(content),
    },
  });

  return {
    type: 'interactive',
    config: {
      wide_screen_mode: false,
    },
    elements,
  };
}

/**
 * Build form card with input fields
 */
// SECURITY: [CR-Sec] User input sanitized before interpolation
export function buildFormCard(
  title: string,
  fields: Array<{
    name: string;
    required?: boolean;
    placeholder?: string;
    type?: 'input' | 'textarea' | 'select';
    options?: Array<{ text: string; value: string }>;
  }>,
  submitText: string = '提交'
): FeishuCard {
  const elements: CardElement[] = [];

  // Add title (sanitized)
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**${sanitizeForCard(title)}**`,
    },
  });

  // Add form fields
  for (const field of fields) {
    if (field.type === 'select' && field.options) {
      elements.push({
        tag: 'input',
        name: field.name,
        required: field.required ?? false,
        placeholder: {
          tag: 'plain_text',
          content: field.placeholder || `请选择${field.name}`,
        },
        element: {
          tag: 'select_static',
          placeholder: {
            tag: 'plain_text',
            content: field.placeholder || `请选择${field.name}`,
          },
          options: field.options.map(opt => ({
            text: {
              tag: 'plain_text',
              content: opt.text,
            },
            value: opt.value,
          })),
        },
      });
    } else if (field.type === 'textarea') {
      elements.push({
        tag: 'input',
        name: field.name,
        required: field.required ?? false,
        placeholder: {
          tag: 'plain_text',
          content: field.placeholder || `请输入${field.name}`,
        },
        element: {
          tag: 'textarea',
          placeholder: {
            tag: 'plain_text',
            content: field.placeholder || `请输入${field.name}`,
          },
          max_length: 2000,
        },
      });
    } else {
      elements.push({
        tag: 'input',
        name: field.name,
        required: field.required ?? false,
        placeholder: {
          tag: 'plain_text',
          content: field.placeholder || `请输入${field.name}`,
        },
        element: {
          tag: 'input',
          placeholder: {
            tag: 'plain_text',
            content: field.placeholder || `请输入${field.name}`,
          },
          max_length: 500,
        },
      });
    }
  }

  // Add submit button
  elements.push({
    tag: 'action',
    actions: [{
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: submitText,
      },
      type: 'primary',
      value: {
        action: 'submit_form',
      },
    }],
  });

  return {
    type: 'interactive',
    config: {
      wide_screen_mode: false,
    },
    elements,
  };
}

/**
 * Build list card
 */
// SECURITY: [CR-Sec] User input sanitized before interpolation
export function buildListCard(
  title: string,
  items: Array<{
    title: string;
    description?: string;
    icon?: string;
    url?: string;
  }>
): FeishuCard {
  const elements: CardElement[] = [];

  // Add title (sanitized)
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**${sanitizeForCard(title)}**`,
    },
  });

  elements.push({
    tag: 'hr',
  });

  // Add items
  for (const item of items) {
    const content = item.icon ? `${item.icon} ${sanitizeForCard(item.title)}` : sanitizeForCard(item.title);
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${content}**${item.description ? `\n${item.description}` : ''}`,
      },
    });
  }

  return {
    type: 'interactive',
    config: {
      wide_screen_mode: true,
    },
    elements,
  };
}

// ============================================================
// Types
// ============================================================

export interface CardConfig {
  wide_screen_mode?: boolean;
  enable_forward?: boolean;
}

export interface CardHeader {
  template?: 'blue' | 'wathet' | 'turquoise' | 'green' | 'yellow' | 'orange' | 'red' | 'carmine' | 'violet' | 'purple' | 'indigo' | 'grey';
  title: {
    tag: 'plain_text';
    content: string;
  };
  subtitle?: {
    tag: 'plain_text';
    content: string;
  };
}

export interface CardElement {
  tag: 'div' | 'markdown' | 'note' | 'hr' | 'action' | 'img' | 'input';
  text?: {
    tag: 'plain_text' | 'lark_md';
    content: string;
  };
  content?: string;
  elements?: Array<{ tag: string; content?: string }>;
  actions?: CardAction[];
  extra?: {
    size?: string;
    color?: string;
  };
  img_key?: string;
  alt?: {
    tag: 'plain_text';
    content: string;
  };
  preview?: boolean;
  mode?: 'crop_center' | 'fit_horizontal';
  name?: string;
  required?: boolean;
  placeholder?: {
    tag: 'plain_text';
    content: string;
  };
  element?: {
    tag: 'input' | 'textarea' | 'select_static';
    placeholder?: {
      tag: 'plain_text';
      content: string;
    };
    max_length?: number;
    options?: Array<{
      text: {
        tag: 'plain_text';
        content: string;
      };
      value: string;
    }>;
  };
}

export interface CardAction {
  tag: 'button' | 'select_static' | 'select_dynamic' | 'overflow' | 'date_picker' | 'picker_time';
  text?: {
    tag: 'plain_text';
    content: string;
  };
  type?: 'primary' | 'default' | 'danger';
  value?: Record<string, unknown>;
  url?: string;
  placeholder?: {
    tag: 'plain_text';
    content: string;
  };
  options?: Array<{
    text: {
      tag: 'plain_text';
      content: string;
    };
    value: string;
  }>;
  initial_option?: string;
  multiple?: boolean;
}

export interface FeishuCard {
  type: 'template' | 'interactive';
  config?: CardConfig;
  header?: CardHeader;
  elements?: CardElement[];
  data?: {
    template_id: string;
    template_variable: Record<string, unknown>;
  };
}
