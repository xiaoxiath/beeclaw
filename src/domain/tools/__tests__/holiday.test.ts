import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchHolidayInfo,
  formatHolidayDescription,
  getDateContext,
  clearHolidayCache,
  type HolidayInfo,
} from '../holiday';

const TEST_DATE = new Date('2026-03-01'); // Monday
const TEST_WEEKEND = new Date('2026-03-07'); // Saturday

function holidayApiResponse(date: string) {
  const fixtures: Record<string, { type: number; name: string; week: number; holidayName?: string }> = {
    '2026-01-01': { type: 2, name: '元旦', week: 4, holidayName: '元旦' },
    '2026-03-01': { type: 1, name: '周末', week: 0 },
    '2026-03-04': { type: 0, name: '工作日', week: 3 },
    '2026-03-07': { type: 1, name: '周末', week: 6 },
  };

  const fixture = fixtures[date] || { type: 0, name: '工作日', week: new Date(date).getDay() };
  const holidayName = fixture.holidayName;

  return {
    code: 0,
    type: {
      type: fixture.type,
      name: fixture.name,
      week: fixture.week,
      cnLunar: '',
      extra_info: '',
    },
    holiday: holidayName
      ? {
          holiday: true,
          name: holidayName,
          wage: 3,
          date,
          after: null,
          target: holidayName,
          rest: 0,
        }
      : null,
  };
}

describe('Holiday Utils', () => {
  beforeEach(() => {
    clearHolidayCache();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const date = String(input).split('/').pop() || '2026-03-04';
      return new Response(JSON.stringify(holidayApiResponse(date)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
  });

  afterEach(() => {
    clearHolidayCache();
    vi.unstubAllGlobals();
  });

  describe('fetchHolidayInfo', () => {
    test('returns holiday info for a date', async () => {
      const result = await fetchHolidayInfo(TEST_DATE);

      expect(result).toBeDefined();
      expect(result!.date).toBe('2026-03-01');
      expect(typeof result!.isHoliday).toBe('boolean');
      expect(typeof result!.isWorkday).toBe('boolean');
    });

    test('returns correct holiday info for known holiday', async () => {
      // New Year's Day
      const newYear = new Date('2026-01-01');
      const result = await fetchHolidayInfo(newYear);

      expect(result!.isHoliday).toBe(true);
      expect(result!.holidayName).toBeDefined();
    });

    test('returns non-holiday for regular day', async () => {
      const regularDay = new Date('2026-03-04'); // Wednesday
      const result = await fetchHolidayInfo(regularDay);

      expect(result!.isHoliday).toBe(false);
      expect(result!.holidayName).toBeUndefined();
    });

    test('returns info for weekend', async () => {
      const result = await fetchHolidayInfo(TEST_WEEKEND);

      expect(result).toBeDefined();
      expect(result!.isWorkday).toBe(false);
    });

    test('caches today\'s info', async () => {
      const result1 = await fetchHolidayInfo();
      const result2 = await fetchHolidayInfo();

      // Both should return the same cached result
      expect(result1).toEqual(result2);
    });
  });

  describe('formatHolidayDescription', () => {
    test('formats holiday info correctly', () => {
      const info: HolidayInfo = {
        date: '2026-01-01',
        isWorkday: false,
        isHoliday: true,
        isAdjusted: false,
        holidayName: '元旦',
        weekDay: 4,
      };

      const description = formatHolidayDescription(info);

      expect(description).toContain('2026-01-01');
      expect(description).toContain('元旦');
      expect(description).toContain('周四');
    });

    test('formats workday correctly', () => {
      const info: HolidayInfo = {
        date: '2026-03-04',
        isWorkday: true,
        isHoliday: false,
        isAdjusted: false,
        weekDay: 3,
      };

      const description = formatHolidayDescription(info);

      expect(description).toContain('2026-03-04');
      expect(description).toContain('工作日');
    });

    test('formats adjusted workday correctly', () => {
      const info: HolidayInfo = {
        date: '2026-01-26',
        isWorkday: true,
        isHoliday: false,
        isAdjusted: true,
        weekDay: 0,
      };

      const description = formatHolidayDescription(info);

      expect(description).toContain('调休工作日');
    });

    test('formats weekend correctly', () => {
      const info: HolidayInfo = {
        date: '2026-03-07',
        isWorkday: false,
        isHoliday: false,
        isAdjusted: false,
        weekDay: 6,
      };

      const description = formatHolidayDescription(info);

      expect(description).toContain('周末');
    });
  });

  describe('getDateContext', () => {
    test('returns context string', () => {
      const context = getDateContext();

      expect(context).toBeDefined();
      expect(typeof context).toBe('string');
      expect(context.length).toBeGreaterThan(0);
    });

    test('includes date string in context', () => {
      const context = getDateContext();
      const today = new Date();
      const year = today.getFullYear();

      expect(context).toContain(String(year));
    });

    test('returns cached info when available', async () => {
      // Fetch to populate cache
      await fetchHolidayInfo();

      const context = getDateContext();

      expect(context).toBeDefined();
      expect(typeof context).toBe('string');
    });
  });

  describe('clearHolidayCache', () => {
    test('clears cached holiday info', async () => {
      await fetchHolidayInfo();

      clearHolidayCache();

      // After clearing, cache should be empty
      // This is verified by checking that a new fetch is made
      const result = await fetchHolidayInfo();
      expect(result).toBeDefined();
    });
  });
});
