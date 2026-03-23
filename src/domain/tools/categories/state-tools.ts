/**
 * State Tools — Extracted from builtin.ts (Phase 4)
 *
 * Re-exports state-management tools for modular access.
 */
export {
  executeStateManageTool,
  executeStateQueryTool,
  executeStateLockManageTool,
} from '../builtin';

// Consolidated state tool definitions are imported from subagent layer
import type { BuiltinToolResult } from '../builtin';

/** All state-management tool definitions. */
export { stateManageTool, stateQueryTool, stateLockManageTool } from '../builtin';
