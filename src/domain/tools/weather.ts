/**
 * QWeather API Integration
 *
 * Fetches weather information from QWeather (和风天气) API
 * Provides dynamic weather context for system prompts
 */

import { logger } from '../../infra/observability/logger';
import { getWeatherConfig } from '../../infra/config';

// Get configuration from unified config system
function getConfig() {
  const config = getWeatherConfig();
  return {
    apiHost: config.apiHost || 'devapi.qweather.com',
    apiKey: config.apiKey,
    token: config.token,
    defaultLocation: config.defaultLocation || '北京',
  };
}

export interface WeatherInfo {
  location: string;           // 城市名称
  locationId: string;         // 城市ID
  temp: string;               // 温度
  text: string;               // 天气状况
  windDir: string;            // 风向
  windScale: string;          // 风力等级
  humidity: string;           // 湿度
  updateTime: string;         // 更新时间
}

export interface DailyWeatherInfo {
  location: string;           // 城市名称
  locationId: string;         // 城市ID
  updateTime: string;         // 更新时间
  daily: Array<{
    fxDate: string;           // 预报日期
    sunrise: string;          // 日出时间
    sunset: string;           // 日落时间
    tempMax: string;          // 最高温度
    tempMin: string;          // 最低温度
    textDay: string;          // 白天天气
    textNight: string;        // 夜间天气
    windDirDay: string;       // 白天风向
    windScaleDay: string;     // 白天风力
    windDirNight: string;     // 夜间风向
    windScaleNight: string;   // 夜间风力
    humidity: string;         // 湿度
    precip: string;           // 降水量
    uvIndex: string;          // 紫外线指数
  }>;
}

interface CityLookupResponse {
  code: string;
  location: Array<{
    name: string;
    id: string;
    lat: string;
    lon: string;
    adm2: string;
    adm1: string;
    country: string;
    tz: string;
    utcOffset: string;
    isDst: string;
    type: string;
    rank: string;
    fxLink: string;
  }>;
}

interface WeatherHourlyResponse {
  code: string;
  updateTime: string;
  fxLink: string;
  hourly: Array<{
    fxTime: string;
    temp: string;
    icon: string;
    text: string;
    wind360: string;
    windDir: string;
    windScale: string;
    windSpeed: string;
    humidity: string;
    pop: string;
    precip: string;
    pressure: string;
    cloud: string;
    dew: string;
  }>;
}

interface WeatherDailyResponse {
  code: string;
  updateTime: string;
  fxLink: string;
  daily: Array<{
    fxDate: string;
    sunrise: string;
    sunset: string;
    moonrise: string;
    moonset: string;
    moonPhase: string;
    moonPhaseIcon: string;
    tempMax: string;
    tempMin: string;
    iconDay: string;
    textDay: string;
    iconNight: string;
    textNight: string;
    wind360Day: string;
    windDirDay: string;
    windScaleDay: string;
    windSpeedDay: string;
    wind360Night: string;
    windDirNight: string;
    windScaleNight: string;
    windSpeedNight: string;
    humidity: string;
    precip: string;
    pressure: string;
    vis: string;
    cloud: string;
    uvIndex: string;
  }>;
}

// Cache for weather info (refreshed every hour)
let cachedWeatherInfo: WeatherInfo | null = null;
let lastFetchTime: number | null = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

// Cache for location ID
let cachedLocationId: string | null = null;
let cachedLocationName: string | null = null;

/**
 * Get authentication headers for QWeather API
 * Supports both API KEY and JWT authentication
 */
function getAuthHeaders(): Record<string, string> {
  const config = getConfig();
  // Prefer API KEY if available (simpler)
  if (config.apiKey) {
    return { 'X-QW-Api-Key': config.apiKey };
  }
  // Fall back to JWT token
  if (config.token) {
    return { 'Authorization': `Bearer ${config.token}` };
  }
  return {};
}

export interface CityInfo {
  id: string;
  name: string;
  tz?: string;  // IANA timezone (e.g., "Asia/Shanghai")
}

/**
 * Search for city location ID and timezone info
 * Exported for use by timezone utilities
 */
export async function searchCity(location: string): Promise<CityInfo | null> {
  const config = getConfig();
  if (!config.apiKey && !config.token) {
    logger.warn('QWEATHER_KEY or QWEATHER_TOKEN not configured, weather info unavailable');
    return null;
  }

  try {
    const url = `https://${config.apiHost}/geo/v2/city/lookup?location=${encodeURIComponent(location)}&lang=zh`;
    const response = await fetch(url, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`City lookup API returned ${response.status}: ${errorText}`);
      return null;
    }

    const data: CityLookupResponse = await response.json();

    if (data.code !== '200' || !data.location || data.location.length === 0) {
      logger.warn('City lookup failed, code:', data.code);
      return null;
    }

    // Return the first result (most relevant)
    const city = data.location[0];
    return {
      id: city.id,
      name: city.name,
      tz: city.tz,  // Include timezone info
    };
  } catch (error) {
    logger.error('Failed to search city:', error);
    return null;
  }
}

/**
 * Fetch hourly weather forecast
 */
async function fetchHourlyWeather(locationId: string): Promise<WeatherHourlyResponse | null> {
  const config = getConfig();
  if (!config.apiKey && !config.token) {
    return null;
  }

  try {
    const url = `https://${config.apiHost}/v7/weather/24h?location=${locationId}&lang=zh`;
    const response = await fetch(url, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`Weather API returned ${response.status}: ${errorText}`);
      return null;
    }

    const data: WeatherHourlyResponse = await response.json();

    if (data.code !== '200') {
      logger.warn('Weather API returned error code:', data.code);
      return null;
    }

    return data;
  } catch (error) {
    logger.error('Failed to fetch weather:', error);
    return null;
  }
}

/**
 * Fetch daily weather forecast
 * @param locationId 城市ID
 * @param days 预报天数: 3d, 7d, 10d, 15d, 30d
 */
async function fetchDailyWeather(locationId: string, days: string = '3d'): Promise<WeatherDailyResponse | null> {
  const config = getConfig();
  if (!config.apiKey && !config.token) {
    return null;
  }

  try {
    const url = `https://${config.apiHost}/v7/weather/${days}?location=${locationId}&lang=zh`;
    const response = await fetch(url, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`Weather API returned ${response.status}: ${errorText}`);
      return null;
    }

    const data: WeatherDailyResponse = await response.json();

    if (data.code !== '200') {
      logger.warn('Weather API returned error code:', data.code);
      return null;
    }

    return data;
  } catch (error) {
    logger.error('Failed to fetch daily weather:', error);
    return null;
  }
}

/**
 * Get current hour index (0-23)
 */
function _getCurrentHourIndex(): number {
  return new Date().getHours();
}

/**
 * Fetch weather information for default location
 */
export async function fetchWeatherInfo(location?: string): Promise<WeatherInfo | null> {
  const config = getConfig();
  const targetLocation = location || config.defaultLocation;

  // Check cache
  const now = Date.now();
  if (
    cachedWeatherInfo &&
    lastFetchTime &&
    now - lastFetchTime < CACHE_DURATION &&
    cachedLocationName === targetLocation
  ) {
    return cachedWeatherInfo;
  }

  try {
    // Step 1: Get location ID (use cache if available)
    if (!cachedLocationId || cachedLocationName !== targetLocation) {
      const cityInfo = await searchCity(targetLocation);
      if (!cityInfo) {
        return null;
      }
      cachedLocationId = cityInfo.id;
      cachedLocationName = cityInfo.name;
    }

    // Step 2: Fetch weather data
    const weatherData = await fetchHourlyWeather(cachedLocationId);
    if (!weatherData || !weatherData.hourly || weatherData.hourly.length === 0) {
      return null;
    }

    // Step 3: Get current hour's weather
    // Find the closest hour
    const now = new Date();
    const currentHour = now.getHours();
    const _currentMinute = now.getMinutes();

    // API returns data starting from the next hour or current hour
    // Find the entry that matches current time best
    let currentWeather = weatherData.hourly[0];

    for (const hourly of weatherData.hourly) {
      const fxTime = new Date(hourly.fxTime);
      const fxHour = fxTime.getHours();

      if (fxHour === currentHour) {
        currentWeather = hourly;
        break;
      }
    }

    // Step 4: Build WeatherInfo
    const info: WeatherInfo = {
      location: cachedLocationName,
      locationId: cachedLocationId,
      temp: currentWeather.temp,
      text: currentWeather.text,
      windDir: currentWeather.windDir,
      windScale: currentWeather.windScale,
      humidity: currentWeather.humidity,
      updateTime: weatherData.updateTime,
    };

    // Cache the result
    cachedWeatherInfo = info;
    lastFetchTime = now;

    logger.info(`Weather info fetched: ${formatWeatherDescription(info)}`);
    return info;
  } catch (error) {
    logger.error('Failed to fetch weather info:', error);
    return null;
  }
}

/**
 * Fetch daily weather forecast
 * @param location 城市名称
 * @param days 预报天数: 3d, 7d, 10d, 15d, 30d
 */
export async function fetchDailyWeatherInfo(location?: string, days: string = '3d'): Promise<DailyWeatherInfo | null> {
  const config = getConfig();
  const targetLocation = location || config.defaultLocation;

  try {
    // Step 1: Get location ID (use cache if available)
    if (!cachedLocationId || cachedLocationName !== targetLocation) {
      const cityInfo = await searchCity(targetLocation);
      if (!cityInfo) {
        return null;
      }
      cachedLocationId = cityInfo.id;
      cachedLocationName = cityInfo.name;
    }

    // Step 2: Fetch daily weather data
    const weatherData = await fetchDailyWeather(cachedLocationId, days);
    if (!weatherData || !weatherData.daily || weatherData.daily.length === 0) {
      return null;
    }

    // Step 3: Build DailyWeatherInfo
    const info: DailyWeatherInfo = {
      location: cachedLocationName,
      locationId: cachedLocationId,
      updateTime: weatherData.updateTime,
      daily: weatherData.daily.map(day => ({
        fxDate: day.fxDate,
        sunrise: day.sunrise,
        sunset: day.sunset,
        tempMax: day.tempMax,
        tempMin: day.tempMin,
        textDay: day.textDay,
        textNight: day.textNight,
        windDirDay: day.windDirDay,
        windScaleDay: day.windScaleDay,
        windDirNight: day.windDirNight,
        windScaleNight: day.windScaleNight,
        humidity: day.humidity,
        precip: day.precip,
        uvIndex: day.uvIndex,
      })),
    };

    logger.info(`Daily weather forecast fetched: ${info.location}, ${info.daily.length} days`);
    return info;
  } catch (error) {
    logger.error('Failed to fetch daily weather info:', error);
    return null;
  }
}

/**
 * Get human-readable description of the weather
 */
export function formatWeatherDescription(info: WeatherInfo): string {
  const parts: string[] = [];

  parts.push(`${info.location}当前天气：${info.text}`);
  parts.push(`温度${info.temp}°C`);
  parts.push(`${info.windDir}${info.windScale}级`);
  parts.push(`湿度${info.humidity}%`);

  return parts.join('，');
}

/**
 * Format daily weather forecast
 */
export function formatDailyWeatherDescription(info: DailyWeatherInfo): string {
  const lines: string[] = [];
  lines.push(`📍 ${info.location} 未来${info.daily.length}天天气预报`);
  lines.push('');

  for (const day of info.daily) {
    const date = new Date(day.fxDate);
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekday = weekdays[date.getDay()];

    lines.push(`📅 ${day.fxDate} (${weekday})`);
    lines.push(`   🌡️  ${day.tempMin}°C ~ ${day.tempMax}°C`);
    lines.push(`   ☀️  白天: ${day.textDay}，${day.windDirDay}${day.windScaleDay}`);
    lines.push(`   🌙  夜间: ${day.textNight}，${day.windDirNight}${day.windScaleNight}`);
    lines.push(`   💧 湿度: ${day.humidity}%，降水: ${day.precip}mm`);
    lines.push(`   🌅 日出: ${day.sunrise}，日落: ${day.sunset}`);
    lines.push('');
  }

  lines.push(`🕐 更新时间: ${info.updateTime}`);
  lines.push('📊 数据来源: 和风天气');

  return lines.join('\n');
}

/**
 * Get weather context for system prompt
 *
 * Note: This is a synchronous function that uses cached weather info.
 * Call fetchWeatherInfo() asynchronously elsewhere to populate the cache.
 */
export function getWeatherContext(): string | null {
  // Check if cache is valid
  const now = Date.now();
  if (
    cachedWeatherInfo &&
    lastFetchTime &&
    now - lastFetchTime < CACHE_DURATION
  ) {
    return formatWeatherDescription(cachedWeatherInfo);
  }

  // Cache expired or not populated yet
  return null;
}

/**
 * Clear cache (useful for testing or forced refresh)
 */
export function clearWeatherCache(): void {
  cachedWeatherInfo = null;
  lastFetchTime = null;
  cachedLocationId = null;
  cachedLocationName = null;
}
