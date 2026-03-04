# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Beeclaw is an evolving AI assistant that supports both CLI and Feishu (Lark) Bot interfaces. It features a multi-provider AI system, persistent memory, skill management, subagent orchestration, and proactive task scheduling.

## Development Commands

### Running the Application

```bash
# CLI mode (interactive chat)
bun run cli

# Bot mode (Feishu integration)
bun run bot

# Bot mode with daemon (enables proactive scheduling)
bun run bot --daemon

# Production mode with PM2
bun run pm2:start
bun run pm2:start:prod
```

### Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test src/agent/__tests__/agent.test.ts

# Run tests matching a pattern
bun test -t "test name pattern"

# Run tests with coverage
bun test --coverage

# Run single test file
bun test src/memory/__tests__/memory.test.ts
```

### Code Quality

```bash
# Lint code
bun run lint
```

## Architecture Overview

Beeclaw uses a layered architecture with clear separation of concerns:

### Core Systems

1. **Agent System** (`src/agent/`)
   - Central orchestrator for AI conversations
   - Context management with token-based compression
   - Tool execution and dependency grouping
   - Supports multiple AI providers (OpenAI, Zhipu, Anthropic, MiniMax)

2. **Memory System** (`src/memory/`)
   - Dual-layer storage: facts (dynamic) and knowledge (stable)
   - Automatic compression after 7 days, archival after 90 days
   - Hybrid search combining keyword and semantic retrieval
   - File-based storage in `data/memory/`

3. **Skill System** (`src/skills/`)
   - Dynamic skill definitions in `skills/{name}/SKILL.md`
   - Tools: `skill_ensure`, `skill_search`, `skill_record`, `skill_maturity`
   - Self-evolution through reflection triggers

4. **Subagent System** (`src/subagent/`)
   - Parallel task execution with DAG orchestration
   - Specialized agent types: research, memory, skill, code, general
   - Shared state management for inter-agent communication

5. **Queue System** (`src/queue/`)
   - Background task processing using Bunqueue
   - Job types: search, skill execution, reminders, analysis
   - Handlers in `src/queue/handlers/`

6. **Proactive System** (`src/proactive/`)
   - Daemon for scheduled tasks and reminders
   - Notification delivery via Feishu or CLI
   - Tools: `schedule_once`, `notification_push`, `proactive_schedule`, `proactive_list`
   - **Unified job handlers** in `src/proactive/job-handlers.ts` for both bot and daemon modes
   - **Proactive chat** (`llm_proactive_chat` task type): AI can initiate conversations based on context
     - Daily greetings with personalized agenda
     - Goal progress check-ins
     - Event reminders with preparation tips
     - Weather alerts and contextual suggestions

### Entry Points

- **CLI** (`src/cli.ts`): Interactive terminal interface with readline
- **Bot** (`src/bot.ts`): Feishu WebSocket integration with daemon mode
- **App Initialization** (`src/app.ts`): Unified initialization shared by CLI and Bot

### Tool Execution Flow

Tools are executed through `createDefaultToolExecutor()` in `src/agent/index.ts`:

1. Memory tools (`memory_*`) → `executeMemoryTool()`
2. Skill tools (`skill_*`) → `executeSkillTool()`
3. Goal tools (`goal_*`) → `executeGoalTool()`
4. Proactive tools (`proactive_*`, `notification_*`, `schedule_once`) → `executeProactiveTool()`
5. Persona tools (`persona_*`) → `executePersonaTool()`
6. Builtin tools (web_search, file_*, shell, etc.) → `executeBuiltinTool()`
7. Feishu tools (`feishu_*`) → Feishu WebSocket client

### Context Management

The agent uses token-based context management (`src/agent/context.ts`):
- Default max tokens: 120,000 (configurable per model)
- Compression threshold: 80% of max tokens
- Keeps recent N messages (default: 6) + system prompt
- Hybrid compression: rule-based + AI summarization

### Session Management

Sessions are unified across CLI and Bot (`src/session/`):
- Session ID format: `{channel}-{userId}-{timestamp}`
- Stored in `data/sessions/` as JSONL files
- Shared memory access across channels

## Key Configuration

### beeclaw.json

Main configuration file with:
- `providers`: AI provider settings (API keys via environment variables)
- `feishu`: Feishu bot credentials (App ID and Secret)
- `compression`: Context compression settings
- `mcp`: MCP server configurations

### Environment Variables

```bash
# AI Providers
ZHIPU_API_KEY=your-key
OPENAI_API_KEY=your-key

# Feishu Bot
LARK_BEECLAW_APPID=cli_xxx
LARK_BEECLAW_AS=your-secret

# Search Providers (optional)
TAVILY_API_KEY=your-key
BING_API_KEY=your-key

# Weather (optional)
QWEATHER_TOKEN=your-token
```

## Important Patterns

### Tool Naming Convention

- Memory: `memory_ls`, `memory_grep`, `memory_read`, `memory_write`, `memory_record`
- Skills: `skill_ensure`, `skill_search`, `skill_record`, `skill_maturity`
- Goals: `goal_create`, `goal_list`, `goal_update`, `goal_delete`
- Proactive: `schedule_once`, `notification_push`, `notification_list`, `proactive_schedule`, `proactive_list`
- Builtin: `web_search`, `web_fetch`, `file_read`, `file_write`, `shell`

### Parameter Naming Compatibility

Support both camelCase and snake_case for backward compatibility:

```typescript
// In job handlers
const skillName = job.params?.skillName as string || job.params?.skill_name as string;
const skillParams = job.params?.skillParams as Record<string, unknown>
                  || job.params?.params as Record<string, unknown>
                  || {};
```

This ensures compatibility with:
- Queue handlers (camelCase: `skillName`, `skillParams`)
- Legacy code (snake_case: `skill_name`, `params`)

### Memory Structure

```
data/memory/
├── SOUL.md           # AI personality (rarely changes)
├── USER.md           # User profile information
├── facts/            # Dynamic facts (updated daily/weekly)
│   ├── events.md
│   ├── preferences.md
│   └── lessons.md
├── knowledge/        # Stable knowledge (updated monthly/yearly)
│   ├── career.md
│   └── family.md
└── sessions/         # Session-specific context
```

### Skill Structure

```
skills/
├── skill-name/
│   ├── SKILL.md          # Skill definition (required)
│   ├── scripts/          # Executable scripts (optional)
│   ├── references/       # Reference documentation (optional)
│   └── evals/            # Evaluation tests (optional)
```

### Test Structure

Tests are co-located with source files:
```
src/
├── agent/
│   ├── index.ts
│   └── __tests__/
│       ├── agent.test.ts
│       ├── api.test.ts
│       └── context.test.ts
```

## Development Workflow

### Adding a New Tool

1. Define the tool in the appropriate module:
   - Memory tools: `src/memory/tools.ts`
   - Skill tools: `src/skills/tools.ts`
   - Builtin tools: `src/tools/`
   - Proactive tools: `src/proactive/tools.ts`

2. Register the tool schema in `src/agent/tools.ts`:
   - Add to `getAllToolsForAI()` or specialized getter
   - Define JSON schema for parameters

3. Add execution logic to `createDefaultToolExecutor()` in `src/agent/index.ts`

4. Write tests in `__tests__/` directory

### Adding a New AI Provider

1. Create provider implementation in `src/providers/`
2. Add provider type to `src/config/schema.ts`
3. Update `src/agent/api.ts` to handle the new provider
4. Add tests in `src/providers/__tests__/`

### Running in Production

Use PM2 for process management:
```bash
# Start with daemon mode
bun run pm2:start

# View logs
bun run pm2:logs

# Monitor
bun run pm2:monit

# Stop
bun run pm2:stop

# Restart
bun run pm2:restart
```

PM2 configuration in `ecosystem.config.cjs`:
- Auto-restart on crash
- Daily restart at 4 AM
- Max memory: 500M
- Logs in `./logs/`

## Critical Development Patterns

### Tool Result Verification (MANDATORY)

Every tool call MUST be verified - never assume success:

```typescript
// ❌ WRONG: Assuming success
await proactive_cancel(id, 'schedule');
console.log("已删除");

// ✅ RIGHT: Verify the result
const result = await proactive_cancel(id, 'schedule');
if (!result.success) {
  return `删除失败: ${result.error}`;
}
const verify = await proactive_list();
if (verify.schedules.find(s => s.id === id)) {
  return "验证失败：任务仍然存在";
}
console.log("✅ 已删除并验证");
```

**Verification patterns:**
- `proactive_cancel` → verify with `proactive_list()`
- `proactive_schedule` → verify with `proactive_list()`
- `memory_write` → verify with `memory_read()`
- `skill_ensure` → verify with `skill_search()`
- `goal_create` → verify with `goal_get()`

### Reflection-Action Loop

When AI makes mistakes or receives corrections, immediate action is required:

```typescript
// User: "不对，应该是 Jest 测试"
// AI must:
1. Acknowledge the mistake
2. Record the correction: memory_record({key: "test_framework", value: "Jest"})
3. Log the failure: skill_record({success: false, error: "Wrong framework"})
4. Confirm to user: "已记录，以后都用 Jest"

// NO recording = NO learning
```

### Unified Job Handlers

Task execution uses unified handlers in `src/proactive/job-handlers.ts`:

- **Single source of truth** for both bot mode and CLI mode
- **DRY principle**: Eliminates duplicate code between `src/bot.ts` and `src/proactive/daemon.ts`
- **Consistent behavior**: Same execution logic regardless of mode

When adding new task types:
1. Add handler to `src/proactive/job-handlers.ts`
2. Add case to switch statement in both `src/bot.ts` and `src/proactive/daemon.ts`
3. Test in both bot mode (`bun run bot --daemon`) and CLI mode

### Feishu Rich Text Messaging

Use appropriate method based on content:

```typescript
// Plain text (no formatting)
await client.sendTextMessage(chatId, 'chat_id', 'Simple message');

// Rich text (Markdown supported)
await client.sendPostMessage(chatId, 'chat_id', '**Bold** and *italic*', {
  title: 'Optional Title'
});
```

**Rule**: Use `sendPostMessage` for skill results, proactive messages, and any content with formatting.

## Design Decisions

### Why File-Based Storage?

- Simplicity and transparency for debugging
- AI can directly read/write files
- Git-friendly for version control
- No database dependencies

### Why Not AI-Based Context Compression?

- Speed: No additional API calls
- Cost: No extra token consumption
- Reliability: Rule-based compression is predictable

### Why Subagent System?

- Parallel execution of independent tasks
- Specialized tools for different task types
- Failure isolation (one subagent failure doesn't break the orchestrator)

### Why Unified Job Handlers?

- Maintainability: Single place to update task execution logic
- Testability: Easier to test handlers independently
- Consistency: Same behavior in bot mode and CLI mode
- DRY: Eliminated 223 lines of duplicate code

## System Prompt Patterns

The system prompts in `src/agent/tools.ts` follow these principles:

### Decision Frameworks

Prompts include clear decision trees:

```
When User Shares Information:
  User says anything about themselves
    ↓
  Is it worth remembering?
    ↓
  IF yes → memory_record({key, value, category})
  IF no → just acknowledge
```

### Verification Rules

System prompts enforce verification:

```
CRITICAL: Every tool call MUST be verified
IF tool returns {success: false} → STOP and report error
IF tool returns {success: true} → Verify with list/get
```

### Proactive Capabilities

AI is instructed to proactively reach out:

```
Good timing:
- User mentioned meeting tomorrow → schedule reminder
- User set goal → check progress weekly
- Morning (9 AM) → greeting with agenda

Always ask first:
"需要我在会议前提醒你吗？"
```

### Prompt Versions

- `default`: Full guidance with examples (for production)
- `concise`: Minimal guidance (for fast responses)
- `verbose`: Detailed guidance (for complex tasks)

See `docs/system-prompt-v2-example.md` for optimized prompt structures.

## Key Dependencies

- **Bun**: Runtime and package manager
- **@larksuiteoapi/node-sdk**: Feishu integration
- **bunqueue**: Background job processing
- **zod**: Schema validation
- **yaml**: YAML parsing

## Documentation References

Key documentation files for deeper understanding:

### System Design
- `ARCHITECTURE.md` - Detailed architecture overview
- `README.md` - Project overview and quick start
- `docs/proactive-capabilities-guide.md` - Complete proactive system guide
- `docs/proactive-quick-reference.md` - Quick reference for proactive tools

### Development Guides
- `docs/logging-guide.md` - Comprehensive logging system guide
- `docs/skill-workflow-proposal.md` - Skill system workflow
- `docs/skill-creator-quickref.md` - Quick reference for creating skills
- `docs/memory-system-guide.md` - Memory system usage

### System Prompt Engineering
- `docs/system-prompt-analysis.md` - Analysis of current prompts (10 issues identified)
- `docs/system-prompt-v2-example.md` - Optimized prompt examples
- `docs/system-prompt-lessons.md` - Critical lessons learned from production
- `docs/system-prompt-improvement.md` - Proactive capabilities enhancement

### Examples
- `docs/proactive-chat-examples.md` - 6 real-world proactive chat scenarios
- `examples/logging-demo.ts` - Logging system demonstration

## Common Tasks

### Debug Memory Issues

```bash
# View memory structure
ls -R data/memory/

# Search memory content
grep -r "search term" data/memory/

# Check session files
ls data/sessions/
```

### Test Feishu Integration

```bash
# Start bot in development mode
bun run bot

# Check connection logs
# Look for: "📡 Connecting to Feishu..." and "✓ Connected"
```

### Monitor Daemon Tasks

```bash
# Check daemon status
bun run pm2:status

# View daemon logs
bun run pm2:logs

# Check scheduled tasks
# Look in logs for: "Daemon scheduler started" and task execution messages
```

### Analyze Logs

Beeclaw has comprehensive logging for debugging:

```bash
# View tool execution logs
grep "\[Tool Execution\]" logs/bot-out.log

# View skill usage
grep "🛠️" logs/bot-out.log

# View LLM decisions
grep "\[Agent\] LLM decided" logs/bot-out.log

# View proactive task execution
grep "\[Daemon\]" logs/bot-out.log

# Real-time monitoring
tail -f logs/bot-out.log | grep --color=auto -E "\[Tool|\[Agent\]|🛠️|📤|📥"
```

**Log markers:**
- `[Tool Execution]` - Tool call start/end with timing
- `[Tool Call]` - Individual tool call with parameters
- `[Tool Result]` - Tool execution result
- `[Agent]` - LLM decision logs
- `🛠️` - Skill usage tracking
- `📤` - Message sent to Feishu
- `📥` - Message received from Feishu
- `[Daemon]` - Proactive task execution

See `docs/logging-guide.md` for complete reference.

### Reset Sessions

```bash
# List sessions
ls data/sessions/

# Delete a specific session
rm data/sessions/cli-user-*.jsonl

# Clear all sessions (use with caution)
rm -rf data/sessions/*.jsonl
```
