/**
 * Tests for the beeclaw → bee adapter layer.
 *
 * TDD: Tests written first, then implementation.
 */

import { describe, it, expect } from 'vitest';
import { toProviderConfig, resetBeeAdapter } from '../index';

// ============================================================================
// toProviderConfig
// ============================================================================

describe('toProviderConfig', () => {
  it('should convert basic OpenAI provider', () => {
    const provider = {
      name: 'openai-main',
      type: 'openai' as const,
      apiKey: 'sk-test-key',
    };

    const config = toProviderConfig(provider);
    expect(config.type).toBe('openai');
    expect(config.apiKey).toBe('sk-test-key');
  });

  it('should convert provider with custom baseUrl', () => {
    const provider = {
      name: 'custom',
      type: 'openai' as const,
      apiKey: 'key',
      baseUrl: 'https://custom.api.com/v1',
    };

    const config = toProviderConfig(provider);
    expect(config.baseUrl).toBe('https://custom.api.com/v1');
  });

  it('should convert Anthropic provider', () => {
    const provider = {
      name: 'anthropic',
      type: 'anthropic' as const,
      apiKey: 'ant-key',
    };

    const config = toProviderConfig(provider);
    expect(config.type).toBe('anthropic');
    expect(config.apiKey).toBe('ant-key');
  });
});

// ============================================================================
// resetBeeAdapter
// ============================================================================

describe('resetBeeAdapter', () => {
  it('should not throw when called', () => {
    expect(() => resetBeeAdapter()).not.toThrow();
  });
});
