/**
 * Human-in-the-loop prompt panel.
 *
 * When a tool emits `needsUserInput: true` in its result (typically the
 * built-in `ask_user_question` tool), this component surfaces the
 * question prominently above the input row. The next user submission
 * automatically becomes the answer — no separate dispatch path needed
 * because the agent already has the question in conversation context.
 *
 * For choice / multi_choice inputType: number keys (1..N) select the
 * Nth option directly via App's onPickOption handler. Free-text is
 * always allowed as fallback.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme';

export interface HitlSignal {
  question: string;
  options?: string[];
  /** 'text' | 'choice' | 'multi_choice' (only 'text' / 'choice' rendered specially). */
  inputType?: string;
  /** Optional supporting context to display alongside the question. */
  context?: string;
}

export interface HitlPromptProps {
  signal: HitlSignal;
}

export function HitlPrompt({ signal }: HitlPromptProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.warn}
      paddingX={1}
      marginBottom={1}
    >
      <Box flexDirection="row" marginBottom={1}>
        <Text color={theme.warn} bold>{'? '}</Text>
        <Text bold>{signal.question}</Text>
      </Box>

      {signal.context && (
        <Box marginBottom={1}>
          <Text color={theme.dim}>{signal.context}</Text>
        </Box>
      )}

      {signal.options && signal.options.length > 0 && (
        <Box flexDirection="column">
          {signal.options.map((opt, i) => (
            <Box key={i} flexDirection="row">
              <Text color={theme.primary} bold>{`  ${i + 1}. `}</Text>
              <Text>{opt}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text color={theme.dim}>
              press a number to pick an option, or type a free-text answer + Enter
            </Text>
          </Box>
        </Box>
      )}

      {(!signal.options || signal.options.length === 0) && (
        <Box>
          <Text color={theme.dim}>type your answer + Enter</Text>
        </Box>
      )}
    </Box>
  );
}
