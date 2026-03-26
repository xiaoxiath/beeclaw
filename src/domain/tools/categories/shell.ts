/**
 * Shell & file tools
 *
 * Re-export from the file-system-tools submodule for modular imports.
 * Usage: import { shellTool } from '../tools/categories/shell';
 */
export {
  shellTool,
  executeShell,
  ShellSchema,
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
} from '../file-system-tools';
