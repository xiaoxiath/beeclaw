/**
 * Built-in provider endpoint table.
 *
 * Single source of truth for the URL/path of each known provider.
 * Both bee's AIClient and beeclaw's local api.ts resolve through here
 * so they cannot drift apart.
 */

export interface ProviderEndpoint {
  baseUrl: string;
  path: string;
  extraBody?: Record<string, unknown>;
}

export const PROVIDER_CONFIGS: Record<string, ProviderEndpoint> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    path: '/chat/completions',
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    path: '/chat/completions',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    path: '/messages',
  },
  minimax: {
    baseUrl: 'https://api.minimaxi.com/v1',
    path: '/chat/completions',
    extraBody: { reasoning_split: true },
  },
};

/**
 * Minimal shape needed to resolve a provider's endpoint.
 * Both bee's ProviderConfig and beeclaw's AIProvider satisfy this structurally.
 */
export interface ProviderEndpointInput {
  type: string;
  baseUrl?: string;
  options?: { extraBody?: unknown } & Record<string, unknown>;
}

/**
 * Resolve the request endpoint for a provider.
 *
 * If a custom baseUrl is set, it overrides the registry. The path is appended
 * only when the custom baseUrl has no path segment (so users can give either
 * "https://x.com" or "https://x.com/v1/chat/completions").
 *
 * Throws if neither a custom baseUrl nor a known provider type is supplied.
 */
export function resolveProviderEndpoint(provider: ProviderEndpointInput): ProviderEndpoint {
  if (provider.baseUrl) {
    const url = new URL(provider.baseUrl);
    const hasPathSegment = url.pathname !== '/' && url.pathname !== '';
    return {
      baseUrl: provider.baseUrl,
      path: hasPathSegment ? '' : '/chat/completions',
      extraBody: provider.options?.extraBody as Record<string, unknown> | undefined,
    };
  }

  const config = PROVIDER_CONFIGS[provider.type];
  if (!config) {
    throw new Error(`Unknown provider type: ${provider.type}`);
  }
  return config;
}
