/**
 * Plugin capability model — declare what you need, get nothing else.
 *
 * MVP: enforced at the api/runtime surface inside the main process.
 * Worker/VM isolation is the planned next step (see PR notes); this
 * tier still requires trusting plugin code at the language level.
 * What it DOES give you:
 *
 *   - A loud, structured error when a plugin reaches for something it
 *     didn't declare. No silent deception.
 *   - A migration ramp: existing plugins (no `capabilities` field)
 *     run in "legacy mode" with a deprecation warning, so we can
 *     ship this without breaking the test-plugin or any third-party
 *     install. Once new plugins adopt declarations, the default can
 *     flip to deny.
 */

import { logger } from '../../../infra/observability/logger';

export const KNOWN_CAPABILITIES = [
  // api.register* methods
  'tool.register',
  'hook.register',
  'channel.register',
  'provider.register',
  'http.serve',
  'cli.register',
  // runtime surface
  'state.access',
  'runtime.command',
  'runtime.media',
  'runtime.config.read',
  'runtime.config.write',
] as const;

export type Capability = (typeof KNOWN_CAPABILITIES)[number];

const KNOWN_SET = new Set<string>(KNOWN_CAPABILITIES);

export function isKnownCapability(c: string): c is Capability {
  return KNOWN_SET.has(c);
}

/** Plugin in "legacy mode" if manifest omits the `capabilities` field. */
export function isLegacyMode(declared: readonly string[] | undefined): boolean {
  return declared === undefined;
}

/**
 * Throw if the requested capability isn't declared.
 * In legacy mode, allow everything but warn once per plugin per cap.
 */
const legacyWarnSeen = new Set<string>();

export function requireCapability(
  pluginId: string,
  declared: readonly string[] | undefined,
  needed: Capability,
): void {
  if (isLegacyMode(declared)) {
    const key = `${pluginId}:${needed}`;
    if (!legacyWarnSeen.has(key)) {
      legacyWarnSeen.add(key);
      logger.warn(
        `[Plugin] "${pluginId}" used capability "${needed}" without declaring it. ` +
        `Add a "capabilities" array to openclaw.plugin.json to opt into the strict ` +
        `model — this warning will become an error in a future release.`,
      );
    }
    return;
  }
  if (!declared!.includes(needed)) {
    throw new Error(
      `[Plugin] "${pluginId}" attempted to use capability "${needed}" but did not declare ` +
      `it in openclaw.plugin.json. Declared: [${declared!.join(', ') || 'none'}].`,
    );
  }
}

// For tests: clear the warn-once cache between runs.
export function _resetLegacyWarnCache(): void {
  legacyWarnSeen.clear();
}
