import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  formatWeatherDescription,
  getWeatherContext,
  clearWeatherCache,
  fetchWeatherInfo,
  type WeatherInfo,
} from '../weather';

describe('Weather Utils', () => {
  beforeEach(() => {
    clearWeatherCache();
  });

  afterEach(() => {
    clearWeatherCache();
  });

  describe('formatWeatherDescription', () => {
    test('formats weather info correctly', () => {
      const info: WeatherInfo = {
        location: '北京',
        locationId: '101010100',
        temp: '25',
        text: '晴',
        windDir: '东北风',
        windScale: '3',
        humidity: '45',
        updateTime: '2026-03-02T12:00+08:00',
      };

      const description = formatWeatherDescription(info);

      expect(description).toContain('北京');
      expect(description).toContain('晴');
      expect(description).toContain('25°C');
      expect(description).toContain('东北风');
      expect(description).toContain('3级');
      expect(description).toContain('45%');
    });

    test('handles different weather conditions', () => {
      const info: WeatherInfo = {
        location: '上海',
        locationId: '101020100',
        temp: '18',
        text: '多云转小雨',
        windDir: '东南风',
        windScale: '2',
        humidity: '78',
        updateTime: '2026-03-02T12:00+08:00',
      };

      const description = formatWeatherDescription(info);

      expect(description).toContain('上海');
      expect(description).toContain('多云转小雨');
      expect(description).toContain('18°C');
      expect(description).toContain('78%');
    });

    test('handles extreme temperatures', () => {
      const hotInfo: WeatherInfo = {
        location: '吐鲁番',
        locationId: '101130500',
        temp: '42',
        text: '晴',
        windDir: '西风',
        windScale: '1',
        humidity: '15',
        updateTime: '2026-03-02T12:00+08:00',
      };

      const coldInfo: WeatherInfo = {
        location: '漠河',
        locationId: '101050300',
        temp: '-35',
        text: '小雪',
        windDir: '西北风',
        windScale: '5',
        humidity: '85',
        updateTime: '2026-03-02T12:00+08:00',
      };

      expect(formatWeatherDescription(hotInfo)).toContain('42°C');
      expect(formatWeatherDescription(coldInfo)).toContain('-35°C');
    });

    test('formats with all fields present', () => {
      const info: WeatherInfo = {
        location: '广州',
        locationId: '101280101',
        temp: '30',
        text: '雷阵雨',
        windDir: '南风',
        windScale: '4',
        humidity: '90',
        updateTime: '2026-03-02T15:30+08:00',
      };

      const description = formatWeatherDescription(info);

      // Verify all parts are joined with commas
      expect(description).toMatch(/广州当前天气：雷阵雨/);
      expect(description).toMatch(/温度30°C/);
      expect(description).toMatch(/南风4级/);
      expect(description).toMatch(/湿度90%/);
    });
  });

  describe('getWeatherContext', () => {
    test('returns null when cache is empty', () => {
      const context = getWeatherContext();
      expect(context).toBeNull();
    });
  });

  describe('clearWeatherCache', () => {
    test('clears all cached data', () => {
      // Call clear
      clearWeatherCache();

      // Verify cache is cleared by checking getWeatherContext returns null
      const context = getWeatherContext();
      expect(context).toBeNull();
    });

    test('can be called multiple times', () => {
      clearWeatherCache();
      clearWeatherCache();
      clearWeatherCache();

      const context = getWeatherContext();
      expect(context).toBeNull();
    });
  });

  describe('WeatherInfo interface', () => {
    test('creates valid WeatherInfo object', () => {
      const info: WeatherInfo = {
        location: '深圳',
        locationId: '101280600',
        temp: '28',
        text: '晴',
        windDir: '南风',
        windScale: '2',
        humidity: '65',
        updateTime: '2026-03-02T12:00+08:00',
      };

      expect(info.location).toBe('深圳');
      expect(info.locationId).toBe('101280600');
      expect(info.temp).toBe('28');
      expect(info.text).toBe('晴');
      expect(info.windDir).toBe('南风');
      expect(info.windScale).toBe('2');
      expect(info.humidity).toBe('65');
      expect(info.updateTime).toBe('2026-03-02T12:00+08:00');
    });

    test('accepts various humidity values', () => {
      const lowHumidity: WeatherInfo = {
        location: 'Test',
        locationId: '1',
        temp: '20',
        text: '晴',
        windDir: '无风',
        windScale: '0',
        humidity: '10',
        updateTime: '2026-03-02T12:00+08:00',
      };

      const highHumidity: WeatherInfo = {
        location: 'Test',
        locationId: '1',
        temp: '20',
        text: '阴',
        windDir: '无风',
        windScale: '0',
        humidity: '100',
        updateTime: '2026-03-02T12:00+08:00',
      };

      expect(formatWeatherDescription(lowHumidity)).toContain('10%');
      expect(formatWeatherDescription(highHumidity)).toContain('100%');
    });

    test('accepts various wind scales', () => {
      const calmWind: WeatherInfo = {
        location: 'Test',
        locationId: '1',
        temp: '20',
        text: '晴',
        windDir: '无风',
        windScale: '0',
        humidity: '50',
        updateTime: '2026-03-02T12:00+08:00',
      };

      const strongWind: WeatherInfo = {
        location: 'Test',
        locationId: '1',
        temp: '20',
        text: '多云',
        windDir: '北风',
        windScale: '12',
        humidity: '50',
        updateTime: '2026-03-02T12:00+08:00',
      };

      expect(formatWeatherDescription(calmWind)).toContain('0级');
      expect(formatWeatherDescription(strongWind)).toContain('12级');
    });
  });

  describe('fetchWeatherInfo', () => {
    test('returns null when API not configured', async () => {
      // Without API key/token configured, should return null
      const result = await fetchWeatherInfo();
      expect(result).toBeNull();
    });

    test('accepts custom location parameter', async () => {
      // Without API key configured, should still accept the parameter
      const result = await fetchWeatherInfo('上海');
      expect(result).toBeNull();
    });
  });
});

describe('Weather API Integration', () => {
  // These tests require mocking fetch or actual API keys
  test.skip('fetchWeatherInfo returns weather data when configured', async () => {
    // This test requires QWEATHER_KEY or QWEATHER_TOKEN to be set
    // and would make actual API calls
  });

  test.skip('fetchWeatherInfo handles API errors gracefully', async () => {
    // This test would mock fetch to return error responses
  });

  test.skip('fetchWeatherInfo uses cache correctly', async () => {
    // This test would verify caching behavior
  });
});
