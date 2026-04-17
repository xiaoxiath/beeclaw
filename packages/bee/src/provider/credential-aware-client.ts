/**
 * P0-1 Credential-Aware AI Client — decorator that injects pool-managed
 * credentials into every outbound `callAI` / `streamAI` request.
 *
 * The wrapper acquires a credential from the appropriate provider pool,
 * patches `options.provider.apiKey` (and optionally `baseUrl`), delegates
 * to the inner `AIClient`, and reports success / failure back to the pool.
 * On an auth or balance error the credential is marked exhausted and the
 * call is automatically retried with the next available credential.
 */

import type { AIClient, CallAIOptions, StreamAIOptions } from './call-ai';
import type { AIResponse } from '../core/types';
import {
  CredentialPool,
  type PooledCredential,
  type CredentialPoolConfig,
  type PoolEventListener,
  type CredentialPoolStats,
} from './credential-pool';
import { classifyError } from '../resilience/retry';

// ---------------------------------------------------------------------------
// Public configuration types
// ---------------------------------------------------------------------------

export interface CredentialAwarePoolEntry {
  credentials: PooledCredential[];
  config?: Partial<CredentialPoolConfig>;
}

export interface CredentialAwareConfig {
  /**
   * Map from provider type (e.g. `"openai"`, `"anthropic"`) to the pool
   * definition for that provider.
   */
  pools: Record<string, CredentialAwarePoolEntry>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a classified error should trigger an immediate
 * credential rotation (i.e. mark the credential exhausted and retry with
 * the next one).
 *
 * NOTE: In P1-1 the `ClassifiedError` type will gain a dedicated
 * `shouldRotateCredential` boolean.  Until then we check the error type
 * directly.
 */
function shouldRotateCredential(classified: { type: string }): boolean {
  return classified.type === 'AUTH_ERROR' || classified.type === 'INSUFFICIENT_BALANCE';
}

function getProviderRecord(options: CallAIOptions | StreamAIOptions): Record<string, unknown> | undefined {
  const provider = options.provider as unknown;
  if (provider && typeof provider === 'object') {
    return provider as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Resolve the provider type key that maps a set of `CallAIOptions` to its
 * credential pool.  We use `options.provider.type` when present; many
 * provider configs carry this field.
 */
function resolveProviderType(options: CallAIOptions | StreamAIOptions): string | undefined {
  // The provider config is expected to carry a `type` (or `provider`) string
  // that identifies the backend.  We try the most common field names.
  const provider = getProviderRecord(options);
  if (!provider) return undefined;

  if (typeof provider.type === 'string') return provider.type;
  if (typeof provider.provider === 'string') return provider.provider;

  return undefined;
}

// ---------------------------------------------------------------------------
// CredentialAwareAIClient
// ---------------------------------------------------------------------------

export class CredentialAwareAIClient {
  private readonly inner: AIClient;
  private readonly pools: Map<string, CredentialPool>;

  constructor(inner: AIClient, config: CredentialAwareConfig) {
    this.inner = inner;
    this.pools = new Map();

    for (const [providerType, entry] of Object.entries(config.pools)) {
      this.pools.set(providerType, new CredentialPool(entry.credentials, entry.config));
    }
  }

  // -----------------------------------------------------------------------
  // callAI — request / response
  // -----------------------------------------------------------------------

  async callAI(options: CallAIOptions): Promise<AIResponse> {
    const providerType = resolveProviderType(options);
    const pool = providerType ? this.pools.get(providerType) : undefined;

    // When there is no pool for this provider, pass through transparently.
    if (!pool) {
      return this.inner.callAI(options);
    }

    // We may retry with successive credentials when the active one is
    // rotated due to an auth / balance error.
    // Safety bound: never try more credentials than the pool contains.
    const maxAttempts = pool.getStats().total;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const credential = pool.acquire();
      if (!credential) {
        throw new Error(
          `[CredentialAwareAIClient] No available credentials for provider "${providerType}"`,
        );
      }

      const credId = credential.id!;
      const patchedOptions = this.patchOptions(options, credential);

      try {
        const response = await this.inner.callAI(patchedOptions);
        pool.reportSuccess(credId);
        return response;
      } catch (error: unknown) {
        const classified = classifyError(error);

        if (shouldRotateCredential(classified)) {
          // Permanently remove this credential and try the next one.
          pool.markExhausted(credId);
          continue;
        }

        // For all other errors report the failure (may trigger cooldown)
        // and let the error propagate to the caller.
        pool.reportFailure(credId, classified.type);
        throw error;
      }
    }

    // All credentials exhausted during rotation attempts.
    throw new Error(
      `[CredentialAwareAIClient] All credentials exhausted for provider "${providerType}"`,
    );
  }

  // -----------------------------------------------------------------------
  // streamAI — streaming
  // -----------------------------------------------------------------------

  async *streamAI(options: StreamAIOptions): AsyncGenerator<string> {
    const providerType = resolveProviderType(options);
    const pool = providerType ? this.pools.get(providerType) : undefined;

    if (!pool) {
      yield* this.inner.streamAI(options);
      return;
    }

    const maxAttempts = pool.getStats().total;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const credential = pool.acquire();
      if (!credential) {
        throw new Error(
          `[CredentialAwareAIClient] No available credentials for provider "${providerType}"`,
        );
      }

      const credId = credential.id!;
      const patchedOptions = this.patchOptions(options, credential) as StreamAIOptions;

      try {
        const stream = this.inner.streamAI(patchedOptions);

        // We must consume the generator inside the try/catch so that
        // errors surfaced mid-stream are still caught.
        let firstChunk = true;
        for await (const chunk of stream) {
          // If we successfully receive at least one chunk, the credential
          // is functional.
          if (firstChunk) {
            firstChunk = false;
            pool.reportSuccess(credId);
          }
          yield chunk;
        }

        // Completed successfully.
        pool.reportSuccess(credId);
        return;
      } catch (error: unknown) {
        const classified = classifyError(error);

        if (shouldRotateCredential(classified)) {
          pool.markExhausted(credId);
          continue;
        }

        pool.reportFailure(credId, classified.type);
        throw error;
      }
    }

    throw new Error(
      `[CredentialAwareAIClient] All credentials exhausted for provider "${providerType}"`,
    );
  }

  // -----------------------------------------------------------------------
  // Pool introspection
  // -----------------------------------------------------------------------

  /**
   * Return the current stats snapshot for a given provider pool.
   */
  getPoolStats(providerType: string): CredentialPoolStats | undefined {
    return this.pools.get(providerType)?.getStats();
  }

  /**
   * Subscribe to events on a specific provider pool.
   *
   * @returns An unsubscribe function, or `undefined` when the provider
   *          type has no pool.
   */
  onPoolEvent(providerType: string, listener: PoolEventListener): (() => void) | undefined {
    return this.pools.get(providerType)?.onEvent(listener);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Shallow-clone the options and replace `provider.apiKey` (and optionally
   * `provider.baseUrl`) with values from the pooled credential.
   */
  private patchOptions<T extends CallAIOptions | StreamAIOptions>(
    options: T,
    credential: PooledCredential,
  ): T {
    // Deep-clone the provider sub-object so we never mutate the caller's
    // original options.
    const provider = { ...(getProviderRecord(options) ?? {}) };
    provider.apiKey = credential.apiKey;

    if (credential.baseUrl !== undefined) {
      provider.baseUrl = credential.baseUrl;
    }

    return {
      ...options,
      provider,
    } as T;
  }
}
