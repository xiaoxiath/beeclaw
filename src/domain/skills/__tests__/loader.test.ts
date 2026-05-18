import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: vi.fn(() => {}) },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  readMetadata,
  emptyMetadata,
  calculateMaturity,
  hasSecurityIssues,
} from '../loader';

describe('loader', () => {
  describe('emptyMetadata', () => {
    it('should return metadata with maturityScore 100 for builtins', () => {
      const m = emptyMetadata();
      expect(m.usageCount).toBe(0);
      expect(m.successCount).toBe(0);
      expect(m.failureCount).toBe(0);
      expect(m.maturityScore).toBe(100);
    });
  });

  describe('calculateMaturity', () => {
    it('should return 0 for unused skills', () => {
      expect(calculateMaturity({ usageCount: 0, successCount: 0, failureCount: 0 })).toBe(0);
    });

    it('should calculate from success rate and usage', () => {
      const score = calculateMaturity({ usageCount: 10, successCount: 9, failureCount: 1 });
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should cap at 100', () => {
      const score = calculateMaturity({ usageCount: 100, successCount: 100, failureCount: 0 });
      expect(score).toBe(100);
    });

    it('should use quality checks when provided', () => {
      const score = calculateMaturity(
        { usageCount: 5, successCount: 5, failureCount: 0 },
        { productionTested: true, stable: true, wellStructured: true, clean: true },
      );
      // 4 checks * 20 = 80 + usage bonus
      expect(score).toBeGreaterThanOrEqual(80);
    });

    it('should give partial score for partial checks', () => {
      const score = calculateMaturity(
        { usageCount: 0, successCount: 0, failureCount: 0 },
        { productionTested: true, stable: false, wellStructured: false, clean: false },
      );
      expect(score).toBe(20); // 1 check * 20 + 0 usage
    });
  });

  describe('hasSecurityIssues', () => {
    it('should detect API key patterns', () => {
      expect(hasSecurityIssues('api_key = "sk-abc123"')).toBe(true);
      expect(hasSecurityIssues('apiKey: "mykey123"')).toBe(true);
    });

    it('should detect secret patterns', () => {
      expect(hasSecurityIssues('secret = "mysecret"')).toBe(true);
    });

    it('should detect OpenAI key patterns', () => {
      expect(hasSecurityIssues('Use sk-abcdefghijklmnopqrstuvwxyz for auth')).toBe(true);
    });

    it('should detect env var API key references', () => {
      expect(hasSecurityIssues('Use ${MY_SERVICE_API_KEY}')).toBe(true);
    });

    it('should return false for clean content', () => {
      expect(hasSecurityIssues('This is a normal skill description.')).toBe(false);
      expect(hasSecurityIssues('## Steps\n1. Search web\n2. Summarize')).toBe(false);
    });
  });

  describe('readMetadata', () => {
    it('should return defaults for nonexistent path', () => {
      const m = readMetadata('/nonexistent/path');
      expect(m.usageCount).toBe(0);
      expect(m.successCount).toBe(0);
      expect(m.maturityScore).toBe(0);
      expect(m.performance).toBeDefined();
    });
  });
});
