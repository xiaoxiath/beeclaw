/**
 * Subagent System Prompts
 *
 * Prompts are generated from role profiles so runtime permissions, role
 * descriptions, and output contracts stay aligned.
 */

import {
  SUBAGENT_PROFILES,
  SUBAGENT_TYPE_VALUES,
  getSubagentProfile,
  resolveSubagentRole,
  type SubagentProfile,
  type SubagentType,
} from './types';

function bulletList(items: string[]): string {
  if (items.length === 0) return '- none';
  return items.map((item) => `- ${item}`).join('\n');
}

function inlineTools(tools: string[]): string {
  return tools.length > 0 ? tools.map((tool) => `\`${tool}\``).join(', ') : 'none';
}

function buildRolePrompt(profile: SubagentProfile): string {
  const output = profile.outputContract;

  return `You are ${profile.displayName}, a specialized Beeclaw subagent.

## Role
${profile.description}

## Why You Exist
You are only useful when your task benefits from isolation, focused expertise, parallelism, independent review, or constrained permissions. You are not a general chat assistant and you do not own the final user answer.

## When To Use This Role
${bulletList(profile.whenToUse)}

## When Not To Use This Role
${bulletList(profile.whenNotToUse)}

## Tool Permissions
Allowed tools: ${inlineTools(profile.allowedTools)}
Disallowed tools: ${inlineTools(profile.disallowedTools)}
Write access: ${profile.permissions.writeAccess ? 'allowed only within explicit ownership/scope' : 'not allowed'}
Can spawn subagents: ${profile.permissions.canSpawnSubagents ? 'yes' : 'no'}
Maximum tool calls: ${profile.permissions.maxToolCalls}
Maximum runtime: ${Math.round(profile.permissions.maxRuntimeMs / 1000)} seconds

If you need a disallowed tool or broader permissions, stop and report what permission is needed. Do not work around the restriction.

## Operating Rules
1. Work only on the assigned local task. Do not take over the user conversation.
2. Keep context isolated: use only the task, provided context, and evidence you gather.
3. Prefer read-heavy evidence gathering before action. For worker tasks, edit only explicitly owned files or paths.
4. Do not spawn other agents unless the runtime explicitly gives you spawn tools.
5. If blocked, return partial results with the blocker and the smallest next action.
6. Distinguish facts from inferences. Do not claim verification you did not perform.
7. Keep the output concise and directly usable by the main agent.

## Output Contract
Return this structure in plain text:

status: success | partial | failed
summary: ${output.summary}
findings:
  - ${output.findings}
verified:
  - ${output.verified}
not_verified:
  - ${output.notVerified}
next_action: ${output.nextAction}
`;
}

/**
 * Prompts for all accepted type names. Legacy aliases resolve to the preferred
 * role prompt so callers can migrate gradually.
 */
export const SUBAGENT_PROMPTS: Record<SubagentType, string> = SUBAGENT_TYPE_VALUES.reduce(
  (acc, type) => {
    acc[type] = buildRolePrompt(SUBAGENT_PROFILES[resolveSubagentRole(type)]);
    return acc;
  },
  {} as Record<SubagentType, string>,
);

/**
 * Get the system prompt for a subagent type.
 */
export function getSubagentPrompt(type: SubagentType): string {
  return SUBAGENT_PROMPTS[type];
}

/**
 * Build a complete system prompt with task context and task-specific contract.
 */
export function buildSubagentSystemPrompt(
  type: SubagentType,
  task: string,
  context?: string,
  options?: {
    expectedOutput?: string;
    successCriteria?: string[];
    ownership?: string[];
    constraints?: string[];
    toolNames?: string[];
  },
): string {
  const profile = getSubagentProfile(type);
  let prompt = getSubagentPrompt(type);

  prompt += `\n\n---\n\n# Your Task\n\n${task}`;

  if (context) {
    prompt += `\n\n---\n\n# Context\n\n${context}`;
  }

  if (options?.ownership?.length) {
    prompt += `\n\n---\n\n# Ownership Boundary\n\n${bulletList(options.ownership)}`;
  }

  if (options?.constraints?.length) {
    prompt += `\n\n---\n\n# Additional Constraints\n\n${bulletList(options.constraints)}`;
  }

  if (options?.successCriteria?.length) {
    prompt += `\n\n---\n\n# Success Criteria\n\n${bulletList(options.successCriteria)}`;
  }

  if (options?.expectedOutput) {
    prompt += `\n\n---\n\n# Expected Output\n\n${options.expectedOutput}`;
  }

  if (options?.toolNames) {
    prompt += `\n\n---\n\n# Runtime Tool Envelope\n\nYou were actually granted these tools: ${inlineTools(options.toolNames)}. If this differs from the role description, obey the runtime tool envelope.`;
  }

  if (profile.role === 'worker' && !options?.ownership?.length) {
    prompt += '\n\nImportant: No explicit file ownership was provided. Do not make broad edits. If the edit scope is unclear, return status: partial and ask the main agent to provide ownership.';
  }

  return prompt;
}
