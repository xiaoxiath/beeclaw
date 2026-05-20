/**
 * One-time welcome banner — rendered inside Ink only when there are
 * no messages yet. After the first turn it disappears from the
 * React tree (replaced by the streaming message). That's helixent's
 * trick for a clean empty state without a permanently-burned header.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme';

const TAGLINES = [
  'What do you want to build today?',
  "What's on your mind?",
  "Let's get started.",
  'Hello, friend.',
  'Ready when you are.',
  'Type / for commands.',
];

export interface WelcomeBannerProps {
  modelLabel?: string;
  logsPath?: string;
}

export function WelcomeBanner({ modelLabel, logsPath }: WelcomeBannerProps): React.ReactElement {
  // Pick a random tagline once per mount.
  const tagline = React.useMemo(
    () => TAGLINES[Math.floor(Math.random() * TAGLINES.length)] ?? TAGLINES[0]!,
    [],
  );

  return (
    <Box flexDirection="row" columnGap={2} marginBottom={1}>
      <Logo />
      <Box flexDirection="column">
        <Box columnGap={1}>
          <Text bold color={theme.primary}>🐝 Beeclaw</Text>
        </Box>
        {modelLabel && (
          <Text color={theme.dim}>model: {modelLabel}</Text>
        )}
        {logsPath && (
          <Text color={theme.dim}>logs: {logsPath}</Text>
        )}
        <Box marginTop={1}>
          <Text color={theme.dim}>{tagline}  ·  type / for commands  ·  meta+enter for newline</Text>
        </Box>
      </Box>
    </Box>
  );
}

function Logo(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color={theme.primary}>  ▋▋ ▋▋ </Text>
      <Text color={theme.primary}>▐▛███▜▌</Text>
      <Text color={theme.primary}>▝▜███▛▘</Text>
    </Box>
  );
}
