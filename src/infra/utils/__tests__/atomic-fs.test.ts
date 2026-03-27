import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Use vi.hoisted to create mock functions that can be referenced inside vi.mock factories
const {
  mockExistsSync,
  mockWriteFileSync,
  mockReadFileSync,
  mockRenameSync,
  mockUnlinkSync,
  mockReaddirSync,
  mockMkdirSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => false),
  mockWriteFileSync: vi.fn(),
  mockReadFileSync: vi.fn(() => ''),
  mockRenameSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockReaddirSync: vi.fn(() => []),
  mockMkdirSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
  renameSync: mockRenameSync,
  unlinkSync: mockUnlinkSync,
  readdirSync: mockReaddirSync,
  mkdirSync: mockMkdirSync,
}));

import { writeFileAtomic, readFileWithRecovery, cleanupTempFiles } from '../atomic-fs';

describe('atomic-fs', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockWriteFileSync.mockReset();
    mockReadFileSync.mockReset();
    mockRenameSync.mockReset();
    mockUnlinkSync.mockReset();
    mockReaddirSync.mockReset();
    mockMkdirSync.mockReset();
  });

  describe('writeFileAtomic', () => {
    it('should write to temp file and rename', () => {
      mockExistsSync.mockReturnValue(false);
      writeFileAtomic('/data/test.json', '{"key":"value"}');

      expect(mockMkdirSync).toHaveBeenCalledWith('/data', { recursive: true });
      expect(mockWriteFileSync).toHaveBeenCalledWith('/data/test.json.tmp', '{"key":"value"}', 'utf-8');
      expect(mockRenameSync).toHaveBeenCalledWith('/data/test.json.tmp', '/data/test.json');
    });

    it('should create backup of existing file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{"old":"data"}');

      writeFileAtomic('/data/test.json', '{"new":"data"}');

      expect(mockReadFileSync).toHaveBeenCalledWith('/data/test.json', 'utf-8');
      expect(mockWriteFileSync).toHaveBeenCalledWith('/data/test.json.bak', '{"old":"data"}', 'utf-8');
    });

    it('should still rename even if backup fails', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => { throw new Error('read failed'); });

      writeFileAtomic('/data/test.json', '{"new":"data"}');

      expect(mockRenameSync).toHaveBeenCalled();
    });
  });

  describe('readFileWithRecovery', () => {
    it('should read primary file successfully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{"key":"value"}');

      const result = readFileWithRecovery('/data/test.json');
      expect(result).toEqual({ key: 'value' });
    });

    it('should return undefined when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const result = readFileWithRecovery('/data/test.json');
      expect(result).toBeUndefined();
    });

    it('should fall back to .bak when primary is corrupted', () => {
      mockExistsSync.mockImplementation(() => true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path === '/data/test.json') throw new Error('corrupted');
        if (path === '/data/test.json.bak') return '{"backup":"data"}';
        return '';
      });

      const result = readFileWithRecovery('/data/test.json');
      expect(result).toEqual({ backup: 'data' });
    });

    it('should return undefined when both primary and backup fail', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => { throw new Error('corrupted'); });

      const result = readFileWithRecovery('/data/test.json');
      expect(result).toBeUndefined();
    });

    it('should validate with custom validator', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{"key":"value"}');

      const validator = (data: unknown): data is { key: string } => {
        return typeof data === 'object' && data !== null && 'key' in data;
      };

      const result = readFileWithRecovery('/data/test.json', validator);
      expect(result).toEqual({ key: 'value' });
    });

    it('should reject invalid data with validator and try backup', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path === '/data/test.json') return '{"wrong":"format"}';
        if (path === '/data/test.json.bak') return '{"key":"valid"}';
        return '';
      });

      const validator = (data: unknown): data is { key: string } => {
        return typeof data === 'object' && data !== null && 'key' in data && (data as any).key !== undefined && typeof (data as any).key === 'string' && (data as any).wrong === undefined;
      };

      const result = readFileWithRecovery('/data/test.json', validator);
      expect(result).toBeDefined();
    });
  });

  describe('cleanupTempFiles', () => {
    it('should remove .tmp files', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['file.json', 'file.json.tmp', 'other.tmp', 'data.bak'] as any);

      const cleaned = cleanupTempFiles('/data');
      expect(cleaned).toBe(2);
      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const cleaned = cleanupTempFiles('/nonexistent');
      expect(cleaned).toBe(0);
    });

    it('should return 0 when no .tmp files exist', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['file.json', 'file.bak'] as any);

      const cleaned = cleanupTempFiles('/data');
      expect(cleaned).toBe(0);
    });

    it('should handle errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => { throw new Error('permission denied'); });

      const cleaned = cleanupTempFiles('/data');
      expect(cleaned).toBe(0);
    });

    it('should continue when individual unlink fails', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['a.tmp', 'b.tmp'] as any);
      mockUnlinkSync.mockImplementation((path: string) => {
        if (path.includes('a.tmp')) throw new Error('busy');
      });

      const cleaned = cleanupTempFiles('/data');
      expect(cleaned).toBe(1);
    });
  });
});
