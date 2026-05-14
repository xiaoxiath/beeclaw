/**
 * Per-request fetch timeout helpers.
 *
 * Wraps fetch() with an AbortController so a hung server can't pin a slot
 * in the LLM concurrency limiter forever. On abort, translateError() rewrites
 * the underlying AbortError into a labelled timeout error so logs are useful.
 */

export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export interface RequestTimeoutScope {
  signal?: AbortSignal;
  clear(): void;
  translateError(error: unknown): unknown;
}

export function createRequestTimeoutScope(
  timeoutMs: number,
  label: string,
): RequestTimeoutScope {
  if (timeoutMs <= 0) {
    return {
      clear: () => {},
      translateError: (error: unknown) => error,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
    translateError: (error: unknown) => {
      if (controller.signal.aborted) {
        return new Error(`${label} timeout after ${timeoutMs}ms`);
      }
      return error;
    },
  };
}

export function withTimeoutSignal(
  init: RequestInit,
  timeout: RequestTimeoutScope,
): RequestInit {
  return timeout.signal ? { ...init, signal: timeout.signal } : init;
}
