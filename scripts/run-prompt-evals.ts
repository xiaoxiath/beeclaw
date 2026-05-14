#!/usr/bin/env bun
/**
 * Prompt-eval CLI runner.
 *
 * Modes:
 *   bun scripts/run-prompt-evals.ts                 # fixture mode (free, CI)
 *   bun scripts/run-prompt-evals.ts --live          # hit real LLM (costs money)
 *   bun scripts/run-prompt-evals.ts --record id1 id2  # live + write fixtures
 *   bun scripts/run-prompt-evals.ts --filter tag=safety
 *
 * Live mode requires the project's normal config (provider + API key) to be
 * set up; see beeclaw.json / .env.
 *
 * Exit code:
 *   0 — every selected case passed
 *   1 — at least one case failed
 *   2 — invocation error (no cases matched, missing LLM client, etc.)
 */

import * as path from 'path';
import {
  runEvalSuite,
  FixtureStore,
  DEFAULT_EVAL_CASES,
  type EvalCase,
  type EvalSuiteResult,
} from '../src/domain/agent/evals';

const FIXTURE_DIR = path.resolve(__dirname, '..', 'tests', 'fixtures', 'prompt-evals');

interface CliArgs {
  live: boolean;
  recordIds: string[];
  filterTag?: string;
  filterIds?: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { live: false, recordIds: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') out.live = true;
    else if (a === '--record') {
      out.live = true; // recording implies live
      // Collect everything until the next flag.
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out.recordIds.push(argv[++i]);
      }
    } else if (a.startsWith('--filter=')) {
      const v = a.slice('--filter='.length);
      if (v.startsWith('tag=')) out.filterTag = v.slice(4);
      else out.filterIds = v.split(',');
    } else if (a === '--filter' && i + 1 < argv.length) {
      const v = argv[++i];
      if (v.startsWith('tag=')) out.filterTag = v.slice(4);
      else out.filterIds = v.split(',');
    }
  }
  return out;
}

function selectCases(args: CliArgs): EvalCase[] {
  let cases = DEFAULT_EVAL_CASES;
  if (args.recordIds.length > 0) {
    cases = cases.filter(c => args.recordIds.includes(c.id));
  } else if (args.filterIds) {
    cases = cases.filter(c => args.filterIds!.includes(c.id));
  }
  if (args.filterTag) {
    cases = cases.filter(c => c.tags?.includes(args.filterTag!));
  }
  return cases;
}

function printSuiteResult(result: EvalSuiteResult): void {
  // eslint-disable-next-line no-console
  const log = console.log;
  log('');
  log(`Prompt evals — ${result.passed}/${result.total} passed (${result.durationMs}ms)`);
  log('');
  for (const c of result.cases) {
    const tag = c.passed ? '✓' : '✗';
    log(`  ${tag}  ${c.caseId}  (${c.durationMs}ms, ${c.source})`);
    if (!c.passed) {
      if (c.error) log(`       error: ${c.error}`);
      for (const a of c.assertions) {
        if (!a.passed) log(`       fail:  ${a.message}`);
      }
    }
  }
  log('');
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const cases = selectCases(args);
  if (cases.length === 0) {
    // eslint-disable-next-line no-console
    console.error('No eval cases matched the filter.');
    return 2;
  }

  const store = new FixtureStore(FIXTURE_DIR);

  // Resolve the *current* assembled system prompt so promptHash reflects
  // the prompt the operator is actually shipping.
  const { assembleSystemPrompt } = await import('../src/domain/agent/prompt-builder');
  const systemPrompt = assembleSystemPrompt({});

  // Live-mode wiring: bind the project's standard LLM client to the
  // EvalLLMClient interface. Stubbed here as a clear placeholder — the
  // operator wires it to bee's AIClient when running live.
  let llmClient = undefined;
  let model = 'fixture-only';
  if (args.live) {
    // eslint-disable-next-line no-console
    console.error(
      'Live mode requested but the LLM-client adapter is intentionally not wired ' +
      'in this script — wire it to bee.AIClient before running. See ' +
      'src/domain/agent/evals/runner.ts for the EvalLLMClient interface.',
    );
    return 2;
  }

  const result = await runEvalSuite(cases, {
    mode: args.live ? 'live' : 'fixture',
    resolveSystemPrompt: () => systemPrompt,
    model,
    fixtureStore: store,
    llmClient,
    recordOnLive: args.recordIds.length > 0,
  });

  printSuiteResult(result);
  return result.failed === 0 ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
  // eslint-disable-next-line no-console
  console.error('eval runner crashed:', err);
  process.exit(2);
});
