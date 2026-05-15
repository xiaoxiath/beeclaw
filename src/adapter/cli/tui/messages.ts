/**
 * Message data model for the TUI's chat history.
 *
 * Kept minimal on purpose — the agent layer already has rich types,
 * but the TUI only needs role + content for rendering. Tool events
 * are handled separately (PR3) since they have their own card layout.
 */

/** A user-submitted line OR a fully-streamed assistant response. */
export interface ChatMessage {
  /** Stable id (used as React key — message index works for now). */
  id: number;
  role: 'user' | 'assistant';
  /** Final text content. For assistant, this is the full streamed text. */
  content: string;
}

/**
 * Generate the next message id given the current history. Pure helper
 * so tests can verify ordering without spinning up the React tree.
 */
export function nextMessageId(messages: readonly ChatMessage[]): number {
  if (messages.length === 0) return 1;
  return messages[messages.length - 1].id + 1;
}
