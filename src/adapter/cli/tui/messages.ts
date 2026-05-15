/**
 * Message data model for the TUI's chat history.
 *
 * Discriminated union covers the three kinds of entries the TUI
 * renders. Tool entries hold their params at call time and update
 * with `result` when the matching tool_result event arrives.
 */

export type ChatMessage =
  | { id: number; kind: 'user'; content: string }
  | { id: number; kind: 'assistant'; content: string }
  | {
      id: number;
      kind: 'tool';
      name: string;
      params: Record<string, unknown>;
      /** Set once the matching tool_result event arrives. */
      result?: unknown;
      /** True after a tool_result has been folded in (vs still pending). */
      resolved?: boolean;
    };

/**
 * Generate the next message id given the current history. Pure helper
 * so tests can verify ordering without spinning up the React tree.
 */
export function nextMessageId(messages: readonly ChatMessage[]): number {
  if (messages.length === 0) return 1;
  return messages[messages.length - 1].id + 1;
}
