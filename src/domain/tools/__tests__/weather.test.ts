import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const mockGetWeatherConfig = vi.hoisted(() =>
  vi.fn(() => ({
    apiHost: 'devapi.qweather.com',
    apiKey: 'fake-api-key-12345',
    token: '',
    defaultLocation: '北京',
  })),
);

vi.mock('../../../infra/config', () => ({
  getWeatherConfig: mockGetWeatherConfig,
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  formatWeatherDescription,
  formatDailyWeatherDescription,
  getWeatherContext,
  clearWeatherCache,
  fetchWeatherInfo,
  fetchDailyWeatherInfo,
  searchCity,
  type WeatherInfo,
  type DailyWeatherInfo,
} from '../weather';
import { cache } from '../../../infra/cache';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCityLookupResponse(name = '北京', id = '101010100') {
  return {
    code: '200',
    location: [
      {
        name,
        id,
        lat: '39.9',
        lon: '116.4',
        adm2: '北京',
        adm1: '北京市',
        country: '中国',
        tz: 'Asia/Shanghai',
        utcOffset: '+08:00',
        isDst: '0',
        type: 'city',
        rank: '10',
        fxLink: 'https://www.qweather.com',
      },
    ],
  };
}

function makeHourlyResponse(hour?: number) {
  const h = hour ?? new Date().getHours();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const fxTime = `2026-03-27T${pad(h)}:00+08:00`;
  return {
    code: '200',
    updateTime: '2026-03-27T12:00+08:00',
    fxLink: 'https://www.qweather.com',
    hourly: [
      {
        fxTime,
        temp: '22',
        icon: '100',
        text: '晴',
        wind360: '45',
        windDir: '东北风',
        windScale: '3',
        windSpeed: '15',
        humidity: '50',
        pop: '0',
        precip: '0.0',
        pressure: '1013',
        cloud: '10',
        dew: '10',
      },
    ],
  };
}

function makeDailyResponse(days = 3) {
  const daily = Array.from({ length: days }, (_, i) => ({
    fxDate: `2026-03-${27 + i}`,
    sunrise: '06:15',
    sunset: '18:30',
    moonrise: '19:00',
    moonset: '06:00',
    moonPhase: '满月',
    moonPhaseIcon: '100',
    tempMax: `${20 + i}`,
    tempMin: `${10 + i}`,
    iconDay: '100',
    textDay: '晴',
    iconNight: '150',
    textNight: '多云',
    wind360Day: '0',
    windDirDay: '北风',
    windScaleDay: '3',
    windSpeedDay: '15',
    wind360Night: '180',
    windDirNight: '南风',
    windScaleNight: '2',
    windSpeedNight: '10',
    humidity: '55',
    precip: '0.0',
    pressure: '1013',
    vis: '25',
    cloud: '10',
    uvIndex: '5',
  }));
  return {
    code: '200',
    updateTime: '2026-03-27T06:00+08:00',
    fxLink: 'https://www.qweather.com',
    daily,
  };
}

/** Aggressively clear all weather-related keys from the cache */
function clearAllWeatherKeys() {
  // The cache doesn't expose a "deleteByPrefix" method, so we
  // call clearWeatherCache (which deletes the base keys) and also
  // directly delete the location-specific keys we use in tests.
  clearWeatherCache();
  // Delete location-specific keys used in our test scenarios
  for (const loc of ['北京', '上海', '广州', 'nonexistent-city', 'xyz']) {
    cache.delete(`weather:info:${loc}`);
    cache.delete(`weather:location:${loc}`);
  }
}

// ── Setup / teardown ───────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  clearAllWeatherKeys();
  // Reset config to default (with apiKey)
  mockGetWeatherConfig.mockReturnValue({
    apiHost: 'devapi.qweather.com',
    apiKey: 'fake-api-key-12345',
    token: '',
    defaultLocation: '北京',
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearAllWeatherKeys();
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Weather Utils', () => {
  // ── formatWeatherDescription ─────────────────────────────────────────────
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

    test('handles negative temperatures', () => {
      const info: WeatherInfo = {
        location: '漠河',
        locationId: '101050300',
        temp: '-35',
        text: '小雪',
        windDir: '西北风',
        windScale: '5',
        humidity: '85',
        updateTime: '2026-01-15T08:00+08:00',
      };
      expect(formatWeatherDescription(info)).toContain('-35°C');
    });
  });

  // ── formatDailyWeatherDescription ────────────────────────────────────────
  describe('formatDailyWeatherDescription', () => {
    test('formats daily forecast with correct structure', () => {
      const info: DailyWeatherInfo = {
        location: '北京',
        locationId: '101010100',
        updateTime: '2026-03-27T06:00+08:00',
        daily: [
          {
            fxDate: '2026-03-27',
            sunrise: '06:15',
            sunset: '18:30',
            tempMax: '22',
            tempMin: '10',
            textDay: '晴',
            textNight: '多云',
            windDirDay: '北风',
            windScaleDay: '3',
            windDirNight: '南风',
            windScaleNight: '2',
            humidity: '55',
            precip: '0.0',
            uvIndex: '5',
          },
        ],
      };

      const result = formatDailyWeatherDescription(info);
      expect(result).toContain('北京');
      expect(result).toContain('未来1天天气预报');
      expect(result).toContain('2026-03-27');
      expect(result).toContain('10°C ~ 22°C');
      expect(result).toContain('白天: 晴');
      expect(result).toContain('夜间: 多云');
      expect(result).toContain('湿度: 55%');
      expect(result).toContain('降水: 0.0mm');
      expect(result).toContain('日出: 06:15');
      expect(result).toContain('日落: 18:30');
      expect(result).toContain('更新时间');
      expect(result).toContain('和风天气');
    });

    test('formats multiple days with weekday names', () => {
      const info: DailyWeatherInfo = {
        location: '上海',
        locationId: '101020100',
        updateTime: '2026-03-27T06:00+08:00',
        daily: [
          {
            fxDate: '2026-03-27',
            sunrise: '06:00',
            sunset: '18:15',
            tempMax: '18',
            tempMin: '8',
            textDay: '阴',
            textNight: '小雨',
            windDirDay: '东风',
            windScaleDay: '2',
            windDirNight: '东南风',
            windScaleNight: '1',
            humidity: '70',
            precip: '2.5',
            uvIndex: '3',
          },
          {
            fxDate: '2026-03-28',
            sunrise: '05:59',
            sunset: '18:16',
            tempMax: '15',
            tempMin: '6',
            textDay: '多云',
            textNight: '晴',
            windDirDay: '西北风',
            windScaleDay: '4',
            windDirNight: '北风',
            windScaleNight: '3',
            humidity: '50',
            precip: '0.0',
            uvIndex: '6',
          },
        ],
      };

      const result = formatDailyWeatherDescription(info);
      expect(result).toContain('未来2天天气预报');
      expect(result).toContain('2026-03-27');
      expect(result).toContain('2026-03-28');
      // weekday names should be present
      expect(result).toMatch(/周[日一二三四五六]/);
    });
  });

  // ── getWeatherContext ─────────────────────────────────────────────────────
  describe('getWeatherContext', () => {
    test('returns null when cache is empty', () => {
      expect(getWeatherContext()).toBeNull();
    });

    test('returns formatted description when cache is populated', () => {
      const info: WeatherInfo = {
        location: '北京',
        locationId: '101010100',
        temp: '20',
        text: '晴',
        windDir: '北风',
        windScale: '2',
        humidity: '40',
        updateTime: '2026-03-27T12:00+08:00',
      };
      cache.set('weather:info:北京', info, 3600);

      const context = getWeatherContext();
      expect(context).not.toBeNull();
      expect(context).toContain('北京');
      expect(context).toContain('20°C');
    });
  });

  // ── clearWeatherCache ────────────────────────────────────────────────────
  describe('clearWeatherCache', () => {
    test('deletes base cache keys', () => {
      cache.set('weather:info', { test: true }, 3600);
      cache.set('weather:location', { test: true }, 3600);
      clearWeatherCache();
      expect(cache.get('weather:info')).toBeUndefined();
      expect(cache.get('weather:location')).toBeUndefined();
    });

    test('can be called multiple times safely', () => {
      clearWeatherCache();
      clearWeatherCache();
      // No exception thrown
      expect(true).toBe(true);
    });
  });

  // ── searchCity ───────────────────────────────────────────────────────────
  describe('searchCity', () => {
    test('returns null when no API key or token configured', async () => {
      mockGetWeatherConfig.mockReturnValue({
        apiHost: 'devapi.qweather.com',
        apiKey: '',
        token: '',
        defaultLocation: '北京',
      });
      const result = await searchCity('北京');
      expect(result).toBeNull();
    });

    test('returns city info on successful lookup with apiKey', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => makeCityLookupResponse('北京', '101010100'),
      }) as any;

      const result = await searchCity('北京');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('101010100');
      expect(result!.name).toBe('北京');
      expect(result!.tz).toBe('Asia/Shanghai');
    });

    test('returns city info on successful lookup with token (fallback auth)', async () => {
      mockGetWeatherConfig.mockReturnValue({
        apiHost: 'devapi.qweather.com',
        apiKey: '',
        token: 'fake-jwt-token',
        defaultLocation: '北京',
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => makeCityLookupResponse('上海', '101020100'),
      }) as any;

      const result = await searchCity('上海');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('上海');

      // Verify Authorization header was used
      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers).toHaveProperty('Authorization', 'Bearer fake-jwt-token');
    });

    test('returns null when response is not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      }) as any;

      const result = await searchCity('北京');
      expect(result).toBeNull();
    });

    test('returns null when API returns non-200 code', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: '404', location: [] }),
      }) as any;

      const result = await searchCity('nonexistent-city');
      expect(result).toBeNull();
    });

    test('returns null when location array is empty', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: '200', location: [] }),
      }) as any;

      const result = await searchCity('xyz');
      expect(result).toBeNull();
    });

    test('returns null on fetch exception', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;

      const result = await searchCity('北京');
      expect(result).toBeNull();
    });
  });

  // ── fetchWeatherInfo ─────────────────────────────────────────────────────
  describe('fetchWeatherInfo', () => {
    test('returns null when API not configured', async () => {
      mockGetWeatherConfig.mockReturnValue({
        apiHost: 'devapi.qweather.com',
        apiKey: '',
        token: '',
        defaultLocation: '北京',
      });
      const result = await fetchWeatherInfo();
      expect(result).toBeNull();
    });

    test('returns weather info on success (full pipeline)', async () => {
      const cityResp = makeCityLookupResponse('北京', '101010100');
      const hourlyResp = makeHourlyResponse();

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => cityResp };
        }
        return { ok: true, json: async () => hourlyResp };
      }) as any;

      const result = await fetchWeatherInfo();
      expect(result).not.toBeNull();
      expect(result!.location).toBe('北京');
      expect(result!.temp).toBe('22');
      expect(result!.text).toBe('晴');
    });

    test('uses custom location parameter', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse('上海', '101020100') };
        }
        return { ok: true, json: async () => makeHourlyResponse() };
      }) as any;

      const result = await fetchWeatherInfo('上海');
      expect(result).not.toBeNull();
      expect(result!.location).toBe('上海');
    });

    test('returns cached result on second call', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse('北京', '101010100') };
        }
        return { ok: true, json: async () => makeHourlyResponse() };
      }) as any;

      const first = await fetchWeatherInfo();
      expect(first).not.toBeNull();

      // Second call should use cache (no additional fetch calls)
      const second = await fetchWeatherInfo();
      expect(second).toEqual(first);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2); // only city + hourly from first call
    });

    test('uses cached location on second call for same city', async () => {
      // First call: both city lookup + hourly
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse('北京', '101010100') };
        }
        return { ok: true, json: async () => makeHourlyResponse() };
      }) as any;

      await fetchWeatherInfo('北京');

      // Clear only weather cache, keep location cache
      cache.delete('weather:info:北京');

      // Second call should reuse location cache
      callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return { ok: true, json: async () => makeHourlyResponse() };
      }) as any;

      const result = await fetchWeatherInfo('北京');
      expect(result).not.toBeNull();
      // Should only have 1 fetch (hourly), no city lookup
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    test('returns null when city lookup fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: '404', location: [] }),
      }) as any;

      const result = await fetchWeatherInfo();
      expect(result).toBeNull();
    });

    test('returns null when hourly weather returns empty', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: true, json: async () => ({ code: '200', updateTime: '', fxLink: '', hourly: [] }) };
      }) as any;

      const result = await fetchWeatherInfo();
      expect(result).toBeNull();
    });

    test('returns null when hourly weather fetch is not ok', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: false, status: 500, text: async () => 'Internal Server Error' };
      }) as any;

      const result = await fetchWeatherInfo();
      expect(result).toBeNull();
    });

    test('returns null when hourly weather API returns error code', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: true, json: async () => ({ code: '401', updateTime: '', fxLink: '', hourly: [] }) };
      }) as any;

      const result = await fetchWeatherInfo();
      expect(result).toBeNull();
    });

    test('matches current hour from hourly data', async () => {
      const currentHour = new Date().getHours();
      const pad = (n: number) => n.toString().padStart(2, '0');

      const hourlyData = {
        code: '200',
        updateTime: '2026-03-27T12:00+08:00',
        fxLink: '',
        hourly: [
          {
            fxTime: `2026-03-27T${pad((currentHour + 1) % 24)}:00+08:00`,
            temp: '15', icon: '100', text: '阴', wind360: '0', windDir: '北风',
            windScale: '1', windSpeed: '5', humidity: '60', pop: '0', precip: '0',
            pressure: '1013', cloud: '50', dew: '8',
          },
          {
            fxTime: `2026-03-27T${pad(currentHour)}:00+08:00`,
            temp: '28', icon: '100', text: '晴', wind360: '90', windDir: '东风',
            windScale: '2', windSpeed: '10', humidity: '40', pop: '0', precip: '0',
            pressure: '1015', cloud: '5', dew: '12',
          },
        ],
      };

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: true, json: async () => hourlyData };
      }) as any;

      const result = await fetchWeatherInfo();
      expect(result).not.toBeNull();
      // Should pick the entry matching current hour (temp 28)
      expect(result!.temp).toBe('28');
    });

    test('falls back to first hourly entry if no hour matches', async () => {
      // All entries have hour = 99 which never matches
      const hourlyData = {
        code: '200',
        updateTime: '2026-03-27T12:00+08:00',
        fxLink: '',
        hourly: [
          {
            fxTime: '2099-01-01T25:00+08:00', // invalid hour, won't match
            temp: '99', icon: '100', text: '未知', wind360: '0', windDir: '无风',
            windScale: '0', windSpeed: '0', humidity: '0', pop: '0', precip: '0',
            pressure: '0', cloud: '0', dew: '0',
          },
        ],
      };

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: true, json: async () => hourlyData };
      }) as any;

      const result = await fetchWeatherInfo();
      expect(result).not.toBeNull();
      // Falls back to first entry
      expect(result!.temp).toBe('99');
    });

    test('returns null on exception during fetch pipeline', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        throw new Error('Network error');
      }) as any;

      const result = await fetchWeatherInfo();
      expect(result).toBeNull();
    });

    test('uses X-QW-Api-Key header when apiKey is configured', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: true, json: async () => makeHourlyResponse() };
      }) as any;

      await fetchWeatherInfo();

      // Check first fetch call (city lookup) headers
      const firstCall = (globalThis.fetch as any).mock.calls[0];
      expect(firstCall[1].headers).toHaveProperty('X-QW-Api-Key', 'fake-api-key-12345');
    });
  });

  // ── fetchDailyWeatherInfo ────────────────────────────────────────────────
  describe('fetchDailyWeatherInfo', () => {
    test('returns null when city lookup fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: '404', location: [] }),
      }) as any;

      const result = await fetchDailyWeatherInfo();
      expect(result).toBeNull();
    });

    test('returns daily weather info on success', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse('北京', '101010100') };
        }
        return { ok: true, json: async () => makeDailyResponse(3) };
      }) as any;

      const result = await fetchDailyWeatherInfo();
      expect(result).not.toBeNull();
      expect(result!.location).toBe('北京');
      expect(result!.daily).toHaveLength(3);
      expect(result!.daily[0].fxDate).toBe('2026-03-27');
      expect(result!.daily[0].tempMax).toBe('20');
      expect(result!.daily[0].tempMin).toBe('10');
      expect(result!.daily[0].textDay).toBe('晴');
      expect(result!.daily[0].textNight).toBe('多云');
    });

    test('passes custom days parameter', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: true, json: async () => makeDailyResponse(7) };
      }) as any;

      const result = await fetchDailyWeatherInfo('北京', '7d');
      expect(result).not.toBeNull();
      expect(result!.daily).toHaveLength(7);

      // Verify the URL contains 7d
      const secondCall = (globalThis.fetch as any).mock.calls[1];
      expect(secondCall[0]).toContain('/7d?');
    });

    test('uses custom location parameter', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse('广州', '101280101') };
        }
        return { ok: true, json: async () => makeDailyResponse(3) };
      }) as any;

      const result = await fetchDailyWeatherInfo('广州');
      expect(result).not.toBeNull();
      expect(result!.location).toBe('广州');
    });

    test('returns null when daily data is empty', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: true, json: async () => ({ code: '200', updateTime: '', fxLink: '', daily: [] }) };
      }) as any;

      const result = await fetchDailyWeatherInfo();
      expect(result).toBeNull();
    });

    test('returns null when daily weather API returns error code', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: true, json: async () => ({ code: '403', updateTime: '', fxLink: '', daily: [] }) };
      }) as any;

      const result = await fetchDailyWeatherInfo();
      expect(result).toBeNull();
    });

    test('returns null when daily weather fetch is not ok', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: false, status: 500, text: async () => 'Server Error' };
      }) as any;

      const result = await fetchDailyWeatherInfo();
      expect(result).toBeNull();
    });

    test('returns null on fetch exception', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        throw new Error('Timeout');
      }) as any;

      const result = await fetchDailyWeatherInfo();
      expect(result).toBeNull();
    });

    test('returns null when no API key or token', async () => {
      mockGetWeatherConfig.mockReturnValue({
        apiHost: 'devapi.qweather.com',
        apiKey: '',
        token: '',
        defaultLocation: '北京',
      });

      const result = await fetchDailyWeatherInfo();
      expect(result).toBeNull();
    });

    test('maps all daily fields correctly', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => makeCityLookupResponse() };
        }
        return { ok: true, json: async () => makeDailyResponse(1) };
      }) as any;

      const result = await fetchDailyWeatherInfo();
      expect(result).not.toBeNull();
      const day = result!.daily[0];
      expect(day).toHaveProperty('fxDate');
      expect(day).toHaveProperty('sunrise');
      expect(day).toHaveProperty('sunset');
      expect(day).toHaveProperty('tempMax');
      expect(day).toHaveProperty('tempMin');
      expect(day).toHaveProperty('textDay');
      expect(day).toHaveProperty('textNight');
      expect(day).toHaveProperty('windDirDay');
      expect(day).toHaveProperty('windScaleDay');
      expect(day).toHaveProperty('windDirNight');
      expect(day).toHaveProperty('windScaleNight');
      expect(day).toHaveProperty('humidity');
      expect(day).toHaveProperty('precip');
      expect(day).toHaveProperty('uvIndex');
    });
  });

  // ── Auth headers branch coverage ─────────────────────────────────────────
  describe('auth header branches', () => {
    test('uses Bearer token when only token is configured', async () => {
      mockGetWeatherConfig.mockReturnValue({
        apiHost: 'devapi.qweather.com',
        apiKey: '',
        token: 'my-jwt-token',
        defaultLocation: '北京',
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => makeCityLookupResponse(),
      }) as any;

      await searchCity('北京');

      const call = (globalThis.fetch as any).mock.calls[0];
      expect(call[1].headers).toHaveProperty('Authorization', 'Bearer my-jwt-token');
      expect(call[1].headers).not.toHaveProperty('X-QW-Api-Key');
    });

    test('prefers apiKey over token when both are set', async () => {
      mockGetWeatherConfig.mockReturnValue({
        apiHost: 'devapi.qweather.com',
        apiKey: 'my-api-key',
        token: 'my-jwt-token',
        defaultLocation: '北京',
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => makeCityLookupResponse(),
      }) as any;

      await searchCity('北京');

      const call = (globalThis.fetch as any).mock.calls[0];
      expect(call[1].headers).toHaveProperty('X-QW-Api-Key', 'my-api-key');
      expect(call[1].headers).not.toHaveProperty('Authorization');
    });
  });
});
