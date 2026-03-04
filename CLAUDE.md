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
   - Tools: `schedule_once`, `notification_push`

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
- Proactive: `schedule_once`, `notification_push`, `notification_list`
- Builtin: `web_search`, `web_fetch`, `file_read`, `file_write`, `shell`

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

## Key Dependencies

- **Bun**: Runtime and package manager
- **@larksuiteoapi/node-sdk**: Feishu integration
- **bunqueue**: Background job processing
- **zod**: Schema validation
- **yaml**: YAML parsing

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

### Reset Sessions

```bash
# List sessions
ls data/sessions/

# Delete a specific session
rm data/sessions/cli-user-*.jsonl

# Clear all sessions (use with caution)
rm -rf data/sessions/*.jsonl
```
