/**
 * QWeather API Integration
 *
 * Fetches weather information from QWeather (和风天气) API
 * Provides dynamic weather context for system prompts
 */

import { logger } from '../utils/logger';
import { getWeatherConfig } from '../config';

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

/**
 * Search for city location ID
 */
async function searchCity(location: string): Promise<{ id: string; name: string } | null> {
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
 * Get current hour index (0-23)
 */
function getCurrentHourIndex(): number {
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
    const currentMinute = now.getMinutes();

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
