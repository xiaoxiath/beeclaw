/**
 * Holiday API Integration
 *
 * Fetches Chinese holiday and workday information from timor.tech API
 * Provides dynamic context about whether today is a workday, holiday, or adjusted workday (调休)
 */

import { logger } from '../../infra/observability/logger';
import { cache } from '../../infra/cache';

const HOLIDAY_API_BASE = 'https://holiday.ailcc.com/api/holiday/info';

export interface HolidayInfo {
  date: string;           // 日期 YYYY-MM-DD
  isWorkday: boolean;     // 是否工作日
  isHoliday: boolean;     // 是否节假日
  isAdjusted: boolean;    // 是否调休（周末补班）
  holidayName?: string;   // 假期名称（如果是节假日）
  weekDay: number;        // 星期几 (0-6, 0=周日)
}

interface HolidayApiResponse {
  code: number;
  type: {
    type: number;        // 0=工作日, 1=周末, 2=节假日, 4=调休
    name: string;        // 日期名称
    week: number;        // 周几 (0-6, 0=周日)
    cnLunar: string;     // 农历
    extra_info: string;  // 额外信息
  };
  holiday: {
    holiday: boolean;    // 是否放假
    name: string;        // 假期名称
    wage: number;        // 加班工资倍数
    date: string;        // 日期
    after: number | null;
    target: string;      // 目标节日
    rest: number;        // 距离天数
  } | null;
}

// Cache keys and TTL (using unified MemoryCache from infra/cache)
const HOLIDAY_CACHE_KEY = 'holiday:info';
const HOLIDAY_TTL = 86400; // 24 hours in seconds (refreshed daily)

/**
 * Parse API response to HolidayInfo
 */
function parseApiResponse(data: HolidayApiResponse, dateStr: string): HolidayInfo {
  // Determine if it's a workday
  // type: 0=工作日, 1=周末, 2=节假日, 4=调休
  const isWorkday = data.type.type === 0 || data.type.type === 4;
  const isHoliday = data.type.type === 2;
  const isAdjusted = data.type.type === 4;

  return {
    date: data.holiday?.date || dateStr,
    isWorkday,
    isHoliday,
    isAdjusted,
    holidayName: data.holiday?.target || undefined,
    weekDay: data.type.week,
  };
}

/**
 * Fetch holiday information for a specific date
 */
export async function fetchHolidayInfo(date?: Date): Promise<HolidayInfo | null> {
  const targetDate = date || new Date();
  const dateStr = formatDate(targetDate);

  // Check cache (only for today's date)
  if (!date) {
    const cached = cache.get<HolidayInfo>(`${HOLIDAY_CACHE_KEY}:${dateStr}`);
    if (cached) return cached;
  }

  try {
    const response = await fetch(`${HOLIDAY_API_BASE}/${dateStr}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Beeclaw/1.0',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`Holiday API returned ${response.status}: ${errorText}`);
      return null;
    }

    const data: HolidayApiResponse = await response.json();

    if (data.code !== 0) {
      logger.warn('Holiday API returned error code:', data.code);
      return null;
    }

    const info = parseApiResponse(data, dateStr);

    // Cache if it's today's date
    if (!date) {
      cache.set(`${HOLIDAY_CACHE_KEY}:${dateStr}`, info, HOLIDAY_TTL);
    }

    logger.info(`Holiday info fetched: ${formatHolidayDescription(info)}`);
    return info;
  } catch (error) {
    logger.error('Failed to fetch holiday info:', error);
    return null;
  }
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get human-readable description of the date
 */
export function formatHolidayDescription(info: HolidayInfo): string {
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const parts: string[] = [];

  parts.push(`今天是 ${info.date} ${weekDays[info.weekDay]}`);

  if (info.isHoliday && info.holidayName) {
    parts.push(`【${info.holidayName}假期】`);
  } else if (info.isAdjusted) {
    parts.push(`【调休工作日】`);
  } else if (info.isWorkday) {
    parts.push(`【工作日】`);
  } else if (!info.isWorkday && !info.isHoliday) {
    parts.push(`【周末】`);
  }

  return parts.join('，');
}

/**
 * Get system prompt context about today's date and holiday status
 *
 * Note: This is a synchronous function that uses cached holiday info.
 * Call fetchHolidayInfo() asynchronously elsewhere to populate the cache.
 */
export function getDateContext(): string {
  const today = new Date();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dateStr = formatDate(today);

  // Try to use cached info
  const cached = cache.get<HolidayInfo>(`${HOLIDAY_CACHE_KEY}:${dateStr}`);
  if (cached) {
    return formatHolidayDescription(cached);
  }

  // Fallback: just show today's date without holiday info
  // The cache will be populated asynchronously elsewhere
  return `今天是 ${dateStr} ${weekDays[today.getDay()]}`;
}

/**
 * Clear cache (useful for testing or forced refresh)
 */
export function clearHolidayCache(): void {
  cache.cleanup();
}
