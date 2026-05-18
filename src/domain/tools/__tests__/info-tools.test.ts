import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), debug: vi.fn(() => {}) },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import { beeclawInfoTool, executeBeeclawInfo } from '../info-tools';

describe('info-tools', () => {
  describe('beeclawInfoTool', () => {
    it('should have name beeclaw_info', () => {
      expect(beeclawInfoTool.name).toBe('beeclaw_info');
    });
  });

  describe('executeBeeclawInfo', () => {
    it('should return success with version info', async () => {
      const result = await executeBeeclawInfo();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });
});
