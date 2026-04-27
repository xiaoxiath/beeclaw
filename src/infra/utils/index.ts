/**
 * Shared utility functions — canonical implementations.
 *
 * Other modules should import from here instead of maintaining local copies.
 */

// ────────────────────────────────────────────
// Async Mutex
// ────────────────────────────────────────────

export { AsyncMutex } from './async-mutex';

// ────────────────────────────────────────────
// Deep Merge
// ────────────────────────────────────────────

/**
 * Recursively merge `sources` into `target`.
 * - Objects are merged key-by-key.
 * - Arrays and primitives are replaced (not concatenated).
 * - `undefined` values in sources are skipped.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  const result = { ...target } as Record<string, unknown>;

  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      const srcVal = (source as Record<string, unknown>)[key];
      if (srcVal === undefined) continue;

      const tgtVal = result[key];
      if (
        tgtVal !== null &&
        tgtVal !== undefined &&
        typeof tgtVal === 'object' &&
        !Array.isArray(tgtVal) &&
        srcVal !== null &&
        typeof srcVal === 'object' &&
        !Array.isArray(srcVal)
      ) {
        result[key] = deepMerge(
          tgtVal as Record<string, unknown>,
          srcVal as Record<string, unknown>,
        );
      } else {
        result[key] = srcVal;
      }
    }
  }

  return result as T;
}

// ────────────────────────────────────────────
// Cosine Similarity
// ────────────────────────────────────────────

/**
 * Compute cosine similarity between two equal-length numeric vectors.
 * Returns 0 when either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ────────────────────────────────────────────
// Card Content Sanitization
// ────────────────────────────────────────────

/**
 * Sanitize user input for safe interpolation into Feishu card lark_md content.
 *
 * SECURITY FIX (P0): Prevents injection attacks by escaping HTML-like
 * characters that could be interpreted by the Feishu card renderer.
 */
/**
 * @deprecated Use `import { sanitizeForCard } from '../../adapter/feishu/utils'` instead.
 * This Feishu-specific utility was moved to the adapter layer.
 * Re-exported here for backward compatibility.
 */
export { sanitizeForCard } from '../../adapter/feishu/utils';

// ────────────────────────────────────────────
// Safe JSON Parse (B-P1-04)
// ────────────────────────────────────────────

/**
 * Parse JSON with multiple fallback strategies:
 * 1. Direct JSON.parse
 * 2. Extract from markdown code blocks (```json ... ```)
 * 3. Extract first JSON object/array from text
 *
 * @param text - The text to parse
 * @param fallback - Optional fallback value if all strategies fail
 * @returns Parsed value or fallback
 */
export function safeJsonParse<T = unknown>(text: string, fallback?: T): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    // 尝试从 markdown 代码块提取
    const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (match) {
      try {
        return JSON.parse(match[1]) as T;
      } catch { /* continue */ }
    }
    // 尝试提取第一个 JSON 对象/数组
    const objMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[1]) as T;
      } catch { /* continue */ }
    }
    return fallback;
  }
}
