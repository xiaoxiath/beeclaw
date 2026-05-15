/**
 * Centralized color theme — every TUI component imports from here.
 * Easy to re-skin, easy to ensure consistency. ANSI color names are
 * what Ink's <Text color> accepts (chalk-style).
 */

export interface TuiTheme {
  /** Primary brand color: banners, prompt indicator, command picker focus. */
  primary: string;
  /** Soft accent for secondary text (model name, hints). */
  secondary: string;
  /** Highlight: assistant marker, completed tool-call marker. */
  highlight: string;
  /** User-facing input text + user message marker. */
  user: string;
  /** Tool-call markers + tool name. */
  tool: string;
  /** Warnings (HITL approval, recoverable errors). */
  warn: string;
  /** Hard errors (turn-failed). */
  error: string;
  /** Dim — sub-detail lines, hint footer, log path. */
  dim: string;
  /** Box border color. */
  border: string;
}

/** Default theme. PR6 may add a config knob to override. */
export const theme: TuiTheme = {
  primary: 'cyan',
  secondary: 'gray',
  highlight: 'green',
  user: 'cyan',
  tool: 'magenta',
  warn: 'yellow',
  error: 'red',
  dim: 'gray',
  border: 'gray',
};
