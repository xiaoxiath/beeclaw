import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger
vi.mock('@infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  getOrCreatePluginRegistry,
  getPluginRegistry,
  resetPluginRegistry,
} from '../index';
import type { PluginRegistry, RegistryFactory, PluginHookRegistration } from '../index';
import { logger } from '@infra/observability/logger';

describe('PluginRegistry - extended coverage', () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  // ─── getOrCreatePluginRegistry ───────────────────────────────
  describe('getOrCreatePluginRegistry', () => {
    it('creates a new registry on first call', () => {
      const factory = getOrCreatePluginRegistry();
      expect(factory).toBeDefined();
      expect(factory.registry).toBeDefined();
      expect(typeof factory.createApi).toBe('function');
    });

    it('returns the same instance on subsequent calls', () => {
      const factory1 = getOrCreatePluginRegistry();
      const factory2 = getOrCreatePluginRegistry();
      expect(factory1).toBe(factory2);
    });

    it('creates registry with all expected maps and arrays', () => {
      const { registry } = getOrCreatePluginRegistry();
      expect(registry.plugins).toBeInstanceOf(Map);
      expect(registry.pluginRootDirs).toBeInstanceOf(Map);
      expect(registry.tools).toBeInstanceOf(Map);
      expect(registry.hooks).toBeInstanceOf(Map);
      expect(registry.typedHooks).toBeInstanceOf(Map);
      expect(registry.channels).toBeInstanceOf(Map);
      expect(registry.providers).toBeInstanceOf(Map);
      expect(registry.gatewayHandlers).toBeInstanceOf(Map);
      expect(registry.httpRoutes).toBeInstanceOf(Map);
      expect(Array.isArray(registry.cliRegistrars)).toBe(true);
      expect(registry.cliRegistrars).toHaveLength(0);
      expect(registry.services).toBeInstanceOf(Map);
      expect(registry.commands).toBeInstanceOf(Map);
      expect(Array.isArray(registry.diagnostics)).toBe(true);
      expect(registry.diagnostics).toHaveLength(0);
    });
  });

  // ─── getPluginRegistry ────────────────────────────────────────
  describe('getPluginRegistry', () => {
    it('throws if registry not initialized', () => {
      expect(() => getPluginRegistry()).toThrow(
        'Plugin registry not initialized. Call getOrCreatePluginRegistry() first.'
      );
    });

    it('returns registry after initialization', () => {
      const factory = getOrCreatePluginRegistry();
      const reg = getPluginRegistry();
      expect(reg).toBe(factory.registry);
    });
  });

  // ─── resetPluginRegistry ──────────────────────────────────────
  describe('resetPluginRegistry', () => {
    it('clears the global registry', () => {
      getOrCreatePluginRegistry();
      resetPluginRegistry();
      expect(() => getPluginRegistry()).toThrow();
    });

    it('allows creating a fresh registry after reset', () => {
      const factory1 = getOrCreatePluginRegistry();
      resetPluginRegistry();
      const factory2 = getOrCreatePluginRegistry();
      expect(factory2).not.toBe(factory1);
    });
  });

  // ─── createApi / Plugin API ──────────────────────────────────
  describe('createApi', () => {
    let factory: RegistryFactory;
    let api: any;

    beforeEach(() => {
      factory = getOrCreatePluginRegistry();
      api = factory.createApi('test-plugin');
    });

    it('returns api with basic fields', () => {
      expect(api.id).toBe('test-plugin');
      expect(api.name).toBe('test-plugin');
      expect(api.source).toBe('test-plugin');
      expect(api.config).toEqual({});
      expect(api.pluginConfig).toEqual({});
      expect(api.runtime).toEqual({});
      expect(api.logger).toBeDefined();
    });

    // ─── registerTool ─────────────────────────────────────────
    describe('registerTool', () => {
      it('registers a tool', () => {
        api.registerTool({ name: 'my-tool', description: 'desc' });
        const reg = factory.registry.tools.get('my-tool');
        expect(reg).toEqual({ name: 'my-tool', description: 'desc', pluginId: 'test-plugin' });
      });

      it('warns on overwriting existing tool', () => {
        api.registerTool({ name: 'dup-tool' });
        api.registerTool({ name: 'dup-tool' });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Tool "dup-tool" already registered')
        );
      });
    });

    // ─── registerHook ─────────────────────────────────────────
    describe('registerHook', () => {
      it('registers a hook with pluginId:name key', () => {
        const handler = vi.fn();
        api.registerHook({ name: 'my-hook', handler });
        const key = 'test-plugin:my-hook';
        const reg = factory.registry.hooks.get(key);
        expect(reg).toEqual({ name: 'my-hook', handler, pluginId: 'test-plugin' });
      });
    });

    // ─── registerChannel ──────────────────────────────────────
    describe('registerChannel', () => {
      it('registers a channel', () => {
        api.registerChannel({ id: 'slack', type: 'messaging' });
        expect(factory.registry.channels.get('slack')).toEqual({ id: 'slack', type: 'messaging' });
      });

      it('warns on overwriting existing channel', () => {
        api.registerChannel({ id: 'slack' });
        api.registerChannel({ id: 'slack' });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Channel "slack" already registered')
        );
      });
    });

    // ─── registerCommand ──────────────────────────────────────
    describe('registerCommand', () => {
      it('registers a command', () => {
        api.registerCommand({ name: 'greet', action: 'say-hi' });
        expect(factory.registry.commands.get('greet')).toEqual({
          name: 'greet',
          action: 'say-hi',
          pluginId: 'test-plugin',
        });
      });

      it('warns on overwriting existing command', () => {
        api.registerCommand({ name: 'greet' });
        api.registerCommand({ name: 'greet' });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Command "greet" already registered')
        );
      });
    });

    // ─── registerHttpRoute ────────────────────────────────────
    describe('registerHttpRoute', () => {
      it('registers an HTTP route with method:path key', () => {
        api.registerHttpRoute({ method: 'get', path: '/health' });
        const key = 'GET:/health';
        expect(factory.registry.httpRoutes.get(key)).toEqual({
          method: 'get',
          path: '/health',
          pluginId: 'test-plugin',
        });
      });

      it('uppercases the method for the key', () => {
        api.registerHttpRoute({ method: 'post', path: '/data' });
        expect(factory.registry.httpRoutes.has('POST:/data')).toBe(true);
      });

      it('warns on overwriting existing route', () => {
        api.registerHttpRoute({ method: 'get', path: '/health' });
        api.registerHttpRoute({ method: 'get', path: '/health' });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('HTTP route "GET:/health" replaced')
        );
      });
    });

    // ─── registerProvider ─────────────────────────────────────
    describe('registerProvider', () => {
      it('registers a provider', () => {
        api.registerProvider({ id: 'openai', model: 'gpt-4' });
        expect(factory.registry.providers.get('openai')).toEqual({ id: 'openai', model: 'gpt-4' });
      });

      it('warns on overwriting existing provider', () => {
        api.registerProvider({ id: 'openai' });
        api.registerProvider({ id: 'openai' });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Provider "openai" already registered')
        );
      });
    });

    // ─── registerCli ──────────────────────────────────────────
    describe('registerCli', () => {
      it('pushes registrar to cliRegistrars array', () => {
        const registrar = { command: 'deploy' };
        api.registerCli(registrar);
        expect(factory.registry.cliRegistrars).toContain(registrar);
      });

      it('allows multiple registrars', () => {
        api.registerCli({ command: 'a' });
        api.registerCli({ command: 'b' });
        expect(factory.registry.cliRegistrars).toHaveLength(2);
      });
    });

    // ─── registerService ──────────────────────────────────────
    describe('registerService', () => {
      it('registers a service', () => {
        api.registerService({ id: 'db', start: vi.fn() });
        expect(factory.registry.services.get('db')).toBeDefined();
      });

      it('warns on overwriting existing service', () => {
        api.registerService({ id: 'db' });
        api.registerService({ id: 'db' });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Service "db" already registered')
        );
      });
    });

    // ─── registerGatewayMethod ────────────────────────────────
    describe('registerGatewayMethod', () => {
      it('registers a gateway handler', () => {
        api.registerGatewayMethod({ name: 'process', handler: vi.fn() });
        const entry = factory.registry.gatewayHandlers.get('process');
        expect(entry).toBeDefined();
        expect(entry.pluginId).toBe('test-plugin');
      });
    });

    // ─── on (typed hook registration) ─────────────────────────
    describe('on', () => {
      it('registers a typed hook with default priority 0', () => {
        const handler = vi.fn();
        api.on('message_received', handler);
        const list = factory.registry.typedHooks.get('message_received');
        expect(list).toHaveLength(1);
        expect(list![0].pluginId).toBe('test-plugin');
        expect(list![0].hookName).toBe('message_received');
        expect(list![0].handler).toBe(handler);
        expect(list![0].priority).toBe(0);
      });

      it('respects custom priority', () => {
        api.on('message_received', vi.fn(), { priority: 10 });
        const list = factory.registry.typedHooks.get('message_received');
        expect(list![0].priority).toBe(10);
      });

      it('sorts hooks by priority descending', () => {
        const h1 = vi.fn();
        const h2 = vi.fn();
        const h3 = vi.fn();
        api.on('message_received', h1, { priority: 1 });
        api.on('message_received', h2, { priority: 10 });
        api.on('message_received', h3, { priority: 5 });
        const list = factory.registry.typedHooks.get('message_received')!;
        expect(list[0].handler).toBe(h2); // priority 10
        expect(list[1].handler).toBe(h3); // priority 5
        expect(list[2].handler).toBe(h1); // priority 1
      });

      it('creates new list if hookName not yet seen', () => {
        expect(factory.registry.typedHooks.has('before_agent_start')).toBe(false);
        api.on('before_agent_start', vi.fn());
        expect(factory.registry.typedHooks.has('before_agent_start')).toBe(true);
      });

      it('appends to existing list', () => {
        api.on('llm_input', vi.fn());
        api.on('llm_input', vi.fn());
        expect(factory.registry.typedHooks.get('llm_input')).toHaveLength(2);
      });

      it('handles options without priority (defaults to 0)', () => {
        api.on('session_start', vi.fn(), {});
        const list = factory.registry.typedHooks.get('session_start')!;
        expect(list[0].priority).toBe(0);
      });
    });

    // ─── resolvePath ──────────────────────────────────────────
    describe('resolvePath', () => {
      it('returns input path if no root dir registered', () => {
        const result = api.resolvePath('some/relative/path');
        expect(result).toBe('some/relative/path');
      });

      it('returns absolute path unchanged', () => {
        factory.registry.pluginRootDirs.set('test-plugin', '/plugins/test');
        const result = api.resolvePath('/absolute/path');
        expect(result).toBe('/absolute/path');
      });

      it('resolves relative path against plugin root dir', () => {
        factory.registry.pluginRootDirs.set('test-plugin', '/plugins/test');
        const result = api.resolvePath('data/config.json');
        expect(result).toBe('/plugins/test/data/config.json');
      });

      it('blocks path traversal attempts with ..', () => {
        factory.registry.pluginRootDirs.set('test-plugin', '/plugins/test');
        const result = api.resolvePath('../../etc/passwd');
        // Should return original path and log warning
        expect(result).toBe('../../etc/passwd');
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('attempted to access path outside its directory')
        );
      });

      it('resolves nested relative paths correctly', () => {
        factory.registry.pluginRootDirs.set('test-plugin', '/plugins/test');
        const result = api.resolvePath('./sub/dir/file.ts');
        expect(result).toBe('/plugins/test/sub/dir/file.ts');
      });
    });

    // ─── logger ───────────────────────────────────────────────
    describe('plugin logger', () => {
      it('info calls logger.debug with plugin prefix', () => {
        api.logger.info('hello', 'world');
        expect(logger.debug).toHaveBeenCalledWith('[test-plugin]', 'hello', 'world');
      });

      it('warn calls logger.warn with plugin prefix', () => {
        api.logger.warn('warning');
        expect(logger.warn).toHaveBeenCalledWith('[test-plugin]', 'warning');
      });

      it('error calls logger.error with plugin prefix', () => {
        api.logger.error('err');
        expect(logger.error).toHaveBeenCalledWith('[test-plugin]', 'err');
      });

      it('debug calls console.debug with plugin prefix', () => {
        const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        api.logger.debug('dbg');
        expect(spy).toHaveBeenCalledWith('[test-plugin]', 'dbg');
        spy.mockRestore();
      });
    });
  });

  // ─── Multi-plugin isolation ────────────────────────────────
  describe('multi-plugin isolation', () => {
    it('different plugins write to same registry but with different pluginIds', () => {
      const factory = getOrCreatePluginRegistry();
      const api1 = factory.createApi('plugin-a');
      const api2 = factory.createApi('plugin-b');

      api1.registerTool({ name: 'tool-a', v: 1 });
      api2.registerTool({ name: 'tool-b', v: 2 });

      expect(factory.registry.tools.get('tool-a')?.pluginId).toBe('plugin-a');
      expect(factory.registry.tools.get('tool-b')?.pluginId).toBe('plugin-b');
    });

    it('hooks from different plugins are namespaced', () => {
      const factory = getOrCreatePluginRegistry();
      const api1 = factory.createApi('plugin-a');
      const api2 = factory.createApi('plugin-b');

      api1.registerHook({ name: 'init', handler: vi.fn() });
      api2.registerHook({ name: 'init', handler: vi.fn() });

      expect(factory.registry.hooks.has('plugin-a:init')).toBe(true);
      expect(factory.registry.hooks.has('plugin-b:init')).toBe(true);
    });

    it('typed hooks from different plugins coexist in same list', () => {
      const factory = getOrCreatePluginRegistry();
      const api1 = factory.createApi('plugin-a');
      const api2 = factory.createApi('plugin-b');

      api1.on('message_received', vi.fn(), { priority: 5 });
      api2.on('message_received', vi.fn(), { priority: 10 });

      const list = factory.registry.typedHooks.get('message_received')!;
      expect(list).toHaveLength(2);
      // plugin-b should be first (higher priority)
      expect(list[0].pluginId).toBe('plugin-b');
      expect(list[1].pluginId).toBe('plugin-a');
    });

    it('resolvePath uses each plugin own root dir', () => {
      const factory = getOrCreatePluginRegistry();
      factory.registry.pluginRootDirs.set('plugin-a', '/plugins/a');
      factory.registry.pluginRootDirs.set('plugin-b', '/plugins/b');

      const api1 = factory.createApi('plugin-a');
      const api2 = factory.createApi('plugin-b');

      expect(api1.resolvePath('file.ts')).toBe('/plugins/a/file.ts');
      expect(api2.resolvePath('file.ts')).toBe('/plugins/b/file.ts');
    });
  });
});
