/**
 * Time & Weather Tools
 *
 * Extracted from builtin.ts for modular organization.
 */

import { z } from 'zod';
import { logger } from '../../infra/observability/logger';
import { getConfig } from '../../infra/config';
import {
  fetchWeatherInfo,
  formatWeatherDescription,
  fetchDailyWeatherInfo,
  formatDailyWeatherDescription,
} from '../tools/weather';
import type { BuiltinToolResult } from './builtin';

// ============================================================================
// Time Tool
// ============================================================================

export const TimeSchema = z.object({
  timezone: z.string().optional().describe('Timezone (e.g., "Asia/Shanghai", "America/New_York")'),
  format: z.string().optional().default('YYYY-MM-DD HH:mm:ss').describe('Time format'),
});

export const timeTool = {
  name: 'time_now',
  description: 'Get the current date and time. Uses user timezone from config (default: Asia/Shanghai).',
  parameters: {
    type: 'object' as const,
    properties: {
      timezone: {
        type: 'string',
        description: 'Override timezone (e.g., "America/New_York"). Default: user configured timezone',
      },
      format: {
        type: 'string',
        description: 'Custom format string (default: YYYY-MM-DD HH:mm:ss)',
      },
    },
    required: [],
  },
};

export async function executeTime(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = TimeSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { timezone: paramTimezone } = parsed.data;
  const now = new Date();

  // Get user timezone from config, fallback to Asia/Shanghai
  let defaultTimezone = 'Asia/Shanghai';
  try {
    const config = getConfig();
    if (config?.user?.timezone) {
      defaultTimezone = config.user.timezone;
    }
  } catch (error) {
    logger.debug('Failed to get timezone from config:', error);
  }

  const timezone = paramTimezone || defaultTimezone;

  try {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long',
      timeZoneName: 'long',
    };

    options.timeZone = timezone;

    const formatted = now.toLocaleString('zh-CN', options);

    // Additional info
    const iso = now.toISOString();
    const unix = Math.floor(now.getTime() / 1000);

    const result = `当前时间: ${formatted}
ISO 格式: ${iso}
Unix 时间戳: ${unix}
时区: ${timezone}`;

    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: `Time error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Weather Tool (using QWeather API)
// ============================================================================

export const WeatherSchema = z.object({
  location: z.string().describe('City name or location (e.g., "Beijing", "New York")'),
  format: z.enum(['current', 'forecast', 'detailed']).optional().default('current').describe('Weather format'),
  days: z.enum(['3d', '7d', '10d', '15d', '30d']).optional().default('3d').describe('Forecast days (only for forecast format)'),
});

export const weatherTool = {
  name: 'weather',
  description: 'Get current weather information and forecast for a location using QWeather (和风天气) API. Supports Chinese cities with detailed weather data.',
  parameters: {
    type: 'object' as const,
    properties: {
      location: {
        type: 'string',
        description: 'City name or location in Chinese or English (e.g., "北京", "Beijing", "上海")',
      },
      format: {
        type: 'string',
        enum: ['current', 'forecast', 'detailed'],
        description: 'Weather format: current (simple), detailed (full info), forecast (multi-day forecast)',
      },
      days: {
        type: 'string',
        enum: ['3d', '7d', '10d', '15d', '30d'],
        description: 'Number of days for forecast (only used when format=forecast, default: 3d)',
      },
    },
    required: ['location'],
  },
};

export async function executeWeather(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = WeatherSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { location, format, days } = parsed.data;

  try {
    // Handle different formats
    if (format === 'forecast') {
      // Fetch multi-day forecast
      const dailyWeatherInfo = await fetchDailyWeatherInfo(location, days);

      if (!dailyWeatherInfo) {
        return {
          success: false,
          error: `无法获取 ${location} 的天气预报。请检查 QWEATHER_KEY 或 QWEATHER_TOKEN 配置。`
        };
      }

      const result = formatDailyWeatherDescription(dailyWeatherInfo);
      return { success: true, data: result };
    } else {
      // Fetch current weather for 'current' and 'detailed' formats
      const weatherInfo = await fetchWeatherInfo(location);

      if (!weatherInfo) {
        return {
          success: false,
          error: `无法获取 ${location} 的天气信息。请检查 QWEATHER_KEY 或 QWEATHER_TOKEN 配置。`
        };
      }

      let result: string;

      if (format === 'current') {
        // Simple current weather
        result = formatWeatherDescription(weatherInfo);
      } else {
        // Detailed format
        result = `📍 ${weatherInfo.location} (ID: ${weatherInfo.locationId})

🌡️ 温度: ${weatherInfo.temp}°C
☁️ 天气: ${weatherInfo.text}
💨 风向风力: ${weatherInfo.windDir} ${weatherInfo.windScale}级
💧 湿度: ${weatherInfo.humidity}%
🕐 更新时间: ${weatherInfo.updateTime}

📊 数据来源: 和风天气`;
      }

      return { success: true, data: result };
    }
  } catch (error) {
    return {
      success: false,
      error: `天气查询失败: ${error instanceof Error ? error.message : '未知错误'}`
    };
  }
}
