/**
 * Single chat-history entry renderer. Dispatches on `kind`:
 *   user      → cyan ❯ marker + verbatim text (no markdown)
 *   assistant → green ⏺ marker + markdown-rendered ANSI text
 *   tool      → ToolCard (PR3)
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme';
import { renderMarkdown } from './markdown';
import { ToolCard } from './ToolCard';
import type { ChatMessage } from './messages';

export interface MessageViewProps {
  message: ChatMessage;
}

export function MessageView({ message }: MessageViewProps): React.ReactElement {
  if (message.kind === 'user') {
    return (
      <Box flexDirection="row" marginBottom={1}>
        <Text color={theme.user} bold>{'❯ '}</Text>
        <Box flexDirection="column" flexGrow={1}>
          <Text>{message.content}</Text>
        </Box>
      </Box>
    );
  }

  if (message.kind === 'tool') {
    return (
      <ToolCard
        name={message.name}
        params={message.params}
        result={message.result}
        resolved={message.resolved}
      />
    );
  }

  // assistant
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
