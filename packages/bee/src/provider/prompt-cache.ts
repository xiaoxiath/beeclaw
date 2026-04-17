export type CacheStrategy = 'system_only' | 'system_and_3';

export interface CacheConfig {
  strategy: CacheStrategy;
  ttl: 'ephemeral' | '1h';
}

const DEFAULT_CONFIG: CacheConfig = { strategy: 'system_and_3', ttl: 'ephemeral' };

/**
 * Apply Anthropic cache_control breakpoints to a payload that was already
 * converted by convertToAnthropicFormat().
 * 
 * CRITICAL: Must be called AFTER convertToAnthropicFormat() because:
 * - That function extracts system messages to a top-level `system` string
 * - cache_control needs to convert system from string to content block array
 */
export function applyAnthropicCacheControl(
  payload: { system?: string; messages: Record<string, unknown>[]; tools?: Record<string, unknown>[] },
  config: CacheConfig = DEFAULT_CONFIG,
): typeof payload {
  const cc = { type: config.ttl === '1h' ? 'ttl_1h' : 'ephemeral' };

  // 1. System prompt → content block array + cache_control
  if (payload.system && typeof payload.system === 'string') {
    (payload as any).system = [
      { type: 'text', text: payload.system, cache_control: cc },
    ];
  }

  // 2. Last N messages get cache breakpoint
  if (config.strategy === 'system_and_3') {
    const msgs = payload.messages;
    const lastN = msgs.slice(-3);
    for (const msg of lastN) {
      const content = msg.content;
      if (typeof content === 'string') {
        msg.content = [{ type: 'text', text: content, cache_control: cc }];
      } else if (Array.isArray(content) && content.length > 0) {
        const lastBlock = content[content.length - 1] as any;
        lastBlock.cache_control = cc;
      }
    }
  }

  return payload;
}
