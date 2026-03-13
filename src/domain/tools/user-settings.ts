/**
 * User Settings Tool
 *
 * Allows users to update their location and timezone settings through conversation
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { BuiltinToolResult } from './builtin';
import { getTimezoneFromLocation } from './timezone';
import { reloadConfig } from '../../infra/config';
import type { AppConfig } from '../../infra/config/schema';

/**
 * Update user settings tool definition
 */
export const updateUserSettingsTool = {
  name: 'update_user_settings',
  description: 'Update user settings like location and timezone. Changes are saved to beeclaw.json.',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'User\'s location (city name, e.g., "北京", "上海", "New York")',
      },
      timezone: {
        type: 'string',
        description: 'User\'s timezone (IANA format, e.g., "Asia/Shanghai", "America/New_York"). Optional - will be auto-derived from location if not specified.',
      },
    },
    required: ['location'],
  },
};

/**
 * Execute update user settings
 */
export async function executeUpdateUserSettings(params: {
  location?: string;
  timezone?: string;
}): Promise<BuiltinToolResult> {
  const { location, timezone } = params;

  if (!location) {
    return {
      success: false,
      error: 'Location is required',
    };
  }

  try {
    // 1. If location provided but no timezone, derive it
    let resolvedTimezone = timezone;
    if (location && !timezone) {
      const derivedTimezone = await getTimezoneFromLocation(location);
      if (derivedTimezone) {
        resolvedTimezone = derivedTimezone;
      } else {
        // If derivation failed, use default
        resolvedTimezone = 'Asia/Shanghai';
      }
    }

    // 2. Update config file
    const configPath = join(process.cwd(), 'beeclaw.json');
    let config: Partial<AppConfig>;

    try {
      const configContent = readFileSync(configPath, 'utf-8');
      config = JSON.parse(configContent) as Partial<AppConfig>;
    } catch (error) {
      // Config file doesn't exist or is invalid, create new one with minimal structure
      config = {};
    }

    if (!config.user) {
      config.user = {};
    }

    if (location) {
      config.user.location = location;
    }

    if (resolvedTimezone) {
      config.user.timezone = resolvedTimezone;
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // 3. Reload config
    reloadConfig();

    // 4. Return success message
    const messages: string[] = [];
    if (location) {
      messages.push(`✅ 位置已更新为: ${location}`);
    }
    if (resolvedTimezone) {
      messages.push(`✅ 时区已更新为: ${resolvedTimezone}`);
    }
    messages.push('\n配置已保存到 beeclaw.json 文件,重启后生效。');

    return {
      success: true,
      data: {
        message: messages.join('\n'),
        location,
        timezone: resolvedTimezone,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update user settings: ${error}`,
    };
  }
}

