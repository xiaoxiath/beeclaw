# Fix: Stagger Daily Reflection and Memory Compression Execution

## Problem

Both tasks were scheduled to run at the same time (3:00 AM), causing potential issues:

1. **Resource Competition**: Both tasks compete for CPU, memory, and LLM API quota
2. **Read/Write Conflicts**: Reflection reads conversations while Compression might delete them
3. **Log Confusion**: Overlapping logs make debugging harder
4. **Error Propagation**: One task failure could affect the other

## Solution

Stagger execution by 30 minutes:

```diff
- Daily Reflection: '0 3 * * *'      (3:00 AM)
- Memory Compression: '0 3 * * *'    (3:00 AM)
+ Daily Reflection: '0 3 * * *'      (3:00 AM)
+ Memory Compression: '30 3 * * *'   (3:30 AM)
```

## Implementation

### Files Changed

1. **src/bot.ts** (line 225)
   - Changed cron from `'0 3 * * *'` to `'30 3 * * *'`
   - Updated description to reflect new time

2. **src/entries/bot.ts** (line 233)
   - Changed cron from `'0 3 * * *'` to `'30 3 * * *'`
   - Updated description to reflect new time

### Execution Order

```
3:00 AM  → Daily Reflection starts
           ├─ Read recent 50 conversations
           ├─ Analyze patterns
           ├─ Extract lessons
           └─ Update SOUL.md
           (Takes ~5-10 minutes)

3:30 AM  → Memory Compression starts
           ├─ Scan files older than 7 days
           ├─ Score importance
           ├─ Generate summaries
           ├─ Archive old files
           └─ Delete low-value content
           (Takes ~10-20 minutes)
```

## Benefits

### 1. **No Resource Competition** ✅
- LLM API calls are spread out (Reflection finishes before Compression starts)
- Memory usage peaks are separated
- CPU load is distributed

### 2. **No Read/Write Conflicts** ✅
- Reflection reads recent conversations (not affected by Compression)
- Compression works on files older than 7 days
- 30-minute buffer ensures no overlap

### 3. **Clearer Logs** ✅
```
[3:00:00] [Daemon] Running daily reflection...
[3:05:23] [Daemon] Reflection complete: 3 patterns, 5 lessons

[3:30:00] [Daemon] Running memory compression...
[3:45:12] [Daemon] Compression complete: 20 summarized, 10 archived
```

### 4. **Better Error Isolation** ✅
- Reflection failure doesn't affect Compression
- Easier to identify which task failed
- Faster debugging

## Migration

### For Existing Deployments

Existing schedules will continue to run at 3:00 AM. To update:

```bash
# Option 1: Manual update via proactive_list + proactive_cancel + recreate
# Check existing schedules
# The AI can help you list and update them

# Option 2: Delete old compression schedule (will be recreated at next startup)
# The idempotency check will prevent duplicates
```

### For New Deployments

No action needed. New schedules will be created with staggered times.

## Testing

### Manual Test

```bash
# Start bot in daemon mode
bun run bot --daemon

# Check logs for staggered execution
# Should see:
# - 3:00 AM: Daily Reflection
# - 3:30 AM: Memory Compression
```

### Verification

```typescript
// List all schedules
proactive_list({ type: 'schedules' })

// Expected output:
// Daily Reflection: cron = "0 3 * * *"
// Daily Memory Compression: cron = "30 3 * * *"
```

## Related Documentation

- [Daily Reflection vs Memory Compression Analysis](../analysis/daily-reflection-vs-compression.md)
- [Visual Comparison](../analysis/reflection-comparison-visual.md)

## References

- Issue: "Daily Reflection 和 Memory Compression 是不是重复了"
- Commit: This change
