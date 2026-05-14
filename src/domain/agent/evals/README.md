# Prompt evals

Regression tests that pin **agent behaviour** to specific prompt sections.
Edit `base.md`, run the suite, and see exactly which behaviour changed.

## What this is

A fixture-based eval runner with **structural assertions** (not full-text
snapshots — those are too flaky for LLM output).

| Mode | Cost | When to use |
|---|---|---|
| `fixture` (default) | free, deterministic | every PR via CI |
| `live` | hits the real LLM | record fixtures, validate prompt changes |

Each `EvalCase` is one user query + a list of assertions about the response
(contains, regex, toolCall, length, etc.). All must pass for the case to pass.

## Workflow

### Add a new case

1. Append an `EvalCase` to `cases/index.ts`.
2. Pick a stable `id` matching `[A-Za-z0-9._-]+` — it doubles as the fixture filename.
3. Use **structural** assertions: `toolCall`, `contains`, `matches`. Avoid
   asserting full response text.
4. Record the fixture (live mode):
   ```bash
   bun run eval:prompts -- --record my-new-case
   ```
5. Verify it replays cleanly:
   ```bash
   bun run eval:prompts -- --filter=my-new-case
   ```
6. Commit `tests/fixtures/prompt-evals/my-new-case.fixture.json`.

### Edit `base.md`

Any change to the assembled system prompt invalidates every fixture (the
`promptHash` no longer matches). The runner refuses stale fixtures with a
clear error so you can't silently merge a behavioural regression.

Recovery:

```bash
# 1. Run the suite — every case will fail with "stale" errors.
bun run eval:prompts

# 2. Re-record the affected fixtures.
bun run eval:prompts -- --record case-1 case-2

# 3. Re-run, now they replay green.
bun run eval:prompts

# 4. Diff the fixtures in git — that diff IS the behaviour change you're
#    introducing. Review it like you would a code diff.
```

### Filter

```bash
bun run eval:prompts -- --filter=tag=safety
bun run eval:prompts -- --filter=case-1,case-2
```

## Why fixtures, not snapshots

LLM output varies between runs even at temperature 0. Asserting full
response text is flaky and the failure messages are useless ("expected
<2KB blob>, got <slightly different 2KB blob>").

Structural assertions answer the question that actually matters: did the
agent **do the right thing**? — call the right tool, refuse the wrong
operation, produce a response in the expected shape.

The fixture itself stays as supporting evidence: when an assertion fails,
the operator can read the recorded response to understand why.

## Components

```
evals/
├── types.ts            EvalCase, EvalAssertion, Fixture, EvalLLMClient
├── assertions.ts       Pure-function assertion evaluator
├── fixture-store.ts    On-disk JSON fixture store with promptHash + atomic write
├── runner.ts           Orchestrator (fixture or live mode)
├── cases/index.ts      Default eval-case catalogue
└── __tests__/          51 unit tests, no external deps
```

The framework is 100% deterministic in fixture mode — every component is
covered by unit tests with mocked LLM clients and real-fs round-trips for
fixtures. The only non-deterministic surface is the live-mode LLM call
itself, which is opt-in via `--live` / `--record`.

## CI integration

Add to your CI step:

```yaml
- run: bun run eval:prompts
```

Fail-fast: the script exits 1 on any case failure, 2 on invocation errors
(no cases matched, missing client, malformed flags).
