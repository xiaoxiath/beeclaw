import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), error: vi.fn(() => {}), debug: vi.fn(() => {}) },
}));

vi.mock('../../../infra/config', () => ({
  getConfig: vi.fn(() => ({ user: { timezone: 'Asia/Shanghai' } })),
}));

vi.mock('../weather', () => ({
  fetchWeatherInfo: vi.fn(async () => ({ temp: 25, description: 'Sunny' })),
  formatWeatherDescription: vi.fn(() => 'Sunny, 25C'),
  fetchDailyWeatherInfo: vi.fn(async () => ({})),
  formatDailyWeatherDescription: vi.fn(() => 'Daily forecast'),
}));

import { timeTool, executeTime } from '../time-tools';

describe('time-tools', () => {
  describe('timeTool', () => {
    it('should have correct name', () => {
      expect(timeTool.name).toBe('time_now');
    });
  });

  describe('executeTime', () => {
    it('should return current time for default timezone', async () => {
      const result = await executeTime({});
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should accept custom timezone', async () => {
      const result = await executeTime({ timezone: 'America/New_York' });
      expect(result.success).toBe(true);
    });

    it('should return error for invalid timezone', async () => {
      const result = await executeTime({ timezone: 'Invalid/Zone' });
      expect(result.success).toBe(false);
    });
  });
});
