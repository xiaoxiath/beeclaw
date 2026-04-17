/**
 * bee — Injection Scanner (P1-4).
 *
 * Scans user-supplied text for common prompt-injection attack patterns:
 *   - Invisible Unicode characters (zero-width joiners, directional marks, etc.)
 *   - System-prompt override attempts ("ignore previous instructions")
 *   - Raw role / chat-template injection tokens ([INST], <|im_start|>, etc.)
 *   - Data-exfiltration probes ("reveal the system prompt", "print api key")
 *
 * Usage:
 *   import { scanForInjection, sanitizeText } from './injection-scanner';
 *
 *   const result = scanForInjection(untrustedInput);
 *   if (!result.safe) { ... }
 *
 *   const clean = sanitizeText(untrustedInput);
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanResult {
  safe: boolean;
  threats: Array<{
    pattern: string;
    category: 'invisible_unicode' | 'system_override' | 'role_injection' | 'data_exfiltration';
    position: number;
    snippet: string;
  }>;
}

// ---------------------------------------------------------------------------
// Threat pattern definitions
// ---------------------------------------------------------------------------

interface ThreatPattern {
  regex: RegExp;
  category: ScanResult['threats'][number]['category'];
  label: string;
}

/**
 * Build the full set of threat patterns.
 *
 * Each regex uses the global (`g`) flag so we can find every occurrence.
 * Unicode (`u`) flag is used where surrogate-pair ranges are involved.
 */
function buildThreatPatterns(): ThreatPattern[] {
  return [
    // ── Invisible Unicode ──────────────────────────────────────────────
    {
      regex: /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\u00AD]/g,
      category: 'invisible_unicode',
      label: 'Invisible Unicode character (BMP)',
    },
    {
      // Unicode Tags block U+E0000–U+E007F (encoded as surrogate pairs)
      regex: /[\u{E0000}-\u{E007F}]/gu,
      category: 'invisible_unicode',
      label: 'Unicode Tags block character',
    },

    // ── System Override ────────────────────────────────────────────────
    {
      regex: /(?:ignore|forget|disregard)\s+(?:all\s+)?(?:previous|above|prior|earlier|preceding)\s+(?:instructions|rules|prompts|guidelines|directives)/gi,
      category: 'system_override',
      label: 'Instruction override attempt',
    },
    {
      // Bare "system:" at start of line, common injection prefix
      regex: /^system\s*:/gim,
      category: 'system_override',
      label: 'System role injection via "system:" prefix',
    },

    // ── Role / Template Injection ──────────────────────────────────────
    {
      regex: /\[INST\]|\[\/INST\]/gi,
      category: 'role_injection',
      label: 'Llama-style role token',
    },
    {
      regex: /<\|im_start\|>|<\|im_end\|>/gi,
      category: 'role_injection',
      label: 'ChatML role token',
    },
    {
      regex: /<\/?(?:system|user|assistant|human|bot)>/gi,
      category: 'role_injection',
      label: 'XML-style role tag',
    },

    // ── Data Exfiltration ──────────────────────────────────────────────
    {
      regex: /(?:output|print|reveal|show|display|leak|expose|dump|echo|repeat)\s+(?:the\s+)?(?:system\s*prompt|api\s*key|secret|token|password|credentials|private\s*key|internal\s*instructions)/gi,
      category: 'data_exfiltration',
      label: 'Data exfiltration probe',
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a short snippet around the match position for reporting. */
function extractSnippet(text: string, position: number, matchLength: number): string {
  const contextRadius = 20;
  const start = Math.max(0, position - contextRadius);
  const end = Math.min(text.length, position + matchLength + contextRadius);

  let snippet = text.slice(start, end);

  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  // Collapse whitespace for cleaner output
  return snippet.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/**
 * Regex for invisible Unicode characters used by `sanitizeText`.
 * Combines BMP invisible ranges and the Tags block.
 */
const INVISIBLE_UNICODE_RE =
  /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\u00AD\u{E0000}-\u{E007F}]/gu;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan `text` for known prompt-injection threat patterns.
 *
 * @param text        The text to scan (typically user input or tool output).
 * @param maxThreats  Maximum number of threats to collect before stopping
 *                    (default 10). Keeps scanning cost bounded on large inputs.
 * @returns           A `ScanResult` indicating whether the text is safe and
 *                    listing any detected threats.
 */
export function scanForInjection(text: string, maxThreats = 10): ScanResult {
  const threats: ScanResult['threats'] = [];
  const patterns = buildThreatPatterns();

  for (const { regex, category, label } of patterns) {
    if (threats.length >= maxThreats) break;

    // Reset lastIndex in case the regex instance was reused
    regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      threats.push({
        pattern: label,
        category,
        position: match.index,
        snippet: extractSnippet(text, match.index, match[0].length),
      });

      if (threats.length >= maxThreats) break;
    }
  }

  return {
    safe: threats.length === 0,
    threats,
  };
}

/**
 * Remove invisible Unicode characters from `text`.
 *
 * This is a lightweight sanitisation step that strips zero-width joiners,
 * directional overrides, Unicode Tags block characters, and similar
 * non-printing code-points that are commonly used to hide injected content.
 *
 * Visible content is preserved unchanged.
 */
export function sanitizeText(text: string): string {
  return text.replace(INVISIBLE_UNICODE_RE, '');
}
