/**
 * Plugin capability MVP — manifest declarations + boundary gating.
 *
 * Covers four layers:
 *   1. Capability constants and `isKnownCapability`.
 *   2. `requireCapability` strict + legacy modes (warn-once).
 *   3. Manifest schema accepts known caps, rejects unknown.
 *   4. createPluginApi gates register* methods.
 *   5. wrapRuntimeForCapabilities gates state / system / config / media.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from '../../../infra/observability/logger';
import {
  KNOWN_CAPABILITIES,
  isKnownCapability,
  isLegacyMode,
  requireCapability,
  _resetLegacyWarnCache,
} from '../capabilities';
import { wrapRuntimeForCapabilities } from '../capabilities/wrap-runtime';
import { createPluginRuntimeShim } from '../runtime-shim';
import {
  getOrCreatePluginRegistry,
  resetPluginRegistry,
} from '../registry';
import { loadPluginManifest } from '../manifest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

beforeEach(() => {
  resetPluginRegistry();
  _resetLegacyWarnCache();
  vi.clearAllMocks();
});

// ─── 1. Capability constants ───────────────────────────────────────────────

describe('KNOWN_CAPABILITIES', () => {
  test('contains the documented core caps', () => {
    expect(KNOWN_CAPABILITIES).toContain('tool.register');
    expect(KNOWN_CAPABILITIES).toContain('http.serve');
    expect(KNOWN_CAPABILITIES).toContain('runtime.config.read');
    expect(KNOWN_CAPABILITIES).toContain('runtime.config.write');
  });

  test('isKnownCapability discriminates', () => {
    expect(isKnownCapability('tool.register')).toBe(true);
    expect(isKnownCapability('totally.made.up')).toBe(false);
  });
});

// ─── 2. requireCapability ──────────────────────────────────────────────────

describe('requireCapability', () => {
  test('strict mode: throws when cap not declared', () => {
    expect(() =>
      requireCapability('p1', ['tool.register'], 'http.serve'),
    ).toThrow(/did not declare it/);
  });

  test('strict mode: passes when cap declared', () => {
    expect(() =>
      requireCapability('p1', ['tool.register', 'http.serve'], 'http.serve'),
    ).not.toThrow();
  });

  test('strict mode with empty array: blocks everything', () => {
    expect(() => requireCapability('p1', [], 'tool.register')).toThrow(/did not declare it/);
  });

  test('legacy mode (undefined): allows + warns ONCE per plugin/cap pair', () => {
    requireCapability('p1', undefined, 'tool.register');
    requireCapability('p1', undefined, 'tool.register'); // second call same plugin/cap
    requireCapability('p1', undefined, 'tool.register'); // third
    expect(logger.warn).toHaveBeenCalledTimes(1);

    requireCapability('p1', undefined, 'http.serve'); // different cap, same plugin → warns
    expect(logger.warn).toHaveBeenCalledTimes(2);

    requireCapability('p2', undefined, 'tool.register'); // different plugin → warns
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  test('isLegacyMode discriminates undefined vs []', () => {
    expect(isLegacyMode(undefined)).toBe(true);
    expect(isLegacyMode([])).toBe(false);
    expect(isLegacyMode(['tool.register'])).toBe(false);
  });
});

// ─── 3. Manifest schema ────────────────────────────────────────────────────

describe('manifest schema — capabilities field', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beeclaw-cap-mfst-'));
  });

  function writeManifest(content: any): string {
    fs.writeFileSync(
      path.join(tmp, 'openclaw.plugin.json'),
      JSON.stringify(content),
    );
    return tmp;
  }

  test('accepts manifest with valid capabilities array', () => {
    writeManifest({
      id: 'p1',
      capabilities: ['tool.register', 'http.serve'],
    });
    const r = loadPluginManifest(tmp);
    expect(r.ok).toBe(true);
  });

  test('accepts manifest with empty capabilities (strict mode opt-in)', () => {
    writeManifest({ id: 'p1', capabilities: [] });
    const r = loadPluginManifest(tmp);
    expect(r.ok).toBe(true);
  });

  test('accepts manifest WITHOUT capabilities (legacy mode)', () => {
    writeManifest({ id: 'p1' });
    const r = loadPluginManifest(tmp);
    expect(r.ok).toBe(true);
  });

  test('rejects manifest with unknown capability', () => {
    writeManifest({ id: 'p1', capabilities: ['totally.fake'] });
    const r = loadPluginManifest(tmp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/capabilities/);
  });

  test('rejects duplicates in capabilities array', () => {
    writeManifest({
      id: 'p1',
      capabilities: ['tool.register', 'tool.register'],
    });
    const r = loadPluginManifest(tmp);
    expect(r.ok).toBe(false);
  });
});

// ─── 4. createPluginApi gating ─────────────────────────────────────────────

describe('createPluginApi — capability gating', () => {
  test('strict mode: registerTool throws without tool.register', () => {
    const { createApi } = getOrCreatePluginRegistry();
    const api = createApi('p1', ['hook.register']); // no tool.register
    expect(() => api.registerTool({ name: 't' })).toThrow(/did not declare/);
  });

  test('strict mode: registerTool passes WITH tool.register', () => {
    const { createApi } = getOrCreatePluginRegistry();
    const api = createApi('p1', ['tool.register']);
    expect(() => api.registerTool({ name: 't' })).not.toThrow();
  });

  test('strict mode: registerHttpRoute requires http.serve', () => {
    const { createApi } = getOrCreatePluginRegistry();
    const api = createApi('p1', ['tool.register']);
    expect(() =>
      api.registerHttpRoute({ method: 'GET', path: '/x' }),
    ).toThrow(/http\.serve/);
  });

  test('strict mode: on() requires hook.register', () => {
    const { createApi } = getOrCreatePluginRegistry();
    const api = createApi('p1', ['tool.register']);
    expect(() => api.on('llm_input' as any, () => {})).toThrow(/hook\.register/);
  });

  test('strict mode []: blocks everything register*', () => {
    const { createApi } = getOrCreatePluginRegistry();
    const api = createApi('p1', []);
    expect(() => api.registerTool({ name: 't' })).toThrow();
    expect(() => api.registerHook({ name: 'h' })).toThrow();
    expect(() => api.registerChannel({ id: 'c' })).toThrow();
    expect(() => api.registerProvider({ id: 'pr' })).toThrow();
    expect(() => api.registerHttpRoute({ method: 'GET', path: '/x' })).toThrow();
  });

  test('legacy mode (undefined): all methods callable + warning logged', () => {
    const { createApi } = getOrCreatePluginRegistry();
    const api = createApi('p1'); // no caps arg
    expect(() => api.registerTool({ name: 't' })).not.toThrow();
    expect(() => api.registerHttpRoute({ method: 'GET', path: '/x' })).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
    expect((logger.warn as any).mock.calls.some((c: any[]) =>
      String(c[0]).includes('without declaring it'),
    )).toBe(true);
  });
});

// ─── 5. wrapRuntimeForCapabilities ─────────────────────────────────────────

describe('wrapRuntimeForCapabilities — runtime surface gating', () => {
  function realRuntime() {
    return createPluginRuntimeShim({
      configLoader: () => ({ ok: true }),
      configWriter: () => {},
      commandRunner: async () => 'cmd-out',
      mediaLoader: async () => Buffer.from('img'),
    });
  }

  test('strict mode: state.set throws without state.access', () => {
    const r = wrapRuntimeForCapabilities(realRuntime(), 'p1', []);
    expect(() => r.state.set('k', 'v')).toThrow(/state\.access/);
  });

  test('strict mode: state.set passes WITH state.access', () => {
    const r = wrapRuntimeForCapabilities(realRuntime(), 'p1', ['state.access']);
    expect(() => r.state.set('k', 'v')).not.toThrow();
    expect(r.state.get('k')).toBe('v');
  });

  test('strict mode: runCommandWithTimeout throws without runtime.command', async () => {
    const r = wrapRuntimeForCapabilities(realRuntime(), 'p1', []);
    expect(() => r.system.runCommandWithTimeout('ls', 1000)).toThrow(/runtime\.command/);
  });

  test('strict mode: enqueueSystemEvent NOT gated (always allowed)', () => {
    const r = wrapRuntimeForCapabilities(realRuntime(), 'p1', []);
    expect(() => r.system.enqueueSystemEvent({ type: 'x' })).not.toThrow();
  });

  test('strict mode: loadConfig throws without runtime.config.read', () => {
    const r = wrapRuntimeForCapabilities(realRuntime(), 'p1', []);
    expect(() => r.config.loadConfig()).toThrow(/runtime\.config\.read/);
  });

  test('strict mode: loadConfig passes WITH runtime.config.read but writeConfigFile still gated', () => {
    const r = wrapRuntimeForCapabilities(realRuntime(), 'p1', ['runtime.config.read']);
    expect(() => r.config.loadConfig()).not.toThrow();
    expect(() => r.config.writeConfigFile({ x: 1 })).toThrow(/runtime\.config\.write/);
  });

  test('strict mode: media.loadWebMedia gated, detectMime always free (pure)', () => {
    const r = wrapRuntimeForCapabilities(realRuntime(), 'p1', []);
    expect(() => r.media.loadWebMedia('https://x')).toThrow(/runtime\.media/);
    // detectMime is a pure function — always allowed.
    expect(r.media.detectMime(Buffer.from([0x89, 0x50]))).toBe('image/png');
  });

  test('logging is always free (no capability needed)', () => {
    const r = wrapRuntimeForCapabilities(realRuntime(), 'p1', []);
    expect(() => r.logging.info('hello')).not.toThrow();
  });

  test('legacy mode (undefined): all gated calls succeed, but warn fires', () => {
    const r = wrapRuntimeForCapabilities(realRuntime(), 'p1', undefined);
    expect(() => r.state.set('k', 'v')).not.toThrow();
    expect(() => r.config.loadConfig()).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});
