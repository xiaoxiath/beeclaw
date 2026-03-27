import { describe, it, expect, mock } from 'bun:test';

mock.module('../../../infra/observability/logger', () => ({
  logger: { info: mock(() => {}), debug: mock(() => {}) },
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
