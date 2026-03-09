# Timeout Configuration

This document explains the timeout settings for Agent and Subagent operations.

## Overview

Beeclaw has configurable timeout settings for AI operations to prevent hanging on slow responses.

## Default Timeouts

| Component | Default Timeout | Environment Variable |
|-----------|----------------|---------------------|
| **Agent** | 5 minutes (300,000ms) | `AGENT_TIMEOUT_MS` |
| **Subagent** | 3 minutes (180,000ms) | `SUBAGENT_TIMEOUT_MS` |

## Why These Values?

### Agent Timeout (5 minutes)

The main agent timeout is set to 5 minutes because:

1. **Large Language Models** - Models like GLM-5 with 200K context can take time to process
2. **Tool Execution** - Agent may need to execute multiple tools (web_fetch, file operations, etc.)
3. **Complex Reasoning** - Multi-step reasoning tasks require more processing time
4. **Network Latency** - API calls to AI providers can be slow

### Subagent Timeout (3 minutes)

Subagent timeout is slightly shorter (3 minutes) because:

1. **Focused Tasks** - Subagents handle specific, well-scoped tasks
2. **Limited Tools** - Each subagent type has a curated tool set
3. **Parallel Execution** - Multiple subagents can run in parallel

## Customizing Timeouts

### Method 1: Environment Variables

```bash
# Set agent timeout to 10 minutes
export AGENT_TIMEOUT_MS=600000

# Set subagent timeout to 5 minutes
export SUBAGENT_TIMEOUT_MS=300000
```

### Method 2: Per-Task Configuration (Subagents Only)

When calling `spawn_subagent` or `spawn_parallel`, you can specify timeout per task:

```typescript
spawn_subagent({
  type: "research",
  task: "Complex research task",
  timeout: 300000  // 5 minutes for this specific task
})
```

## When to Increase Timeout

Consider increasing timeout if you experience:

1. **Consistent timeouts** - If you regularly see timeout errors
2. **Large context** - Using models with 100K+ context windows
3. **Complex tasks** - Multi-step reasoning or extensive tool usage
4. **Slow network** - High latency connection to AI provider

## When to Decrease Timeout

Consider decreasing timeout if you want:

1. **Faster failure** - Fail quickly on unresponsive models
2. **Cost control** - Avoid paying for slow/incomplete responses
3. **Interactive use** - Real-time chat requiring quick responses

## Monitoring Timeouts

### Check Timeout Logs

When a timeout occurs, you'll see logs like:

```
[Session] Agent timeout after 300000ms: Agent response timeout
[Subagent] subagent-xxx failed: Subagent timeout after 180000ms
```

### Success Indicators

Successful operations show completion time:

```
[Agent] Response completed in 45000ms
[Subagent] subagent-xxx completed in 30000ms
```

## Best Practices

1. **Start with defaults** - The 5/3 minute defaults work well for most cases
2. **Monitor first** - Check logs before adjusting timeouts
3. **Task-specific** - Use per-task timeout for known slow operations
4. **Balance** - Too short = false failures, too long = poor UX

## Related Files

- `src/session/index.ts` - Agent timeout implementation
- `src/subagent/runtime.ts` - Subagent timeout implementation
- `src/subagent/tools.ts` - Tool definitions and default values
