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

import {
  fileReadTool,
  fileWriteTool,
  fileListTool,
  fileDeleteTool,
  shellTool,
} from '../builtin';

/** All file-system tool definitions. */
export const fileTools = [
  fileReadTool,
  fileWriteTool,
  fileListTool,
  fileDeleteTool,
  shellTool,
];
