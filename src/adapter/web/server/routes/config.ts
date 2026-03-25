import { Hono } from 'hono';
import { logger } from '../../../../infra/observability/logger';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AppConfigSchema } from '@/infra/config/schema';
import { deepMerge } from '../../../../infra/utils';

const CONFIG_FILE = join(process.cwd(), 'beeclaw.json');

// Schema for config updates (partial)
const configUpdateSchema = z.object({
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    format: z.enum(['pretty', 'json']).optional(),
  }).optional(),
  memory: z.object({
    type: z.enum(['filesystem']).optional(),
    path: z.string().optional(),
    retentionDays: z.number().optional(),
    maxEntries: z.number().optional(),
  }).optional(),
  user: z.object({
    name: z.string().optional(),
    location: z.string().optional(),
    timezone: z.string().optional(),
    locale: z.string().optional(),
  }).optional(),
  web: z.object({
    enabled: z.boolean().optional(),
    port: z.number().optional(),
    host: z.string().optional(),
    auth: z.object({
      level: z.enum(['none', 'token', 'basic']).optional(),
      token: z.string().optional(),
      basicUsers: z.array(z.object({
        username: z.string(),
        password: z.string(),
      })).optional(),
    }).optional(),
  }).optional(),
}).passthrough(); // Allow other fields

function sanitizeConfig(config: any): any {
  // Create a deep copy
  const sanitized = JSON.parse(JSON.stringify(config));

  // Mask sensitive fields
  if (sanitized.providers) {
    sanitized.providers = sanitized.providers.map((provider: any) => ({
      ...provider,
      apiKey: provider.apiKey ? '***MASKED***' : undefined,
    }));
  }

  if (sanitized.web?.auth?.token) {
    sanitized.web.auth.token = '***MASKED***';
  }

  if (sanitized.web?.auth?.basicUsers) {
    sanitized.web.auth.basicUsers = sanitized.web.auth.basicUsers.map((user: any) => ({
      username: user.username,
      password: '***MASKED***',
    }));
  }

  return sanitized;
}

export default new Hono()
  // Get current configuration (sanitized)
  .get('/', async (c) => {
    logger.debug('[Config API] GET /');

    try {
      const configContent = readFileSync(CONFIG_FILE, 'utf-8');
      const config = JSON.parse(configContent);

      // Return sanitized config
      const sanitized = sanitizeConfig(config);

      return c.json({
        config: sanitized,
        path: CONFIG_FILE,
      });
    } catch (error) {
      console.error('[Config API] Error reading config:', error);
      return c.json({
        error: true,
        message: error instanceof Error ? error.message : 'Failed to read config',
      }, 500);
    }
  })

  // Update configuration
  .put('/', zValidator('json', configUpdateSchema), async (c) => {
    logger.debug('[Config API] PUT /');
    const updates = c.req.valid('json');
    logger.debug('[Config API] Updates:', JSON.stringify(updates, null, 2));

    try {
      // Read current config
      const configContent = readFileSync(CONFIG_FILE, 'utf-8');
      const currentConfig = JSON.parse(configContent);

      // Deep merge updates
      const newConfig = deepMerge(currentConfig, updates);

      // Validate new config
      const validated = AppConfigSchema.parse(newConfig);

      // Write back to file
      writeFileSync(CONFIG_FILE, JSON.stringify(validated, null, 2));

      logger.debug('[Config API] Config updated successfully');

      return c.json({
        success: true,
        message: 'Configuration updated. Restart may be required for some changes to take effect.',
        config: sanitizeConfig(validated),
      });
    } catch (error) {
      console.error('[Config API] Error updating config:', error);

      if (error instanceof z.ZodError) {
        return c.json({
          error: true,
          message: 'Validation failed',
          details: error.errors,
        }, 400);
      }

      return c.json({
        error: true,
        message: error instanceof Error ? error.message : 'Failed to update config',
      }, 500);
    }
  });
