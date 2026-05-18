/**
 * Bottom status bar.
 *
 * Layout (single line, full terminal width):
 *
 *   model: openai-codex / gpt-5.3-codex      ⏳ working…       12.3k tokens
 *   └─ left ─────────────────────────────────┘└ center ─┘└── right ──┘
 *
 * Centered region shows a STATIC busy marker + phase label only when busy.
 * We deliberately do NOT use ink-spinner's animated spinner — its internal
 * setInterval triggers a setState every ~80ms, which forces Ink to re-render
 * the dynamic region on every tick. During a 3-second turn that's ~37
 * re-renders, and each one risks leaving a `> ` tombstone in scrollback
 * after a recent <Static> commit shifted the dynamic region's tracked
 * position. A static glyph + text gives the same "something is happening"
 * signal at zero render cost.
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

      {/* Center: static busy marker + phase. flexGrow absorbs the middle. */}
      <Box flexGrow={1} justifyContent="center">
        {status !== 'idle' && phaseLabel && (
          <Text color={theme.dim}>
            <Text color={theme.primary}>⏳</Text>{` ${phaseLabel}`}
          </Text>
        )}
      </Box>

      {/* Right: tokens. */}
      <Box flexShrink={0}>
        <Text color={theme.dim}>{tokenLabel}</Text>
      </Box>
    </Box>
  );
}
