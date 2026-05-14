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

// Mock bun:sqlite
vi.mock('bun:sqlite', () => {
  class MockDatabase {
    path: string;
    constructor(path: string) { this.path = path; }
    run = vi.fn();
    query = vi.fn(() => ({ all: vi.fn(() => []) }));
    transaction = vi.fn((fn: Function) => fn);
    close = vi.fn();
  }
  return { Database: MockDatabase };
});

// Mock drizzle-orm
vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn((_sqlite: any, _opts?: any) => ({
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

// Mock schema
vi.mock('./schema', () => ({
  sessions: {},
  tasks: {},
}));

import {
  initDataConnection,
  getDataConnection,
  getSQLite,
  closeDataConnection,
} from '../connection';

describe('db/connection', () => {
  afterEach(() => {
    closeDataConnection();
  });

  describe('initDataConnection', () => {
    it('should initialize the database connection', () => {
      expect(() => initDataConnection({ path: '/tmp/test.db' })).not.toThrow();
    });

    it('should throw if already initialized', () => {
      initDataConnection({ path: '/tmp/test.db' });
      expect(() => initDataConnection({ path: '/tmp/test2.db' })).toThrow('already initialized');
    });

    it('should accept migrate option', () => {
      expect(() => initDataConnection({ path: '/tmp/test.db', migrate: true })).not.toThrow();
    });
  });

  describe('getDataConnection', () => {
    it('should throw if not initialized', () => {
      expect(() => getDataConnection()).toThrow('not initialized');
    });

    it('should return connection after init', () => {
      initDataConnection({ path: '/tmp/test.db' });
      const conn = getDataConnection();
      expect(conn).toBeDefined();
    });
  });

  describe('getSQLite', () => {
    it('should throw if not initialized', () => {
      expect(() => getSQLite()).toThrow('not initialized');
    });

    it('should return SQLite instance after init', () => {
      initDataConnection({ path: '/tmp/test.db' });
      const sqlite = getSQLite();
      expect(sqlite).toBeDefined();
    });
  });

  describe('closeDataConnection', () => {
    it('should close without error when not initialized', () => {
      expect(() => closeDataConnection()).not.toThrow();
    });

    it('should close after init', () => {
      initDataConnection({ path: '/tmp/test.db' });
      expect(() => closeDataConnection()).not.toThrow();
    });

    it('should allow re-initialization after close', () => {
      initDataConnection({ path: '/tmp/test.db' });
      closeDataConnection();
      expect(() => initDataConnection({ path: '/tmp/test2.db' })).not.toThrow();
    });

    it('runs WAL checkpoint(TRUNCATE) and optimize before close', () => {
      initDataConnection({ path: '/tmp/test.db' });
      const sqlite = getSQLite() as any;
      sqlite.run.mockClear();

      closeDataConnection();

      const runCalls = sqlite.run.mock.calls.map((c: any[]) => c[0]);
      expect(runCalls).toContain('PRAGMA wal_checkpoint(TRUNCATE)');
      expect(runCalls).toContain('PRAGMA optimize');
      // Order matters: checkpoint must precede optimize, both before close.
      const cpIdx = runCalls.indexOf('PRAGMA wal_checkpoint(TRUNCATE)');
      const optIdx = runCalls.indexOf('PRAGMA optimize');
      expect(cpIdx).toBeLessThan(optIdx);
      expect(sqlite.close).toHaveBeenCalledTimes(1);
    });

    it('still closes if checkpoint throws (logs and proceeds)', () => {
      initDataConnection({ path: '/tmp/test.db' });
      const sqlite = getSQLite() as any;
      sqlite.run.mockImplementation((sql: string) => {
        if (sql === 'PRAGMA wal_checkpoint(TRUNCATE)') {
          throw new Error('database is locked');
        }
      });

      expect(() => closeDataConnection()).not.toThrow();
      expect(sqlite.close).toHaveBeenCalledTimes(1);
    });
  });
});
