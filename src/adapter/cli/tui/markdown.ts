/**
 * Render markdown to ANSI-colored terminal text.
 *
 * Wraps `marked` + `marked-terminal` v7 with a single render() entry
 * point so the TUI components don't need to know about the renderer
 * config. We register the terminal renderer once at import time —
 * marked uses module-global state, so calling marked.use() repeatedly
 * stacks renderers and slows successive parses.
 *
 * Output is intentionally ANSI text (not Ink components). It's printed
 * via Ink's <Text> as a single string OR flushed to scrollback via
 * stdout.write(). Using ANSI keeps the rendering loop O(content) and
 * avoids Ink re-laying-out a deep AST every keystroke.
 */

import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  // Defaults are sensible: bold for **, dim for blockquotes, syntax-
  // highlighted code blocks via cli-highlight (bundled with
  // marked-terminal). The empty options object is intentional — the
  // upstream defaults are tuned for terminals.
  marked.use(markedTerminal() as any);
  registered = true;
}

/**
 * Render markdown content to terminal ANSI text. Trailing newlines
 * are normalized to a single \n so the output composes cleanly into
 * the TUI message list.
 */
export function renderMarkdown(content: string): string {
  if (!content) return '';
  ensureRegistered();
  const out = marked.parse(content) as string;
  return out.replace(/\n+$/, '\n');
}
