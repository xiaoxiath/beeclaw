/**
 * Pure formatters for tool events from agent.chatStream.
 *
 * The previous REPL printed `[tool] name {raw json}` which truncated
 * mid-string and leaked ANSI codes. These helpers produce structured,
 * scannable output:
 *
 *   ⏺ Searching the web                ← description (1st line)
 *   └─ query: "Bun runtime features"   ← key detail (2nd line)
 *   ✓ 5 results in 1.2s                ← result summary (when known)
 *
 * All functions are pure so unit tests can pin output without spinning
 * up React.
 */

const MAX_PARAM_VALUE_CHARS = 80;
const MAX_DETAIL_LINE_CHARS = 100;

/**
 * Truncate a string with an ellipsis when it exceeds the limit.
 * Preserves opening quote / paren style so the abbreviated form
 * still reads natural ("Bun runti…").
 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Pretty-print a single param value for the detail line. Strings get
 * quoted, objects/arrays get a compact JSON, everything else its
 * String() form.
 */
export function formatParamValue(value: unknown, max: number = MAX_PARAM_VALUE_CHARS): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(truncate(value, max));
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Objects / arrays — compact JSON, then truncate as a whole.
  try {
    return truncate(JSON.stringify(value), max);
  } catch {
    return '[unserializable]';
  }
}

/**
 * Map a tool name to a human-friendly first-line label. Unknown tools
 * fall back to the name verbatim with under_scores → spaces.
 */
const TOOL_LABELS: Record<string, string> = {
  web_search: 'Searching the web',
  web_fetch: 'Fetching URL',
  deep_research: 'Deep research',
  request_deep_analysis: 'Requesting deep analysis',
  shell: 'Running shell command',
  spawn_subagent: 'Spawning subagent',
  spawn_parallel: 'Spawning parallel subagents',
  memory_read: 'Reading memory',
  memory_write: 'Writing memory',
  memory_grep: 'Searching memory',
  memory_ls: 'Listing memory',
  memory_record: 'Recording memory fact',
  memory_search: 'Searching memory (keyword)',
  memory_semantic_search: 'Searching memory (semantic)',
  skill_get: 'Loading skill',
  skill_list: 'Listing skills',
  goal_create: 'Creating goal',
  goal_list: 'Listing goals',
  ask_user_question: 'Asking you a question',
  create_chart: 'Creating chart',
  code_execute: 'Executing code',
};

export function describeToolCall(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
}

/**
 * Pick the most informative single field from a tool's params for the
 * `└─ ` detail line. Falls back to the first scalar param if no known
 * "key" field is present.
 */
const KEY_FIELDS_BY_TOOL: Record<string, string[]> = {
  web_search: ['query'],
  web_fetch: ['url'],
  deep_research: ['topic', 'query'],
  shell: ['command'],
  spawn_subagent: ['task', 'type'],
  spawn_parallel: ['tasks'],
  memory_read: ['path'],
  memory_write: ['path'],
  memory_grep: ['query', 'path'],
  memory_ls: ['path'],
  memory_record: ['fact', 'category'],
  memory_search: ['query'],
  memory_semantic_search: ['query'],
  skill_get: ['name'],
  goal_create: ['title'],
  ask_user_question: ['question'],
  create_chart: ['type'],
  code_execute: ['language', 'code'],
};

/** Generic fallback: pick first scalar field worth showing. */
function pickFallbackKey(params: Record<string, unknown>): string | null {
  const candidates = ['name', 'path', 'query', 'task', 'title', 'message', 'content'];
  for (const k of candidates) {
    if (k in params) return k;
  }
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return k;
  }
  return null;
}

/**
 * Build the `└─ key: "value"` detail line for a tool call. Returns
 * empty string when no useful field exists (caller should omit).
 */
export function formatToolDetail(name: string, params: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return '';
  const known = KEY_FIELDS_BY_TOOL[name];
  if (known) {
    for (const k of known) {
      if (k in params) {
        const line = `${k}: ${formatParamValue(params[k])}`;
        return truncate(line, MAX_DETAIL_LINE_CHARS);
      }
    }
  }
  const fallback = pickFallbackKey(params);
  if (!fallback) return '';
  const line = `${fallback}: ${formatParamValue(params[fallback])}`;
  return truncate(line, MAX_DETAIL_LINE_CHARS);
}

/**
 * Produce a one-line summary of a tool result. Strings get truncated
 * with their length annotated; objects with `success`/`error` get
 * structural treatment.
 */
export function formatToolResult(result: unknown): string {
  if (result === undefined || result === null) return 'done';
  if (typeof result === 'string') {
    if (result.length === 0) return 'done (empty)';
    if (result.length <= 60) return result;
    return `${result.length} chars`;
  }
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (r.success === false) {
      const err = typeof r.error === 'string' ? r.error : 'failed';
      return `error: ${truncate(err, 60)}`;
    }
    if (r.success === true) {
      // Try to find a short summary field.
      for (const k of ['summary', 'message', 'output']) {
        if (typeof r[k] === 'string' && (r[k] as string).length <= 60) return r[k] as string;
      }
      return 'ok';
    }
    if (Array.isArray(result)) return `${result.length} items`;
    return `${Object.keys(r).length} fields`;
  }
  return String(result);
}
