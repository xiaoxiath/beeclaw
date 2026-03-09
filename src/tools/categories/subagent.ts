/**
 * Subagent delegation tools
 *
 * Re-export from builtin.ts for modular imports.
 * Usage: import { webSearchTool } from '../tools/categories/search';
 */
export {
  spawnSubagentToolDef,
  spawnParallelToolDef,
  executeSpawnSubagentTool,
  executeSpawnParallelTool
} from '../builtin';
