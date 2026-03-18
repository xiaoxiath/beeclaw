# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Beeclaw is an AI assistant that supports both CLI and Feishu (Lark) bot interfaces. Built with Bun and TypeScript, it features memory persistence, skill management, subagent orchestration, and plugin extensibility.

## Development Commands

### Running the Application
```bash
# CLI mode (interactive chat)
bun run cli

# Feishu bot mode
bun run bot

# Bot mode with daemon (proactive scheduling)
bun run bot --daemon

# Production with PM2
bun run pm2:start
bun run pm2:logs
bun run pm2:restart
```

### Testing and Linting
```bash
# Run all tests
bun test

# Run specific test file
bun test src/agent/__tests__/agent.test.ts

# Run tests with pattern matching
bun test -t "test pattern"

# Lint code
bun lint
```

### Development Setup
```bash
# Install dependencies
bun install

# Configuration (copy example and edit)
cp beeclaw.example.json beeclaw.json

# Set required environment variables
export OPENAI_API_KEY=your-key  # or ZHIPU_API_KEY, etc.
export LARK_BEECLAW_APPID=...   # for Feishu bot
export LARK_BEECLAW_AS=...      # for Feishu bot
```

## Core Architecture

### Unified Initialization (`src/app/`)
The `initApp()` function in `src/app/index.ts` is the single entry point for both CLI and Bot modes. It:
1. Loads configuration from `beeclaw.json`
2. Initializes memory stores and session manager
3. Sets up MCP connections and plugin system
4. Creates the global agent instance
5. Optionally enables session recovery

**Always call `initApp()` before accessing `getAgent()`, `getProvider()`, or other global state.**

### Agent System (`src/agent/`)
The core AI interaction layer:
- `createAgent()` - Creates an agent with provider, model, and tools
- `agent.chat()` - Main conversation loop with tool calling
- Supports multiple providers: OpenAI, Anthropic, Zhipu, MiniMax
- Implements context window management with token estimation and compression
- Tool execution is handled through a unified executor pattern

### Memory System (`src/memory/`)
Persistent storage with intelligent retrieval:
- **Storage**: Filesystem-based JSONL storage in `data/memory/`
- **Categories**: conversations, facts, decisions, skills
- **Compression**: Automatic summarization of old conversations
- **Scoring**: Importance-based ranking (recency, frequency, relevance, uniqueness)
- **Tools**: `memory_ls`, `memory_grep`, `memory_read`, `memory_write`, `memory_record`

Memory is auto-loaded into agent context on initialization when `loadCoreMemory: true`.

### Skills System (`src/skills/`)
Reusable skill modules stored in `skills/` directory:
- Each skill is a markdown file with YAML frontmatter (SOUL.md-style)
- Skills can define tools, prompts, and examples
- Maturity levels: seed, growing, mature, deprecated
- Tools: `skill_list`, `skill_get`, `skill_create`, `skill_update`

### Session Management (`src/session/`)
Conversation persistence and recovery:
- Sessions are stored as JSONL files in `data/sessions/`
- Each session has a unique ID and tracks message history
- Session recovery handles unfinished conversations after restart
- Use `getOrCreateSession()` to get or create sessions by channel/user

### Subagent System (`src/subagent/`)
Parallel task execution with DAG orchestration:
- Subagents run independently with their own context
- Task orchestrator coordinates complex multi-step workflows
- Shared state enables inter-subagent communication
- Used for tasks requiring parallel processing or decomposition

### MCP Integration (`src/mcp/`)
Model Context Protocol for external tool servers:
- Configured in `beeclaw.json` under `mcp.servers`
- Supports stdio transport (e.g., filesystem, github servers)
- Tools are exposed to the agent alongside built-in tools
- Initialize with `initializeMCP()` during app startup

### Plugin System (`src/plugins/`)
OpenClaw-compatible plugin architecture:
- Plugins discovered from bundled, global, and workspace directories
- Each plugin has a manifest (`plugin.json`) defining hooks and tools
- Hook system allows plugins to intercept and modify behavior
- Load plugins with `loadPlugins()` during initialization

### Proactive System (`src/proactive/`)
Daemon mode for scheduled tasks:
- Scheduler manages cron-based task execution
- Daemon checks for due tasks and executes handlers
- Built-in tasks: memory compression, goal progress checks, reminders
- Custom tasks can be scheduled via `scheduler.createSchedule()`

## Configuration Schema

Configuration is validated with Zod schemas in `src/config/schema.ts`:
- `AppConfig` - Root configuration type
- `AIProvider` - Provider settings (name, type, apiKey, models)
- `AgentConfig` - Agent settings (model, systemPrompt, tools)
- `MemoryConfig` - Memory path and retention policies
- `MCPConfig` - MCP server connections
- `PluginsConfig` - Plugin discovery and configuration

Configuration file (`beeclaw.json`) supports environment variable interpolation with `${VAR_NAME}` syntax.

## Important Patterns

### Tool Implementation
All tools follow a consistent pattern:
```typescript
// 1. Define tool schema for AI
export const toolSchema: OpenAITool = {
  type: 'function',
  function: {
    name: 'tool_name',
    description: 'Tool description',
    parameters: { /* JSON schema */ }
  }
};

// 2. Implement executor
export async function executeTool(params: any, context: ToolContext): Promise<ToolResult> {
  // Implementation
}

// 3. Register in getAllToolsForAI()
export function getAllToolsForAI(): OpenAITool[] {
  return [...memoryTools, ...skillTools, ...builtinTools];
}
```

### Context Management
- Token estimation uses character count heuristics (4 chars ≈ 1 token)
- Context compression triggers at configurable threshold (default 80%)
- Compression strategy: "hybrid" (keeps recent + summarized old)
- Use `estimateTotalTokens()` and `compressToolResult()` for large outputs

### Error Handling
- Use custom error classes for different error types
- Tool errors should return structured error results, not throw
- Session recovery handles crashes gracefully
- Always log errors with context using `logger.error()`

### Import Best Practices

**Prefer static imports over dynamic imports** to enable compile-time validation:

✅ **Use static imports by default**:
```typescript
// Good: Compile-time validation, type safety, IDE support
import { getSkillStore } from '../skills/store';
import { reloadConfig } from '../config';
```

❌ **Avoid unnecessary dynamic imports**:
```typescript
// Bad: Runtime errors, no type checking, poor IDE support
const { getSkillStore } = await import('../skills/store');
const { reloadConfig } = await import('../config');
```

**Valid use cases for dynamic imports**:
- Plugin systems (e.g., Jiti loading TypeScript plugins)
- Breaking circular dependencies
- Optional dependencies (e.g., MCP HTTP transport)
- Test isolation (reloading modules in each test)

**Rationale**: Static imports provide:
- Compile-time error detection (missing modules, typos)
- Full TypeScript type checking
- Better IDE support (autocompletion, go-to-definition)
- Bundle optimization (tree-shaking, code splitting)

### Testing Conventions

**Test Organization**:

1. **Unit Tests** → `src/module/__tests__/` (co-located with implementation)
   ```typescript
   src/
   ├── adapter/
   │   └── feishu/
   │       ├── client.ts
   │       └── __tests__/
   │           └── client.test.ts
   └── domain/
       └── agent/
           ├── agent.ts
           └── __tests__/
               └── agent.test.ts
   ```

2. **Integration Tests** → `tests/integration/` (multi-module collaboration)
   ```typescript
   tests/
   └── integration/
       └── p3-integration.test.ts
   ```

3. **E2E Tests** → `tests/e2e/` (full system workflows)
   ```typescript
   tests/
   └── e2e/
       └── feishu-webhook.test.ts
   ```

**Shared Test Utilities** → `src/infra/testing/`:
```typescript
src/infra/testing/
├── mocks/           # Mock implementations (console, fetch, etc.)
│   ├── console.ts
│   └── fetch.ts
└── helpers/         # Test utilities and fixtures
    └── test-utils.ts
```

**Test Naming**:
- Unit tests: `*.test.ts` (e.g., `agent.test.ts`)
- Integration tests: `*.integration.test.ts`
- E2E tests: `*.e2e.test.ts`

**Test Principles**:
- ✅ **Co-location**: Tests live next to the code they test
- ✅ **Independence**: Each test should run independently
- ✅ **Fast**: Unit tests should be fast (< 100ms each)
- ✅ **Descriptive**: Test names should explain the behavior

**Running Tests**:
```bash
# Run all tests
bun test

# Run specific test file
bun test src/domain/agent/__tests__/agent.test.ts

# Run tests with pattern
bun test -t "should handle"

# Run integration tests only
bun test tests/integration
```

### File Organization
```
src/
├── agent/          # AI agent and tool calling
├── app/            # Unified initialization
├── cli/            # CLI interface
├── config/         # Configuration loading and validation
├── evolution/      # Self-evolution and preference learning
├── feishu/         # Feishu bot integration
├── finance/        # Financial data providers
├── goal/           # Goal tracking system
├── hooks/          # Event-driven hooks
├── mcp/            # MCP protocol integration
├── memory/         # Memory storage and retrieval
├── persona/        # Personality and traits
├── plugins/        # Plugin system
├── proactive/      # Daemon and scheduled tasks
├── queue/          # Job queue system
├── search/         # Web search providers
├── services/       # Shared services (gateway, session)
├── session/        # Session management
├── skills/         # Skill system
├── store/          # Base store implementation
├── subagent/       # Subagent orchestration
├── tools/          # Built-in tools
└── utils/          # Utility functions
```

## Key Dependencies

- **Bun** - Runtime and package manager (v1.3.9+)
- **@larksuiteoapi/node-sdk** - Feishu/Lark API client
- **zod** - Schema validation
- **ajv** - JSON schema validation
- **bunqueue** - Job queue for background tasks
- **yaml** - YAML parsing for frontmatter
- **clipboardy** - Clipboard access (CLI mode)

## Feishu Integration

Feishu bot uses WebSocket for real-time messaging:
- Initialize with `initFeishuWSIntegration(config.feishu)`
- Handle messages through event-based routing in `src/routes/`
- Send messages via `client.sendTextMessage(chatId, 'chat_id', message)`
- Bot mode requires `LARK_BEECLAW_APPID` and `LARK_BEECLAW_AS` env vars

### Feishu Card V2 (Streaming Messages)

Beeclaw supports Feishu Card Schema 2.0 for enhanced message experience with streaming updates:

**Features:**
- **Real-time Progress Feedback**: Users see agent reasoning steps as they happen
- **Collapsible Tool Panels**: Tool calls displayed in expandable/collapsible panels
- **Rich Markdown Rendering**: Proper code highlighting, tables, and lists
- **Streaming Updates**: Cards update in real-time as agent processes requests

**Architecture:**

1. **ContentBlock** (`src/types/content-block.ts`)
   - Unified message block types: `ToolUseBlock`, `TextBlock`, `ImageBlock`
   - Agent generates ContentBlocks during execution

2. **Card V2 Types** (`src/feishu/card-v2/types/`)
   - Card Schema 2.0 type definitions
   - Supports `streaming_mode`, `CollapsiblePanel`, `MarkdownElement`

3. **StreamingMessageController** (`src/feishu/card-v2/streaming-controller.ts`)
   - Manages streaming message lifecycle
   - Debounced updates (500ms) to avoid API spam
   - Handles message withdrawal errors gracefully

4. **MessageCardRenderer** (`src/feishu/card-v2/message-renderer.ts`)
   - Renders ContentBlocks to Card JSON
   - Creates collapsible step panels for tool calls
   - Renders final answer as markdown

5. **ToolIconRegistry** (`src/feishu/card-v2/tool-icon-registry.ts`)
   - Maps tool names to Feishu standard icons
   - Generates step descriptions from tool inputs
   - Pre-registered 20+ core Beeclaw tools

**Usage:**

Enable Card V2 in `beeclaw.json`:
```json
{
  "feishu": {
    "enabled": true,
    "appId": "...",
    "appSecret": "...",
    "useCardV2": true
  }
}
```

When enabled, the Session manager automatically:
1. Creates `StreamingMessageController` for Feishu messages
2. Passes `onContentBlock` callback to `Agent.chat()`
3. Agent generates ContentBlocks during execution
4. StreamingController renders and updates cards in real-time
5. Final card shows collapsed tool panels and formatted answer

**Key Methods:**
- `FeishuWSClient.replyCard(messageId, card)` - Send initial card reply
- `FeishuWSClient.patchCard(messageId, card)` - Update existing card (streaming)
- `StreamingMessageController.pushContent(block)` - Push new content block
- `StreamingMessageController.finish()` - Complete streaming and collapse panels

**Testing:**
```bash
# Run Card V2 tests
bun test src/feishu/card-v2/__tests__/
bun test src/types/__tests__/content-block.test.ts
```

## Plugin Development

Plugins follow the OpenClaw plugin API:
1. Create `plugin.json` manifest with metadata and hook declarations
2. Implement hooks as exported functions (e.g., `onToolCall`, `onAgentMessage`)
3. Use the runtime shim for OpenClaw API compatibility
4. Place in `plugins/` directory or configure discovery paths

## Performance Considerations

- Memory compression runs daily at 3 AM (configurable)
- Large tool results are automatically compressed to stay within token limits
- Session recovery is delayed (10s after startup) to avoid blocking initialization
- Plugin loading is non-blocking and failures are logged but don't crash the app
- MCP servers are initialized asynchronously during app startup

## Common Development Tasks

### Adding a New Tool
1. Define tool schema in appropriate module (e.g., `src/memory/tools.ts`)
2. Implement executor function with error handling
3. Add to tool registry in `src/agent/tools.ts`
4. Update `getAllToolsForAI()` to include the tool
5. Add tests in corresponding `__tests__/` directory

### Adding a New AI Provider
1. Add provider type to `AIProviderSchema` in `src/config/schema.ts`
2. Implement API client in `src/agent/api.ts` following the pattern
3. Add provider-specific error handling and retry logic
4. Update documentation with new provider configuration

### Creating a New Skill
1. Create `skills/category-name/SKILL.md`
2. Add YAML frontmatter with metadata (name, description, maturity)
3. Define skill content with prompts and examples
4. Skill will be auto-discovered and available via `skill_get`

### Debugging Session Issues
1. Check session files in `data/sessions/` directory
2. Use `listSessions()` to see all active sessions
3. Check session recovery logs on startup
4. Verify session ID consistency across messages

## Important Patterns

### FastLLMJudge - Unified Engineering Judgment

All "engineering judgment" scenarios should use `FastLLMJudge` instead of manual `callAI()` calls:

**What is FastLLMJudge?**
- Unified judgment engine for deterministic, low-stakes decisions
- Uses fast model from config (`llmRouter.tiers.fast`)
- Low temperature (0.1) for consistency
- Fast timeout (2s) with graceful degradation
- Structured JSON output with validation

**When to Use FastLLMJudge:**
✅ **Engineering Judgment** (low-stakes, deterministic):
- Pattern selection (direct/react/plan-execute/reflective)
- Tool selection (which tools to include)
- Memory injection decisions (should load context?)
- Skill matching (which skills are relevant?)
- Task decomposition (break down into subtasks)
- Knowledge extraction (extract facts from conversation)

❌ **Complex Tasks** (require creativity, nuance):
- Summary generation (compressing conversation history)
- Reflection engine (analyzing patterns, generating insights)
- Research synthesis (combining multiple sources)
- Content generation (writing code, documentation)

**Usage Pattern:**
```typescript
import { getFastLLMJudge } from '../agent/fast-llm-judge';

const judge = getFastLLMJudge(provider, fastModel);

const result = await judge.judge<SelectionResult>({
  taskName: 'pattern-selection',
  promptTemplate: PATTERN_SELECTION_PROMPT,
  promptVariables: { task },
  validateOutput: (output) => {
    // Validate and transform output
    return validated;
  },
  defaultValue: { pattern: 'react', ... }, // Fallback on failure
});

if (result.failed) {
  // Handle failure (result.result contains defaultValue)
}
```

**Why No Caching?**
- Engineering judgment inputs are highly dynamic (user queries, tasks, context)
- Cache hit rate ≈ 0% for these scenarios
- Fast model cost is negligible (~$0.0001/call, ~$3/month for 30K calls)
- Removing cache simplifies code and reduces maintenance burden

**Migration Checklist:**
If you find code using `callAI()` for judgment tasks:
1. Check if it's an engineering judgment (low-stakes, deterministic)
2. Create a prompt template with `{variable}` placeholders
3. Implement `validateOutput()` to validate and transform the result
4. Define a sensible `defaultValue` for graceful degradation
5. Replace `callAI()` with `judge.judge()`
6. Remove manual JSON parsing and error handling (FastLLMJudge handles this)

**Reference:**
- Implementation: `src/domain/agent/fast-llm-judge.ts`
- Examples: `src/domain/agent/patterns/pattern-selector.ts`, `src/domain/agent/hybrid-tool-selector.ts`
- Design doc: `docs/design/unified-llm-judgment.md`

### MemoryStore API Correct Usage

MemoryStore has specific methods for different operations. Using non-existent methods causes runtime errors:

**Correct Methods:**
```typescript
const store = getMemoryStore();

// ✅ Get recent conversations
const conversations = await store.getRecentConversations('default', 50);

// ✅ Record a fact
await store.record('lessons', 'Pattern: Users prefer concise responses');

// ✅ Read/write files
const content = store.read('facts/preferences.md');
await store.write('facts/test.md', 'content', 'overwrite');

// ✅ Get core context (USER.md + SOUL.md + facts/)
const context = store.getCoreContext();
```

**Non-Existent Methods (will throw errors):**
```typescript
// ❌ This method doesn't exist
store.getByCategory('conversations');

// ❌ This method doesn't exist
store.add({ category: 'facts', key: 'test', value: '...' });
```

**Common Pitfall - Daily Reflection:**
```typescript
// ❌ Wrong - getByCategory() doesn't exist
const conversations = store.getByCategory('conversations');

// ✅ Correct - use getRecentConversations()
const conversationEntries = await store.getRecentConversations('default', 50);

// Convert format if needed
const conversations = conversationEntries.map(entry => ({
  timestamp: entry.timestamp,
  userMessage: entry.user,
  assistantMessage: entry.assistant,
  skillTriggered: entry.metadata?.skillTriggered,
}));
```

**When to Use Each Method:**
- `getRecentConversations(userId, limit)` - Get last N conversations
- `record(category, fact)` - Record a new fact to `facts/{category}.md`
- `read(path)` / `write(path, content, mode)` - Direct file operations
- `getCoreContext()` - Get all core memory for AI context
- `ls(path)` / `grep(query, path)` - Browse and search memory

**Reference:**
- Implementation: `src/domain/memory/store.ts`
- Tools: `src/domain/memory/tools.ts`

### Configuration-Driven Model Selection

Always read fast model from configuration instead of hardcoding:

**❌ Bad - Hardcoded model:**
```typescript
const response = await callAI({
  provider,
  model: 'glm-4-flash', // ❌ Hardcoded!
  messages,
  temperature: 0.1,
});
```

**✅ Good - Configuration-driven:**
```typescript
import { getConfig_ } from '../../app';

const config = getConfig_();
const fastModel = config?.llmRouter?.tiers?.fast?.models?.[0];

const response = await callAI({
  provider,
  model: fastModel, // ✅ From config
  messages,
  temperature: 0.1,
});
```

**Or use FastLLMJudge (even better):**
```typescript
import { getFastLLMJudge } from '../agent/fast-llm-judge';

// FastLLMJudge automatically reads fast model from config
const judge = getFastLLMJudge(provider, fastModel);
```

**Why?**
- Different environments may use different models (gpt-4o-mini vs glm-4-flash)
- Cost optimization: switch models without code changes
- Testing: use cheaper models in development
- Configuration is the single source of truth

**Configuration Schema (`beeclaw.json`):**
```json
{
  "llmRouter": {
    "tiers": {
      "fast": {
        "models": ["glm-4-flash"]
      }
    }
  }
}
```
