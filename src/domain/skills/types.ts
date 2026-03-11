import { z } from 'zod';

// Skill frontmatter schema
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).describe('Skill name (kebab-case)'),
  description: z.string().min(1).describe('What the skill does AND when to trigger'),
  version: z.string().optional().default('1.0.0'),
  compatibility: z.string().optional().describe('Required tools or dependencies'),
  tags: z.array(z.string()).optional().default([]),
  triggers: z.array(z.string()).optional().default([]),
  depends_on: z.array(z.string()).optional().default([]),
  author: z.string().optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

// Full skill structure
export interface Skill {
  name: string;
  description: string;
  version: string;
  compatibility?: string;
  tags: string[];
  triggers: string[];
  dependsOn: string[];
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  content: string;           // SKILL.md body content
  path: string;              // Directory path
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
  hasAgents: boolean;        // Agent instructions directory
  hasEvals: boolean;         // Evals directory
  isBuiltin: boolean;        // Is this a built-in skill?
  readonly: boolean;         // Can the user modify this skill?

  // Evolution metadata
  usageCount: number;
  successCount: number;
  failureCount: number;
  lastUsed?: string;
  lastFailure?: string;
  maturityScore: number;     // 0-100
}

// Skill creation options
export interface CreateSkillOptions {
  name: string;
  description: string;
  content?: string;
  tags?: string[];
  triggers?: string[];
  dependsOn?: string[];
  compatibility?: string;
  author?: string;
}

// Skill update options
export interface UpdateSkillOptions {
  description?: string;
  content?: string;
  tags?: string[];
  triggers?: string[];
  compatibility?: string;
}

// Skill maturity assessment result
export interface MaturityAssessment {
  ready: boolean;
  score: number;
  checks: {
    productionTested: boolean;
    stable: boolean;
    wellStructured: boolean;
    clean: boolean;
  };
  recommendations: string[];
}

// Skill search result
export interface SkillSearchResult {
  name: string;
  description: string;
  tags: string[];
  author?: string;
  score: number;
}

// Skill tool result
export interface SkillToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
  instructions?: string;
  outputFormat?: string;
}

// ============================================================================
// Evaluation System Types (New Paradigm)
// ============================================================================

// Single eval test case
export interface SkillEval {
  id: number;
  name?: string;              // Descriptive name for the eval
  prompt: string;             // User's task prompt
  expected_output?: string;   // Human-readable description of success
  files?: string[];           // Input file paths relative to skill root
  expectations?: string[];    // Verifiable statements about output
}

// Evals.json structure
export interface SkillEvals {
  skill_name: string;
  evals: SkillEval[];
}

// Grading result for a single expectation
export interface GradedExpectation {
  text: string;
  passed: boolean;
  evidence: string;
}

// Grading result for a run
export interface GradingResult {
  expectations: GradedExpectation[];
  summary: {
    passed: number;
    failed: number;
    total: number;
    pass_rate: number;
  };
  execution_metrics?: {
    tool_calls: Record<string, number>;
    total_tool_calls: number;
    total_steps: number;
    errors_encountered: number;
    output_chars: number;
    transcript_chars: number;
  };
  timing?: {
    executor_duration_seconds: number;
    grader_duration_seconds: number;
    total_duration_seconds: number;
  };
}

// Timing data from a run
export interface TimingData {
  total_tokens: number;
  duration_ms: number;
  total_duration_seconds: number;
  executor_start?: string;
  executor_end?: string;
  executor_duration_seconds?: number;
}

// Benchmark run result
export interface BenchmarkRun {
  eval_id: number;
  eval_name: string;
  configuration: 'with_skill' | 'without_skill' | 'old_skill';
  run_number: number;
  result: {
    pass_rate: number;
    passed: number;
    failed: number;
    total: number;
    time_seconds: number;
    tokens: number;
    tool_calls: number;
    errors: number;
  };
  expectations?: GradedExpectation[];
  notes?: string[];
}

// Statistical summary
export interface StatSummary {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

// Benchmark summary
export interface BenchmarkSummary {
  with_skill?: {
    pass_rate: StatSummary;
    time_seconds: StatSummary;
    tokens: StatSummary;
  };
  without_skill?: {
    pass_rate: StatSummary;
    time_seconds: StatSummary;
    tokens: StatSummary;
  };
  delta?: {
    pass_rate: string;
    time_seconds: string;
    tokens: string;
  };
}

// Full benchmark result
export interface BenchmarkResult {
  metadata: {
    skill_name: string;
    skill_path: string;
    executor_model?: string;
    analyzer_model?: string;
    timestamp: string;
    evals_run: (number | string)[];
    runs_per_configuration: number;
  };
  runs: BenchmarkRun[];
  run_summary: BenchmarkSummary;
  notes?: string[];
}

// Eval metadata for a single run
export interface EvalMetadata {
  eval_id: number;
  eval_name: string;
  prompt: string;
  assertions: string[];
}

// Feedback from user review
export interface FeedbackReview {
  run_id: string;
  feedback: string;
  timestamp: string;
}

export interface FeedbackResult {
  reviews: FeedbackReview[];
  status: 'complete' | 'partial';
}

// Skill iteration history
export interface SkillHistory {
  started_at: string;
  skill_name: string;
  current_best: string;
  iterations: Array<{
    version: string;
    parent: string | null;
    expectation_pass_rate: number;
    grading_result: 'baseline' | 'won' | 'lost' | 'tie';
    is_current_best: boolean;
  }>;
}

// Skill evolution config
export const SkillEvolutionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  autoReflect: z.boolean().default(true),
  autoExtract: z.boolean().default(true),
  reflectThreshold: z.number().default(2),      // Failures before reflect
  extractThreshold: z.number().default(3),      // Repetitions before extract
  publishThreshold: z.number().default(80),     // Maturity score to publish
});

export type SkillEvolutionConfig = z.infer<typeof SkillEvolutionConfigSchema>;
