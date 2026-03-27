import { describe, it, expect, mock } from 'bun:test';

mock.module('../../../infra/observability/logger', () => ({
  logger: { info: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) },
}));

import { calcTool, executeCalc } from '../calc-tools';

describe('calc-tools', () => {
  describe('calcTool', () => {
    it('should have correct name', () => {
      expect(calcTool.name).toBe('calc');
    });

    it('should require expression parameter', () => {
      expect(calcTool.parameters.required).toContain('expression');
    });
  });

  describe('executeCalc', () => {
    it('should evaluate simple addition', async () => {
      const result = await executeCalc({ expression: '2 + 2' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('4');
    });

    it('should evaluate multiplication', async () => {
      const result = await executeCalc({ expression: '3 * 7' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('21');
    });

    it('should evaluate sqrt', async () => {
      const result = await executeCalc({ expression: 'sqrt(16)' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('4');
    });

    it('should use pi constant', async () => {
      const result = await executeCalc({ expression: 'pi' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('3.14');
    });

    it('should return error for invalid expression', async () => {
      const result = await executeCalc({ expression: 'invalid((' });
      expect(result.success).toBe(false);
    });

    it('should return error for missing expression', async () => {
      const result = await executeCalc({});
      expect(result.success).toBe(false);
    });
  });
});
