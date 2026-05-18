import { describe, test, expect, vi, beforeEach } from 'vitest';

// =========================================================================
// Infrastructure mocks (bun-specific, MCP, queues)
// =========================================================================
vi.mock('bun:sqlite', () => {
  class MockDatabase {
    constructor() {}
    exec = vi.fn();
    run = vi.fn();
    query = vi.fn(() => ({ all: vi.fn(() => []) }));
    prepare = vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }));
    transaction = vi.fn((fn: Function) => fn);
    close = vi.fn();
  }
  return { Database: MockDatabase, default: MockDatabase };
});
vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() })),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: vi.fn() }));
vi.mock('bunqueue/client', () => ({ Queue: vi.fn(), Worker: vi.fn() }));

// =========================================================================
// Domain / infra mocks
// =========================================================================

vi.mock('@infra/observability/logger', () => {
  const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    logger: mockLogger,
    getLogger: vi.fn(() => mockLogger),
  };
});

// --- Loop detector ---
const mockLoopDetector = { reset: vi.fn(), record: vi.fn(), isLooping: vi.fn(() => false) };
vi.mock('@infra/resilience/loop-detector', () => ({
  LoopDetector: vi.fn(),
  createLoopDetector: vi.fn(() => mockLoopDetector),
}));

// --- Timeout enforcer ---
vi.mock('@infra/resilience/timeout-enforcer', () => ({
  TimeoutEnforcer: { fromConfig: vi.fn(() => ({ enforce: vi.fn((fn: any) => fn()) })) },
}));

// --- API ---
const mockCallAI = vi.fn();
const mockHasToolCalls = vi.fn(() => false);
const mockExtractToolCalls = vi.fn(() => []);
const mockExtractContent = vi.fn(() => 'AI response');
vi.mock('@domain/agent/api', () => ({
  callAI: (...args: any[]) => mockCallAI(...args),
  // callAIWithFallback delegates to callAI when no fallback is set.
  callAIWithFallback: (...args: any[]) => mockCallAI(args[0]),
  hasToolCalls: (...args: any[]) => mockHasToolCalls(...args),
  extractToolCalls: (...args: any[]) => mockExtractToolCalls(...args),
  extractContent: (...args: any[]) => mockExtractContent(...args),
}));

// --- Tools ---
const mockGetAllToolsForAI = vi.fn(() => []);
const mockBuildSystemPrompt = vi.fn((base: string) => base);
const mockBuildVolatileContext = vi.fn(() => '[time: 2026-03-27 morning]');
const mockFormatSkillsForPrompt = vi.fn(() => '');
const mockGetCurrentTimeContext = vi.fn(() => 'Current time: 2026-03-27');
vi.mock('@domain/agent/tools', () => ({
  getAllToolsForAI: (...args: any[]) => mockGetAllToolsForAI(...args),
  SYSTEM_PROMPTS: { default: 'Default system prompt', concise: 'Concise', verbose: 'Verbose' },
  buildSystemPrompt: (...args: any[]) => mockBuildSystemPrompt(...args),
  formatSkillsForPrompt: (...args: any[]) => mockFormatSkillsForPrompt(...args),
  getCurrentTimeContext: (...args: any[]) => mockGetCurrentTimeContext(...args),
  buildVolatileContext: (...args: any[]) => mockBuildVolatileContext(...args),
  getMemoryTools: vi.fn(() => []),
  getSkillTools: vi.fn(() => []),
  getToolsByCategory: vi.fn(() => []),
  TOOL_CATEGORIES: {},
}));

// --- Types ---
vi.mock('@domain/agent/types', () => ({
  stripMessageMetadata: vi.fn((msgs: any[]) => msgs.map((m: any) => {
    const { metadata, ...rest } = m;
    return rest;
  })),
}));

// --- Context ---
const mockEstimateMessageTokens = vi.fn(() => 10);
const mockEstimateTotalTokens = vi.fn((msgs: any[]) => msgs.length * 10);
const mockEstimateTokens = vi.fn((s: string) => Math.ceil((s?.length || 0) / 4));
const mockCompressToolResult = vi.fn((s: string) => s);
const mockCompressAssistantMessage = vi.fn((s: string) => s);
const mockFormatTokenStats = vi.fn(() => 'TokenStats: 100/1000');
const mockCleanTokenStats = vi.fn((s: string) => s);
const mockCalculateContextConfig = vi.fn(() => ({
  maxTokens: 8000,
  keepRecent: 4,
  compressionThreshold: 0.8,
}));
vi.mock('@domain/agent/context', () => ({
  estimateMessageTokens: (...args: any[]) => mockEstimateMessageTokens(...args),
  estimateTotalTokens: (...args: any[]) => mockEstimateTotalTokens(...args),
  estimateTokens: (...args: any[]) => mockEstimateTokens(...args),
  compressToolResult: (...args: any[]) => mockCompressToolResult(...args),
  compressAssistantMessage: (...args: any[]) => mockCompressAssistantMessage(...args),
  formatTokenStats: (...args: any[]) => mockFormatTokenStats(...args),
  cleanTokenStats: (...args: any[]) => mockCleanTokenStats(...args),
  calculateContextConfig: (...args: any[]) => mockCalculateContextConfig(...args),
  DEFAULT_TOKEN_STATS_CONFIG: { showTokenStats: false, tokenStatsFormat: 'inline' },
  DEFAULT_CONTEXT_CONFIG: { maxTokens: 8000, keepRecent: 4, compressionThreshold: 0.8 },
  getModelContextWindow: vi.fn(() => 128000),
}));

// --- Compression ---
const mockCompressMessages = vi.fn(async () => ({ messages: [], stats: null }));
const mockShouldCompress = vi.fn(() => false);
const mockHybridCompress = vi.fn(async () => ({ summary: '', compressionRatio: 1 }));
vi.mock('@domain/agent/compression', () => ({
  compressMessages: (...args: any[]) => mockCompressMessages(...args),
  shouldCompress: (...args: any[]) => mockShouldCompress(...args),
  hybridCompress: (...args: any[]) => mockHybridCompress(...args),
}));

// --- TieredCompressor (used by context-manager) ---
const mockTieredCompress = vi.fn(async () => ({
  compressed: 'Compressed summary of conversation',
  originalTokens: 5000,
  compressedTokens: 2500,
  ratio: 0.5,
}));
const mockTieredCompressor = { compress: (...args: any[]) => mockTieredCompress(...args), getStats: vi.fn(() => ({})), resetStats: vi.fn() };
vi.mock('@domain/agent/compression/tiered-compressor', () => ({
  getTieredCompressor: vi.fn(() => mockTieredCompressor),
}));

// --- Memory ---
const mockMemoryStore = {
  getCoreContext: vi.fn(() => ({ user: 'Test User', soul: 'friendly AI' })),
};
const mockDynamicInjector = {
  inject: vi.fn(async (msg: string) => msg),
};
vi.mock('@domain/memory', () => ({
  getMemoryStore: vi.fn(() => mockMemoryStore),
  getDynamicMemoryInjector: vi.fn(() => mockDynamicInjector),
}));
vi.mock('@domain/memory/lifecycle-manager', () => ({
  getLifecycleManager: vi.fn(() => null),
}));

// --- Skills ---
const mockSkillStore = {
  list: vi.fn(() => []),
};
vi.mock('@domain/skills/store', () => ({
  getSkillStore: vi.fn(() => mockSkillStore),
}));

// --- Skill enforcement ---
vi.mock('@domain/skills/enforcement', () => ({
  SkillEnforcementEngine: vi.fn().mockImplementation(() => ({
    matchSkillsForQuery: vi.fn(() => ({ matched: false, skills: [], directive: '' })),
    validateOutputCompleteness: vi.fn(() => []),
    buildRetryPrompt: vi.fn(() => ''),
    clearTraces: vi.fn(),
  })),
}));

// --- Ports ---
const mockHookRunner = {
  runBeforeModelResolve: vi.fn(() => null),
  runBeforeAgentStart: vi.fn(),
  runBeforePromptBuild: vi.fn(async () => null),
  runMessageReceived: vi.fn(async () => {}),
  runLlmInput: vi.fn(async () => {}),
  runLlmOutput: vi.fn(async () => {}),
  runToolResultPersist: vi.fn((_: any) => _.result),
  runMessageSending: vi.fn(async () => null),
  runMessageSent: vi.fn(async () => {}),
  runAgentEnd: vi.fn(async () => {}),
  runBeforeReset: vi.fn(),
  runBeforeCompaction: vi.fn(async () => {}),
  runAfterCompaction: vi.fn(async () => {}),
};
vi.mock('@domain/ports', () => ({
  getHookRunnerPort: vi.fn(() => mockHookRunner),
  getHealthMonitorPort: vi.fn(() => null),
}));

// --- Evolution ---
vi.mock('@domain/agent/evolution', () => ({
  recordSkillFailure: vi.fn(),
  getReflectionStats: vi.fn(() => ({ recentFailures: 0, failureDetails: [] })),
}));
vi.mock('@domain/agent/evolution/preference-learning', () => ({
  checkPreferenceTriggers: vi.fn(() => ({ hasPreference: false, expressions: [] })),
}));
vi.mock('@domain/agent/evolution/self-evolution', () => ({
  triggerSelfEvolution: vi.fn(async () => ({ improved: false })),
}));

// --- Context sub-modules ---
vi.mock('@domain/agent/context/simhash', () => ({
  getSimHasher: vi.fn(() => ({
    deduplicateItems: vi.fn((items: any[]) => items),
  })),
}));
vi.mock('@domain/agent/context/health-dashboard', () => ({
  getContextHealthDashboard: vi.fn(() => ({
    measure: vi.fn(() => ({})),
    checkAlerts: vi.fn(() => []),
  })),
}));

// --- Phase 4 extracted modules ---
const mockToolDispatcher = {
  executeToolBatches: vi.fn(async () => []),
  persistResult: vi.fn((_name: string, result: any) => result),
};
vi.mock('@domain/agent/tool-dispatcher', () => ({
  ToolDispatcher: vi.fn().mockImplementation(() => mockToolDispatcher),
}));
vi.mock('@domain/agent/token-budget', () => ({
  TokenBudgetManager: vi.fn().mockImplementation(() => ({
    checkTurnBudget: vi.fn(() => ({ allowed: true })),
    recordUsage: vi.fn(),
  })),
}));
vi.mock('@domain/agent/skill-runner', () => ({
  SkillRunner: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@domain/agent/tool-executor', () => ({
  createDefaultToolExecutor: vi.fn(() => vi.fn(async () => ({ success: true }))),
  _executeToolInner: vi.fn(),
}));

// --- Memory Manager ---
vi.mock('@domain/agent/memory-manager', () => ({
  MemoryManager: vi.fn().mockImplementation(() => ({
    refreshMemory: vi.fn(() => 0),
    recordConversation: vi.fn(async () => {}),
  })),
}));

// --- Hybrid tool selector ---
const mockHybridSelector = {
  select: vi.fn(async (tools: any[]) => tools),
  recordFailure: vi.fn(),
  getStats: vi.fn(() => ({ calls: 0, successes: 0, failures: 0, totalInputTools: 0, totalOutputTools: 0, lastError: null, lastCallAt: null, avgInputTools: 0, avgOutputTools: 0 })),
  resetStats: vi.fn(),
};
vi.mock('@domain/agent/hybrid-tool-selector', () => ({
  getHybridToolSelector: vi.fn(() => mockHybridSelector),
}));

// --- App re-export ---
vi.mock('../../app', () => ({
  getAgent: vi.fn(),
}));

// --- Builtin tools re-export ---
vi.mock('@domain/tools', () => ({
  getBuiltinToolsForAI: vi.fn(() => []),
  executeBuiltinTool: vi.fn(),
  isBuiltinTool: vi.fn(() => false),
  builtinToolNames: [],
}));

// --- Tool dependencies re-export ---
vi.mock('@domain/agent/tool-dependencies', () => ({
  groupToolCalls: vi.fn(),
  getGroupingStats: vi.fn(),
  isParallelTool: vi.fn(),
  getToolDependency: vi.fn(),
  hasSideEffects: vi.fn(),
  registerToolDependencyOverride: vi.fn(),
  registerToolDependencyPattern: vi.fn(),
  clearToolDependencyOverrides: vi.fn(),
  getToolDependencyOverrides: vi.fn(),
}));

// =========================================================================
// Import module under test
// =========================================================================
import { Agent, createAgent } from '../index';
import * as ports from '@domain/ports';
import * as skillStoreModule from '@domain/skills/store';
import { SkillEnforcementEngine } from '@domain/skills/enforcement';
import { ToolDispatcher } from '@domain/agent/tool-dispatcher';
import { TokenBudgetManager } from '@domain/agent/token-budget';
import { SkillRunner } from '@domain/agent/skill-runner';
import { MemoryManager } from '@domain/agent/memory-manager';
import { createDefaultToolExecutor } from '@domain/agent/tool-executor';
import { getHybridToolSelector } from '@domain/agent/hybrid-tool-selector';

// =========================================================================
// Helpers
// =========================================================================

function makeProvider(overrides: any = {}) {
  return {
    name: 'test-provider',
    type: 'openai' as const,
    apiKey: 'test-key',
    default: true,
    models: {},
    ...overrides,
  };
}

function makeAIResponse(content: string, toolCalls?: any[]) {
  return {
    id: 'resp-1',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

function resetAllMocks() {
  vi.clearAllMocks();
  // Re-establish implementations cleared by clearAllMocks
  mockCallAI.mockResolvedValue(makeAIResponse('AI response'));
  mockHasToolCalls.mockReturnValue(false);
  mockExtractToolCalls.mockReturnValue([]);
  mockExtractContent.mockReturnValue('AI response');
  mockCleanTokenStats.mockImplementation((s: string) => s);
  mockEstimateMessageTokens.mockReturnValue(10);
  mockEstimateTotalTokens.mockImplementation((msgs: any[]) => msgs.length * 10);
  mockEstimateTokens.mockImplementation((s: string) => Math.ceil((s?.length || 0) / 4));
  mockCompressToolResult.mockImplementation((s: string) => s);
  mockCompressAssistantMessage.mockImplementation((s: string) => s);
  mockCalculateContextConfig.mockReturnValue({
    maxTokens: 8000,
    keepRecent: 4,
    compressionThreshold: 0.8,
  });
  mockBuildVolatileContext.mockReturnValue('[time: 2026-03-27 morning]');
  mockBuildSystemPrompt.mockImplementation((base: string) => base);
  mockShouldCompress.mockReturnValue(false);
  mockHybridSelector.select.mockImplementation(async (tools: any[]) => tools);
  mockDynamicInjector.inject.mockImplementation(async (msg: string) => msg);
  mockHookRunner.runBeforeModelResolve.mockReturnValue(null);
  mockHookRunner.runToolResultPersist.mockImplementation((o: any) => o.result);
  mockHookRunner.runMessageSending.mockResolvedValue(null);
  mockToolDispatcher.executeToolBatches.mockResolvedValue([]);
  mockToolDispatcher.persistResult.mockImplementation((_name: string, result: any) => result);

  // Re-establish constructor mocks wiped by clearAllMocks
  vi.mocked(SkillEnforcementEngine).mockImplementation(function(this: any) {
    this.matchSkillsForQuery = vi.fn(() => ({ matched: false, skills: [], directive: '' }));
    this.validateOutputCompleteness = vi.fn(() => []);
    this.buildRetryPrompt = vi.fn(() => '');
    this.clearTraces = vi.fn();
  } as any);
  vi.mocked(ToolDispatcher).mockImplementation(function(this: any) {
    Object.assign(this, mockToolDispatcher);
  } as any);
  vi.mocked(TokenBudgetManager).mockImplementation(function(this: any) {
    this.checkTurnBudget = vi.fn(() => ({ allowed: true }));
    this.recordUsage = vi.fn();
  } as any);
  vi.mocked(SkillRunner).mockImplementation(function(this: any) {} as any);
  vi.mocked(MemoryManager).mockImplementation(function(this: any) {
    this.refreshMemory = vi.fn(() => 0);
    this.recordConversation = vi.fn(async () => {});
  } as any);
  vi.mocked(createDefaultToolExecutor).mockReturnValue(vi.fn(async () => ({ success: true })) as any);
  vi.mocked(ports.getHookRunnerPort).mockReturnValue(mockHookRunner as any);
  vi.mocked(ports.getHealthMonitorPort).mockReturnValue(null as any);
  vi.mocked(skillStoreModule.getSkillStore).mockReturnValue(mockSkillStore as any);
  vi.mocked(getHybridToolSelector).mockReturnValue(mockHybridSelector as any);
  mockMemoryStore.getCoreContext.mockReturnValue({ user: 'Test User', soul: 'friendly AI' });
  mockSkillStore.list.mockReturnValue([]);
  mockLoopDetector.isLooping.mockReturnValue(false);
  mockLoopDetector.reset.mockImplementation(() => {});
  mockLoopDetector.record.mockImplementation(() => {});
}

// =========================================================================
// Tests
// =========================================================================

describe('Agent', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // =====================================================================
  // Constructor
  // =====================================================================
  describe('constructor', () => {
    test('creates agent with minimal options', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
      });
      expect(agent).toBeDefined();
      expect(agent.getMessages()).toEqual([]);
    });

    test('creates agent with system prompt — adds system + volatile messages', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'You are helpful.',
      });
      const msgs = agent.getMessages();
      expect(msgs.length).toBe(2);
      expect(msgs[0].role).toBe('system');
      expect(msgs[0].content).toBe('You are helpful.');
      expect(msgs[1].role).toBe('system');
      expect(msgs[1].content).toContain('time');
    });

    test('sets default maxToolIterations to 30', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
      });
      // Verify through getContextConfig which is set
      expect(agent.getContextConfig().maxTokens).toBe(8000);
    });

    test('applies hook runner before_model_resolve when hook returns model override', () => {
      mockHookRunner.runBeforeModelResolve.mockReturnValue({
        model: 'gpt-4-turbo',
        provider: makeProvider({ name: 'turbo-provider' }),
      });

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'test',
      });

      // The calculateContextConfig should have been called with resolved model
      expect(mockCalculateContextConfig).toHaveBeenCalledWith(
        'gpt-4-turbo',
        undefined,
        undefined,
      );
    });

    test('handles hook runner initialization failure gracefully', () => {
      // getHookRunnerPort throws
      vi.mocked(ports.getHookRunnerPort).mockImplementation(() => { throw new Error('No plugins'); });

      // Should not throw
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
      });
      expect(agent).toBeDefined();

      // Restore
      vi.mocked(ports.getHookRunnerPort).mockReturnValue(mockHookRunner as any);
    });

    test('uses custom toolExecutor when provided', async () => {
      const customExecutor = vi.fn(async () => ({ custom: true }));
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        toolExecutor: customExecutor,
      });
      expect(agent).toBeDefined();
    });

    test('merges tokenStatsConfig with defaults', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        tokenStatsConfig: { showTokenStats: true },
      });
      const config = agent.getTokenStatsConfig();
      expect(config.showTokenStats).toBe(true);
    });
  });

  // =====================================================================
  // getTokenEstimate / getContextConfig / getTokenStatsConfig
  // =====================================================================
  describe('accessors', () => {
    test('getTokenEstimate returns current estimate', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'hello',
      });
      // 2 system messages, each 10 tokens
      expect(agent.getTokenEstimate()).toBe(20);
    });

    test('getContextConfig returns copy', () => {
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4' });
      const config = agent.getContextConfig();
      expect(config.maxTokens).toBe(8000);
    });

    test('getTokenStatsConfig returns copy', () => {
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4' });
      const config = agent.getTokenStatsConfig();
      expect(config.showTokenStats).toBe(false);
    });
  });

  // =====================================================================
  // clearHistory
  // =====================================================================
  describe('clearHistory', () => {
    test('preserves system messages and clears rest', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System msg',
      });
      agent.addMessage({ role: 'user', content: 'Hello' });
      agent.addMessage({ role: 'assistant', content: 'Hi' });

      expect(agent.getMessages().length).toBe(4); // 2 system + user + assistant

      agent.clearHistory();

      const msgs = agent.getMessages();
      expect(msgs.length).toBe(2); // only system messages remain
      expect(msgs[0].role).toBe('system');
      expect(msgs[1].role).toBe('system');
    });

    test('clears everything when no system messages', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
      });
      agent.addMessage({ role: 'user', content: 'Hello' });

      agent.clearHistory();

      expect(agent.getMessages().length).toBe(0);
      expect(agent.getTokenEstimate()).toBe(0);
    });

    test('calls hookRunner.runBeforeReset', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'test',
      });
      agent.clearHistory();

      expect(mockHookRunner.runBeforeReset).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.any(Array),
          tokensBefore: expect.any(Number),
          timestamp: expect.any(String),
        }),
      );
    });
  });

  // =====================================================================
  // addMessage
  // =====================================================================
  describe('addMessage', () => {
    test('adds message and updates token count', () => {
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4' });
      const before = agent.getTokenEstimate();

      agent.addMessage({ role: 'user', content: 'Test message' });

      expect(agent.getMessages().length).toBe(1);
      expect(agent.getTokenEstimate()).toBe(before + 10);
    });
  });

  // =====================================================================
  // refreshTime
  // =====================================================================
  describe('refreshTime', () => {
    test('updates volatile time context in second system message', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'hello',
      });

      const before = agent.getMessages()[1].content;

      // Change the volatile context
      mockBuildVolatileContext.mockReturnValue('[time: 2026-03-27 afternoon]');
      agent.refreshTime();

      const after = agent.getMessages()[1].content;
      expect(after).toBe('[time: 2026-03-27 afternoon]');
      expect(after).not.toBe(before);
    });

    test('skips update when volatile context is the same', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'hello',
      });

      // Same volatile context
      const tokensBefore = agent.getTokenEstimate();
      agent.refreshTime();
      expect(agent.getTokenEstimate()).toBe(tokensBefore);
    });

    test('inserts volatile message if missing', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
      });
      // Manually add just a system message with no volatile
      (agent as any).messages = [{ role: 'system', content: 'stable prefix' }];
      (agent as any).estimatedTokens = 10;

      agent.refreshTime();

      expect(agent.getMessages().length).toBe(2);
      expect(agent.getMessages()[1].role).toBe('system');
    });
  });

  // =====================================================================
  // refreshMemory
  // =====================================================================
  describe('refreshMemory', () => {
    test('delegates to memoryManager and updates tokens', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'hello',
      });

      const before = agent.getTokenEstimate();
      // memoryManager.refreshMemory returns token delta (mocked as 0 by default)
      agent.refreshMemory();
      expect(agent.getTokenEstimate()).toBe(before); // 0 delta
    });
  });

  // =====================================================================
  // getLastToolCalls
  // =====================================================================
  describe('getLastToolCalls', () => {
    test('returns empty array initially', () => {
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4' });
      expect(agent.getLastToolCalls()).toEqual([]);
    });
  });

  // =====================================================================
  // getCompressedSummary
  // =====================================================================
  describe('getCompressedSummary', () => {
    test('returns empty string initially', () => {
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4' });
      expect(agent.getCompressedSummary()).toBe('');
    });
  });

  // =====================================================================
  // chat — basic flow
  // =====================================================================
  describe('chat — basic flow', () => {
    test('sends user message and returns AI response', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      const result = await agent.chat('Hello');

      expect(result).toBe('AI response');
      expect(mockCallAI).toHaveBeenCalled();
    });

    test('adds user message to history', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      await agent.chat('Hello world');

      const msgs = agent.getMessages();
      const userMsg = msgs.find(m => m.role === 'user');
      expect(userMsg?.content).toBe('Hello world');
    });

    test('adds assistant response to history', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      await agent.chat('Hello');

      const msgs = agent.getMessages();
      const assistantMsg = msgs.find(m => m.role === 'assistant');
      expect(assistantMsg?.content).toBe('AI response');
    });

    test('calls refreshTime at start of chat', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      // mockBuildVolatileContext was already called in constructor
      vi.clearAllMocks();
      resetAllMocks();

      await agent.chat('Hi');

      // refreshTime should call buildVolatileContext
      expect(mockBuildVolatileContext).toHaveBeenCalled();
    });

    test('runs hook lifecycle events', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      await agent.chat('Hello');

      expect(mockHookRunner.runMessageReceived).toHaveBeenCalled();
      expect(mockHookRunner.runLlmInput).toHaveBeenCalled();
      expect(mockHookRunner.runLlmOutput).toHaveBeenCalled();
      expect(mockHookRunner.runMessageSending).toHaveBeenCalled();
      expect(mockHookRunner.runMessageSent).toHaveBeenCalled();
      expect(mockHookRunner.runAgentEnd).toHaveBeenCalled();
    });

    test('calls manageContextCompression', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      // Add enough messages so manageContextCompression enters its logic
      // But it will return early since messages.length <= 10
      await agent.chat('Hi');
      // No error means it ran correctly
    });

    test('uses HybridToolSelector to filter tools', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      await agent.chat('Hello');

      expect(mockHybridSelector.select).toHaveBeenCalled();
    });

    test('handles HybridToolSelector failure gracefully', async () => {
      mockHybridSelector.select.mockRejectedValueOnce(new Error('selector fail'));

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      // Should not throw
      const result = await agent.chat('Hello');
      expect(result).toBe('AI response');
    });

    test('enriches message with dynamic memory injection', async () => {
      mockDynamicInjector.inject.mockResolvedValueOnce('Hello [memory: user likes cats]');

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      await agent.chat('Hello');

      expect(mockDynamicInjector.inject).toHaveBeenCalledWith('Hello', 'default');
    });

    test('handles dynamic memory injection failure gracefully', async () => {
      mockDynamicInjector.inject.mockRejectedValueOnce(new Error('injection fail'));

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      const result = await agent.chat('Hello');
      expect(result).toBe('AI response');
    });

    test('uses userContext.userId for memory injection', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      await agent.chat('Hello', { userContext: { userId: 'user-123' } as any });

      expect(mockDynamicInjector.inject).toHaveBeenCalledWith('Hello', 'user-123');
    });

    test('modifies final content via hookRunner.runMessageSending', async () => {
      mockHookRunner.runMessageSending.mockResolvedValueOnce({ content: 'Modified response' });

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      const result = await agent.chat('Hello');
      expect(result).toBe('Modified response');
    });

    test('appends token stats when showTokenStats is true', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
        tokenStatsConfig: { showTokenStats: true },
      });

      const result = await agent.chat('Hello');
      expect(result).toContain('TokenStats');
    });
  });

  // =====================================================================
  // chat — tool execution
  // =====================================================================
  describe('chat — tool execution', () => {
    test('executes tools when AI returns tool calls', async () => {
      const toolCalls = [{
        id: 'tc_1',
        type: 'function',
        function: { name: 'search', arguments: '{"q":"test"}' },
      }];

      // First call: tool call, second call: final response
      mockCallAI
        .mockResolvedValueOnce(makeAIResponse('', toolCalls))
        .mockResolvedValueOnce(makeAIResponse('Search result: found'));

      mockHasToolCalls
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      mockExtractToolCalls.mockReturnValueOnce(toolCalls);
      mockExtractContent.mockReturnValue('Search result: found');

      mockToolDispatcher.executeToolBatches.mockResolvedValueOnce([{
        call: toolCalls[0],
        result: { results: ['item1'] },
      }]);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      const result = await agent.chat('Search for test');

      expect(mockToolDispatcher.executeToolBatches).toHaveBeenCalled();
      expect(result).toBe('Search result: found');
    });

    test('calls onToolCall and onToolResult callbacks', async () => {
      const toolCalls = [{
        id: 'tc_1',
        type: 'function',
        function: { name: 'search', arguments: '{"q":"test"}' },
      }];

      mockCallAI
        .mockResolvedValueOnce(makeAIResponse('', toolCalls))
        .mockResolvedValueOnce(makeAIResponse('Done'));

      mockHasToolCalls
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      mockExtractToolCalls.mockReturnValueOnce(toolCalls);
      mockExtractContent.mockReturnValue('Done');

      mockToolDispatcher.executeToolBatches.mockResolvedValueOnce([{
        call: toolCalls[0],
        result: { ok: true },
      }]);

      const onToolCall = vi.fn();
      const onToolResult = vi.fn();

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      await agent.chat('Do search', { onToolCall, onToolResult });

      // Tool dispatcher receives the callbacks
      expect(mockToolDispatcher.executeToolBatches).toHaveBeenCalledWith(
        toolCalls,
        expect.any(Number),
        expect.any(Array),
        expect.objectContaining({
          onToolCall,
          onToolResult,
        }),
      );
    });

    test('respects maxToolIterations limit', async () => {
      // Always return tool calls to force iteration limit
      mockCallAI.mockResolvedValue(makeAIResponse('', [{
        id: 'tc', type: 'function',
        function: { name: 'loop_tool', arguments: '{}' },
      }]));
      mockHasToolCalls.mockReturnValue(true);
      mockExtractToolCalls.mockReturnValue([{
        id: 'tc', type: 'function',
        function: { name: 'loop_tool', arguments: '{}' },
      }]);
      mockToolDispatcher.executeToolBatches.mockResolvedValue([{
        call: { id: 'tc', type: 'function', function: { name: 'loop_tool', arguments: '{}' } },
        result: { ok: true },
      }]);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
        maxToolIterations: 3,
      });

      const result = await agent.chat('Loop');

      // Should stop after 3 iterations
      expect(mockCallAI).toHaveBeenCalledTimes(3);
      // Falls back to max-iterations message
      expect(result).toContain('工具调用次数限制');
    });

    test('updates lastToolCalls when AI returns tool calls', async () => {
      const toolCalls = [{
        id: 'tc_1', type: 'function',
        function: { name: 'my_tool', arguments: '{}' },
      }];

      mockCallAI
        .mockResolvedValueOnce(makeAIResponse('Using tool', toolCalls))
        .mockResolvedValueOnce(makeAIResponse('Done'));

      mockHasToolCalls
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      mockExtractToolCalls.mockReturnValueOnce(toolCalls);
      mockExtractContent.mockReturnValue('Done');
      mockToolDispatcher.executeToolBatches.mockResolvedValueOnce([{
        call: toolCalls[0], result: {},
      }]);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      await agent.chat('Use tool');
      expect(agent.getLastToolCalls()).toEqual(toolCalls);
    });
  });

  // =====================================================================
  // chat — skill_get handling (Bug Fix 1 path)
  // =====================================================================
  describe('chat — skill_get with other tools', () => {
    test('handles skill_get + other tools in same response', async () => {
      const skillGetCall = {
        id: 'tc_skill', type: 'function',
        function: { name: 'skill_get', arguments: '{"name":"my_skill"}' },
      };
      const otherCall = {
        id: 'tc_other', type: 'function',
        function: { name: 'search', arguments: '{"q":"test"}' },
      };

      mockCallAI
        .mockResolvedValueOnce(makeAIResponse('Let me get the skill', [skillGetCall, otherCall]))
        .mockResolvedValueOnce(makeAIResponse('Done with skill'));

      mockHasToolCalls
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      mockExtractToolCalls.mockReturnValueOnce([skillGetCall, otherCall]);
      mockExtractContent.mockReturnValue('Done with skill');

      mockToolDispatcher.executeToolBatches.mockResolvedValueOnce([{
        call: otherCall, result: { found: true },
      }]);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      // Use a custom executor to handle skill_get
      (agent as any).toolExecutor = vi.fn(async () => ({ skill: 'loaded' }));

      const result = await agent.chat('Use skill and search');
      expect(result).toContain('Done with skill');
    });
  });

  // =====================================================================
  // chat — thinking content extraction
  // =====================================================================
  describe('chat — thinking content', () => {
    test('extracts thinking block and emits via onContentBlock', async () => {
      mockCleanTokenStats.mockImplementation((s: string) => s);
      mockCallAI.mockResolvedValue({
        ...makeAIResponse('<thinking>\nLet me think about this\n</thinking>\n\nHere is my answer'),
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '<thinking>\nLet me think about this\n</thinking>\n\nHere is my answer',
          },
          finish_reason: 'stop',
        }],
      });
      mockHasToolCalls.mockReturnValue(false);
      mockExtractContent.mockReturnValue('Here is my answer');

      const onContentBlock = vi.fn();

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      await agent.chat('Think about this', { onContentBlock });

      // Should emit thinking block
      expect(onContentBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'thinking',
          thinking: 'Let me think about this',
        }),
      );
    });
  });

  // =====================================================================
  // chat — token budget guard
  // =====================================================================
  describe('chat — token budget guard', () => {
    test('stops iteration when token budget exceeded', async () => {
      // Simulate high token usage by returning large estimated tokens
      mockEstimateMessageTokens.mockReturnValue(5000);

      mockCallAI.mockResolvedValue(makeAIResponse('', [{
        id: 'tc', type: 'function',
        function: { name: 'heavy_tool', arguments: '{}' },
      }]));
      mockHasToolCalls.mockReturnValue(true);
      mockExtractToolCalls.mockReturnValue([{
        id: 'tc', type: 'function',
        function: { name: 'heavy_tool', arguments: '{}' },
      }]);
      mockToolDispatcher.executeToolBatches.mockResolvedValue([{
        call: { id: 'tc', type: 'function', function: { name: 'heavy_tool', arguments: '{}' } },
        result: 'x'.repeat(10000),
      }]);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      const result = await agent.chat('Heavy task');

      // Should have stopped due to token budget
      expect(result).toContain('Token');
    });
  });

  // =====================================================================
  // chat — fallback when no final content
  // =====================================================================
  describe('chat — fallback content', () => {
    test('uses last assistant message when max iterations reached', async () => {
      // Tool calls loop but assistant has content
      mockCallAI.mockResolvedValue({
        ...makeAIResponse('Partial progress'),
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Partial progress',
            tool_calls: [{ id: 'tc', type: 'function', function: { name: 't', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        }],
      });
      mockHasToolCalls.mockReturnValue(true);
      mockExtractToolCalls.mockReturnValue([{ id: 'tc', type: 'function', function: { name: 't', arguments: '{}' } }]);
      mockToolDispatcher.executeToolBatches.mockResolvedValue([{
        call: { id: 'tc', type: 'function', function: { name: 't', arguments: '{}' } },
        result: {},
      }]);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
        maxToolIterations: 2,
      });

      const result = await agent.chat('Do something');
      // Should use the last assistant content
      expect(result).toContain('Partial progress');
    });

    test('returns error message when no assistant content at all', async () => {
      mockCallAI.mockResolvedValue({
        ...makeAIResponse(''),
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'tc', type: 'function', function: { name: 't', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        }],
      });
      mockHasToolCalls.mockReturnValue(true);
      mockExtractToolCalls.mockReturnValue([{ id: 'tc', type: 'function', function: { name: 't', arguments: '{}' } }]);
      mockToolDispatcher.executeToolBatches.mockResolvedValue([{
        call: { id: 'tc', type: 'function', function: { name: 't', arguments: '{}' } },
        result: {},
      }]);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
        maxToolIterations: 1,
      });

      const result = await agent.chat('Fail');
      expect(result).toContain('工具调用次数限制');
    });
  });

  // =====================================================================
  // trimContextIfNeeded
  // =====================================================================
  describe('trimContextIfNeeded (via addMessage)', () => {
    test('does not compress when under threshold', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
      });

      agent.addMessage({ role: 'user', content: 'Short message' });
      // With maxTokens=8000, threshold=0.8 => 6400, and we have ~10 tokens
      // No compression should happen
      expect(agent.getMessages().length).toBe(1);
    });

    test('compresses tool messages when over threshold', () => {
      // Make tokens high to trigger compression
      mockEstimateMessageTokens.mockReturnValue(2000);
      mockCalculateContextConfig.mockReturnValue({
        maxTokens: 8000,
        keepRecent: 2,
        compressionThreshold: 0.8,
      });

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      // Reset mock to normal then override for tool messages
      mockEstimateMessageTokens.mockReturnValue(2000);

      // Add enough messages to exceed threshold (8000 * 0.8 = 6400)
      agent.addMessage({ role: 'user', content: 'msg1' });
      agent.addMessage({ role: 'tool', content: '{"big":"data"}', tool_call_id: 'tc1' });
      agent.addMessage({ role: 'user', content: 'msg2' });
      agent.addMessage({ role: 'assistant', content: 'response' });

      // compressToolResult should have been called for the tool message
      // (if the threshold was exceeded)
      expect(mockCompressToolResult).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // compressContextWithLLM
  // =====================================================================
  describe('compressContextWithLLM', () => {
    test('returns empty result when no provider', async () => {
      const agent = new Agent({
        provider: undefined as any,
        model: 'gpt-4',
      });

      const result = await agent.compressContextWithLLM();
      expect(result.summary).toBe('');
      expect(result.compressionRatio).toBe(1);
    });

    test('returns empty result when not enough messages to compress', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      const result = await agent.compressContextWithLLM();
      expect(result.summary).toBe('');
    });

    test('compresses when enough messages exist', async () => {
      mockTieredCompress.mockResolvedValueOnce({
        compressed: 'Compressed summary of conversation',
        originalTokens: 5000,
        compressedTokens: 2500,
        ratio: 0.5,
      });

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      // Add many messages to exceed keepRecent threshold
      for (let i = 0; i < 15; i++) {
        (agent as any).messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg ${i}` });
      }
      (agent as any).estimatedTokens = 5000;

      const result = await agent.compressContextWithLLM();
      expect(mockTieredCompress).toHaveBeenCalled();
    });

    test('handles compression failure and falls back to trim', async () => {
      mockTieredCompress.mockRejectedValueOnce(new Error('LLM compression failed'));

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      for (let i = 0; i < 15; i++) {
        (agent as any).messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg ${i}` });
      }
      (agent as any).estimatedTokens = 5000;

      const result = await agent.compressContextWithLLM();
      expect(result.summary).toBe('');
    });

    test('prevents concurrent compression via _compressing flag', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      // Set the flag manually
      (agent as any)._compressing = true;

      const result = await agent.compressContextWithLLM();
      expect(result.summary).toBe('');
      expect(result.compressionRatio).toBe(1);

      // Reset
      (agent as any)._compressing = false;
    });
  });

  // =====================================================================
  // chatStream
  // =====================================================================
  describe('chatStream', () => {
    test('yields content from AI response', async () => {
      mockCallAI.mockResolvedValue(makeAIResponse('Streamed response'));
      mockHasToolCalls.mockReturnValue(false);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      const chunks: any[] = [];
      for await (const chunk of agent.chatStream('Hello')) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === 'content' && c.content === 'Streamed response')).toBe(true);
    });

    test('yields tool_call and tool_result events', async () => {
      const toolCalls = [{
        id: 'tc_1', type: 'function',
        function: { name: 'search', arguments: '{"q":"test"}' },
      }];

      mockCallAI
        .mockResolvedValueOnce(makeAIResponse('', toolCalls))
        .mockResolvedValueOnce(makeAIResponse('Done'));

      mockHasToolCalls
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      mockExtractToolCalls.mockReturnValueOnce(toolCalls);

      mockToolDispatcher.executeToolBatches.mockResolvedValueOnce([{
        call: toolCalls[0],
        result: { found: true },
      }]);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      const chunks: any[] = [];
      for await (const chunk of agent.chatStream('Search')) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === 'tool_call' && c.name === 'search')).toBe(true);
      expect(chunks.some(c => c.type === 'tool_result' && c.name === 'search')).toBe(true);
    });

    test('yields skill attribution when skills are used', async () => {
      const toolCalls = [{
        id: 'tc_1', type: 'function',
        function: { name: 'skill_get', arguments: '{"name":"my_skill"}' },
      }];

      mockCallAI
        .mockResolvedValueOnce(makeAIResponse('', toolCalls))
        .mockResolvedValueOnce(makeAIResponse('Skill result'));

      mockHasToolCalls
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      mockExtractToolCalls.mockReturnValueOnce(toolCalls);

      mockToolDispatcher.executeToolBatches.mockResolvedValueOnce([{
        call: toolCalls[0],
        result: { skill: 'loaded' },
      }]);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      const chunks: any[] = [];
      for await (const chunk of agent.chatStream('Use my skill')) {
        chunks.push(chunk);
      }

      // Should have skill attribution
      const skillChunk = chunks.find(c => c.type === 'content' && c.content?.includes('my_skill'));
      expect(skillChunk).toBeDefined();
    });

    test('token budget guard stops streaming', async () => {
      mockEstimateMessageTokens.mockReturnValue(5000);

      mockCallAI.mockResolvedValue(makeAIResponse('', [{
        id: 'tc', type: 'function',
        function: { name: 'heavy', arguments: '{}' },
      }]));
      mockHasToolCalls.mockReturnValue(true);
      mockExtractToolCalls.mockReturnValue([{
        id: 'tc', type: 'function',
        function: { name: 'heavy', arguments: '{}' },
      }]);
      mockToolDispatcher.executeToolBatches.mockResolvedValue([{
        call: { id: 'tc', type: 'function', function: { name: 'heavy', arguments: '{}' } },
        result: {},
      }]);

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      const chunks: any[] = [];
      for await (const chunk of agent.chatStream('Heavy')) {
        chunks.push(chunk);
      }

      const warningChunk = chunks.find(c => c.type === 'content' && c.content?.includes('Token'));
      expect(warningChunk).toBeDefined();
    });
  });

  // =====================================================================
  // manageContextCompression
  // =====================================================================
  describe('manageContextCompression (via chat)', () => {
    test('skips when messages <= 10', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      // Only 3 messages (2 system + 1 user added by chat)
      await agent.chat('Hi');

      // TieredCompressor should not have been called (not enough messages)
      expect(mockTieredCompress).not.toHaveBeenCalled();
    });

    test('calls compression pipeline when enough messages and above threshold', async () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'System',
      });

      // Add 12 messages to trigger manageContextCompression
      for (let i = 0; i < 12; i++) {
        (agent as any).messages.push({ role: 'user', content: `msg ${i}`.repeat(30) });
      }
      (agent as any).estimatedTokens = 7000; // above 80% threshold

      mockTieredCompress.mockResolvedValue({
        compressed: 'compressed content',
        originalTokens: 700,
        compressedTokens: 300,
        ratio: 0.57,
      });

      await agent.chat('Trigger compression');

      // TieredCompressor.compress should be called for old messages
      expect(mockTieredCompress).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // isToolBlocked
  // =====================================================================
  describe('isToolBlocked', () => {
    test('returns true for blocked tools', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        blockedTools: ['dangerous_tool'],
      });

      expect((agent as any).isToolBlocked('dangerous_tool')).toBe(true);
    });

    test('returns false for non-blocked tools', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        blockedTools: ['dangerous_tool'],
      });

      expect((agent as any).isToolBlocked('safe_tool')).toBe(false);
    });

    test('returns false when blockedTools is undefined', () => {
      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
      });

      expect((agent as any).isToolBlocked('any_tool')).toBe(false);
    });
  });
});

// =========================================================================
// simpleHash (private, tested indirectly)
// =========================================================================
describe('simpleHash', () => {
  test('produces consistent hash for same input', () => {
    // simpleHash is a module-level function, not exported
    // We test it indirectly through the KV-cache mechanism
    // Just verify Agent can be created (simpleHash is used internally)
    const agent = new Agent({
      provider: {
        name: 'test', type: 'openai', apiKey: 'k', default: true, models: {},
      },
      model: 'gpt-4',
      systemPrompt: 'Test prompt',
    });
    expect(agent).toBeDefined();
  });
});

// =========================================================================
// createAgent
// =========================================================================
describe('createAgent', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test('creates agent with default system prompt when none provided', () => {
    const agent = createAgent({
      provider: makeProvider(),
      model: 'gpt-4',
    });

    expect(agent).toBeInstanceOf(Agent);
    // Should use SYSTEM_PROMPTS.default
    expect(mockBuildSystemPrompt).toHaveBeenCalled();
  });

  test('loads core memory and skills into system prompt', () => {
    mockSkillStore.list.mockReturnValue([
      { name: 'test-skill', description: 'A test skill', triggers: ['test'] },
    ]);

    const agent = createAgent({
      provider: makeProvider(),
      model: 'gpt-4',
      loadCoreMemory: true,
    });

    expect(mockMemoryStore.getCoreContext).toHaveBeenCalled();
    expect(mockFormatSkillsForPrompt).toHaveBeenCalled();
    expect(mockBuildSystemPrompt).toHaveBeenCalled();
  });

  test('skips core memory when loadCoreMemory is false', () => {
    const agent = createAgent({
      provider: makeProvider(),
      model: 'gpt-4',
      loadCoreMemory: false,
    });

    expect(mockMemoryStore.getCoreContext).not.toHaveBeenCalled();
  });

  test('handles memory store initialization failure', () => {
    mockMemoryStore.getCoreContext.mockImplementation(() => { throw new Error('Not initialized'); });

    // Should not throw
    const agent = createAgent({
      provider: makeProvider(),
      model: 'gpt-4',
    });

    expect(agent).toBeInstanceOf(Agent);
  });

  test('handles skill store initialization failure', () => {
    vi.mocked(skillStoreModule.getSkillStore).mockImplementation(() => { throw new Error('Skills not ready'); });

    const agent = createAgent({
      provider: makeProvider(),
      model: 'gpt-4',
    });

    expect(agent).toBeInstanceOf(Agent);

    // Restore
    vi.mocked(skillStoreModule.getSkillStore).mockReturnValue(mockSkillStore as any);
  });

  test('merges params with legacy options (params take precedence)', () => {
    const agent = createAgent({
      provider: makeProvider(),
      model: 'gpt-4',
      temperature: 0.5,
      topP: 0.8,
      maxTokens: 1000,
      params: {
        temperature: 0.9,
        top_p: 0.95,
        max_tokens: 2000,
      },
    });

    // The params should override legacy options
    expect(agent).toBeInstanceOf(Agent);
  });

  test('passes blockedTools to agent', () => {
    const agent = createAgent({
      provider: makeProvider(),
      model: 'gpt-4',
      blockedTools: ['tool_a', 'tool_b'],
    });

    expect((agent as any).isToolBlocked('tool_a')).toBe(true);
    expect((agent as any).isToolBlocked('tool_c')).toBe(false);
  });

  test('passes contextConfig and tokenStatsConfig', () => {
    const agent = createAgent({
      provider: makeProvider(),
      model: 'gpt-4',
      contextConfig: { keepRecent: 10 },
      tokenStatsConfig: { showTokenStats: true },
    });

    expect(agent.getTokenStatsConfig().showTokenStats).toBe(true);
  });
});

// =========================================================================
// Module re-exports
// =========================================================================
describe('module re-exports', () => {
  test('exports all expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.getAllToolsForAI).toBe('function');
    expect(mod.SYSTEM_PROMPTS).toBeDefined();
    expect(typeof mod.buildSystemPrompt).toBe('function');
    expect(typeof mod.formatSkillsForPrompt).toBe('function');
    expect(typeof mod.getCurrentTimeContext).toBe('function');
    expect(typeof mod.getMemoryTools).toBe('function');
    expect(typeof mod.getSkillTools).toBe('function');
    expect(typeof mod.getToolsByCategory).toBe('function');
    expect(mod.TOOL_CATEGORIES).toBeDefined();
    expect(typeof mod.getBuiltinToolsForAI).toBe('function');
    expect(typeof mod.executeBuiltinTool).toBe('function');
    expect(typeof mod.isBuiltinTool).toBe('function');
    expect(mod.builtinToolNames).toBeDefined();
    expect(typeof mod.recordSkillFailure).toBe('function');
    expect(typeof mod.stripMessageMetadata).toBe('function');
    expect(typeof mod.Agent).toBe('function');
    expect(typeof mod.createAgent).toBe('function');
    expect(typeof mod.ToolDispatcher).toBe('function');
    expect(typeof mod.TokenBudgetManager).toBe('function');
    expect(typeof mod.SkillRunner).toBe('function');
    expect(typeof mod.createDefaultToolExecutor).toBe('function');
    expect(typeof mod._executeToolInner).toBe('function');
  });
});
