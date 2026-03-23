/**
 * Code Tools — Extracted from builtin.ts (Phase 4)
 *
 * Re-exports code/compute tools for modular access.
 */
export {
  calcTool,
  executeCalc,
  CalcSchema,
  codeExecuteTool,
  executeCode,
  CodeExecuteSchema,
  claudeCodeTool,
  executeClaudeCode,
  ClaudeCodeSchema,
} from '../builtin';

import type { OpenAITool } from '../../agent/types';

/** All code/compute tool definitions. */
export const codeTools: OpenAITool[] = [
  // Lazy-loaded to avoid circular dependency
  // Tools are imported by consumers via individual exports above
];
