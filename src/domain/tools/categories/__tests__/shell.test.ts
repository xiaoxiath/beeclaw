import { describe, it, expect, vi } from 'vitest';

// Mock upstream module
vi.mock('../../file-system-tools', () => ({
  shellTool: { name: 'shell' },
  executeShell: vi.fn(() => Promise.resolve({ success: true })),
  ShellSchema: {},
  fileReadTool: { name: 'file_read' },
  executeFileRead: vi.fn(() => Promise.resolve({ success: true })),
  FileReadSchema: {},
  fileWriteTool: { name: 'file_write' },
  executeFileWrite: vi.fn(() => Promise.resolve({ success: true })),
  FileWriteSchema: {},
  fileListTool: { name: 'file_list' },
  executeFileList: vi.fn(() => Promise.resolve({ success: true })),
  FileListSchema: {},
  fileDeleteTool: { name: 'file_delete' },
  executeFileDelete: vi.fn(() => Promise.resolve({ success: true })),
  FileDeleteSchema: {},
}));

import {
  shellTool,
  executeShell,
  fileReadTool,
  executeFileRead,
  fileWriteTool,
  executeFileWrite,
  fileListTool,
  executeFileList,
  fileDeleteTool,
  executeFileDelete,
} from '../shell';

describe('categories/shell re-exports', () => {
  it('exports shellTool', () => {
    expect(shellTool.name).toBe('shell');
  });

  it('exports executeShell', () => {
    expect(typeof executeShell).toBe('function');
  });

  it('exports fileReadTool', () => {
    expect(fileReadTool.name).toBe('file_read');
  });

  it('exports executeFileRead', () => {
    expect(typeof executeFileRead).toBe('function');
  });

  it('exports fileWriteTool', () => {
    expect(fileWriteTool.name).toBe('file_write');
  });

  it('exports executeFileWrite', () => {
    expect(typeof executeFileWrite).toBe('function');
  });

  it('exports fileListTool', () => {
    expect(fileListTool.name).toBe('file_list');
  });

  it('exports executeFileList', () => {
    expect(typeof executeFileList).toBe('function');
  });

  it('exports fileDeleteTool', () => {
    expect(fileDeleteTool.name).toBe('file_delete');
  });

  it('exports executeFileDelete', () => {
    expect(typeof executeFileDelete).toBe('function');
  });
});
