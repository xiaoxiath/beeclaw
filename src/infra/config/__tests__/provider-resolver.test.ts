/**
 * Test three-layer configuration system (v4)
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { ProviderResolver } from '../provider-resolver';
import { ParamsMerger } from '../params-merger';
import type { AIProvider, AgentConfig, LLMTierConfig } from '../schema';

describe('ParamsMerger', () => {
  test('should merge two params objects', () => {
    const base = { temperature: 0.7, max_tokens: 4096 };
    const override = { temperature: 0.5 };

    const result = ParamsMerger.mergeParams(base, override);

    expect(result.temperature).toBe(0.5);
    expect(result.max_tokens).toBe(4096);
  });

  test('should merge three layers', () => {
    const modelParams = { temperature: 0.7, max_tokens: 4096, do_sample: true };
    const roleParams = { temperature: 0.5, max_tokens: 2048 };
    const usageParams = { temperature: 0.8 };

    const result = ParamsMerger.mergeThreeLayers(modelParams, roleParams, usageParams);

    expect(result.temperature).toBe(0.8);
    expect(result.max_tokens).toBe(2048);
    expect(result.do_sample).toBe(true);
  });

  test('should identify param sources', () => {
    const modelParams = { temperature: 0.7, max_tokens: 4096 };
    const roleParams = { temperature: 0.5 };
    const usageParams = { max_tokens: 1000 };

    const sources = ParamsMerger.identifyParamSources(modelParams, roleParams, usageParams);

    expect(sources.temperature).toBe('role');
    expect(sources.max_tokens).toBe('usage');
  });
});

describe('ProviderResolver (v4)', () => {
  let resolver: ProviderResolver;
  let providers: AIProvider[];

  beforeEach(() => {
    providers = [
      {
        name: 'zhipu',
        type: 'zhipu',
        apiKey: 'test-key',
        default: true,
        models: {
          'glm-5': {
            displayName: 'GLM-5',
            maxTokens: 128000,
            defaultParams: {
              temperature: 0.7,
              max_tokens: 4096,
              do_sample: true,
            },
          },
          'glm-4.7-flashx': {
            displayName: 'GLM-4.7 FlashX',
            defaultParams: {
              temperature: 0.3,
              max_tokens: 2048,
            },
          },
        },
        roles: {
          chat: {
            model: 'glm-5',
            params: {
              temperature: 0.7,
              max_tokens: 4096,
            },
          },
          fast: {
            model: 'glm-4.7-flashx',
            params: {
              temperature: 0.3,
              max_tokens: 1000,
            },
          },
        },
      },
    ];
    resolver = new ProviderResolver(providers);
  });

  test('should get default provider', () => {
    const provider = resolver.getDefaultProvider();
    expect(provider?.name).toBe('zhipu');
  });

  test('should resolve role', () => {
    const result = resolver.resolveRole(undefined, 'chat');

    expect(result.model).toBe('glm-5');
    expect(result.params.temperature).toBe(0.7);
    expect(result.params.max_tokens).toBe(4096);
    expect(result.provider.name).toBe('zhipu');
  });

  test('should merge model and role params', () => {
    const result = resolver.resolveRole(undefined, 'chat');

    // Role overrides temperature
    expect(result.params.temperature).toBe(0.7);
    // Role overrides max_tokens
    expect(result.params.max_tokens).toBe(4096);
    // Model provides do_sample (not in role params)
    expect(result.params.do_sample).toBe(true);
  });

  test('should resolve agent with role', () => {
    const agent: AgentConfig = {
      id: 'test',
      name: 'Test Agent',
      role: 'chat',
    };

    const result = resolver.resolveAgent(agent);

    expect(result.model).toBe('glm-5');
    expect(result.params.temperature).toBe(0.7);
    expect(result.provider.name).toBe('zhipu');
  });

  test('should resolve agent with role and usage params', () => {
    const agent: AgentConfig = {
      id: 'test',
      name: 'Test Agent',
      role: 'chat',
      params: {
        temperature: 0.9,
      },
    };

    const result = resolver.resolveAgent(agent);

    expect(result.model).toBe('glm-5');
    expect(result.params.temperature).toBe(0.9); // Agent override
    expect(result.params.max_tokens).toBe(4096); // From role
  });

  test('should resolve tier with role', () => {
    const tier: LLMTierConfig = {
      role: 'fast',
    };

    const result = resolver.resolveTier(tier);

    expect(result.models).toEqual(['glm-4.7-flashx']);
    expect(result.params.temperature).toBe(0.3);
    expect(result.params.max_tokens).toBe(1000);
    expect(result.provider.name).toBe('zhipu');
  });

  test('should throw error for non-existent role', () => {
    expect(() => {
      resolver.resolveRole(undefined, 'non-existent');
    }).toThrow('Role "non-existent" not defined');
  });

  test('should throw error for non-existent provider', () => {
    expect(() => {
      resolver.resolveRole('non-existent', 'chat');
    }).toThrow('Provider "non-existent" not found');
  });

  test('should throw error if agent has no role', () => {
    const agent: AgentConfig = {
      id: 'test',
      name: 'Test Agent',
    } as any;

    expect(() => {
      resolver.resolveAgent(agent);
    }).toThrow('must have "role" specified');
  });

  test('should throw error if tier has no role', () => {
    const tier: LLMTierConfig = {} as any;

    expect(() => {
      resolver.resolveTier(tier);
    }).toThrow('must have "role" specified');
  });
});
