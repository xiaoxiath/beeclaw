/**
 * Shared utility functions — canonical implementations.
 *
 * Other modules should import from here instead of maintaining local copies.
 */

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
  let result = { ...target } as Record<string, unknown>;

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
