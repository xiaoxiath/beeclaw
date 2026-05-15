/**
 * Floating slash-command picker.
 *
 * Rendered above the input row when the buffer starts with '/'. Shows
 * up to N matches ranked by command-scorer. The InputEditor handles
 * arrow keys + Tab/Enter — this component is render-only.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme';
import type { ScoredCommand } from './command-scorer';

export interface CommandPickerProps {
  matches: readonly ScoredCommand[];
  /** Index of the currently-highlighted row (0-based). */
  selectedIndex: number;
}

export function CommandPicker({ matches, selectedIndex }: CommandPickerProps): React.ReactElement | null {
  if (matches.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1} marginBottom={1}>
      {matches.map((sc, idx) => {
        const isSelected = idx === selectedIndex;
        const namePrefix = isSelected ? '▸ ' : '  ';
        const nameColor = isSelected ? theme.primary : theme.user;
        const kindLabel = sc.command.kind === 'skill' ? '[skill]' : '[builtin]';
        return (
          <Box key={sc.command.name} flexDirection="row">
            <Text color={isSelected ? theme.primary : theme.dim}>{namePrefix}</Text>
            <Text color={nameColor} bold={isSelected}>{`/${sc.command.name}`}</Text>
            <Text color={theme.dim}>{`  ${kindLabel}  ${sc.command.description}`}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
