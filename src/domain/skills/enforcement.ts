/**
 * Skill Enforcement Middleware
 *
 * Addresses two critical problems:
 * 1. Skills not being used when they should be (LLM skips skill_get)
 * 2. Skills giving conclusions without full content (LLM summarizes instead of following steps)
 *
 * This module provides:
 * - Pre-turn skill matching: checks user query against registered skills BEFORE LLM call
 * - Skill usage injection: adds strong directives to system prompt when matching skills found
 * - Post-turn validation: verifies that skill steps were followed completely
 * - Output completeness guard: detects truncated/summarized skill outputs
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '../../infra/observability/logger';
import { getSkillStore, type Skill } from './store';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillSearchResult {
  skill: Skill;
  score: number;
  matchedOn: string[];
}

export interface SkillMatchResult {
  matched: boolean;
  skills: SkillSearchResult[];
  directive: string;
}

export interface SkillExecutionTrace {
  skillId: string;
  skillName: string;
  stepsExpected: number;
  stepsCompleted: number;
  toolCallsMade: string[];
  complete: boolean;
  issues: string[];
}

export interface SkillEnforcementConfig {
  /** Minimum score threshold for skill matching (default: 0.3) */
  matchThreshold: number;
  /** Maximum number of skills to recommend per turn (default: 3) */
  maxRecommendations: number;
  /** Whether to inject strong directives (default: true) */
  injectDirectives: boolean;
  /** Whether to validate output completeness (default: true) */
  validateOutput: boolean;
  /** Minimum expected output length for skill results (default: 200) */
  minOutputLength: number;
  /** Keywords that indicate summarization rather than full output */
  summarizationIndicators: string[];
}

const DEFAULT_CONFIG: SkillEnforcementConfig = {
  matchThreshold: 0.3,
  maxRecommendations: 3,
  injectDirectives: true,
  validateOutput: true,
  minOutputLength: 200,
  summarizationIndicators: [
    'in summary',
    'to summarize',
    'the key takeaway',
    'in brief',
    'here is a summary',
    'the main points are',
    'tl;dr',
    'in conclusion',
    '总结来说',
    '简单来说',
    '总之',
    '概括地说',
    '主要结论是',
    '归纳起来',
  ],
};

// ─── Skill Enforcement Engine ────────────────────────────────────────────────

export class SkillEnforcementEngine {
  private config: SkillEnforcementConfig;
  private logger?: Logger;
  private executionTraces: Map<string, SkillExecutionTrace> = new Map();

  constructor(
    config?: Partial<SkillEnforcementConfig>,
    logger?: Logger,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  // ─── Pre-Turn: Skill Matching ───────────────────────────────────────────

  /**
   * Match user query against registered skills.
   * Call this BEFORE the LLM API call to prepare skill directives.
   */
  matchSkillsForQuery(userMessage: string): SkillMatchResult {
    const store = getSkillStore();
    if (!store) {
      return {
        matched: false,
        skills: [],
        directive: '',
      };
    }

    const skills = store.search(userMessage);
    const matched = skills.slice(0, this.config.maxRecommendations);

    if (matched.length === 0) {
      return {
        matched: false,
        skills: [],
        directive: '',
      };
    }

    this.logger?.info?.(
      `[SkillEnforcement] Matched ${matched.length} skill(s) for query: ${matched.map(s => s.name).join(', ')}`,
    );

    const directive = this.buildSkillDirective(matched);

    return {
      matched: true,
      skills: matched.map(skill => ({ skill, score: 1, matchedOn: [skill.name] })),
      directive,
    };
  }

  /**
   * Build a strong directive string for injecting into system prompt.
   */
  private buildSkillDirective(skills: Skill[]): string {
    let directive = '<skill-enforcement>\n';
    directive += '## MANDATORY Skill Usage\n\n';
    directive += 'The following skill(s) are HIGHLY RELEVANT to the current user request.\n';
    directive += 'You MUST use them by calling `search_skills` or `get_skill_details` first.\n\n';

    for (const skill of skills) {
      directive += `### Skill: ${skill.name}\n`;
      directive += `- **ID:** ${skill.id}\n`;
      directive += `- **Description:** ${skill.description}\n`;
      if (skill.tools && skill.tools.length > 0) {
        directive += `- **Required tools:** ${skill.tools.join(', ')}\n`;
      }
      directive += '\n';
    }

    directive += '### ENFORCEMENT RULES\n\n';
    directive += '1. **DO NOT skip skill usage.** If a matching skill exists, you must use it.\n';
    directive += '2. **DO NOT summarize skill results.** Always provide the COMPLETE output.\n';
    directive += '3. **Follow ALL skill steps.** Execute every step in the skill template.\n';
    directive += '4. **Show your work.** Include all intermediate results, data, and analysis.\n';
    directive += '5. **If a skill tool fails**, report the specific error and try alternatives.\n\n';

    directive += '### OUTPUT REQUIREMENTS\n\n';
    directive += '- Provide FULL content, not summaries or conclusions only\n';
    directive += '- Include raw data, tables, quotes, and specific numbers where applicable\n';
    directive += '- If the output is long, that is EXPECTED — do not truncate\n';
    directive += '- The user wants COMPLETE information, not a brief overview\n';

    directive += '</skill-enforcement>';

    return directive;
  }

  // ─── During Turn: Track Tool Calls ──────────────────────────────────────

  /**
   * Record that a skill-related tool was called during the current turn.
   */
  recordToolCall(toolName: string, _toolInput: Record<string, unknown>): void {
    // Track which skill tools are being called
    for (const [traceId, trace] of this.executionTraces) {
      const skill = getSkillStore()?.get(trace.skillId);
      if (skill && skill.tools && skill.tools.includes(toolName)) {
        trace.toolCallsMade.push(toolName);
        trace.stepsCompleted++;
        this.logger?.info?.(
          `[SkillEnforcement] Skill "${trace.skillName}" step completed: ${toolName} (${trace.stepsCompleted}/${trace.stepsExpected})`,
        );
      }
    }
  }

  /**
   * Start tracking a skill execution.
   */
  startSkillTracking(skillId: string): string {
    const skill = this.skillStore.getSkill(skillId);
    if (!skill) return '';

    const traceId = `${skillId}-${Date.now()}`;
    this.executionTraces.set(traceId, {
      skillId,
      skillName: skill.name,
      stepsExpected: (skill.tools || []).length,
      stepsCompleted: 0,
      toolCallsMade: [],
      complete: false,
      issues: [],
    });

    return traceId;
  }

  // ─── Post-Turn: Validate Output ─────────────────────────────────────────

  /**
   * Validate that the agent's output is complete and doesn't just provide
   * a summary when full content was expected.
   *
   * Returns validation issues, empty array if output is acceptable.
   */
  validateOutputCompleteness(
    output: string,
    matchedSkills: Skill[],
  ): string[] {
    if (!this.config.validateOutput) return [];

    const issues: string[] = [];

    // Check 1: Output length
    if (output.length < this.config.minOutputLength && matchedSkills.length > 0) {
      issues.push(
        `Output is suspiciously short (${output.length} chars) for a skill-backed response. ` +
        `Expected at least ${this.config.minOutputLength} chars. ` +
        `The agent may have summarized instead of providing full content.`
      );
    }

    // Check 2: Summarization indicators
    const outputLower = output.toLowerCase();
    const detectedIndicators = this.config.summarizationIndicators.filter(
      indicator => outputLower.includes(indicator.toLowerCase()),
    );

    if (detectedIndicators.length >= 2) {
      issues.push(
        `Output contains multiple summarization indicators: ${detectedIndicators.join(', ')}. ` +
        `The agent may be summarizing instead of providing complete content.`
      );
    }

    // Check 3: Missing expected content markers
    for (const skill of matchedSkills) {
      // If skill has examples, check if output follows a similar structure
      if (skill.examples && skill.examples.length > 0) {
        // Simple heuristic: check if any tool names from the skill were mentioned
        const toolNames = skill.tools || [];
        const mentionedTools = toolNames.filter(
          toolName => output.includes(toolName),
        );
        if (mentionedTools.length === 0 && toolNames.length > 0) {
          issues.push(
            `Skill "${skill.name}" requires tools [${toolNames.join(', ')}] ` +
            `but none were referenced in the output. The skill may not have been properly executed.`
          );
        }
      }
    }

    if (issues.length > 0) {
      this.logger?.info?.(
        `[SkillEnforcement] Output validation found ${issues.length} issue(s): ${issues.join('; ')}`,
      );
    }

    return issues;
  }

  /**
   * Build a retry prompt when output validation fails.
   * This can be injected as a follow-up user message to get the agent to
   * provide complete output.
   */
  buildRetryPrompt(issues: string[]): string {
    let prompt = 'Your previous response appears to be incomplete. Specifically:\n\n';

    for (const issue of issues) {
      prompt += `- ${issue}\n`;
    }

    prompt += '\nPlease provide the COMPLETE response with:\n';
    prompt += '1. All data, tables, and specific numbers — not just summaries\n';
    prompt += '2. Full execution of all skill steps\n';
    prompt += '3. Raw information and detailed analysis, not just conclusions\n';
    prompt += '4. If the content is long, include ALL of it — do not truncate\n';

    return prompt;
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Clear all execution traces.
   */
  clearTraces(): void {
    this.executionTraces.clear();
  }

  /**
   * Get all current traces (for debugging).
   */
  getTraces(): SkillExecutionTrace[] {
    return Array.from(this.executionTraces.values());
  }
}
