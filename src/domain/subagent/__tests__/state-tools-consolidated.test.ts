import { describe, it, expect } from 'bun:test';

import {
  stateManageTool,
  stateQueryTool,
  stateLockManageTool,
  formatStateEntry,
  formatStateStats,
} from '../state-tools-consolidated';

describe('state-tools-consolidated', () => {
  describe('stateManageTool', () => {
    it('should have expected name', () => {
      expect(stateManageTool.name).toBe('state_manage');
    });

    it('should define required parameters', () => {
      const props = stateManageTool.parameters.properties;
      expect(props.action).toBeDefined();
      expect(props.key).toBeDefined();
    });
  });

  describe('stateQueryTool', () => {
    it('should have expected name', () => {
      expect(stateQueryTool.name).toBe('state_query');
    });
  });

  describe('stateLockManageTool', () => {
    it('should have expected name', () => {
      expect(stateLockManageTool.name).toBe('state_lock_manage');
    });
  });

  describe('formatStateEntry', () => {
    it('should format a basic entry', () => {
      const entry = {
        value: { hello: 'world' },
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02'),
      };
      const formatted = formatStateEntry('test-key', entry);
      expect(formatted).toContain('test-key');
      expect(formatted).toContain('hello');
      expect(formatted).toContain('world');
    });

    it('should include TTL when present', () => {
      const entry = {
        value: 42,
        createdAt: new Date(),
        updatedAt: new Date(),
        ttl: 60000,
      };
      const formatted = formatStateEntry('ttl-key', entry);
      expect(formatted).toContain('TTL');
      expect(formatted).toContain('60000');
    });

    it('should include expiration info', () => {
      const entry = {
        value: 'temp',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30000),
      };
      const formatted = formatStateEntry('exp-key', entry);
      expect(formatted).toContain('Expires');
    });

    it('should include metadata when present', () => {
      const entry = {
        value: 'x',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { owner: 'test' },
      };
      const formatted = formatStateEntry('meta-key', entry);
      expect(formatted).toContain('Metadata');
      expect(formatted).toContain('owner');
    });
  });

  describe('formatStateStats', () => {
    it('should format stats correctly', () => {
      const stats = {
        totalEntries: 10,
        lockedKeys: 2,
        activeSubscriptions: 1,
        expiredEntries: 3,
        estimatedMemoryUsage: 2048,
      };
      const formatted = formatStateStats(stats);
      expect(formatted).toContain('10');
      expect(formatted).toContain('Locked Keys');
      expect(formatted).toContain('KB');
    });
  });
});
