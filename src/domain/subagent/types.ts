/**
 * Subagent Types
 *
 * Core type definitions for the subagent system.
 *
 * Design direction:
 * - A subagent is a constrained work unit, not another general assistant.
 * - Preferred roles are narrow and permission-scoped.
 * - Legacy type names are kept as aliases for compatibility.
 */

/**
 * Preferred subagent roles.
 */
export type SubagentRole =
  | 'explorer'   // Read-only codebase / data / document exploration
  | 'reviewer'   // Read-only review with findings and evidence
  | 'researcher' // Official docs / external source research
  | 'triager'    // Logs, tests, incidents, issue diagnosis
  | 'worker'     // Bounded implementation within explicit ownership
  | 'verifier'   // Test/build/behavior verification
  | 'memory'     // Memory operations, knowledge management
  | 'skill';     // Skill creation, execution, evaluation

/**
 * Legacy names accepted by existing callers.
 */
export type LegacySubagentType =
  | 'research'   // Alias for researcher
  | 'code'       // Alias for worker
  | 'general';   // Alias for explorer; no longer means full tool access

export type SubagentType = SubagentRole | LegacySubagentType;

export type SubagentStatus = 'success' | 'partial' | 'failed';

export interface SubagentPermissionProfile {
  writeAccess: boolean;
  canSpawnSubagents: boolean;
  maxToolCalls: number;
  maxRuntimeMs: number;
}

export interface SubagentOutputContract {
  summary: string;
  findings: string;
  verified: string;
  notVerified: string;
  nextAction: string;
}

export interface SubagentProfile {
  role: SubagentRole;
  displayName: string;
  description: string;
  whenToUse: string[];
  whenNotToUse: string[];
  allowedTools: string[];
  disallowedTools: string[];
  permissions: SubagentPermissionProfile;
  outputContract: SubagentOutputContract;
}

export const SUBAGENT_ROLE_VALUES: SubagentRole[] = [
  'explorer',
  'reviewer',
  'researcher',
  'triager',
  'worker',
  'verifier',
  'memory',
  'skill',
];

export const LEGACY_SUBAGENT_TYPE_ALIASES: Record<LegacySubagentType, SubagentRole> = {
  research: 'researcher',
  code: 'worker',
  general: 'explorer',
};

export const SUBAGENT_TYPE_VALUES: SubagentType[] = [
  ...SUBAGENT_ROLE_VALUES,
  'research',
  'code',
  'general',
];

export const SUBAGENT_PROFILES: Record<SubagentRole, SubagentProfile> = {
  explorer: {
    role: 'explorer',
    displayName: 'Explorer',
    description: 'Read-only codebase, data, and document mapper that returns evidence and paths.',
    whenToUse: [
      'Need to understand module structure, call chains, file ownership, or existing behavior',
      'Need evidence before deciding whether implementation or review work is needed',
      'Multiple independent code areas can be explored in parallel',
    ],
    whenNotToUse: [
      'The task requires file edits',
      'The main agent already has enough local context',
      'The user needs direct multi-turn conversation with a specialist',
    ],
    allowedTools: ['file_read', 'file_list', 'memory_ls', 'memory_grep', 'memory_read'],
    disallowedTools: ['file_write', 'file_delete', 'shell', 'code_execute', 'spawn_subagent', 'spawn_parallel'],
    permissions: {
      writeAccess: false,
      canSpawnSubagents: false,
      maxToolCalls: 12,
      maxRuntimeMs: 120000,
    },
    outputContract: {
      summary: 'One sentence describing what was found.',
      findings: 'Paths, functions, call chains, and evidence. No speculative rewrites.',
      verified: 'Files, patterns, or commands inspected.',
      notVerified: 'Relevant areas not inspected and why.',
      nextAction: 'What the main agent should inspect, decide, or delegate next.',
    },
  },

  reviewer: {
    role: 'reviewer',
    displayName: 'Reviewer',
    description: 'Read-only reviewer that reports concrete risks with severity and evidence.',
    whenToUse: [
      'Need independent review of correctness, security, performance, concurrency, or test coverage',
      'A diff or bounded file list exists',
      'The output should be findings, not implementation',
    ],
    whenNotToUse: [
      'Pure formatting or style-only review',
      'No concrete scope is available',
      'The task requires code changes',
    ],
    allowedTools: ['file_read', 'file_list', 'memory_grep', 'memory_read'],
    disallowedTools: ['file_write', 'file_delete', 'shell', 'code_execute', 'spawn_subagent', 'spawn_parallel'],
    permissions: {
      writeAccess: false,
      canSpawnSubagents: false,
      maxToolCalls: 16,
      maxRuntimeMs: 180000,
    },
    outputContract: {
      summary: 'One sentence overall review conclusion.',
      findings: 'Severity-ordered findings with evidence, impact, recommendation, and confidence.',
      verified: 'Files/diff/tests reviewed.',
      notVerified: 'Important paths or runtime behavior not verified.',
      nextAction: 'What the main agent should fix, verify, or ask next.',
    },
  },

  researcher: {
    role: 'researcher',
    displayName: 'Researcher',
    description: 'Research and information-gathering specialist for external or documentation sources that prioritizes authoritative evidence.',
    whenToUse: [
      'Need current API behavior, official docs, version changes, or external facts',
      'Research can be isolated from code edits',
      'The result needs citations, dates, or version qualifiers',
    ],
    whenNotToUse: [
      'The answer is already available in the local repository',
      'The task requires implementation',
      'Non-authoritative sources are insufficient for the decision',
    ],
    allowedTools: ['web_search', 'web_fetch', 'file_read', 'memory_grep', 'memory_read'],
    disallowedTools: ['file_write', 'file_delete', 'shell', 'code_execute', 'spawn_subagent', 'spawn_parallel'],
    permissions: {
      writeAccess: false,
      canSpawnSubagents: false,
      maxToolCalls: 14,
      maxRuntimeMs: 180000,
    },
    outputContract: {
      summary: 'One sentence answer with date/version when relevant.',
      findings: 'Facts with source links or local file evidence; distinguish inference from source facts.',
      verified: 'Sources, docs, or files checked.',
      notVerified: 'Missing sources, inaccessible docs, or uncertain claims.',
      nextAction: 'What the main agent should verify or decide next.',
    },
  },

  triager: {
    role: 'triager',
    displayName: 'Triager',
    description: 'Read-heavy analyzer for failures, logs, tests, alerts, and incidents.',
    whenToUse: [
      'Need to classify noisy logs or test failures',
      'Multiple root-cause hypotheses can be checked independently',
      'Need symptoms separated from likely root cause',
    ],
    whenNotToUse: [
      'The next step is already a specific code edit',
      'The task requires deploying or changing production state',
      'The failure data is too incomplete to analyze',
    ],
    allowedTools: ['file_read', 'file_list', 'memory_grep', 'memory_read'],
    disallowedTools: ['file_write', 'file_delete', 'shell', 'code_execute', 'spawn_subagent', 'spawn_parallel'],
    permissions: {
      writeAccess: false,
      canSpawnSubagents: false,
      maxToolCalls: 14,
      maxRuntimeMs: 180000,
    },
    outputContract: {
      summary: 'One sentence root-cause hypothesis or classification.',
      findings: 'Symptoms, likely root cause, evidence, and noise to ignore.',
      verified: 'Logs, stack traces, tests, or files inspected.',
      notVerified: 'Missing reproduction or data.',
      nextAction: 'Smallest next diagnostic or fix candidate.',
    },
  },

  worker: {
    role: 'worker',
    displayName: 'Code Worker',
    description: 'Code implementation worker for bounded file ownership and explicit acceptance criteria.',
    whenToUse: [
      'The main agent has selected a solution and file ownership is clear',
      'The edit scope is bounded and unlikely to conflict with other workers',
      'Verification commands or acceptance criteria are known',
    ],
    whenNotToUse: [
      'The design choice is still unresolved',
      'Multiple workers would edit the same file or shared abstraction',
      'The task requires broad repository-wide refactoring without ownership',
    ],
    allowedTools: ['file_read', 'file_list', 'file_write', 'code_execute', 'shell', 'memory_read'],
    disallowedTools: ['file_delete', 'spawn_subagent', 'spawn_parallel'],
    permissions: {
      writeAccess: true,
      canSpawnSubagents: false,
      maxToolCalls: 20,
      maxRuntimeMs: 240000,
    },
    outputContract: {
      summary: 'One sentence implementation result.',
      findings: 'Files changed, rationale, and notable behavior changes.',
      verified: 'Commands/tests run and outcomes.',
      notVerified: 'Tests or behavior not checked and why.',
      nextAction: 'What the main agent should review or run next.',
    },
  },

  verifier: {
    role: 'verifier',
    displayName: 'Verifier',
    description: 'Validation worker that runs checks and reports results without broadening scope.',
    whenToUse: [
      'Need independent test/build/lint verification',
      'Need to distinguish environment failures from code failures',
      'The main agent needs a concise verification report',
    ],
    whenNotToUse: [
      'The task is to implement a fix',
      'The required command is destructive or deploys changes',
      'The validation criteria are unclear',
    ],
    allowedTools: ['file_read', 'file_list', 'shell', 'code_execute'],
    disallowedTools: ['file_write', 'file_delete', 'spawn_subagent', 'spawn_parallel'],
    permissions: {
      writeAccess: false,
      canSpawnSubagents: false,
      maxToolCalls: 10,
      maxRuntimeMs: 180000,
    },
    outputContract: {
      summary: 'One sentence pass/fail conclusion.',
      findings: 'Commands run, failures, and likely cause if any.',
      verified: 'Checks that completed successfully.',
      notVerified: 'Checks skipped or blocked and why.',
      nextAction: 'What should be fixed or re-run.',
    },
  },

  memory: {
    role: 'memory',
    displayName: 'Memory Knowledge Curator',
    description: 'Memory and Knowledge management worker with explicit read/write memory scope.',
    whenToUse: [
      'Need to search, update, or record durable knowledge',
      'Need memory cleanup or deduplication',
      'The task is about knowledge management rather than code changes',
    ],
    whenNotToUse: [
      'The task only needs transient context',
      'The user has not authorized durable memory changes',
      'The work requires broad file edits',
    ],
    allowedTools: ['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record', 'file_read'],
    disallowedTools: ['file_write', 'file_delete', 'shell', 'code_execute', 'spawn_subagent', 'spawn_parallel'],
    permissions: {
      writeAccess: true,
      canSpawnSubagents: false,
      maxToolCalls: 16,
      maxRuntimeMs: 180000,
    },
    outputContract: {
      summary: 'One sentence memory action result.',
      findings: 'Memory keys/files read, written, updated, or skipped.',
      verified: 'Follow-up reads or checks performed.',
      notVerified: 'Memory areas not checked.',
      nextAction: 'What the main agent should remember or ask before further writes.',
    },
  },

  skill: {
    role: 'skill',
    displayName: 'Skill Curator',
    description: 'Skill management worker with bounded skill files and verification.',
    whenToUse: [
      'Need to inspect, create, update, or evaluate a skill',
      'The skill scope is clear',
      'The output should include verification of the skill contract',
    ],
    whenNotToUse: [
      'The task is normal code implementation',
      'The user needs direct expert handoff',
      'The skill ownership or target path is unclear',
    ],
    allowedTools: ['skill_list', 'skill_get', 'skill_ensure', 'skill_evals', 'skill_record', 'skill_maturity', 'file_read', 'file_write'],
    disallowedTools: ['file_delete', 'shell', 'code_execute', 'spawn_subagent', 'spawn_parallel'],
    permissions: {
      writeAccess: true,
      canSpawnSubagents: false,
      maxToolCalls: 18,
      maxRuntimeMs: 240000,
    },
    outputContract: {
      summary: 'One sentence skill action result.',
      findings: 'Skill files changed or inspected and maturity/eval notes.',
      verified: 'skill_get, eval, or file checks performed.',
      notVerified: 'Skill behavior not exercised and why.',
      nextAction: 'What the main agent should review or run next.',
    },
  },
};

export function resolveSubagentRole(type: SubagentType): SubagentRole {
  return (LEGACY_SUBAGENT_TYPE_ALIASES as Partial<Record<SubagentType, SubagentRole>>)[type] || (type as SubagentRole);
}

export function getSubagentProfile(type: SubagentType): SubagentProfile {
  return SUBAGENT_PROFILES[resolveSubagentRole(type)];
}

/**
 * Configuration for spawning a subagent
 */
export interface SubagentConfig {
  /** Type of subagent (determines available tools and system prompt) */
  type: SubagentType;

  /** Task description for the subagent */
  task: string;

  /** Additional context to provide */
  context?: string;

  /** Limit available tools (optional, defaults based on type) */
  tools?: string[];

  /** Additional tools to deny for this task */
  disallowedTools?: string[];

  /** Expected output shape or deliverable */
  expectedOutput?: string;

  /** Explicit success criteria */
  successCriteria?: string[];

  /** File or module ownership boundary for worker-style tasks */
  ownership?: string[];

  /** Extra task constraints */
  constraints?: string[];

  /** Allow this subagent to receive spawn_subagent/spawn_parallel tools. Default false. */
  allowSubagentSpawn?: boolean;

  /** Maximum tokens for this subagent (optional) */
  maxTokens?: number;

  /** Timeout in milliseconds (optional, default: 60000) */
  timeout?: number;

  /** AI provider (overrides runtime default) */
  provider?: any;

  /** AI model (overrides runtime default) */
  model?: string;

  /** Unique identifier for this subagent */
  id?: string;

  /** AbortSignal for cooperative cancellation */
  signal?: AbortSignal;
}

/**
 * Result from a subagent execution
 */
export interface SubagentResult {
  /** Whether the subagent succeeded */
  success: boolean;

  /** Structured status, including partial completion */
  status?: SubagentStatus;

  /** Output text */
  output: string;

  /** One-sentence summary when available */
  summary?: string;

  /** Structured findings or key output items */
  findings?: string[];

  /** Checks the subagent says it completed */
  verified?: string[];

  /** Checks or scope the subagent did not verify */
  notVerified?: string[];

  /** Suggested next action for the main agent */
  nextAction?: string;

  /** Tokens used */
  tokensUsed: number;

  /** Duration in milliseconds */
  duration: number;

  /** Error message if failed */
  error?: string;

  /** Subagent identifier */
  id?: string;

  /** Requested type, including legacy aliases */
  type?: SubagentType;

  /** Resolved role profile used for execution */
  role?: SubagentRole;

  /** Tool names made available to this subagent */
  toolNames?: string[];

  /** Permission envelope used for this subagent */
  permissions?: SubagentPermissionProfile;

  /** ISO timestamps for observability */
  startedAt?: string;
  endedAt?: string;
}

/**
 * Subagent statistics
 */
export interface SubagentStats {
  totalSpawned: number;
  successful: number;
  failed: number;
  totalTokens: number;
  totalDuration: number;
  avgDuration: number;
}

/**
 * Tool set configuration for each subagent type.
 *
 * Tool names MUST match the actual registered names from:
 * - builtin.ts: web_search, web_fetch, file_read, file_write, file_list, file_delete,
 *               shell, code_execute, spawn_subagent, spawn_parallel, etc.
 * - memory/tools.ts: memory_ls, memory_grep, memory_read, memory_write, memory_record
 * - skills/tools.ts: skill_list, skill_get, skill_ensure, skill_delete, skill_record,
 *                     skill_maturity, skill_evals
 */
export const SUBAGENT_TOOL_SETS: Record<SubagentType, string[]> = {
  explorer: SUBAGENT_PROFILES.explorer.allowedTools,
  reviewer: SUBAGENT_PROFILES.reviewer.allowedTools,
  researcher: SUBAGENT_PROFILES.researcher.allowedTools,
  triager: SUBAGENT_PROFILES.triager.allowedTools,
  worker: SUBAGENT_PROFILES.worker.allowedTools,
  verifier: SUBAGENT_PROFILES.verifier.allowedTools,
  memory: SUBAGENT_PROFILES.memory.allowedTools,
  skill: SUBAGENT_PROFILES.skill.allowedTools,

  // Legacy aliases.
  research: SUBAGENT_PROFILES.researcher.allowedTools,
  code: SUBAGENT_PROFILES.worker.allowedTools,
  general: SUBAGENT_PROFILES.explorer.allowedTools,
};
