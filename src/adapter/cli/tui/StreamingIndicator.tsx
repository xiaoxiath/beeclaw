/**
 * Animated streaming indicator — shown while a chat turn is busy.
 *
 * Rotating glyph + shimmering label. The animation runs inside this
 * leaf component so its frequent setState (every ~120ms) only re-renders
 * THIS component, not the surrounding App. That's the key trick: in the
 * old design we had ink-spinner inside Footer, which forced Ink to
 * redraw the whole dynamic region 8×/second and produced tombstones.
 *
 * Modeled on helixent's StreamingIndicator.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme';
import { useAnimationFrame } from './use-animation-frame';

const LABELS = [
  'Thinking…',
  'Working…',
  'Processing…',
  'Reasoning…',
  'Almost there…',
];

const FRAMES = process.platform === 'darwin'
  ? ['·', '✢', '✳', '✶', '✻', '✽']
  : ['·', '✢', '*', '✶', '✻', '✽'];

const SPINNER = [...FRAMES, ...[...FRAMES].reverse()];
const SHIMMER_WIDTH = 3;

export interface StreamingIndicatorProps {
  active: boolean;
  /** Optional phase override (e.g. "calling weather…") shown after the spinner. */
  phase?: string;
}

export function StreamingIndicator({ active, phase }: StreamingIndicatorProps): React.ReactElement | null {
  const label = useMemo(
    () => phase ?? LABELS[Math.floor(Math.random() * LABELS.length)] ?? 'Thinking…',
    [phase],
  );
  const time = useAnimationFrame(active ? 120 : null);

  if (!active) return null;

  const spinnerChar = SPINNER[Math.floor(time / 120) % SPINNER.length]!;
  const cycle = label.length + SHIMMER_WIDTH * 2;
  const pos = Math.floor(time / 100) % cycle;
  const shimmerStart = pos - SHIMMER_WIDTH;
  const shimmerEnd = pos + SHIMMER_WIDTH;

  return (
    <Box columnGap={1} marginBottom={1}>
      <Text color={theme.primary}>{spinnerChar}</Text>
      <Shimmer text={label} start={shimmerStart} end={shimmerEnd} />
    </Box>
  );
}

function Shimmer({ text, start, end }: { text: string; start: number; end: number }): React.ReactElement {
  if (start >= text.length || end < 0) {
    return <Text color={theme.dim}>{text}</Text>;
  }
  const lo = Math.max(0, start);
  const hi = Math.min(text.length, end);
  return (
    <Text>
      {lo > 0 && <Text color={theme.dim}>{text.slice(0, lo)}</Text>}
      <Text color={theme.primary} bold>{text.slice(lo, hi)}</Text>
      {hi < text.length && <Text color={theme.dim}>{text.slice(hi)}</Text>}
    </Text>
  );
}
