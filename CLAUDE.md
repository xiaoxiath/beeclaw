# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Beeclaw is an AI assistant that supports both CLI and Feishu (Lark) bot interfaces. Built with Bun and TypeScript, it features memory persistence, skill management, subagent orchestration, and plugin extensibility.

## Development Commands

### Running the Application
```bash
bun run cli              # CLI mode (interactive chat)
bun run bot              # Feishu bot mode
bun run bot --daemon     # Bot with proactive scheduling
bun run pm2:start        # Production with PM2
bun run test              # Run all tests (vitest)
bun lint                 # Lint code
```

### Development Setup
```bash
bun install

# Option A: Configuration file
cp beeclaw.example.json beeclaw.json
# Edit beeclaw.json to fill in API keys

# Option B: Environment variables
cp .env.example .env && echo 'ZHIPU_API_KEY=your_key' >> .env

# For Feishu bot mode
export LARK_BEECLAW_APPID=...
export LARK_BEECLAW_AS=...
```

## Core Architecture

### Unified Initialization (`src/app/`)
The `initApp()` function is the single entry point for both CLI and Bot modes:
1. Loads configuration from `beeclaw.json`
2. Initializes memory stores and session manager
3. Sets up MCP connections and plugin system
4. Creates the global agent instance

**Always call `initApp()` before accessing `getAgent()`, `getProvider()`, or other global state.**

### Agent System (`src/domain/agent/`)
- `createAgent()` - Creates an agent with provider, model, and tools
- `agent.chat()` - Main conversation loop with tool calling
- Supports: OpenAI, Anthropic, Zhipu, MiniMax
- Context management with token estimation and compression

### Memory System (`src/domain/memory/`)
- **Storage**: Filesystem-based JSONL in `data/memory/`
- **Categories**: conversations, facts, decisions, skills
- **Tools**: `memory_ls`, `memory_grep`, `memory_read`, `memory_write`, `memory_record`

### Skills System (`src/domain/skills/`)
- Markdown files with YAML frontmatter in `skills/` directory
- Maturity levels: seed, growing, mature, deprecated
- Tools: `skill_list`, `skill_get`, `skill_ensure`

### Session Management (`src/domain/session/`)
- Sessions stored as JSONL in `data/sessions/`
- Use `getOrCreateSession()` to get or create sessions

### Subagent System (`src/domain/subagent/`)
- Parallel task execution with DAG orchestration
- Independent context for each subagent
- Shared state for inter-subagent communication

### MCP Integration (`src/adapter/mcp/`)
- Configured in `beeclaw.json` under `mcp.servers`
- Supports stdio transport
- Tools exposed alongside built-in tools

### Plugin System (`src/adapter/plugins/`)
- OpenClaw-compatible plugin architecture
- Hook system for behavior interception
- Load with `loadPlugins()` during initialization

## File Organization
```
src/
├── app/              # Unified initialization & lifecycle
│   ├── dispatcher/   # Event dispatching
│   ├── queue-handlers/ # Background task workers
│   └── routes/       # HTTP API routes
├── domain/           # Core domain logic
│   ├── agent/        # AI agent, tool calling, prompts
│   │   ├── compression/  # Context compression
│   │   ├── context/      # Context window management
│   │   ├── evolution/    # Self-evolution engine
│   │   ├── goal/         # Goal tracking
│   │   ├── persona/      # Persona/traits system
│   │   └── prompts/      # Prompt layer templates
│   ├── extraction/   # Content extraction
│   ├── memory/       # Memory storage, search, scoring
│   ├── proactive/    # Scheduled tasks & notifications
│   ├── sandbox/      # Sandbox execution (process/container)
│   ├── search/       # Multi-provider search & deep research
│   ├── skills/       # Skill system with evolution
│   ├── session/      # Session management & recovery
│   ├── subagent/     # Subagent orchestration & state
│   └── tools/        # Tool registry & built-in tools
│       └── categories/   # search, shell, finance, sandbox, subagent, utility
├── adapter/          # External adapters
│   ├── cli/          # CLI interface
│   ├── feishu/       # Feishu bot integration (Card V2)
│   ├── mcp/          # MCP protocol integration
│   ├── plugins/      # Plugin system (hooks, loader, registry)
│   └── web/          # Web UI (React client + Hono server)
├── infra/            # Infrastructure
│   ├── ai/           # AI provider abstractions
│   ├── cache/        # Caching layer
│   ├── config/       # Configuration (Zod schema)
│   ├── db/           # Database layer (SQLite + Drizzle ORM)
│   ├── entry/        # Entry point registry
│   ├── observability/ # Logging & monitoring
│   ├── queue/        # Job queue
│   ├── resilience/   # Circuit breaker & retry
│   ├── testing/      # Test helpers & mocks
│   └── utils/        # Utility functions
├── entries/          # Entry points (cli.ts, bot.ts, web.ts)
└── types/            # Shared TypeScript type definitions
```

## Important Patterns

### FastLLMJudge - Unified Engineering Judgment

All "engineering judgment" scenarios should use `FastLLMJudge`:

**When to Use**:
- Pattern selection (direct/react/plan-execute)
- Tool selection
- Memory injection decisions
- Skill matching
- Task decomposition

**Usage**:
```typescript
import { getFastLLMJudge } from '../agent/fast-llm-judge';

const judge = getFastLLMJudge(provider, fastModel);
const result = await judge.judge<SelectionResult>({
  taskName: 'pattern-selection',
  promptTemplate: PATTERN_SELECTION_PROMPT,
  promptVariables: { task },
  validateOutput: (output) => { /* validate */ },
  defaultValue: { pattern: 'react' },
});
```

### Configuration-Driven Model Selection

Always read fast model from configuration:

```typescript
import { getConfig_ } from '../../app';

const config = getConfig_();
const fastModel = config?.llmRouter?.tiers?.fast?.models?.[0];
```

### MemoryStore API Usage

```typescript
const store = getMemoryStore();

// Get recent conversations
const conversations = await store.getRecentConversations('default', 50);

// Record a fact
await store.record('lessons', 'Pattern: Users prefer concise responses');

// Read/write files
const content = store.read('facts/preferences.md');
await store.write('facts/test.md', 'content', 'overwrite');
```

### Testing Conventions

**Test Organization**:
- Unit Tests → `src/module/__tests__/` (co-located)
- Integration Tests → `tests/integration/`
- E2E Tests → `tests/e2e/`

**Running Tests**:
```bash
bun run test                                    # All tests
bun run test src/domain/agent/__tests__/        # Specific file
bun run test -t "should handle"                 # Pattern matching
```

### Import Best Practices

**Prefer static imports**:
```typescript
// ✅ Good: Compile-time validation
import { getSkillStore } from '../skills/store';

// ❌ Avoid: Runtime errors, no type checking
const { getSkillStore } = await import('../skills/store');
```

**Valid use cases for dynamic imports**:
- Plugin systems
- Breaking circular dependencies
- Optional dependencies

## Feishu Integration

### Card V2 (Streaming Messages)

Enable in `beeclaw.json`:
```json
{
  "feishu": {
    "enabled": true,
    "useCardV2": true
  }
}
```

**Key Components**:
- `StreamingMessageController` - Manages streaming lifecycle
- `MessageCardRenderer` - Renders ContentBlocks to Card JSON
- `ToolIconRegistry` - Maps tool names to icons

## Configuration Schema

Configuration validated with Zod in `src/infra/config/schema.ts`:
- `AppConfig` - Root configuration
- `AIProvider` - Provider settings
- `AgentConfig` - Agent settings
- `MemoryConfig` - Memory settings

Supports environment variable interpolation: `${VAR_NAME}` and `${VAR:-default}`

## Performance Considerations

- Memory compression runs daily at 3 AM
- Large tool results auto-compressed
- Session recovery delayed 10s after startup
- Plugin loading is non-blocking
- MCP servers initialized asynchronously

## Common Development Tasks

### Adding a New Tool
1. Implement tool in `src/domain/tools/` (e.g., new file or existing category module)
2. Define Zod schema and OpenAI function definition
3. Register in `src/domain/tools/builtin.ts`:
   - Always-loaded → add to `coreBuiltinTools`
   - Conditional → add to `conditionalDeepResearchTools` or `conditionalSubagentStateTools`
4. For category access, add re-export in `src/domain/tools/categories/`
5. `getBuiltinToolsForAI()` auto-collects from registries — no manual update needed
6. Add tests in `__tests__/`

### Adding a New AI Provider
1. Add provider type to `AIProviderSchema` in `src/infra/config/schema.ts`
2. Implement API client in `src/domain/agent/api.ts`
3. Add provider-specific error handling
4. Update documentation

### Creating a New Skill
1. Create `skills/category-name/SKILL.md`
2. Add YAML frontmatter (name, description, maturity)
3. Skill auto-discovered via `skill_get`

## Error Handling

- Use custom error classes
- Tool errors return structured results, don't throw
- Session recovery handles crashes
- Always log errors with context: `logger.error()`

## Key Dependencies

- **Bun** v1.3.9+ - Runtime and package manager
- **@larksuiteoapi/node-sdk** - Feishu/Lark API client
- **zod** - Schema validation
- **ajv** - JSON schema validation
- **bunqueue** - Job queue

## Debugging

- Check session files in `data/sessions/`
- Use `listSessions()` to see active sessions
- Verify session ID consistency
- Check logs with `logger.error()`

## Documentation

- [docs/getting-started.md](docs/getting-started.md) - Quick start guide
- [docs/configuration.md](docs/configuration.md) - Configuration reference
- [docs/architecture.md](docs/architecture.md) - System architecture
