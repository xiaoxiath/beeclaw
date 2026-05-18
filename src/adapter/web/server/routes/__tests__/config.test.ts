import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Mock fs
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock('fs', () => ({
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
}));

// Mock deepMerge
vi.mock('../../../../../infra/utils', () => ({
  deepMerge: (target: any, updates: any) => ({ ...target, ...updates }),
}));

// Mock AppConfigSchema
vi.mock('@/infra/config/schema', () => ({
  AppConfigSchema: {
    parse: vi.fn((config: any) => config),
  },
}));

import configRoutes from '../config';
import { AppConfigSchema } from '@/infra/config/schema';

describe('Config Routes', () => {
  const sampleConfig = {
    logging: { level: 'info', format: 'pretty' },
    memory: { type: 'filesystem', path: '/data' },
    user: { name: 'Test User' },
    web: {
      enabled: true,
      port: 3000,
      host: '0.0.0.0',
      auth: { level: 'none' },
    },
    providers: [
      { name: 'openai', apiKey: 'sk-fake-key-123456' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(JSON.stringify(sampleConfig));
    (AppConfigSchema.parse as any).mockImplementation((config: any) => config);
  });

  // ─── GET / ───
  describe('GET / (get config)', () => {
    it('returns sanitized config', async () => {
      const res = await configRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.config).toBeDefined();
      expect(json.path).toBeDefined();
      // API keys should be masked
      expect(json.config.providers[0].apiKey).toBe('***MASKED***');
    });

    it('masks web auth token', async () => {
      const configWithToken = {
        ...sampleConfig,
        web: {
          ...sampleConfig.web,
          auth: { level: 'token', token: 'my-secret-token' },
        },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(configWithToken));

      const res = await configRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.config.web.auth.token).toBe('***MASKED***');
    });

    it('masks basicUsers passwords', async () => {
      const configWithBasic = {
        ...sampleConfig,
        web: {
          ...sampleConfig.web,
          auth: {
            level: 'basic',
            basicUsers: [{ username: 'admin', password: 'secret123' }],
          },
        },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(configWithBasic));

      const res = await configRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.config.web.auth.basicUsers[0].password).toBe('***MASKED***');
      expect(json.config.web.auth.basicUsers[0].username).toBe('admin');
    });

    it('handles providers without apiKey', async () => {
      const configNoKey = {
        ...sampleConfig,
        providers: [{ name: 'local' }],
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(configNoKey));

      const res = await configRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.config.providers[0].apiKey).toBeUndefined();
    });

    it('returns 500 when config file not found', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

      const res = await configRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe(true);
      expect(json.message).toBe('ENOENT');
    });

    it('returns 500 on JSON parse error', async () => {
      mockReadFileSync.mockReturnValue('not valid json');

      const res = await configRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe(true);
    });

    it('handles non-Error throws', async () => {
      mockReadFileSync.mockImplementation(() => { throw 'string error'; });

      const res = await configRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.message).toBe('Failed to read config');
    });
  });

  // ─── PUT / ───
  describe('PUT / (update config)', () => {
    it('updates config successfully', async () => {
      const res = await configRoutes.request('/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logging: { level: 'debug' },
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.message).toContain('updated');
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('returns sanitized config in response', async () => {
      const configWithKey = {
        ...sampleConfig,
        providers: [{ name: 'openai', apiKey: 'sk-new-key' }],
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(configWithKey));

      const res = await configRoutes.request('/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logging: { level: 'debug' },
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.config.providers[0].apiKey).toBe('***MASKED***');
    });

    it('returns 400 for validation error from AppConfigSchema', async () => {
      // Suppress console.error output during this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Import the zod module to create a ZodError
      const { z } = await import('zod');
      const zodError = new z.ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['logging', 'level'],
          message: 'Expected string, received number',
        },
      ]);
      (AppConfigSchema.parse as any).mockImplementation(() => {
        throw zodError;
      });

      const res = await configRoutes.request('/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logging: { level: 'debug' },
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe(true);
      expect(json.message).toBe('Validation failed');

      consoleSpy.mockRestore();
    });

    it('returns 500 when reading config fails during update', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('Read failed'); });

      const res = await configRoutes.request('/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logging: { level: 'debug' },
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe(true);
      expect(json.message).toBe('Read failed');
    });

    it('returns 500 when writing config fails', async () => {
      mockWriteFileSync.mockImplementation(() => { throw new Error('Write failed'); });

      const res = await configRoutes.request('/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logging: { level: 'debug' },
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe(true);
      expect(json.message).toBe('Write failed');
    });

    it('handles non-Error throw during update', async () => {
      mockReadFileSync.mockImplementation(() => { throw 42; });

      const res = await configRoutes.request('/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logging: { level: 'debug' },
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.message).toBe('Failed to update config');
    });

    it('updates user config', async () => {
      const res = await configRoutes.request('/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: { name: 'New Name', timezone: 'America/New_York' },
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });

    it('updates web config', async () => {
      const res = await configRoutes.request('/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          web: { port: 8080 },
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });
  });
});
