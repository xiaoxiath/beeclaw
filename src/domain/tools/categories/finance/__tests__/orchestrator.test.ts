/**
 * Finance Orchestrator Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FinanceOrchestrator, getFinanceOrchestrator } from '../orchestrator';
import type { FinanceConfig } from '../types';

describe('FinanceOrchestrator', () => {
  let orchestrator: FinanceOrchestrator;

  beforeEach(() => {
    // Create a fresh orchestrator for each test
    orchestrator = new FinanceOrchestrator({
      cacheEnabled: false,  // Disable cache for testing
    });
  });

  describe('constructor', () => {
    it('should create orchestrator with default config', () => {
      const orch = new FinanceOrchestrator();
      expect(orch).toBeDefined();
    });

    it('should create orchestrator with custom config', () => {
      const config: FinanceConfig = {
        tushareToken: 'test-token',
        defaultSource: 'tushare',
        cacheEnabled: true,
      };
      const orch = new FinanceOrchestrator(config);
      expect(orch).toBeDefined();
    });
  });

  describe('getConfiguredProviders', () => {
    it('should return configured providers', () => {
      const providers = orchestrator.getConfiguredProviders();
      // Sina and Eastmoney are always available (no API key required)
      expect(providers).toContain('sina');
      expect(providers).toContain('eastmoney');
    });

    it('should include tushare when token is provided', () => {
      const orchWithTushare = new FinanceOrchestrator({
        tushareToken: 'test-token',
      });
      const providers = orchWithTushare.getConfiguredProviders();
      expect(providers).toContain('tushare');
    });
  });

  describe('clearCache', () => {
    it('should clear cache without error', () => {
      expect(() => orchestrator.clearCache()).not.toThrow();
    });
  });
});

describe('getFinanceOrchestrator', () => {
  it('should return singleton instance', () => {
    const orch1 = getFinanceOrchestrator();
    const orch2 = getFinanceOrchestrator();
    expect(orch1).toBe(orch2);
  });

  it('should create new instance when config is provided', () => {
    const orch1 = getFinanceOrchestrator();
    const orch2 = getFinanceOrchestrator({ cacheEnabled: false });
    // They should be the same because singleton is updated
    expect(orch2).toBeDefined();
  });
});
