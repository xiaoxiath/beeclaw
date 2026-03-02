/**
 * Content Extractor
 *
 * Extract main content from web pages and convert to Markdown
 */

export interface ExtractOptions {
  maxLength?: number;
  timeout?: number;
  includeImages?: boolean;
}

export class ContentExtractor {
  private defaultTimeout: number;
  private defaultMaxLength: number;

  constructor(options?: { timeout?: number; maxLength?: number }) {
    this.defaultTimeout = options?.timeout || 15000;
    this.defaultMaxLength = options?.maxLength || 10000;
  }

  /**
   * Extract content from a URL and convert to Markdown
   */
  async extract(url: string, options?: ExtractOptions): Promise<string> {
    const timeout = options?.timeout || this.defaultTimeout;
    const maxLength = options?.maxLength || this.defaultMaxLength;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Beeclaw/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';

      // Handle non-HTML content
      if (!contentType.includes('text/html')) {
        if (contentType.includes('application/json')) {
          const json = await response.json();
          const text = JSON.stringify(json, null, 2);
          return text.slice(0, maxLength);
        }
        const text = await response.text();
        return text.slice(0, maxLength);
      }

      let html = await response.text();
      return this.htmlToMarkdown(html, maxLength, options?.includeImages);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Content extraction timeout');
      }
      throw error;
    }
  }

  /**
   * Convert HTML to Markdown
   */
  private htmlToMarkdown(html: string, maxLength: number, includeImages?: boolean): string {
    // Remove scripts, styles, nav, footer, header
    let content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '');

    // Try to extract main content (article, main, or just use body)
    const mainMatch = content.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                      content.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      content = mainMatch[1];
    }

    // Convert HTML elements to Markdown
    // Headers
    content = content.replace(/<h1[^>]*>([^<]*)<\/h1>/gi, '# $1\n\n');
    content = content.replace(/<h2[^>]*>([^<]*)<\/h2>/gi, '## $1\n\n');
    content = content.replace(/<h3[^>]*>([^<]*)<\/h3>/gi, '### $1\n\n');
    content = content.replace(/<h4[^>]*>([^<]*)<\/h4>/gi, '#### $1\n\n');
    content = content.replace(/<h5[^>]*>([^<]*)<\/h5>/gi, '##### $1\n\n');
    content = content.replace(/<h6[^>]*>([^<]*)<\/h6>/gi, '###### $1\n\n');

    // Links
    content = content.replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)');

    // Bold and italic
    content = content.replace(/<(b|strong)[^>]*>([^<]*)<\/\1>/gi, '**$2**');
    content = content.replace(/<(i|em)[^>]*>([^<]*)<\/\1>/gi, '*$2*');

    // Code
    content = content.replace(/<code[^>]*>([^<]*)<\/code>/gi, '`$1`');
    content = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n');

    // Lists
    content = content.replace(/<li[^>]*>([^<]*)<\/li>/gi, '- $1\n');
    content = content.replace(/<\/?[ou]l[^>]*>/gi, '\n');

    // Blockquotes
    content = content.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '> $1\n');

    // Images (optional)
    if (includeImages) {
      content = content.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
      content = content.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');
    } else {
      content = content.replace(/<img[^>]*\/?>/gi, '');
    }

    // Paragraphs and breaks
    content = content.replace(/<br\s*\/?>/gi, '\n');
    content = content.replace(/<p[^>]*>([^<]*)<\/p>/gi, '$1\n\n');
    content = content.replace(/<div[^>]*>([^<]*)<\/div>/gi, '$1\n');

    // Remove remaining HTML tags
    content = content.replace(/<[^>]*>/g, '');

    // Decode HTML entities
    content = content
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
      .replace(/&(#x[0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex.slice(2), 16)));

    // Clean up whitespace - aggressive cleanup to save tokens
    content = content
      .replace(/\r\n/g, '\n')           // Normalize line endings
      .replace(/\r/g, '\n')             // Handle old Mac line endings
      .replace(/[ \t]+\n/g, '\n')       // Remove trailing spaces before newlines
      .replace(/\n[ \t]+/g, '\n')       // Remove leading spaces after newlines
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Multiple newlines with spaces -> 2 newlines
      .replace(/\n{3,}/g, '\n\n')       // Max 2 consecutive newlines
      .replace(/[ \t]{2,}/g, ' ')       // Max 1 consecutive space
      .trim();

    // Truncate if needed
    if (content.length > maxLength) {
      content = content.slice(0, maxLength) + '\n\n... (content truncated)';
    }

    return content;
  }
}

// Singleton instance
let extractorInstance: ContentExtractor | null = null;

export function getContentExtractor(): ContentExtractor {
  if (!extractorInstance) {
    extractorInstance = new ContentExtractor();
  }
  return extractorInstance;
}
