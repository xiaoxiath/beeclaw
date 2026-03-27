import { describe, it, expect, mock } from 'bun:test';

mock.module('../../../infra/observability/logger', () => ({
  logger: { info: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) },
}));

mock.module('../../../infra/config', () => ({
  getConfig: mock(() => ({ user: { timezone: 'Asia/Shanghai' } })),
}));

mock.module('../weather', () => ({
  fetchWeatherInfo: mock(async () => ({ temp: 25, description: 'Sunny' })),
  formatWeatherDescription: mock(() => 'Sunny, 25C'),
  fetchDailyWeatherInfo: mock(async () => ({})),
  formatDailyWeatherDescription: mock(() => 'Daily forecast'),
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
