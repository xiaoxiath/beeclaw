import { describe, test, expect } from 'bun:test';
import {
  ServerConfigSchema,
  AuthConfigSchema,
  CorsConfigSchema,
  AIProviderSchema,
  AgentConfigSchema,
  SessionStorageConfigSchema,
  MemoryConfigSchema,
  SkillsConfigSchema,
  ChannelPluginConfigSchema,
  ToolPluginConfigSchema,
  LoggingConfigSchema,
  FeishuConfigSchema,
  AppConfigSchema,
} from '../schema';

describe('ServerConfigSchema', () => {
  test('accepts valid config', () => {
    const result = ServerConfigSchema.parse({ port: 3000, host: 'localhost' });
    expect(result.port).toBe(3000);
    expect(result.host).toBe('localhost');
  });

  test('applies default values', () => {
    const result = ServerConfigSchema.parse({});
    expect(result.port).toBe(3000);
    expect(result.host).toBe('0.0.0.0');
  });

  test('applies partial defaults', () => {
    const result = ServerConfigSchema.parse({ port: 8080 });
    expect(result.port).toBe(8080);
    expect(result.host).toBe('0.0.0.0');
  });
});

describe('AuthConfigSchema', () => {
  test('accepts valid config with tokens', () => {
    const result = AuthConfigSchema.parse({
      enabled: true,
      tokens: ['token1', 'token2'],
      password: 'secret'
    });
    expect(result.enabled).toBe(true);
    expect(result.tokens).toEqual(['token1', 'token2']);
    expect(result.password).toBe('secret');
  });

  test('applies default values', () => {
    const result = AuthConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.tokens).toEqual([]);
    expect(result.password).toBeUndefined();
  });

  test('accepts disabled auth', () => {
    const result = AuthConfigSchema.parse({ enabled: false });
    expect(result.enabled).toBe(false);
  });
});

describe('CorsConfigSchema', () => {
  test('accepts valid config', () => {
    const result = CorsConfigSchema.parse({
      enabled: true,
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST'],
    });
    expect(result.enabled).toBe(true);
    expect(result.origins).toEqual(['http://localhost:3000']);
  });

  test('applies default values', () => {
    const result = CorsConfigSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.origins).toEqual(['localhost']);
    expect(result.methods).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']);
    expect(result.maxAge).toBe(86400);
    expect(result.credentials).toBe(true);
  });
});

describe('AIProviderSchema', () => {
  test('accepts valid OpenAI provider', () => {
    const result = AIProviderSchema.parse({
      name: 'openai-main',
      type: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com',
      models: {
        'gpt-4': { contextWindow: 128000, maxTokens: 4096 }
      },
      default: true,
    });
    expect(result.name).toBe('openai-main');
    expect(result.type).toBe('openai');
    expect(result.apiKey).toBe('sk-test');
    expect(result.models).toHaveProperty('gpt-4');
  });

  test('accepts valid Anthropic provider', () => {
    const result = AIProviderSchema.parse({
      name: 'anthropic',
      type: 'anthropic',
      apiKey: 'sk-ant-test',
      models: {
        'claude-3-opus': { contextWindow: 200000 }
      }
    });
    expect(result.type).toBe('anthropic');
    expect(result.models).toHaveProperty('claude-3-opus');
  });

  test('applies default values', () => {
    const result = AIProviderSchema.parse({
      name: 'test',
      apiKey: 'key',
      models: {},  // models is required but can be empty
    });
    expect(result.type).toBe('openai');
    expect(result.models).toEqual({});
    expect(result.default).toBe(false);
  });

  test('accepts custom provider type', () => {
    const result = AIProviderSchema.parse({
      name: 'custom-ai',
      type: 'custom',
      apiKey: 'key',
      models: {
        'custom-model': { contextWindow: 8000 }
      },
      options: { customOption: 'value' },
    });
    expect(result.type).toBe('custom');
    expect(result.options).toEqual({ customOption: 'value' });
  });

  test('accepts all valid provider types', () => {
    const types = ['openai', 'anthropic', 'zhipu', 'minimax', 'custom'];
    for (const type of types) {
      const result = AIProviderSchema.parse({
        name: `${type}-provider`,
        type,
        apiKey: 'key',
      });
      expect(result.type).toBe(type);
    }
  });
});

describe('AgentConfigSchema', () => {
  test('accepts valid agent config', () => {
    const result = AgentConfigSchema.parse({
      id: 'agent-1',
      name: 'Test Agent',
      provider: 'openai',
      model: 'gpt-4',
      systemPrompt: 'You are helpful.',
      temperature: 0.7,
      maxTokens: 2000,
      tools: ['tool1', 'tool2'],
    });
    expect(result.id).toBe('agent-1');
    expect(result.name).toBe('Test Agent');
    expect(result.temperature).toBe(0.7);
  });

  test('validates temperature range', () => {
    expect(() => AgentConfigSchema.parse({
      id: 'agent-1',
      name: 'Test',
      provider: 'openai',
      model: 'gpt-4',
      temperature: 3, // Invalid: > 2
    })).toThrow();
  });

  test('validates topP range', () => {
    expect(() => AgentConfigSchema.parse({
      id: 'agent-1',
      name: 'Test',
      provider: 'openai',
      model: 'gpt-4',
      topP: 1.5, // Invalid: > 1
    })).toThrow();
  });

  test('applies default tools array', () => {
    const result = AgentConfigSchema.parse({
      id: 'agent-1',
      name: 'Test',
      provider: 'openai',
      model: 'gpt-4',
    });
    expect(result.tools).toEqual([]);
  });
});

describe('SessionStorageConfigSchema', () => {
  test('accepts valid config', () => {
    const result = SessionStorageConfigSchema.parse({
      type: 'sqlite',
      path: './data/sessions.db',
    });
    expect(result.type).toBe('sqlite');
    expect(result.path).toBe('./data/sessions.db');
  });

  test('applies default values', () => {
    const result = SessionStorageConfigSchema.parse({});
    expect(result.type).toBe('jsonl');
    expect(result.path).toBe('./data/sessions');
  });

  test('accepts all storage types', () => {
    const types = ['jsonl', 'memory', 'sqlite'];
    for (const type of types) {
      const result = SessionStorageConfigSchema.parse({ type });
      expect(result.type).toBe(type);
    }
  });
});

describe('MemoryConfigSchema', () => {
  test('accepts valid config', () => {
    const result = MemoryConfigSchema.parse({
      type: 'filesystem',
      path: './data/memory',
      tools: {
        enabled: ['memory_ls', 'memory_read'],
        autoRecord: false,
      },
      retention: {
        conversations: '30d',
        facts: 'forever',
      },
    });
    expect(result.type).toBe('filesystem');
    expect(result.tools?.enabled).toEqual(['memory_ls', 'memory_read']);
  });

  test('applies default values', () => {
    const result = MemoryConfigSchema.parse({});
    expect(result.type).toBe('filesystem');
    expect(result.tools?.enabled).toEqual(['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record']);
    expect(result.tools?.autoRecord).toBe(true);
  });
});

describe('SkillsConfigSchema', () => {
  test('accepts valid config', () => {
    const result = SkillsConfigSchema.parse({
      userPath: './skills/user',
      builtinPath: './skills/builtin',
      autoLoad: false,
    });
    expect(result.userPath).toBe('./skills/user');
    expect(result.autoLoad).toBe(false);
  });

  test('applies default values', () => {
    const result = SkillsConfigSchema.parse({});
    expect(result.userPath).toBe('./data/memory/skills');
    expect(result.builtinPath).toBe('./skills');
    expect(result.autoLoad).toBe(true);
  });
});

describe('ChannelPluginConfigSchema', () => {
  test('accepts lark channel', () => {
    const result = ChannelPluginConfigSchema.parse({
      type: 'lark',
      enabled: true,
      config: { appId: 'test' },
    });
    expect(result.type).toBe('lark');
    expect(result.enabled).toBe(true);
  });

  test('accepts webhook channel', () => {
    const result = ChannelPluginConfigSchema.parse({
      type: 'webhook',
      enabled: true,
    });
    expect(result.type).toBe('webhook');
  });

  test('applies default enabled value', () => {
    const result = ChannelPluginConfigSchema.parse({ type: 'lark' });
    expect(result.enabled).toBe(true);
  });
});

describe('ToolPluginConfigSchema', () => {
  test('accepts http tool', () => {
    const result = ToolPluginConfigSchema.parse({
      type: 'http',
      enabled: true,
      config: { url: 'https://api.example.com' },
    });
    expect(result.type).toBe('http');
  });

  test('accepts mcp tool', () => {
    const result = ToolPluginConfigSchema.parse({
      type: 'mcp',
      enabled: true,
    });
    expect(result.type).toBe('mcp');
  });

  test('applies default type value', () => {
    const result = ToolPluginConfigSchema.parse({});
    expect(result.type).toBe('http');
  });
});

describe('LoggingConfigSchema', () => {
  test('accepts valid config', () => {
    const result = LoggingConfigSchema.parse({
      level: 'debug',
      format: 'json',
      file: '/var/log/beeclaw.log',
    });
    expect(result.level).toBe('debug');
    expect(result.format).toBe('json');
    expect(result.file).toBe('/var/log/beeclaw.log');
  });

  test('applies default values', () => {
    const result = LoggingConfigSchema.parse({});
    expect(result.level).toBe('info');
    expect(result.format).toBe('pretty');
    expect(result.file).toBeUndefined();
  });

  test('accepts all log levels', () => {
    const levels = ['debug', 'info', 'warn', 'error'];
    for (const level of levels) {
      const result = LoggingConfigSchema.parse({ level });
      expect(result.level).toBe(level);
    }
  });
});

describe('FeishuConfigSchema', () => {
  test('accepts valid config', () => {
    const result = FeishuConfigSchema.parse({
      enabled: true,
      appId: 'cli_test',
      appSecret: 'secret',
      encryptKey: 'key',
      verificationToken: 'token',
    });
    expect(result.enabled).toBe(true);
    expect(result.appId).toBe('cli_test');
  });

  test('applies default values', () => {
    const result = FeishuConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.appId).toBeUndefined();
  });
});

describe('AppConfigSchema', () => {
  test('accepts minimal config with all defaults', () => {
    const result = AppConfigSchema.parse({});
    expect(result.server).toBeDefined();
    expect(result.auth).toBeDefined();
    expect(result.cors).toBeDefined();
    expect(result.providers).toEqual([]);
    expect(result.agents).toEqual([]);
  });

  test('accepts full config', () => {
    const fullConfig = {
      server: { port: 8080, host: '127.0.0.1' },
      auth: { enabled: true, tokens: ['token'] },
      cors: { enabled: true, origins: ['*'] },
      providers: [{ name: 'openai', apiKey: 'key' }],
      agents: [{ id: 'a1', name: 'Agent', provider: 'openai', model: 'gpt-4' }],
      sessionStorage: { type: 'sqlite' },
      memory: { path: './mem' },
      skills: { userPath: './skills' },
      channels: { lark: { type: 'lark', enabled: true } },
      tools: { weather: { type: 'http', enabled: true } },
      logging: { level: 'debug' },
      feishu: { enabled: false },
    };

    const result = AppConfigSchema.parse(fullConfig);
    expect(result.server.port).toBe(8080);
    expect(result.providers.length).toBe(1);
    expect(result.agents.length).toBe(1);
  });

  test('merges with defaults', () => {
    const result = AppConfigSchema.parse({
      server: { port: 9000 },
    });
    expect(result.server.port).toBe(9000);
    expect(result.server.host).toBe('0.0.0.0'); // Default
  });

  test('accepts empty channels and tools', () => {
    const result = AppConfigSchema.parse({
      channels: {},
      tools: {},
    });
    expect(result.channels).toEqual({});
    expect(result.tools).toEqual({});
  });
});
