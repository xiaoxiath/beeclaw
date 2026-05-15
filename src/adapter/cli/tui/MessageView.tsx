/**
 * Single chat message renderer.
 *
 * User messages: cyan ❯ marker + the typed text (no markdown — user
 * input is shown verbatim so they can see exactly what they sent).
 *
 * Assistant messages: green ⏺ marker + content piped through
 * marked-terminal so code blocks, lists, bold, etc. render properly.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme';
import { renderMarkdown } from './markdown';
import type { ChatMessage } from './messages';

export interface MessageViewProps {
  message: ChatMessage;
}

export function MessageView({ message }: MessageViewProps): React.ReactElement {
  if (message.role === 'user') {
    return (
      <Box flexDirection="row" marginBottom={1}>
        <Text color={theme.user} bold>{'❯ '}</Text>
        <Box flexDirection="column" flexGrow={1}>
          <Text>{message.content}</Text>
        </Box>
      </Box>
    );
  }

  // Assistant: render markdown to ANSI text and let Ink show as one
  // <Text> block. ANSI escapes pass through Ink unchanged.
  const rendered = renderMarkdown(message.content);
  return (
    <Box flexDirection="row" marginBottom={1}>
      <Text color={theme.highlight} bold>{'⏺ '}</Text>
      <Box flexDirection="column" flexGrow={1}>
        <Text>{rendered}</Text>
      </Box>
    </Box>
  );
}
