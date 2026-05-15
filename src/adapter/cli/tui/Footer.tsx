/**
 * Bottom status bar.
 *
 * Layout (single line, full terminal width):
 *
 *   model: openai-codex / gpt-5.3-codex      ⠹ working…       12.3k tokens
 *   └─ left ─────────────────────────────────┘└ center ─┘└── right ──┘
 *
 * Centered region shows the spinner + phase label only when busy.
 * Token count snapshot is supplied via prop so the Footer stays pure
 * (App handles polling — re-renders on every turn-end).
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from './theme';
import { formatTokenCount } from './format-tokens';

export type FooterStatus = 'idle' | 'busy' | 'exiting';

export interface FooterProps {
  modelLabel?: string;
  totalTokens?: number;
  status: FooterStatus;
  /** Phase label shown next to the spinner. */
  phase?: string;
}

export function Footer({ modelLabel, totalTokens, status, phase }: FooterProps): React.ReactElement {
  const tokenLabel = totalTokens !== undefined && totalTokens > 0
    ? `${formatTokenCount(totalTokens)} tokens`
    : '';
  const phaseLabel = phase ?? (status === 'busy' ? 'working…' : status === 'exiting' ? 'exiting…' : '');

  return (
    <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
      {/* Left: model. */}
      <Box flexShrink={0}>
        <Text color={theme.dim}>
          {modelLabel ? `model: ${modelLabel}` : ''}
        </Text>
      </Box>

      {/* Center: spinner + phase. flexGrow lets it absorb the middle. */}
      <Box flexGrow={1} justifyContent="center">
        {status !== 'idle' && phaseLabel && (
          <>
            <Text color={theme.primary}>
              <Spinner type="dots" />
            </Text>
            <Text color={theme.dim}>{` ${phaseLabel}`}</Text>
          </>
        )}
      </Box>

      {/* Right: tokens. */}
      <Box flexShrink={0}>
        <Text color={theme.dim}>{tokenLabel}</Text>
      </Box>
    </Box>
  );
}
