#!/usr/bin/env bun
/**
 * Regenerate beeclaw.schema.json from the Zod schema.
 *
 * The Zod schema in src/infra/config/schema.ts is the source of truth
 * for runtime validation. The JSON Schema next to it is consumed by
 * editors (VS Code via $schema in beeclaw.json) for autocompletion +
 * inline validation. They MUST stay in sync.
 *
 * Run before committing schema changes:
 *   bun run gen:config-schema
 *
 * CI runs the same script and `git diff --exit-code` to fail PRs that
 * change the Zod schema without updating the JSON form.
 */

import * as fs from 'fs';
import * as path from 'path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AppConfigSchema } from '../src/infra/config/schema';

const OUT = path.resolve('beeclaw.schema.json');

const generated = zodToJsonSchema(AppConfigSchema, {
  name: 'BeeclawConfig',
  $refStrategy: 'none', // Inline everything — easier for editors to consume.
  target: 'jsonSchema7',
});

// Wrap with the same outer envelope the existing file uses, so we can
// keep the $id, title, description headers stable across regenerations.
const wrapped = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://beeclaw.dev/schema/config.json',
  title: 'Beeclaw Configuration',
  description:
    'Beeclaw Configuration Schema. Generated from src/infra/config/schema.ts ' +
    '(Zod = source of truth) via scripts/regen-config-schema.ts. ' +
    'Do NOT edit by hand — your changes will be overwritten by the next regen. ' +
    'CI fails the build if this file drifts from the Zod source.',
  ...((generated as { definitions?: Record<string, unknown> }).definitions
    ? (generated as { definitions: Record<string, unknown> }).definitions.BeeclawConfig
    : (generated as Record<string, unknown>)),
};

fs.writeFileSync(OUT, JSON.stringify(wrapped, null, 2) + '\n', 'utf-8');

// eslint-disable-next-line no-console
console.log(`✓ Wrote ${OUT} (${fs.statSync(OUT).size} bytes)`);
