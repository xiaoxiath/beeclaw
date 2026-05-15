/**
 * Compact human-readable token count formatter.
 *
 * 999      → "999"
 * 12345    → "12.3k"
 * 1234567  → "1.23M"
 *
 * Pure helper so unit tests can pin behavior without React.
 */

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.floor(n));
  if (n < 10_000) {
    // 1.23k for tight precision below 10k
    const rounded = Math.round(n / 10) / 100;
    return `${rounded.toFixed(2)}k`;
  }
  if (n < 1_000_000) {
    const rounded = Math.round(n / 100) / 10;
    return `${rounded.toFixed(1)}k`;
  }
  const rounded = Math.round(n / 10_000) / 100;
  return `${rounded.toFixed(2)}M`;
}
