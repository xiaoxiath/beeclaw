/**
 * bee — L1 Format Compressor.
 *
 * Lossless compression by removing format redundancies.
 * Compression rate: 10-30%, Information retention: ~99%, Latency: <1ms
 *
 * Extracted from beeclaw's src/domain/agent/compression/l1-format-compressor.ts.
 * Changes: uses bee's estimateTokens, no singleton.
 */

import { estimateTokens } from '../token-estimator';
import type { CompressionResult } from './types';

export interface CompressionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
  description: string;
}

const DEFAULT_RULES: CompressionRule[] = [
  {
    name: 'collapse_newlines',
    pattern: /\n{3,}/g,
    replacement: '\n\n',
    description: 'Collapse 3+ consecutive newlines to 2',
  },
  {
    name: 'trim_trailing_whitespace',
    pattern: /[ \t]+$/gm,
    replacement: '',
    description: 'Remove trailing whitespace on each line',
  },
  {
    name: 'collapse_spaces',
    pattern: / {2,}/g,
    replacement: ' ',
    description: 'Collapse 2+ consecutive spaces to 1',
  },
  {
    name: 'remove_html_comments',
    pattern: /<!--[\s\S]*?-->/g,
    replacement: '',
    description: 'Remove HTML comments',
  },
  {
    name: 'remove_empty_list_items',
    pattern: /^[-*]\s*$/gm,
    replacement: '',
    description: 'Remove empty list items',
  },
  {
    name: 'normalize_bullets',
    pattern: /^(\s*)[*+]\s/gm,
    replacement: '$1- ',
    description: 'Normalize bullet points to dash',
  },
  {
    name: 'strip_zero_width_chars',
    pattern: /[\u200b\u200c\u200d\ufeff]/g,
    replacement: '',
    description: 'Remove zero-width characters',
  },
  {
    name: 'collapse_code_blank_lines',
    pattern: /(```[\s\S]*?```)\n{2,}/g,
    replacement: '$1\n\n',
    description: 'Collapse blank lines after code blocks',
  },
];

export class L1FormatCompressor {
  readonly name = 'L1-Format';

  private rules: CompressionRule[];

  constructor(customRules?: CompressionRule[]) {
    this.rules = customRules ?? DEFAULT_RULES;
  }

  compress(text: string): CompressionResult {
    const startTime = Date.now();
    const originalTokens = estimateTokens(text);

    let result = text;
    const appliedRules: string[] = [];

    for (const rule of this.rules) {
      const before = result;
      result = result.replace(rule.pattern, rule.replacement);
      if (result !== before) {
        appliedRules.push(rule.name);
      }
    }

    // Clean up double newlines created by removals
    result = result.replace(/\n{3,}/g, '\n\n');

    const compressedTokens = estimateTokens(result);
    const latencyMs = Date.now() - startTime;

    return {
      compressed: result,
      originalTokens,
      compressedTokens,
      ratio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
      infoRetention: 0.99,
      method: appliedRules.length > 0 ? `L1-Format[${appliedRules.join(',')}]` : 'L1-Format[no-change]',
      latencyMs,
    };
  }

  getRules(): Array<{ name: string; description: string }> {
    return this.rules.map(r => ({ name: r.name, description: r.description }));
  }

  addRule(rule: CompressionRule): void {
    this.rules.push(rule);
  }

  removeRule(name: string): boolean {
    const index = this.rules.findIndex(r => r.name === name);
    if (index >= 0) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }
}
