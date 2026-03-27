/**
 * Test configuration system (v6)
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ProviderResolver } from '../provider-resolver';
import { ParamsMerger } from '../params-merger';
import type { AIProvider, AgentConfig, LLMTierConfig, RoleDefinition } from '../schema';

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

describe('ProviderResolver (v6)', () => {
  let resolver: ProviderResolver;
  let providers: AIProvider[];
  let roles: Record<string, RoleDefinition>;

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
      },
    ];

    // v6: roles are global, not per-provider
    roles = {
      chat: {
        provider: 'zhipu',
        model: 'glm-5',
        params: {
          temperature: 0.7,
          max_tokens: 4096,
        },
      },
      fast: {
        provider: 'zhipu',
        model: 'glm-4.7-flashx',
        params: {
          temperature: 0.3,
          max_tokens: 1000,
        },
      },
    };

    resolver = new ProviderResolver(providers, roles);
  });

  test('should get default provider', () => {
    const provider = resolver.getDefaultProvider();
    expect(provider?.name).toBe('zhipu');
  });

  test('should resolve role', () => {
    const result = resolver.resolveRole('chat');

    expect(result.model).toBe('glm-5');
    expect(result.params.temperature).toBe(0.7);
    expect(result.params.max_tokens).toBe(4096);
    expect(result.provider.name).toBe('zhipu');
  });

  test('should merge role params with usage params', () => {
    const result = resolver.resolveRole('chat');

    // Role sets temperature
    expect(result.params.temperature).toBe(0.7);
    // Role sets max_tokens
    expect(result.params.max_tokens).toBe(4096);
  });

  test('should resolve role with usage params override', () => {
    const result = resolver.resolveRole('chat', { temperature: 0.9 });

    expect(result.model).toBe('glm-5');
    expect(result.params.temperature).toBe(0.9); // Usage override
    expect(result.params.max_tokens).toBe(4096); // From role
    expect(result.provider.name).toBe('zhipu');
  });

  test('should resolve role with agent-level params', () => {
    const usageParams = { temperature: 0.9 };

    const result = resolver.resolveRole('chat', usageParams);

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
      resolver.resolveRole('non-existent');
    }).toThrow('Role "non-existent" not found');
  });

  test('should throw error for non-existent provider in role', () => {
    // Create a resolver with a role that references a non-existent provider
    const badRoles: Record<string, RoleDefinition> = {
      chat: {
        provider: 'non-existent',
        model: 'some-model',
      },
    };
    const badResolver = new ProviderResolver(providers, badRoles);

    expect(() => {
      badResolver.resolveRole('chat');
    }).toThrow('Provider "non-existent"');
  });

  test('should return undefined for non-existent role via getRole', () => {
    const roleDef = resolver.getRole('non-existent');
    expect(roleDef).toBeUndefined();
  });

  test('should throw error if tier role not found', () => {
    const tier = { role: 'non-existent' } as LLMTierConfig;

    expect(() => {
      resolver.resolveTier(tier);
    }).toThrow('not found');
  });
});
