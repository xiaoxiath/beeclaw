# Session storage migration: JSONL → SQLite

The session module currently runs in dual-mode controlled by the
`USE_SQLITE_SESSIONS` env var:

| `USE_SQLITE_SESSIONS` | Read order | Write |
|---|---|---|
| unset / `false` (default) | JSONL only | JSONL only |
| `true` | SQLite first, JSONL fallback | both stores |

The default has historically been JSONL because the SQLite path was
silently lossy — it dropped 10+ Session fields (`summary`,
`responseDelivered`, `pendingDelivery`, `recoveryAttempts`,
`lastRecoveryAt`, `lastAiResponse`, `lastMessageSource`,
`consecutiveRecoveryFailures`, `processedMessageIds`,
`archivedSegments`).

Fixed by `packSessionExtras` / `unpackSessionFromRow` (see migration.ts):
those fields now travel inside `sessions.metadata._sessionExtras` so a
SQLite round-trip is lossless.

## Cutover steps

1. **Backup**: `cp -r data/memory/sessions data/memory/sessions.bak.$(date +%s)`
2. **Dry-run migration**: confirms count and surfaces any corrupt files.
   ```
   bun run migrate:sessions -- --dry-run
   ```
3. **Commit migration**: actually inserts.
   ```
   bun run migrate:sessions -- --commit
   ```
   Idempotent — re-running shows `already in db: N`.
4. **Flip the env var** in your runtime config:
   ```
   USE_SQLITE_SESSIONS=true
   ```
5. **Verify**: start the bot, send a test message, confirm it persists
   across restart by reading from SQLite.
6. **(Optional) Clean up JSONL** after a soaking period:
   ```
   mv data/memory/sessions data/memory/sessions.archive.$(date +%s)
   ```
   The migration script never deletes source files automatically.

## Rollback

If anything goes wrong, unset `USE_SQLITE_SESSIONS` — the code falls
back to JSONL transparently. Source files are intact.

## Single-source future

This migration is the safe foundation. A future PR will:
- Drop the `USE_SQLITE_SESSIONS` env var and make SQLite the only path.
- Move JSONL writes to an opt-in "export" mode for backup / portability.
- Delete the JSONL fallback in `loadSession`.

That cutover is gated on operators (you) confirming the migration is
clean and the round-trip is faithful — which is what `migrate:sessions
--dry-run` verifies.
