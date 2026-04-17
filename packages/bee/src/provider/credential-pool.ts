/**
 * P0-1 Credential Pool — multi-API-key failover pool.
 *
 * Manages a set of provider credentials and exposes strategy-based
 * selection, automatic cooldown on repeated failures, and an event
 * system so callers can observe pool health in real time.
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Strategy used to pick the next credential from the pool. */
export type SelectionStrategy = 'fill_first' | 'round_robin' | 'random' | 'least_used';

/** Runtime state of a single credential. */
export type CredentialState = 'active' | 'cooling' | 'exhausted';

/** Event names emitted by the pool. */
export type PoolEventType = 'credential_cooling' | 'credential_recovered' | 'all_exhausted';

/** Payload delivered with every pool event. */
export interface PoolEvent {
  type: PoolEventType;
  credentialId: string;
  timestamp: number;
  /** Present only for `credential_cooling` events. */
  reason?: string;
}

/** A single credential supplied by the caller. */
export interface PooledCredential {
  /** Optional human-readable / external id.  Auto-generated when omitted. */
  id?: string;
  apiKey: string;
  baseUrl?: string;
  refreshToken?: string;
  tokenEndpoint?: string;
  /** Requests-per-minute limit hint (informational, not enforced here). */
  rpmLimit?: number;
  /** Arbitrary tags used to narrow `acquire()` searches. */
  tags?: string[];
}

/** Configuration for the pool itself. */
export interface CredentialPoolConfig {
  strategy: SelectionStrategy;
  /** How long (ms) a credential stays in cooling before it is retried. Default 3 600 000 (1 h). */
  cooldownMs: number;
  /** Consecutive errors before a credential enters cooling. Default 3. */
  errorThreshold: number;
  /** Optional set of error-type strings that trigger cooldown.  When empty every error counts. */
  cooldownTriggers: string[];
}

/** Snapshot returned by `getStats()`. */
export interface CredentialPoolStats {
  total: number;
  active: number;
  cooling: number;
  exhausted: number;
  credentials: ReadonlyArray<{
    id: string;
    state: CredentialState;
    consecutiveErrors: number;
    totalSuccesses: number;
    totalFailures: number;
    cooldownEndsAt: number | null;
  }>;
}

export type PoolEventListener = (event: PoolEvent) => void;

// ---------------------------------------------------------------------------
// Internal bookkeeping
// ---------------------------------------------------------------------------

interface InternalCredential {
  /** Stable identifier (caller-supplied or derived). */
  id: string;
  credential: Readonly<PooledCredential>;
  state: CredentialState;
  consecutiveErrors: number;
  totalSuccesses: number;
  totalFailures: number;
  /** Epoch-ms when the current cooldown expires.  `null` when not cooling. */
  cooldownEndsAt: number | null;
  /** Number of times this credential has been acquired (used by least_used). */
  acquireCount: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CredentialPoolConfig = {
  strategy: 'round_robin',
  cooldownMs: 3_600_000,
  errorThreshold: 3,
  cooldownTriggers: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic id from the API key so that credentials without an
 * explicit `id` still get a stable, non-sensitive identifier.
 */
function deriveId(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// CredentialPool
// ---------------------------------------------------------------------------

export class CredentialPool {
  private readonly entries: InternalCredential[];
  private readonly config: CredentialPoolConfig;
  private readonly listeners: PoolEventListener[] = [];

  /** Round-robin index — only meaningful when strategy is `round_robin`. */
  private rrIndex = 0;

  constructor(credentials: PooledCredential[], config?: Partial<CredentialPoolConfig>) {
    if (credentials.length === 0) {
      throw new Error('CredentialPool requires at least one credential');
    }

    this.config = { ...DEFAULT_CONFIG, ...config };

    this.entries = credentials.map((cred) => {
      const id = cred.id ?? deriveId(cred.apiKey);
      return {
        id,
        credential: Object.freeze({ ...cred, id }),
        state: 'active' as CredentialState,
        consecutiveErrors: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        cooldownEndsAt: null,
        acquireCount: 0,
      };
    });
  }

  // -----------------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------------

  /**
   * Select the next usable credential.
   *
   * @param tags  When provided only credentials whose `tags` include **all**
   *              of the requested tags are considered.
   * @returns The selected `PooledCredential`, or `null` when none are available.
   */
  acquire(tags?: string[]): PooledCredential | null {
    // Restore any credentials whose cooldown has elapsed.
    this.refreshCooldowns();

    const candidates = this.entries.filter((e) => {
      if (e.state !== 'active') return false;
      if (tags && tags.length > 0) {
        const credTags = e.credential.tags ?? [];
        return tags.every((t) => credTags.includes(t));
      }
      return true;
    });

    if (candidates.length === 0) return null;

    const selected = this.selectByStrategy(candidates);
    selected.acquireCount += 1;
    return selected.credential;
  }

  private selectByStrategy(candidates: InternalCredential[]): InternalCredential {
    switch (this.config.strategy) {
      case 'fill_first':
        // Always prefer the first candidate (stable order from constructor).
        return candidates[0];

      case 'round_robin': {
        // Advance the shared index and wrap around the full entries list so
        // that the round-robin position is stable regardless of which
        // credentials are currently in cooldown.
        const start = this.rrIndex;
        const total = this.entries.length;
        for (let i = 0; i < total; i++) {
          const entry = this.entries[(start + i) % total];
          if (candidates.includes(entry)) {
            this.rrIndex = (start + i + 1) % total;
            return entry;
          }
        }
        // Fallback (should not happen — candidates is non-empty).
        this.rrIndex = (this.rrIndex + 1) % total;
        return candidates[0];
      }

      case 'random':
        return candidates[Math.floor(Math.random() * candidates.length)];

      case 'least_used': {
        let best = candidates[0];
        for (let i = 1; i < candidates.length; i++) {
          if (candidates[i].acquireCount < best.acquireCount) {
            best = candidates[i];
          }
        }
        return best;
      }

      default: {
        // Exhaustive check — should never happen at runtime.
        const _: never = this.config.strategy;
        throw new Error(`Unknown selection strategy: ${_}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Feedback
  // -----------------------------------------------------------------------

  /**
   * Record a failure against a credential.
   *
   * When the consecutive-error count reaches `errorThreshold` the credential
   * moves into `cooling` state and a `credential_cooling` event is emitted.
   */
  reportFailure(credentialId: string, errorType: string): void {
    const entry = this.findEntry(credentialId);
    if (!entry || entry.state === 'exhausted') return;

    // If cooldownTriggers is configured, only count matching error types.
    if (
      this.config.cooldownTriggers.length > 0 &&
      !this.config.cooldownTriggers.includes(errorType)
    ) {
      entry.totalFailures += 1;
      return;
    }

    entry.consecutiveErrors += 1;
    entry.totalFailures += 1;

    if (entry.consecutiveErrors >= this.config.errorThreshold && entry.state === 'active') {
      entry.state = 'cooling';
      entry.cooldownEndsAt = Date.now() + this.config.cooldownMs;
      this.emit({
        type: 'credential_cooling',
        credentialId,
        timestamp: Date.now(),
        reason: errorType,
      });

      // Check if the entire pool is now non-active.
      this.checkAllExhausted();
    }
  }

  /**
   * Record a successful call — resets the consecutive error counter.
   */
  reportSuccess(credentialId: string): void {
    const entry = this.findEntry(credentialId);
    if (!entry) return;
    entry.consecutiveErrors = 0;
    entry.totalSuccesses += 1;
  }

  /**
   * Permanently disable a credential (e.g. revoked key, zero balance).
   */
  markExhausted(credentialId: string): void {
    const entry = this.findEntry(credentialId);
    if (!entry) return;
    entry.state = 'exhausted';
    entry.cooldownEndsAt = null;

    this.checkAllExhausted();
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  getStats(): CredentialPoolStats {
    this.refreshCooldowns();

    const stats: CredentialPoolStats = {
      total: this.entries.length,
      active: 0,
      cooling: 0,
      exhausted: 0,
      credentials: this.entries.map((e) => {
        return {
          id: e.id,
          state: e.state,
          consecutiveErrors: e.consecutiveErrors,
          totalSuccesses: e.totalSuccesses,
          totalFailures: e.totalFailures,
          cooldownEndsAt: e.cooldownEndsAt,
        };
      }),
    };

    for (const e of this.entries) {
      switch (e.state) {
        case 'active':
          stats.active++;
          break;
        case 'cooling':
          stats.cooling++;
          break;
        case 'exhausted':
          stats.exhausted++;
          break;
      }
    }

    return stats;
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  /**
   * Register a listener that will be called for every pool event.
   *
   * @returns An unsubscribe function.
   */
  onEvent(listener: PoolEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private emit(event: PoolEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Swallow listener errors — pool operation must not be disrupted.
      }
    }
  }

  /**
   * Walk every cooling credential and restore it to `active` when its
   * cooldown period has elapsed.
   */
  private refreshCooldowns(): void {
    const now = Date.now();
    for (const entry of this.entries) {
      if (entry.state === 'cooling' && entry.cooldownEndsAt !== null && now >= entry.cooldownEndsAt) {
        entry.state = 'active';
        entry.cooldownEndsAt = null;
        entry.consecutiveErrors = 0;
        this.emit({
          type: 'credential_recovered',
          credentialId: entry.id,
          timestamp: now,
        });
      }
    }
  }

  /**
   * Emit `all_exhausted` when no credential is `active` **and** none is
   * currently cooling (i.e. all are permanently exhausted).
   */
  private checkAllExhausted(): void {
    const hasActive = this.entries.some((e) => e.state === 'active');
    const hasCooling = this.entries.some((e) => e.state === 'cooling');

    if (!hasActive && !hasCooling) {
      this.emit({
        type: 'all_exhausted',
        credentialId: '*',
        timestamp: Date.now(),
      });
    }
  }

  private findEntry(credentialId: string): InternalCredential | undefined {
    return this.entries.find((e) => e.id === credentialId);
  }
}
