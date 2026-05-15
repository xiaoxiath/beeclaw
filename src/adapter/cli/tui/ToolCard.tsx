/**
 * Renders a single tool event as a two-line card:
 *
 *   ⏺ <description>            ← magenta marker, friendly name
 *   └─ <key>: "<value>"        ← dim detail line (key params abbreviated)
 *   ✓ <result summary>         ← shown only when result is in
 *
 * Result summaries are deliberately short and dim — full results are
 * usually long JSON the user shouldn't have to scroll past. The agent's
 * follow-up assistant message typically summarizes them anyway.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme';
import { describeToolCall, formatToolDetail, formatToolResult } from './tool-format';

export interface ToolCardProps {
  name: string;
  params: Record<string, unknown>;
  result?: unknown;
  resolved?: boolean;
}

export function ToolCard({ name, params, result, resolved }: ToolCardProps): React.ReactElement {
  const description = describeToolCall(name);
  const detail = formatToolDetail(name, params);
  const summary = resolved ? formatToolResult(result) : null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Text color={theme.tool} bold>{'⏺ '}</Text>
        <Text>{description}</Text>
        <Text color={theme.dim}>{`  (${name})`}</Text>
      </Box>
      {detail && (
        <Box flexDirection="row">
          <Text color={theme.dim}>{'  └─ '}</Text>
          <Text color={theme.dim}>{detail}</Text>
        </Box>
      )}
      {summary !== null && (
        <Box flexDirection="row">
          <Text color={theme.highlight}>{'  ✓ '}</Text>
          <Text color={theme.dim}>{summary}</Text>
        </Box>
      )}
      {!resolved && (
        <Box flexDirection="row">
          <Text color={theme.dim}>{'  … '}</Text>
          <Text color={theme.dim}>(running)</Text>
        </Box>
      )}
    </Box>
  );
}
