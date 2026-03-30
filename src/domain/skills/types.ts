import { z } from 'zod';

// Skill frontmatter schema
export const SkillFrontmatterSchema = z.object({
  name: z.string().describe('Skill name (kebab-case)'),
  description: z.string().describe('What the skill does AND when to trigger'),
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

/** Fallback frontmatter for malformed SKILL.md files */
export const EMPTY_FRONTMATTER: SkillFrontmatter = {
  name: '',
  description: '',
  version: '1.0.0',
  tags: [],
  triggers: [],
  depends_on: [],
};

// Full skill structure
export interface Skill {
  id?: string;               // Skill identifier (directory name or unique ID)
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
  enabled?: boolean;         // Whether this skill is active

  // Tools associated with this skill (optional)
  tools?: string[];

  // Example usages (optional)
  examples?: string[];

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
  examples?: string[];
  maturity?: 'seed' | 'growing' | 'mature' | 'deprecated';
  dependsOn?: string[];
  compatibility?: string;
  author?: string;
  frontmatter?: {
    triggers?: string[];
    examples?: string[];
    maturity?: 'seed' | 'growing' | 'mature' | 'deprecated';
  };
}

// Skill update options
export interface UpdateSkillOptions {
  name?: string;
  description?: string;
  content?: string;
  tags?: string[];
  triggers?: string[];
  compatibility?: string;
  enabled?: boolean;
  frontmatter?: {
    triggers?: string[];
    examples?: string[];
    maturity?: 'seed' | 'growing' | 'mature' | 'deprecated';
  };
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

// ============================================================================
// Evaluation Execution Types
// ============================================================================

// Single eval run result
export interface EvalRunResult {
  eval_id: number;
  eval_name?: string;
  passed: boolean;
  output: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  feedback: string;
  expectations_checked?: number;
  expectations_passed?: number;
  execution_time_ms?: number;
}

// Multiple evals run result
export interface EvalsRunResult {
  skill_name: string;
  total_evals: number;
  passed_count: number;
  failed_count: number;
  pass_rate: number;
  results: EvalRunResult[];
  overall_grade: 'A' | 'B' | 'C' | 'D' | 'F';
  timestamp: string;
}

// ============================================================================
// Skill Recommendation Types
// ============================================================================

export interface SkillRecommendation {
  name: string;
  description: string;
  confidence: number;        // 0-1
  reason: string;            // Why this skill is recommended
  matched_triggers: string[]; // Which triggers matched
  matched_tags: string[];     // Which tags matched
}

export interface SkillRecommendResult {
  context: string;
  recommendations: SkillRecommendation[];
  timestamp: string;
}

// ============================================================================
// Performance Monitoring Types
// ============================================================================

export interface SkillPerformanceMetrics {
  avg_execution_time_ms: number;
  p95_execution_time_ms: number;
  min_execution_time_ms: number;
  max_execution_time_ms: number;
  total_executions: number;
  avg_tool_calls: number;
  avg_tokens_used: number;
}

// ============================================================================
// Failure Analysis Types
// ============================================================================

export interface FailurePattern {
  type: string;             // Error type (timeout, parse_error, etc.)
  count: number;            // How many times this occurred
  percentage: number;       // Percentage of total failures
  examples: string[];       // Example error messages
  suggestion: string;       // How to fix
}

export interface FailureAnalysisResult {
  skill_name: string;
  total_failures: number;
  total_uses: number;
  failure_rate: number;
  patterns: FailurePattern[];
  common_causes: string[];
  recommendations: string[];
  timestamp: string;
}

// ============================================================================
// Import/Export Types
// ============================================================================

export interface SkillExportResult {
  skill_name: string;
  export_path: string;
  size_bytes: number;
  files_included: string[];
  checksum: string;
  timestamp: string;
}

export interface SkillImportResult {
  skill_name: string;
  imported_version: string;
  files_imported: string[];
  conflicts_resolved: string[];
  success: boolean;
  message: string;
}
