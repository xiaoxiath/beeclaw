/**
 * Timezone Utilities
 *
 * Derives timezone from location using weather API
 * Provides synchronous resolution with cached results
 */

import { searchCity } from './weather';
import { logger } from './logger';

const locationTimezoneCache = new Map<string, string>();

/**
 * Get timezone from location using weather API
 * Results are cached for performance
 */
export async function getTimezoneFromLocation(location: string): Promise<string | null> {
  // Check cache
  if (locationTimezoneCache.has(location)) {
    return locationTimezoneCache.get(location)!;
  }

  try {
    // Use weather API to get timezone info
    const cityInfo = await searchCity(location);
    if (cityInfo && cityInfo.tz) {
      locationTimezoneCache.set(location, cityInfo.tz);
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
  const { getConfig } = require('../config');
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
    const { getConfig } = require('../config');
    const config = getConfig();

    // 1. Explicit timezone config (highest priority)
    if (config.user?.timezone) {
      return config.user.timezone;
    }

    // 2. Try to get from cache (derived at startup)
    if (config.user?.location) {
      const cachedTz = locationTimezoneCache.get(config.user.location);
      if (cachedTz) {
        return cachedTz;
      }
    }
  } catch (error) {
    // Config not loaded, use default
  }

  // 3. Default fallback
  return 'Asia/Shanghai';
}

/**
 * Resolve user location with fallback
 */
export function resolveUserLocation(): string {
  try {
    const { getConfig } = require('../config');
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
    // Config not loaded, use default
  }

  // 3. Default
  return '北京';
}

/**
 * Clear cache (for testing)
 */
export function clearTimezoneCache(): void {
  locationTimezoneCache.clear();
}
