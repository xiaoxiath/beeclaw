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

import {
  calcTool,
  codeExecuteTool,
  claudeCodeTool,
} from '../builtin';

/** All code/compute tool definitions. */
export const codeTools = [
  calcTool,
  codeExecuteTool,
  claudeCodeTool,
];
