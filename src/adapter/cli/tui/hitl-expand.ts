/**
 * Pure helper: when a HITL prompt has options and the user replies
 * with a single digit (1..N), expand it to "Option N: <option text>"
 * so the model gets a self-explanatory answer rather than a bare "1".
 *
 * Anything that's not a valid 1..N digit answer passes through verbatim.
 */

export function expandHitlAnswer(
  answer: string,
  options: readonly string[] | undefined,
): string {
  if (!options || options.length === 0) return answer;
  const trimmed = answer.trim();
  if (!/^\d+$/.test(trimmed)) return answer;
  const n = parseInt(trimmed, 10);
  if (n < 1 || n > options.length) return answer;
  return `Option ${n}: ${options[n - 1]}`;
}
