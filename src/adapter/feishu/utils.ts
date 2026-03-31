/**
 * Feishu-specific Utilities
 *
 * Functions that are specific to Feishu card/message formatting.
 * Moved from infra/utils to respect layer boundaries.
 */

/**
 * Sanitize string for safe use in Feishu Card JSON.
 * Escapes HTML entities to prevent XSS in card rendering.
 */
export function sanitizeForCard(input: string): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}
