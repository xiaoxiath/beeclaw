/**
 * Bottom status bar — minimalist, model on the left, tokens on the right.
 *
 * The animated busy indicator no longer lives here (it was triggering
 * 8 re-renders per second via ink-spinner and producing tombstones).
 * The indicator is rendered separately by <StreamingIndicator/> in
 * App.tsx — animation re-renders are localized to that leaf.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme';
import { formatTokenCount } from './format-tokens';

export type FooterStatus = 'idle' | 'busy' | 'exiting';

export interface FooterProps {
  modelLabel?: string;
  totalTokens?: number;
  status: FooterStatus;
  /** Unused now — kept for backwards-compat; phase is shown by StreamingIndicator. */
  phase?: string;
}

export function Footer({ modelLabel, totalTokens }: FooterProps): React.ReactElement {
  const tokenLabel = totalTokens !== undefined && totalTokens > 0
    ? `${formatTokenCount(totalTokens)} tokens`
    : '';

  return (
    <Box flexDirection="row" paddingX={1}>
      <Box flexGrow={1}>
        <Text color={theme.dim}>
          {modelLabel ? modelLabel : ''}
        </Text>
      </Box>
      <Box>
        <Text color={theme.dim}>{tokenLabel}</Text>
      </Box>
    </Box>
  );
}
