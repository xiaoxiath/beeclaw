/**
 * AskUserQuestion Tool for HITL (Human-in-the-Loop) System
 *
 * Allows the AI agent to request information, clarification, or decisions from users.
 */

import type { ToolResult } from '../agent/types';
import type { UserContext } from '../agent/types';

export interface AskUserQuestionParams {
  question: string;
  options?: string[];
  context?: string;
  inputType?: 'text' | 'choice' | 'confirmation' | 'multi_choice';
}

/**
 * Tool definition in simple format (for builtinTools registry)
 */
export const askUserQuestionTool = {
  name: 'ask_user_question',
  description:
    'Ask the user for information, clarification, or decision when needed. ' +
    'Use this tool when you lack necessary information, encounter ambiguity, ' +
    'or need the user to make a decision. This will pause execution until the user responds.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user. Be specific and clear.',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of choices for the user. Use this for decision making. ' +
          'If provided, the user will select from these options.',
      },
      context: {
        type: 'string',
        description:
          'Additional context explaining why this information is needed. ' +
          'Helps the user understand the purpose of the question.',
      },
      inputType: {
        type: 'string',
        description:
          'Type of input expected: ' +
          '"text" for free-form input, ' +
          '"choice" for single selection from options, ' +
          '"confirmation" for yes/no questions, ' +
          '"multi_choice" for multiple selections from options. ' +
          'Defaults to "text" if not specified.',
      },
    },
    required: ['question'],
  },
};

/**
 * Execute the ask_user_question tool
 *
 * Returns a special result that signals the agent to wait for user input.
 */
export async function executeAskUserQuestion(
  params: AskUserQuestionParams,
  _context?: UserContext
): Promise<ToolResult> {
  // Validate params
  if (!params.question || params.question.trim().length === 0) {
    return {
      success: false,
      error: 'Question cannot be empty',
    };
  }

  // Validate options if provided
  if (params.options && params.options.length === 0) {
    return {
      success: false,
      error: 'Options array cannot be empty if provided',
    };
  }

  // Validate inputType matches options
  if (params.inputType === 'choice' || params.inputType === 'multi_choice') {
    if (!params.options || params.options.length === 0) {
      return {
        success: false,
        error: `inputType "${params.inputType}" requires options to be provided`,
      };
    }
  }

  // Return special result to signal HITL
  return {
    success: false, // Mark as "not completed" (waiting for input)
    needsUserInput: true, // HITL signal
    question: params.question,
    options: params.options,
    context: params.context,
    inputType: params.inputType || 'text',
    message: `Waiting for user input: ${params.question}`,
  };
}
