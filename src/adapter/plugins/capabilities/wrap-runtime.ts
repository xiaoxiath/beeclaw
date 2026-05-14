/**
 * Wrap a plugin runtime with capability checks.
 *
 * The runtime instance itself is shared across plugins (it's a thin shim
 * around process-wide services). We wrap the *handle* we hand to each
 * plugin so calls into capability-gated namespaces throw if not declared.
 *
 * Always-allowed namespaces (no capability needed): logging, events.
 * The plugin can log + listen to events without any declarations.
 */

import { requireCapability, type Capability } from './index';

/**
 * Wrap a single object's methods with a capability gate.
 * Non-function properties pass through unchanged.
 * `null` / `undefined` runtime sub-namespaces also pass through, so
 * calling them at all surfaces the underlying error rather than masking it.
 */
function gateNamespace<T extends Record<string, any>>(
  ns: T | null | undefined,
  pluginId: string,
  declared: readonly string[] | undefined,
  cap: Capability,
): T {
  if (ns == null) return ns as unknown as T;
  return new Proxy(ns, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        requireCapability(pluginId, declared, cap);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

export function wrapRuntimeForCapabilities<R extends Record<string, any>>(
  runtime: R,
  pluginId: string,
  declaredCapabilities: readonly string[] | undefined,
): R {
  const declared = declaredCapabilities;

  // `config` is split: loadConfig (read) vs writeConfigFile (write).
  // Wrap the two functions individually rather than the whole namespace.
  const wrappedConfig = runtime.config
    ? new Proxy(runtime.config, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== 'function') return value;
          if (prop === 'loadConfig') {
            return (...args: unknown[]) => {
              requireCapability(pluginId, declared, 'runtime.config.read');
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          if (prop === 'writeConfigFile') {
            return (...args: unknown[]) => {
              requireCapability(pluginId, declared, 'runtime.config.write');
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return value;
        },
      })
    : runtime.config;

  // `system.runCommandWithTimeout` is the only gated method on `system`;
  // `enqueueSystemEvent` and `requestHeartbeatNow` are always allowed.
  const wrappedSystem = runtime.system
    ? new Proxy(runtime.system, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop === 'runCommandWithTimeout' && typeof value === 'function') {
            return (...args: unknown[]) => {
              requireCapability(pluginId, declared, 'runtime.command');
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return value;
        },
      })
    : runtime.system;

  // Wrap whole namespaces.
  const wrappedState = gateNamespace(runtime.state, pluginId, declared, 'state.access');
  const wrappedMedia = runtime.media
    ? new Proxy(runtime.media, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop === 'loadWebMedia' && typeof value === 'function') {
            return (...args: unknown[]) => {
              requireCapability(pluginId, declared, 'runtime.media');
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return value; // detectMime: always allowed (pure)
        },
      })
    : runtime.media;

  // Return a new object — leaving the original untouched so other
  // wrapped instances aren't perturbed.
  return {
    ...runtime,
    config: wrappedConfig,
    system: wrappedSystem,
    state: wrappedState,
    media: wrappedMedia,
    // logging, events, tools, channel, tts, stt: ungated (logging/events
    // are always free; tools/channel are stubs; tts/stt are warn-stubs).
  } as R;
}
