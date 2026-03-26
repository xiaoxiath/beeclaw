/**
 * Timezone Utilities
 *
 * Derives timezone from location using weather API
 * Provides synchronous resolution with cached results
 */

import { searchCity } from './weather';
import { logger } from '../../infra/observability/logger';
import { getConfig } from '../../infra/config';
import { cache } from '../../infra/cache';

const TZ_CACHE_PREFIX = 'timezone:location:';
const TZ_TTL = 86400; // 24 hours in seconds

/**
 * Get timezone from location using weather API
 * Results are cached for performance
 */
export async function getTimezoneFromLocation(location: string): Promise<string | null> {
  // Check unified cache
  const cacheKey = `${TZ_CACHE_PREFIX}${location}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Use weather API to get timezone info
    const cityInfo = await searchCity(location);
    if (cityInfo && cityInfo.tz) {
      cache.set(cacheKey, cityInfo.tz, TZ_TTL);
      logger.info(`Timezone derived for ${location}: ${cityInfo.tz}`);
      return cityInfo.tz;
    }
  } catch (error) {
    logger.warn(`Failed to derive timezone for ${location}:`, error);
  }

  return null;
}

/**
 * Initialize timezone cache at app startup
 * Should be called in initApp()
 */
export async function initializeTimezoneCache(): Promise<void> {
  const config = getConfig();

  // If user.location is configured but timezone is not, derive it
  if (config.user?.location && !config.user?.timezone) {
    await getTimezoneFromLocation(config.user.location);
  }
}

/**
 * Resolve user timezone (synchronous, uses cache)
 */
export function resolveUserTimezone(): string {
  try {
    const config = getConfig();

    // 1. Explicit timezone config (highest priority)
    if (config.user?.timezone) {
      return config.user.timezone;
    }

    // 2. Try to get from cache (derived at startup)
    if (config.user?.location) {
      const cachedTz = cache.get<string>(`${TZ_CACHE_PREFIX}${config.user.location}`);
      if (cachedTz) {
        return cachedTz;
      }
    }
  } catch (error) {
    logger.warn('Timezone config load failed', { error });
  }

  // 3. Default fallback
  return 'Asia/Shanghai';
}

/**
 * Resolve user location with fallback
 */
export function resolveUserLocation(): string {
  try {
    const config = getConfig();

    // 1. User location (highest priority)
    if (config.user?.location) {
      return config.user.location;
    }

    // 2. Weather default location (backward compatibility)
    if (config.weather?.defaultLocation) {
      return config.weather.defaultLocation;
    }
  } catch (error) {
    logger.warn('Timezone config load failed', { error });
  }

  // 3. Default
  return '北京';
}

/**
 * Clear cache (for testing)
 */
export function clearTimezoneCache(): void {
  cache.cleanup();
}
