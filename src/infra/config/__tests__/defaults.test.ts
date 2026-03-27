import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_CONFIG, mergeWithDefaults, getDefault, isDefaultValue } from '../defaults';

describe('defaults', () => {
  describe('DEFAULT_CONFIG', () => {
    it('should have server defaults', () => {
      expect(DEFAULT_CONFIG.server.port).toBe(3000);
      expect(DEFAULT_CONFIG.server.host).toBe('0.0.0.0');
    });

    it('should have auth disabled by default', () => {
      expect(DEFAULT_CONFIG.auth.enabled).toBe(false);
      expect(DEFAULT_CONFIG.auth.tokens).toEqual([]);
    });

    it('should have CORS enabled with localhost', () => {
      expect(DEFAULT_CONFIG.cors.enabled).toBe(true);
      expect(DEFAULT_CONFIG.cors.origins).toEqual(['localhost']);
      expect(DEFAULT_CONFIG.cors.methods).toContain('GET');
      expect(DEFAULT_CONFIG.cors.methods).toContain('POST');
      expect(DEFAULT_CONFIG.cors.credentials).toBe(true);
      expect(DEFAULT_CONFIG.cors.maxAge).toBe(86400);
    });

    it('should have empty providers array', () => {
      expect(DEFAULT_CONFIG.providers).toEqual([]);
    });

    it('should have agent defaults', () => {
      expect(DEFAULT_CONFIG.agent.name).toBe('Default Assistant');
      expect(DEFAULT_CONFIG.agent.role).toBe('chat');
      expect(DEFAULT_CONFIG.agent.visionRole).toBe('vision');
      expect(DEFAULT_CONFIG.agent.tools).toContain('memory_ls');
      expect(DEFAULT_CONFIG.agent.tools).toContain('memory_write');
    });

    it('should have memory defaults', () => {
      expect(DEFAULT_CONFIG.memory.type).toBe('filesystem');
      expect(DEFAULT_CONFIG.memory.path).toBe('./data/memory');
      expect(DEFAULT_CONFIG.memory.tools.autoRecord).toBe(true);
      expect(DEFAULT_CONFIG.memory.search.hybrid.vectorWeight).toBe(0.7);
      expect(DEFAULT_CONFIG.memory.search.hybrid.textWeight).toBe(0.3);
    });

    it('should have MCP enabled by default', () => {
      expect(DEFAULT_CONFIG.mcp.enabled).toBe(true);
      expect(DEFAULT_CONFIG.mcp.servers).toEqual([]);
    });

    it('should have feishu disabled by default', () => {
      expect(DEFAULT_CONFIG.feishu.enabled).toBe(false);
    });

    it('should have logging defaults', () => {
      expect(DEFAULT_CONFIG.logging.level).toBe('info');
      expect(DEFAULT_CONFIG.logging.format).toBe('pretty');
    });

    it('should have sandbox disabled by default', () => {
      expect(DEFAULT_CONFIG.sandbox.enabled).toBe(false);
      expect(DEFAULT_CONFIG.sandbox.provider).toBe('auto');
    });

    it('should have compression defaults', () => {
      expect(DEFAULT_CONFIG.compression.enabled).toBe(true);
      expect(DEFAULT_CONFIG.compression.threshold).toBe(0.8);
      expect(DEFAULT_CONFIG.compression.keepRecent).toBe(8);
      expect(DEFAULT_CONFIG.compression.strategy).toBe('hybrid');
    });

    it('should have extraction defaults', () => {
      expect(DEFAULT_CONFIG.extraction.enabled).toBe(true);
      expect(DEFAULT_CONFIG.extraction.confidenceThreshold).toBe(0.9);
      expect(DEFAULT_CONFIG.extraction.sensitivePatterns).toContain('password');
      expect(DEFAULT_CONFIG.extraction.sensitivePatterns).toContain('api_key');
    });

    it('should have llmRouter enabled by default', () => {
      expect(DEFAULT_CONFIG.llmRouter.enabled).toBe(true);
      expect(DEFAULT_CONFIG.llmRouter.fallbackEnabled).toBe(true);
      expect(DEFAULT_CONFIG.llmRouter.costTracking).toBe(true);
    });

    it('should have plugins enabled by default', () => {
      expect(DEFAULT_CONFIG.plugins.enabled).toBe(true);
      expect(DEFAULT_CONFIG.plugins.disabledPlugins).toEqual([]);
    });

    it('should have web UI disabled by default', () => {
      expect(DEFAULT_CONFIG.web.enabled).toBe(false);
    });

    it('should have toolSelector defaults', () => {
      expect(DEFAULT_CONFIG.toolSelector.strategy).toBe('hybrid');
      expect(DEFAULT_CONFIG.toolSelector.maxTools).toBe(30);
      expect(DEFAULT_CONFIG.toolSelector.cache.enabled).toBe(true);
    });
  });

  describe('mergeWithDefaults', () => {
    it('should return defaults when given empty config', () => {
      const result = mergeWithDefaults({});
      expect(result.server.port).toBe(3000);
      expect(result.logging.level).toBe('info');
    });

    it('should override specific values', () => {
      const result = mergeWithDefaults({
        server: { port: 8080, host: '127.0.0.1' },
      } as any);
      expect(result.server.port).toBe(8080);
      expect(result.server.host).toBe('127.0.0.1');
    });

    it('should deep merge nested objects', () => {
      const result = mergeWithDefaults({
        logging: { level: 'debug' },
      } as any);
      expect(result.logging.level).toBe('debug');
      expect(result.logging.format).toBe('pretty'); // preserved from default
    });

    it('should replace arrays (not concatenate)', () => {
      const result = mergeWithDefaults({
        providers: [{ id: 'test', type: 'openai', apiKey: 'key' }],
      } as any);
      expect(result.providers).toHaveLength(1);
      expect(result.providers[0].id).toBe('test');
    });

    it('should preserve all default keys not in override', () => {
      const result = mergeWithDefaults({ server: { port: 9999 } } as any);
      expect(result.auth).toBeDefined();
      expect(result.cors).toBeDefined();
      expect(result.memory).toBeDefined();
      expect(result.mcp).toBeDefined();
    });
  });

  describe('getDefault', () => {
    it('should return default server config', () => {
      const server = getDefault('server');
      expect(server.port).toBe(3000);
      expect(server.host).toBe('0.0.0.0');
    });

    it('should return default logging config', () => {
      const logging = getDefault('logging');
      expect(logging.level).toBe('info');
      expect(logging.format).toBe('pretty');
    });

    it('should return default memory config', () => {
      const memory = getDefault('memory');
      expect(memory.type).toBe('filesystem');
    });
  });

  describe('isDefaultValue', () => {
    it('should return true for matching default values', () => {
      expect(isDefaultValue('server', { port: 3000, host: '0.0.0.0' })).toBe(true);
    });

    it('should return false for non-default values', () => {
      expect(isDefaultValue('server', { port: 8080, host: '0.0.0.0' } as any)).toBe(false);
    });

    it('should return true for default logging', () => {
      expect(isDefaultValue('logging', { level: 'info', format: 'pretty' })).toBe(true);
    });

    it('should return false when value differs', () => {
      expect(isDefaultValue('logging', { level: 'debug', format: 'pretty' } as any)).toBe(false);
    });
  });
});
