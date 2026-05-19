/**
 * Serialize a ChatMessage to ANSI plain text — used by the scrollback
 * flusher in App.tsx. Messages older than "current" are dumped to
 * stdout via useStdout().write() and live in terminal scrollback,
 * outside Ink's tracked render area. Ink's dynamic region only ever
 * holds the CURRENT message (plus indicator + input), so resizing
 * never confuses Ink's diff and no tombstones can form.
 *
 * Mirrors the visual output of MessageView.tsx / ToolCard.tsx but
 * emits ANSI strings instead of an Ink component tree. We keep them
 * deliberately parallel (not auto-derived) — the React renderer can
 * use richer layout primitives, while plain text is line-oriented.
 */

import { renderMarkdown } from './markdown';
import { describeToolCall, formatToolDetail, formatToolResult } from './tool-format';
import type { ChatMessage } from './messages';

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;

// 24-bit ANSI; falls back to plain text if hex is malformed.
function color(hex: string, s: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return s;
  const [, r, g, b] = m;
  return `${ESC}38;2;${parseInt(r, 16)};${parseInt(g, 16)};${parseInt(b, 16)}m${s}${RESET}`;
}

// We re-import the theme via dynamic lookup to keep this module
// importable from test environments that stub theme.
import { theme } from './theme';

const userMarker = `${BOLD}${color(theme.user, '❯')}${RESET}`;
const assistantMarker = `${BOLD}${color(theme.highlight, '⏺')}${RESET}`;
const toolMarker = `${BOLD}${color(theme.tool, '⏺')}${RESET}`;
const dimMark = (s: string) => `${DIM}${s}${RESET}`;

export function messageToPlainText(message: ChatMessage): string | null {
  switch (message.kind) {
    case 'user':
      return `${userMarker} ${message.content}`;
    case 'assistant':
      if (!message.content) return null;
      // marked-terminal already emits ANSI; we just prepend the marker.
      // The rendered text usually ends with \n — trim trailing whitespace
      // to keep the scrollback tight.
      return `${assistantMarker} ${renderMarkdown(message.content).replace(/\s+$/, '')}`;
    case 'tool':
      return toolCardText(message);
  }
}

function toolCardText(m: Extract<ChatMessage, { kind: 'tool' }>): string {
  const description = describeToolCall(m.name);
  const detail = formatToolDetail(m.name, m.params);
  const summary = m.resolved ? formatToolResult(m.result) : null;

  const lines: string[] = [];
  lines.push(`${toolMarker} ${description}${dimMark(`  (${m.name})`)}`);
  if (detail) {
    lines.push(`  ${dimMark(`└─ ${detail}`)}`);
  }
  if (summary !== null) {
    lines.push(`  ${color(theme.highlight, '✓')} ${dimMark(summary)}`);
  } else if (!m.resolved) {
    lines.push(`  ${dimMark('… (running)')}`);
  }
  return lines.join('\n');
}
