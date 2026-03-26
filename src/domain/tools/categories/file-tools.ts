/**
 * File Tools — Extracted from builtin.ts (Phase 4)
 *
 * Re-exports file-system tools for modular access.
 * Now imports directly from the file-system-tools submodule.
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
} from '../file-system-tools';

import type { OpenAITool } from '../../agent/types';

/** All file-system tool definitions. */
export const fileTools: OpenAITool[] = [
  // INTENTIONALLY EMPTY — circular dependency guard.
  //
  // Consumers should import individual tools (fileReadTool, fileWriteTool, fileListTool, fileDeleteTool, shellTool)
  // directly from this module rather than using this array.
];
