/**
 * File Tools — Extracted from builtin.ts (Phase 4)
 *
 * Re-exports file-system tools for modular access.
 */
export {
  fileReadTool,
  executeFileRead,
  FileReadSchema,
  fileWriteTool,
  executeFileWrite,
  FileWriteSchema,
  fileListTool,
  executeFileList,
  FileListSchema,
  fileDeleteTool,
  executeFileDelete,
  FileDeleteSchema,
  shellTool,
  executeShell,
  ShellSchema,
} from '../builtin';

import type { OpenAITool } from '../../agent/types';

/** All file-system tool definitions. */
export const fileTools: OpenAITool[] = [
  // Lazy-loaded to avoid circular dependency
  // Tools are imported by consumers via individual exports above
];
