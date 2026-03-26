/**
 * Code Tools — Extracted from builtin.ts (Phase 4)
 *
 * Re-exports code/compute tools for modular access.
 * Now imports directly from the calc-tools submodule.
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
} from '../calc-tools';

import type { OpenAITool } from '../../agent/types';

/** All code/compute tool definitions. */
export const codeTools: OpenAITool[] = [
  // INTENTIONALLY EMPTY — circular dependency guard.
  //
  // Consumers should import individual tools (calcTool, codeExecuteTool, claudeCodeTool)
  // directly from this module rather than using this array.
];
