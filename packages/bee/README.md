# bee

A production-honed AI agent harness, extracted from [beeclaw](https://github.com/xiaoxiath/beeclaw).

**bee** provides the building blocks for robust AI agents: provider abstraction, tool dispatch, context compression, and resilience patterns — all battle-tested in production.

## Why bee?

| | General frameworks | bee |
|---|---|---|
| Context management | Manual or none | Built-in L1/L2/L3 tiered compression + SimHash dedup |
| Token awareness | None | Budget manager, bilingual (CN/EN) token estimation |
| Tool resilience | None | Circuit breaker, retry, loop detection, timeout |
| Parallel tools | All serial or all parallel | Dependency-aware batched parallelism |
| Origin | Top-down design | **Extracted from a production Agent** |

**bee does NOT provide**: workflow engines, UI components, vector databases, multi-agent orchestration, or built-in tools.

## Quick Start

### Install

```bash
bun add bee          # or npm/pnpm add bee
```

### 5-Minute Agent

```typescript
import { Agent, ToolRegistry } from 'bee';
import { z } from 'zod';

// 1. Define tools
const tools = new ToolRegistry();

tools.register({
  name: 'get_weather',
  description: 'Get current weather for a city',
  parameters: z.object({
    city: z.string().describe('City name'),
  }),
  execute: async ({ city }) => {
    const res = await fetch(`https://wttr.in/${city}?format=j1`);
    return res.json();
  },
});

// 2. Create agent
const agent = new Agent({
  provider: {
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o',
  },
  systemPrompt: 'You are a helpful weather assistant.',
  tools: tools.getDefinitions(),
  toolExecutor: tools.createExecutor(),
});

// 3. Chat
const response = await agent.chat('What is the weather in Tokyo?');
console.log(response.content);

// 4. Stream
for await (const event of agent.chatStream('How about Paris?')) {
  if (event.type === 'content') process.stdout.write(event.content);
  if (event.type === 'tool_call') console.log(`[Tool] ${event.name}`);
}
```

---

## API Reference

### Core Types

```typescript
import type {
  ChatMessage,
  ToolCall,
  ToolResult,
  AIResponse,
  OpenAITool,
  ProviderConfig,
} from 'bee';
```

### Agent

```typescript
import { Agent } from 'bee';

const agent = new Agent({
  provider: { type: 'openai', apiKey: '...', model: 'gpt-4o' },
  systemPrompt?: string,
  tools?: OpenAITool[],
  toolExecutor?: (name: string, params: Record<string, unknown>) => Promise<ToolResult>,
  maxTurns?: number,           // default: 10
  maxTokens?: number,          // default: 4096
  contextManager?: {           // optional context compression
    estimator: { estimateTokens: (text: string) => number };
    compressor: { compress: (messages: ChatMessage[], budget: number) => Promise<ChatMessage[]> };
    maxContextTokens?: number;
  },
});

// Sync chat — handles tool-call loop automatically
const response: AgentResponse = await agent.chat('Hello');

// Streaming chat — yields events as they arrive
for await (const event of agent.chatStream('Hello')) {
  // event.type: 'content' | 'tool_call' | 'tool_result' | 'done'
}

// History management
agent.clearHistory();
const history: ChatMessage[] = agent.getHistory();
```

### AIClient

Low-level AI API client with retry and concurrency control.

```typescript
import { AIClient, ConcurrencyLimiter, UnifiedRetryEngine } from 'bee';

const client = new AIClient({
  retryEngine: new UnifiedRetryEngine({ maxRetries: 3 }),
  concurrencyLimiter: new ConcurrencyLimiter({ maxConcurrency: 5 }),
  fetchFn?: customFetch,  // injectable for testing
});

// Call AI
const response: AIResponse = await client.callAI({
  provider: { type: 'openai', apiKey: '...', baseUrl?: '...' },
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
  tools?: [...],
  temperature?: 0.7,
  maxTokens?: 4096,
});

// Stream AI
const stream = client.streamAI({
  /* same options */
});
for await (const chunk of stream) { /* ... */ }
```

### Provider Format Conversion

```typescript
import { convertToAnthropicFormat, convertFromAnthropicFormat } from 'bee';

// Convert OpenAI messages → Anthropic format
const anthropicMessages = convertToAnthropicFormat(openaiMessages);

// Convert Anthropic response → OpenAI format
const openaiResponse = convertFromAnthropicFormat(anthropicResponse);
```

### Concurrency & Routing

```typescript
import { ConcurrencyLimiter, TieredLLMRouter } from 'bee';

// Priority-based concurrency control
const limiter = new ConcurrencyLimiter({ maxConcurrency: 5 });
await limiter.acquire({ priority: 'high' });  // LLMRequestPriority
limiter.release();

// Tiered routing with fallback
const router = new TieredLLMRouter({
  tiers: {
    fast:     { models: ['gpt-4o-mini'], providers: [...] },
    standard: { models: ['gpt-4o'],      providers: [...] },
    advanced: { models: ['o1'],          providers: [...] },
  },
});
const config = router.selectProvider('complex-reasoning'); // → advanced tier
```

### ToolRegistry & ToolDispatcher

```typescript
import { ToolRegistry, ToolDispatcher } from 'bee';
import { z } from 'zod';

const registry = new ToolRegistry();

registry.register({
  name: 'search',
  description: 'Search the web',
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => ({ success: true, data: '...' }),
});

// Get OpenAI function format
const openaiTools = registry.getDefinitions();

// Dispatch tool calls
const dispatcher = new ToolDispatcher({
  executor: registry.createExecutor(),
  blockedTools: ['dangerous_tool'],  // optional blocklist
});

const results = await dispatcher.dispatch([
  { name: 'search', arguments: { query: 'test' } },
]);
```

### Context Compression

Three compression levels, automatically tiered by age:

```typescript
import {
  TieredCompressor,
  L1FormatCompressor,
  L2ExtractiveCompressor,
  L3AbstractiveCompressor,
} from 'bee';

// L1: Regex-based format cleanup (<1ms)
const l1 = new L1FormatCompressor();

// L2: TextRank extractive summarization (~10ms)
const l2 = new L2ExtractiveCompressor();

// L3: LLM abstractive summarization (~1s)
const l3 = new L3AbstractiveCompressor({
  llmClient: { callAI: (opts) => client.callAI(opts) },
  model: 'gpt-4o-mini',
});

// Automatic tiered compression
const compressor = new TieredCompressor(
  l1, l2, l3,
  {
    estimator: { estimateTokens: (text) => text.length / 4 },
    maxContextTokens: 128000,
  },
);

const result = await compressor.compress(messages, budget);
```

### Resilience

```typescript
import {
  UnifiedRetryEngine,
  CircuitBreaker,
  CircuitBreakerRegistry,
  LoopDetector,
  TimeoutEnforcer,
} from 'bee';

// Retry with exponential backoff
const retryEngine = new UnifiedRetryEngine({
  maxRetries: 3,
  baseDelay: 1000,
  strategy: 'exponential',
});

// Circuit breaker
const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 30000 });
await breaker.execute(() => fetch('/api'));

// Tool loop detection
const loopDetector = new LoopDetector({ maxRepetitions: 3 });
const result = loopDetector.check(toolCallRecord);
if (result.detected) { /* break the loop */ }

// Timeout enforcement
const enforcer = new TimeoutEnforcer({ defaultTimeoutMs: 30000 });
await enforcer.execute(toolName, asyncFn, params);
```

### Token Estimation & Budget

```typescript
import { estimateTokens, estimateMessageTokens, TokenBudgetManager } from 'bee';

// Estimate tokens (optimized for Chinese + English)
const tokens = estimateTokens('你好世界 Hello World');

// Message-level estimation
const msgTokens = estimateMessageTokens({ role: 'user', content: 'Hello' });

// Budget manager
const budget = new TokenBudgetManager({
  maxContextTokens: 128000,
  reservedForResponse: 4096,
});
budget.reset(systemMessages, tools);
const remaining = budget.getRemaining();
budget.addMessage(userMessage);
```

### Interfaces (implement yourself)

```typescript
// Memory store
import type { IMemoryStore } from 'bee';

// MCP client manager
import type { IMCPManager } from 'bee';

// Hook runner (lifecycle events)
import { NoOpHookRunner } from 'bee';
import type { IHookRunner } from 'bee';
```

---

## Architecture

```
bee/
  core/        — Types, Logger interface
  agent/       — Agent orchestrator (chat loop, streaming)
  provider/    — AIClient, concurrency, routing, format conversion
  tool/        — Registry + dispatcher
  context/     — Token estimation, budget, compression (L1/L2/L3)
  resilience/  — Retry, circuit breaker, loop detection, timeout
  hooks/       — Lifecycle hook interface
  memory/      — Memory store interface (no implementation)
  mcp/         — MCP client interface (no implementation)
```

## License

MIT
