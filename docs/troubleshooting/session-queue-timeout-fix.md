# Session Queue Timeout Fix

## Problem

Messages were expiring in the session queue while waiting for the agent to finish processing long-running tasks.

**Root Cause:**
- Session queue's `maxWaitTime`: 5 minutes (300 seconds)
- Agent's inactivity timeout: 10 minutes (600 seconds)
- Turn timeout: 10 minutes (600 seconds)

When the agent processes a message for a long time (e.g., complex reasoning, multiple tool calls), any new messages that arrive would wait in the queue. If the agent takes more than 5 minutes, those queued messages expire before they can be processed.

**Error Message:**
```
error: [SessionQueue] Message expired after 583s wait.
```

## Solution

Aligned the session queue's `maxWaitTime` with the resilience config's `turnTimeoutMs`:

1. **Updated default `maxWaitTime`**: Changed from 5 minutes to 10 minutes
2. **Made queue timeout configurable**: Queue now uses `turnTimeoutMs + 60s` buffer
3. **Integrated with resilience config**: Session manager initializes queue with correct timeout

### Changes

#### 1. `src/infra/resilience/session-lock.ts`
- Updated `DEFAULT_MAX_WAIT_TIME` from 5 minutes to 10 minutes
- Added documentation explaining the alignment requirement

#### 2. `src/domain/session/index.ts`
- Added `resilienceConfig` parameter to `initSessionManager()`
- Queue now initialized with `maxWaitTime = max(turnTimeout + 60s, 600s)`
- Logs the queue configuration on startup

#### 3. `src/app/index.ts`
- Imports `resolveConfig` from resilience config
- Passes resilience config to session manager initialization

## Verification

Test added: `src/infra/resilience/__tests__/session-lock.test.ts`
- ✅ Verifies queue's `maxWaitTime` >= turn timeout
- ✅ Tests message expiration behavior

## Configuration

The queue timeout is now automatically calculated from the resilience config:

```typescript
// Standard preset
turnTimeoutMs: 600,000 (10 minutes)
maxWaitTime: 660,000 (11 minutes)

// Complex research preset
turnTimeoutMs: 1,800,000 (30 minutes)
maxWaitTime: 1,860,000 (31 minutes)

// Long running preset
turnTimeoutMs: 3,600,000 (60 minutes)
maxWaitTime: 3,660,000 (61 minutes)
```

## Impact

- ✅ Messages no longer expire while waiting for agent processing
- ✅ Queue timeout automatically adapts to different resilience presets
- ✅ No more "Message expired after Xs wait" errors during normal operation
- ✅ Better user experience for long-running tasks

## Monitoring

On startup, you'll see a log message:
```
[SessionManager] Queue configured with maxWaitTime: 660s (turn timeout: 600s)
```

This confirms the queue is properly configured with the correct timeout.
