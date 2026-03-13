import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  WebSearchSchema,
  webSearchTool,
  executeWebSearch,
  WebFetchSchema,
  webFetchTool,
  executeWebFetch,
  TimeSchema,
  timeTool,
  executeTime,
  CalcSchema,
  calcTool,
  executeCalc,
  CodeExecuteSchema,
  codeExecuteTool,
  executeCode,
  FileReadSchema,
  fileReadTool,
  executeFileRead,
  FileWriteSchema,
  fileWriteTool,
  executeFileWrite,
  FileListSchema,
  fileListTool,
  executeFileList,
  FileDeleteSchema,
  fileDeleteTool,
  executeFileDelete,
  builtinTools,
  builtinToolNames,
  getBuiltinToolsForAI,
  executeBuiltinTool,
  isBuiltinTool,
} from '../builtin';
import type { BuiltinToolResult } from '../builtin';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), 'test-builtin-files');

describe('Builtin Tools', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('Tool Definitions', () => {
    test('webSearchTool has correct structure', () => {
      expect(webSearchTool.name).toBe('web_search');
      expect(webSearchTool.description).toBeDefined();
      expect(webSearchTool.parameters).toBeDefined();
    });

    test('webFetchTool has correct structure', () => {
      expect(webFetchTool.name).toBe('web_fetch');
      expect(webFetchTool.description).toBeDefined();
      expect(webFetchTool.parameters).toBeDefined();
    });

    test('timeTool has correct structure', () => {
      expect(timeTool.name).toBe('time_now');
      expect(timeTool.description).toBeDefined();
      expect(timeTool.parameters).toBeDefined();
    });

    test('calcTool has correct structure', () => {
      expect(calcTool.name).toBe('calc');
      expect(calcTool.description).toBeDefined();
      expect(calcTool.parameters).toBeDefined();
    });
  });

  describe('Schema Validation', () => {
    test('WebSearchSchema validates correct input', () => {
      const result = WebSearchSchema.safeParse({ query: 'test query' });
      expect(result.success).toBe(true);
    });

    test('WebSearchSchema accepts optional parameters', () => {
      const result = WebSearchSchema.safeParse({
        query: 'test',
        numResults: 10,
        region: 'cn',
      });
      expect(result.success).toBe(true);
    });

    test('WebFetchSchema validates correct input', () => {
      const result = WebFetchSchema.safeParse({ url: 'https://example.com' });
      expect(result.success).toBe(true);
    });

    test('TimeSchema validates with no parameters', () => {
      const result = TimeSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test('TimeSchema validates with timezone parameter', () => {
      const result = TimeSchema.safeParse({ timezone: 'Asia/Shanghai' });
      expect(result.success).toBe(true);
    });

    test('CalcSchema validates correct input', () => {
      const result = CalcSchema.safeParse({ expression: '1 + 1' });
      expect(result.success).toBe(true);
    });
  });

  describe('executeTime', () => {
    test('returns current time', async () => {
      const result = await executeTime({});
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(typeof result.data).toBe('string');
    });

    test('accepts timezone parameter', async () => {
      const result = await executeTime({ timezone: 'Asia/Shanghai' });
      expect(result.success).toBe(true);
    });

    test('handles invalid timezone gracefully', async () => {
      const result = await executeTime({ timezone: 'Invalid/Timezone' });
      // Invalid timezone should return error
      expect(result.success).toBe(false);
    });
  });

  describe('executeCalc', () => {
    test('evaluates simple expression', async () => {
      const result = await executeCalc({ expression: '1 + 1' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('2');
    });

    test('evaluates complex expression', async () => {
      const result = await executeCalc({ expression: '(10 + 5) * 2' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('30');
    });

    test('evaluates math functions', async () => {
      const result = await executeCalc({ expression: 'sqrt(16)' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('4');
    });

    test('handles invalid expression', async () => {
      const result = await executeCalc({ expression: 'invalid expression' });
      expect(result.success).toBe(false);
    });

    test('handles division by zero', async () => {
      const result = await executeCalc({ expression: '1 / 0' });
      // Division by zero returns Infinity which is not finite, so it fails
      expect(result.success).toBe(false);
    });

    test('evaluates with Math constants', async () => {
      const result = await executeCalc({ expression: 'pi' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('3.14');
    });
  });

  describe('builtinTools object', () => {
    test('contains expected tools', () => {
      expect(builtinTools.web_search).toBeDefined();
      expect(builtinTools.web_fetch).toBeDefined();
      expect(builtinTools.time_now).toBeDefined();
      expect(builtinTools.calc).toBeDefined();
      expect(builtinTools.code_execute).toBeDefined();
      expect(builtinTools.weather).toBeDefined();
    });
  });

  describe('builtinToolNames', () => {
    test('contains expected names', () => {
      expect(builtinToolNames).toContain('web_search');
      expect(builtinToolNames).toContain('web_fetch');
      expect(builtinToolNames).toContain('time_now');
      expect(builtinToolNames).toContain('calc');
    });
  });

  describe('getBuiltinToolsForAI', () => {
    test('returns array of tools', () => {
      const tools = getBuiltinToolsForAI();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    test('returns tools in internal format', () => {
      const tools = getBuiltinToolsForAI();

      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toBeDefined();
      }
    });
  });

  describe('isBuiltinTool', () => {
    test('returns true for builtin tools', () => {
      expect(isBuiltinTool('web_search')).toBe(true);
      expect(isBuiltinTool('web_fetch')).toBe(true);
      expect(isBuiltinTool('time_now')).toBe(true);
      expect(isBuiltinTool('calc')).toBe(true);
    });

    test('returns false for non-builtin tools', () => {
      expect(isBuiltinTool('unknown_tool')).toBe(false);
      expect(isBuiltinTool('memory_read')).toBe(false);
      expect(isBuiltinTool('skill_list')).toBe(false);
    });
  });

  describe('executeBuiltinTool', () => {
    test('executes time_now tool', async () => {
      const result = await executeBuiltinTool('time_now', {});
      expect(result.success).toBe(true);
    });

    test('executes calc tool', async () => {
      const result = await executeBuiltinTool('calc', { expression: '2 + 2' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('4');
    });

    test('returns error for unknown tool', async () => {
      const result = await executeBuiltinTool('unknown_tool', {});
      expect(result.success).toBe(false);
    });

    test('returns error for invalid calc expression', async () => {
      const result = await executeBuiltinTool('calc', { expression: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('CodeExecuteSchema', () => {
    test('validates correct input', () => {
      const result = CodeExecuteSchema.safeParse({ code: 'return 1 + 1' });
      expect(result.success).toBe(true);
    });

    test('accepts optional timeout', () => {
      const result = CodeExecuteSchema.safeParse({ code: 'return 1', timeout: 5000 });
      expect(result.success).toBe(true);
    });
  });

  describe('codeExecuteTool', () => {
    test('has correct structure', () => {
      expect(codeExecuteTool.name).toBe('code_execute');
      expect(codeExecuteTool.description).toBeDefined();
      expect(codeExecuteTool.parameters).toBeDefined();
    });
  });

  describe('executeCode', () => {
    test('executes simple code', async () => {
      const result = await executeCode({ code: 'return 1 + 1' });
      expect(result.success).toBe(true);
    });

    test('returns error for dangerous patterns', async () => {
      const result = await executeCode({ code: 'require("fs")' });
      expect(result.success).toBe(false);
    });

    test('returns error for eval pattern', async () => {
      const result = await executeCode({ code: 'eval("test")' });
      expect(result.success).toBe(false);
    });

    test('returns error for import pattern', async () => {
      const result = await executeCode({ code: 'import fs from "fs"' });
      expect(result.success).toBe(false);
    });
  });

  describe('FileReadSchema', () => {
    test('validates correct input', () => {
      const result = FileReadSchema.safeParse({ path: '/tmp/test.txt' });
      expect(result.success).toBe(true);
    });

    test('accepts optional parameters', () => {
      const result = FileReadSchema.safeParse({
        path: '/tmp/test.txt',
        encoding: 'utf-8',
        max_length: 1000
      });
      expect(result.success).toBe(true);
    });
  });

  describe('fileReadTool', () => {
    test('has correct structure', () => {
      expect(fileReadTool.name).toBe('file_read');
      expect(fileReadTool.description).toBeDefined();
      expect(fileReadTool.parameters).toBeDefined();
    });
  });

  describe('executeFileRead', () => {
    test('returns error for non-existent file', async () => {
      const result = await executeFileRead({ path: '/non/existent/file.txt' });
      expect(result.success).toBe(false);
    });

    test('returns error for path outside allowed directories', async () => {
      const result = await executeFileRead({ path: '/etc/passwd' });
      expect(result.success).toBe(false);
    });
  });

  describe('FileWriteSchema', () => {
    test('validates correct input', () => {
      const result = FileWriteSchema.safeParse({
        path: '/tmp/test.txt',
        content: 'Hello World'
      });
      expect(result.success).toBe(true);
    });
  });

  describe('fileWriteTool', () => {
    test('has correct structure', () => {
      expect(fileWriteTool.name).toBe('file_write');
      expect(fileWriteTool.description).toBeDefined();
      expect(fileWriteTool.parameters).toBeDefined();
    });
  });

  describe('executeFileWrite', () => {
    test('redirects path to output directory if outside allowed directories', async () => {
      const result = await executeFileWrite({ path: '/etc/test.txt', content: 'test' });
      // It redirects to output/ instead of failing
      expect(result.success).toBe(true);
    });
  });

  describe('FileListSchema', () => {
    test('validates correct input', () => {
      const result = FileListSchema.safeParse({ path: '/tmp' });
      expect(result.success).toBe(true);
    });
  });

  describe('fileListTool', () => {
    test('has correct structure', () => {
      expect(fileListTool.name).toBe('file_list');
      expect(fileListTool.description).toBeDefined();
      expect(fileListTool.parameters).toBeDefined();
    });
  });

  describe('executeFileList', () => {
    test('returns error for non-existent directory', async () => {
      const result = await executeFileList({ path: '/non/existent/dir' });
      expect(result.success).toBe(false);
    });

    test('returns error for path outside allowed directories', async () => {
      const result = await executeFileList({ path: '/etc' });
      expect(result.success).toBe(false);
    });
  });

  describe('FileDeleteSchema', () => {
    test('validates correct input', () => {
      const result = FileDeleteSchema.safeParse({ path: '/tmp/test.txt' });
      expect(result.success).toBe(true);
    });
  });

  describe('fileDeleteTool', () => {
    test('has correct structure', () => {
      expect(fileDeleteTool.name).toBe('file_delete');
      expect(fileDeleteTool.description).toBeDefined();
      expect(fileDeleteTool.parameters).toBeDefined();
    });
  });

  describe('executeFileDelete', () => {
    test('returns error for non-existent file', async () => {
      const result = await executeFileDelete({ path: '/non/existent/file.txt' });
      expect(result.success).toBe(false);
    });

    test('returns error for path outside allowed directories', async () => {
      const result = await executeFileDelete({ path: '/etc/passwd' });
      expect(result.success).toBe(false);
    });
  });
});
