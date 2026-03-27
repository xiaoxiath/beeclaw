import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

// Mock logger
mock.module('../../observability/logger', () => ({
  logger: {
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  },
}));

// Mock bun:sqlite
mock.module('bun:sqlite', () => {
  class MockDatabase {
    path: string;
    constructor(path: string) { this.path = path; }
    run = mock();
    query = mock(() => ({ all: mock(() => []) }));
    transaction = mock((fn: Function) => fn);
    close = mock();
  }
  return { Database: MockDatabase };
});

// Mock drizzle-orm
mock.module('drizzle-orm/bun-sqlite', () => ({
  drizzle: mock((_sqlite: any, _opts?: any) => ({
    select: mock(),
    insert: mock(),
    update: mock(),
    delete: mock(),
  })),
}));

// Mock fs
mock.module('fs', () => ({
  existsSync: mock(() => true),
  mkdirSync: mock(),
}));

// Mock schema
mock.module('./schema', () => ({
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
  });
});
