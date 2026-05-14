/**
 * Fixture store — persists recorded LLM responses on disk and replays them
 * deterministically for offline runs.
 *
 * Each fixture is one JSON file under <baseDir>/<caseId>.fixture.json. The
 * promptHash field guards against silent staleness: if the system prompt
 * (base.md), the user message, or the model is changed, the hash changes
 * and load() refuses to use the fixture, surfacing the drift to the
 * operator.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Fixture, EvalToolCall } from './types';

export const FIXTURE_FORMAT_VERSION = 1;

/** Compute the prompt-hash that pins a fixture to its inputs. */
export function computePromptHash(input: {
  systemPrompt: string;
  userMessage: string;
  model: string;
}): string {
  const canonical = `${input.model}\n${input.systemPrompt}\n${input.userMessage}`;
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex').slice(0, 16);
}

export class FixtureStore {
  constructor(private readonly baseDir: string) {}

  /** Absolute path of the fixture file for a given case id. */
  private filePath(caseId: string): string {
    // Restrict the id to a safe filename — the same allowlist the skill
    // packager uses, so we avoid path-traversal and OS-incompatible chars.
    if (!/^[A-Za-z0-9._-]+$/.test(caseId)) {
      throw new Error(`fixture: unsafe caseId "${caseId}" (must match [A-Za-z0-9._-]+)`);
    }
    return path.join(this.baseDir, `${caseId}.fixture.json`);
  }

  /**
   * Load a fixture if present and not stale.
   *
   * Returns:
   *   - the Fixture when present and the promptHash matches `expectedHash`
   *   - null when the file is missing
   *   - throws when the file exists but is unreadable, malformed, or stale
   *     (so a stale fixture surfaces loudly rather than silently passing)
   */
  load(caseId: string, expectedHash: string): Fixture | null {
    const fp = this.filePath(caseId);
    if (!fs.existsSync(fp)) return null;

    let raw: string;
    try {
      raw = fs.readFileSync(fp, 'utf-8');
    } catch (e) {
      throw new Error(`fixture ${caseId}: read failed: ${(e as Error).message}`);
    }

    let parsed: Fixture;
    try {
      parsed = JSON.parse(raw) as Fixture;
    } catch (e) {
      throw new Error(`fixture ${caseId}: invalid JSON: ${(e as Error).message}`);
    }

    if (!parsed.caseId || !parsed.promptHash || typeof parsed.responseText !== 'string') {
      throw new Error(`fixture ${caseId}: malformed (missing required fields)`);
    }
    if (parsed.caseId !== caseId) {
      throw new Error(`fixture ${caseId}: caseId mismatch (file says "${parsed.caseId}")`);
    }
    if (parsed.promptHash !== expectedHash) {
      throw new Error(
        `fixture ${caseId}: stale (promptHash ${parsed.promptHash} != expected ${expectedHash}). ` +
        `Re-record with: bun run eval:prompts -- --record ${caseId}`,
      );
    }
    if (!Array.isArray(parsed.toolCalls)) parsed.toolCalls = [];
    return parsed;
  }

  /**
   * Save (or overwrite) a fixture. Creates the base directory if missing.
   * Atomic via temp-file + rename so a crash mid-write can never leave a
   * half-written fixture that load() would then reject.
   */
  save(fixture: Fixture): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const fp = this.filePath(fixture.caseId);
    const tmp = `${fp}.tmp.${process.pid}.${Date.now()}`;
    const json = JSON.stringify(fixture, null, 2);
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, fp);
  }

  /** True iff a fixture file exists for `caseId` (no validity check). */
  exists(caseId: string): boolean {
    return fs.existsSync(this.filePath(caseId));
  }

  /** List all caseIds that currently have a fixture on disk. */
  list(): string[] {
    if (!fs.existsSync(this.baseDir)) return [];
    return fs.readdirSync(this.baseDir)
      .filter(f => f.endsWith('.fixture.json'))
      .map(f => f.replace(/\.fixture\.json$/, ''))
      .sort();
  }

  /** Convenience for tests: build a Fixture object from raw inputs. */
  static newFixture(
    caseId: string,
    model: string,
    promptHash: string,
    responseText: string,
    toolCalls: EvalToolCall[] = [],
  ): Fixture {
    return {
      caseId,
      recordedAt: new Date().toISOString(),
      model,
      promptHash,
      responseText,
      toolCalls,
    };
  }
}
