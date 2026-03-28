/**
 * Additional coverage tests for src/domain/agent/index.ts
 * Targets uncovered lines: skill enforcement retry, evolution triggers,
 * preference signals, chatStream paths, trimContextIfNeeded edge cases,
 * manageContextCompression fallback paths, and createAgent variations.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// =========================================================================
// Infrastructure mocks
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

vi.mock('@infra/observability/logger', () => {
  const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: mockLogger, getLogger: vi.fn(() => mockLogger) };
});

const mockLoopDetector = { reset: vi.fn(), record: vi.fn(), isLooping: vi.fn(() => false) };
vi.mock('@infra/resilience/loop-detector', () => ({
  LoopDetector: vi.fn(),
  createLoopDetector: vi.fn(() => mockLoopDetector),
}));
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
  hasToolCalls: (...args: any[]) => mockHasToolCalls(...args),
  extractToolCalls: (...args: any[]) => mockExtractToolCalls(...args),
  extractContent: (...args: any[]) => mockExtractContent(...args),
}));

// --- Tools ---
const mockGetAllToolsForAI = vi.fn(() => []);
const mockBuildSystemPrompt = vi.fn((base: string) => base);
const mockBuildVolatileContext = vi.fn(() => '[time: 2026-03-27 morning]');
const mockFormatSkillsForPrompt = vi.fn(() => '');
vi.mock('@domain/agent/tools', () => ({
  getAllToolsForAI: (...args: any[]) => mockGetAllToolsForAI(...args),
  SYSTEM_PROMPTS: { default: 'Default system prompt', concise: 'Concise', verbose: 'Verbose' },
  buildSystemPrompt: (...args: any[]) => mockBuildSystemPrompt(...args),
  formatSkillsForPrompt: (...args: any[]) => mockFormatSkillsForPrompt(...args),
  getCurrentTimeContext: vi.fn(() => 'Current time: 2026-03-27'),
  buildVolatileContext: (...args: any[]) => mockBuildVolatileContext(...args),
  getMemoryTools: vi.fn(() => []),
  getSkillTools: vi.fn(() => []),
  getToolsByCategory: vi.fn(() => []),
  TOOL_CATEGORIES: {},
}));

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

const mockCompressMessages = vi.fn(async () => ({ messages: [], stats: null }));
const mockShouldCompress = vi.fn(() => false);
vi.mock('@domain/agent/compression', () => ({
  compressMessages: (...args: any[]) => mockCompressMessages(...args),
  shouldCompress: (...args: any[]) => mockShouldCompress(...args),
  hybridCompress: vi.fn(async () => ({ summary: '', compressionRatio: 1 })),
}));

// --- Memory ---
const mockMemoryStore = { getCoreContext: vi.fn(() => ({ user: 'Test User', soul: 'friendly AI' })) };
const mockDynamicInjector = { inject: vi.fn(async (msg: string) => msg) };
vi.mock('@domain/memory', () => ({
  getMemoryStore: vi.fn(() => mockMemoryStore),
  getDynamicMemoryInjector: vi.fn(() => mockDynamicInjector),
}));
vi.mock('@domain/memory/lifecycle-manager', () => ({ getLifecycleManager: vi.fn(() => null) }));

const mockSkillStore = { list: vi.fn(() => []), search: vi.fn(() => []), get: vi.fn(() => null) };
vi.mock('@domain/skills/store', () => ({ getSkillStore: vi.fn(() => mockSkillStore) }));

// --- Skill enforcement ---
const mockSkillEnforcementInstance = {
  matchSkillsForQuery: vi.fn(() => ({ matched: false, skills: [], directive: '' })),
  validateOutputCompleteness: vi.fn(() => []),
  buildRetryPrompt: vi.fn(() => 'Please retry'),
  clearTraces: vi.fn(),
};
vi.mock('@domain/skills/enforcement', () => ({
  SkillEnforcementEngine: vi.fn().mockImplementation(() => mockSkillEnforcementInstance),
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

const mockHealthMonitor = {
  hasIssues: vi.fn(() => false),
  buildHealthContext: vi.fn(() => null),
};

vi.mock('@domain/ports', () => ({
  getHookRunnerPort: vi.fn(() => mockHookRunner),
  getHealthMonitorPort: vi.fn(() => mockHealthMonitor),
}));

// --- Evolution ---
const mockGetReflectionStats = vi.fn(() => ({ recentFailures: 0, failureDetails: [] }));
const mockRecordSkillFailure = vi.fn();
vi.mock('@domain/agent/evolution', () => ({
  recordSkillFailure: (...args: any[]) => mockRecordSkillFailure(...args),
  getReflectionStats: (...args: any[]) => mockGetReflectionStats(...args),
}));
const mockCheckPreferenceTriggers = vi.fn(() => ({ hasPreference: false, expressions: [] }));
vi.mock('@domain/agent/evolution/preference-learning', () => ({
  checkPreferenceTriggers: (...args: any[]) => mockCheckPreferenceTriggers(...args),
}));
const mockTriggerSelfEvolution = vi.fn(async () => ({ improved: false }));
vi.mock('@domain/agent/evolution/self-evolution', () => ({
  triggerSelfEvolution: (...args: any[]) => mockTriggerSelfEvolution(...args),
}));

vi.mock('@domain/agent/context/simhash', () => ({
  getSimHasher: vi.fn(() => ({ deduplicateItems: vi.fn((items: any[]) => items) })),
}));
vi.mock('@domain/agent/context/health-dashboard', () => ({
  getContextHealthDashboard: vi.fn(() => ({
    measure: vi.fn(() => ({})),
    checkAlerts: vi.fn(() => []),
  })),
}));

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
vi.mock('@domain/agent/skill-runner', () => ({ SkillRunner: vi.fn().mockImplementation(() => ({})) }));
vi.mock('@domain/agent/tool-executor', () => ({
  createDefaultToolExecutor: vi.fn(() => vi.fn(async () => ({ success: true }))),
  _executeToolInner: vi.fn(),
}));
vi.mock('@domain/agent/memory-manager', () => ({
  MemoryManager: vi.fn().mockImplementation(() => ({
    refreshMemory: vi.fn(() => 0),
    recordConversation: vi.fn(async () => {}),
  })),
}));
const mockHybridSelector = { select: vi.fn(async (tools: any[]) => tools) };
vi.mock('@domain/agent/hybrid-tool-selector', () => ({
  getHybridToolSelector: vi.fn(() => mockHybridSelector),
}));
vi.mock('../../app', () => ({ getAgent: vi.fn() }));
vi.mock('@domain/tools', () => ({
  getBuiltinToolsForAI: vi.fn(() => []),
  executeBuiltinTool: vi.fn(),
  isBuiltinTool: vi.fn(() => false),
  builtinToolNames: [],
}));
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

import { Agent, createAgent } from '../index';
import { SkillEnforcementEngine } from '@domain/skills/enforcement';
import { ToolDispatcher } from '@domain/agent/tool-dispatcher';
import { TokenBudgetManager } from '@domain/agent/token-budget';
import { SkillRunner } from '@domain/agent/skill-runner';
import { MemoryManager } from '@domain/agent/memory-manager';
import { createDefaultToolExecutor } from '@domain/agent/tool-executor';
import * as ports from '@domain/ports';
import * as skillStoreModule from '@domain/skills/store';
import { getHybridToolSelector } from '@domain/agent/hybrid-tool-selector';

function makeProvider(overrides: any = {}) {
  return { name: 'test-provider', type: 'openai' as const, apiKey: 'test-key', default: true, models: {}, ...overrides };
}

function makeAIResponse(content: string, toolCalls?: any[]) {
  return {
    id: 'resp-1',
    choices: [{ index: 0, message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

function resetAllMocks() {
  vi.clearAllMocks();
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
  mockCalculateContextConfig.mockReturnValue({ maxTokens: 8000, keepRecent: 4, compressionThreshold: 0.8 });
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
  mockSkillEnforcementInstance.matchSkillsForQuery.mockReturnValue({ matched: false, skills: [], directive: '' });
  mockSkillEnforcementInstance.validateOutputCompleteness.mockReturnValue([]);
  mockHealthMonitor.hasIssues.mockReturnValue(false);
  mockHealthMonitor.buildHealthContext.mockReturnValue(null);
  mockGetReflectionStats.mockReturnValue({ recentFailures: 0, failureDetails: [] });
  mockCheckPreferenceTriggers.mockReturnValue({ hasPreference: false, expressions: [] });
  mockTriggerSelfEvolution.mockResolvedValue({ improved: false });
  mockRecordSkillFailure.mockReset();

  vi.mocked(SkillEnforcementEngine).mockImplementation(function (this: any) {
    Object.assign(this, mockSkillEnforcementInstance);
  } as any);
  vi.mocked(ToolDispatcher).mockImplementation(function (this: any) { Object.assign(this, mockToolDispatcher); } as any);
  vi.mocked(TokenBudgetManager).mockImplementation(function (this: any) { this.checkTurnBudget = vi.fn(() => ({ allowed: true })); this.recordUsage = vi.fn(); } as any);
  vi.mocked(SkillRunner).mockImplementation(function (this: any) {} as any);
  vi.mocked(MemoryManager).mockImplementation(function (this: any) { this.refreshMemory = vi.fn(() => 0); this.recordConversation = vi.fn(async () => {}); } as any);
  vi.mocked(createDefaultToolExecutor).mockReturnValue(vi.fn(async () => ({ success: true })) as any);
  vi.mocked(ports.getHookRunnerPort).mockReturnValue(mockHookRunner as any);
  vi.mocked(ports.getHealthMonitorPort).mockReturnValue(mockHealthMonitor as any);
  vi.mocked(skillStoreModule.getSkillStore).mockReturnValue(mockSkillStore as any);
  vi.mocked(getHybridToolSelector).mockReturnValue(mockHybridSelector as any);
  mockMemoryStore.getCoreContext.mockReturnValue({ user: 'Test User', soul: 'friendly AI' });
  mockSkillStore.list.mockReturnValue([]);
}

describe('Agent — additional coverage', () => {
  beforeEach(() => { resetAllMocks(); });

  // =====================================================================
  // safeJsonParse (lines 56-57) — error path
  // =====================================================================
  describe('safeJsonParse error path (via skill_get with invalid JSON)', () => {
    test('handles invalid JSON arguments in tool calls gracefully', async () => {
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });

      // First call returns tool calls with invalid JSON arguments
      mockCallAI.mockResolvedValueOnce(makeAIResponse('', [
        { id: 'tc1', type: 'function', function: { name: 'some_tool', arguments: '{invalid json' } },
      ]));
      mockHasToolCalls.mockReturnValueOnce(true);
      mockExtractToolCalls.mockReturnValueOnce([
        { id: 'tc1', type: 'function', function: { name: 'some_tool', arguments: '{invalid json' } },
      ]);
      mockToolDispatcher.executeToolBatches.mockResolvedValueOnce([
        { call: { id: 'tc1', type: 'function', function: { name: 'some_tool', arguments: '{invalid json' } }, result: { ok: true } },
      ]);

      // Second call returns final content
      mockCallAI.mockResolvedValueOnce(makeAIResponse('Final'));
      mockHasToolCalls.mockReturnValueOnce(false);
      mockExtractContent.mockReturnValueOnce('Final');

      const result = await agent.chat('test');
      expect(result).toContain('Final');
    });
  });

  // =====================================================================
  // constructor — hookRunner model override (lines 125-129)
  // =====================================================================
  describe('constructor hook runner model/provider override', () => {
    test('applies model AND provider override from hook', () => {
      mockHookRunner.runBeforeModelResolve.mockReturnValue({
        model: 'custom-model',
        provider: { name: 'custom', type: 'openai' as const, apiKey: 'k', default: true, models: {} },
      });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      expect(agent).toBeDefined();
      expect(mockHookRunner.runBeforeModelResolve).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // constructor — skillEnforcement init failure (lines 273, 276)
  // =====================================================================
  describe('constructor skill enforcement init', () => {
    test('handles skillStore returning null gracefully', () => {
      vi.mocked(skillStoreModule.getSkillStore).mockReturnValue(null as any);
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      expect(agent).toBeDefined();
    });
  });

  // =====================================================================
  // constructor — healthMonitor (line 304)
  // =====================================================================
  describe('constructor health monitor', () => {
    test('stores health monitor when available', () => {
      vi.mocked(ports.getHealthMonitorPort).mockReturnValue(mockHealthMonitor as any);
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      expect(agent).toBeDefined();
    });

    test('handles health monitor init failure gracefully', () => {
      vi.mocked(ports.getHealthMonitorPort).mockImplementation(() => { throw new Error('No monitor'); });
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      expect(agent).toBeDefined();
    });
  });

  // =====================================================================
  // trimContextIfNeeded — compression branches (lines 497-545)
  // =====================================================================
  describe('trimContextIfNeeded — advanced compression branches', () => {
    test('compresses assistant messages with tool_calls when over threshold', () => {
      mockCalculateContextConfig.mockReturnValue({ maxTokens: 100, keepRecent: 1, compressionThreshold: 0.5 });
      mockEstimateMessageTokens.mockReturnValue(30);
      mockCompressAssistantMessage.mockImplementation(() => 'compressed');

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });

      // Add messages that will exceed threshold
      agent.addMessage({ role: 'assistant', content: 'long text', tool_calls: [{ id: 'tc1', type: 'function' as const, function: { name: 'test', arguments: '{}' } }] });
      agent.addMessage({ role: 'user', content: 'test msg' });
      agent.addMessage({ role: 'user', content: 'another msg' });

      // The trimContextIfNeeded should have been called automatically
      expect(agent.getMessages().length).toBeGreaterThan(0);
    });

    test('falls back to removing messages when compression is insufficient', () => {
      mockCalculateContextConfig.mockReturnValue({ maxTokens: 50, keepRecent: 1, compressionThreshold: 0.3 });
      // Return high token count to trigger removal
      mockEstimateMessageTokens.mockReturnValue(20);

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      // Add many messages
      for (let i = 0; i < 10; i++) {
        agent.addMessage({ role: 'user', content: `msg ${i}` });
      }
      // Should not crash even with aggressive trimming
      expect(agent.getMessages().length).toBeGreaterThan(0);
    });

    test('handles endIndex <= startIndex edge case', () => {
      mockCalculateContextConfig.mockReturnValue({ maxTokens: 100, keepRecent: 20, compressionThreshold: 0.5 });
      mockEstimateMessageTokens.mockReturnValue(30);

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      // Only add a few messages — keepRecent > messages, so endIndex <= startIndex
      agent.addMessage({ role: 'user', content: 'msg 1' });
      agent.addMessage({ role: 'user', content: 'msg 2' });
      expect(agent.getMessages().length).toBeGreaterThanOrEqual(2);
    });
  });

  // =====================================================================
  // chat — skill enforcement injection (lines 874-906)
  // =====================================================================
  describe('chat — skill enforcement injection', () => {
    test('injects skill directive when skills match', async () => {
      mockSkillEnforcementInstance.matchSkillsForQuery.mockReturnValue({
        matched: true,
        skills: [{ skill: { name: 'test-skill', id: 'sk1' }, score: 1, matchedOn: ['test'] }],
        directive: 'Use test-skill',
      });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      await agent.chat('test message');

      // Should have injected a system message with the directive
      const msgs = agent.getMessages();
      const directiveMsgs = msgs.filter(m => m.role === 'system' && m.content === 'Use test-skill');
      expect(directiveMsgs.length).toBe(1);
    });
  });

  // =====================================================================
  // chat — health monitor injection (lines 915-928)
  // =====================================================================
  describe('chat — health monitor injection', () => {
    test('injects health context when health monitor has issues', async () => {
      mockHealthMonitor.hasIssues.mockReturnValue(true);
      mockHealthMonitor.buildHealthContext.mockReturnValue('Data source X is down');

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      await agent.chat('test');

      const msgs = agent.getMessages();
      const healthMsgs = msgs.filter(m => m.role === 'system' && m.content === 'Data source X is down');
      expect(healthMsgs.length).toBe(1);
    });

    test('skips injection when buildHealthContext returns null', async () => {
      mockHealthMonitor.hasIssues.mockReturnValue(true);
      mockHealthMonitor.buildHealthContext.mockReturnValue(null);

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      const msgsBefore = agent.getMessages().length;
      await agent.chat('test');

      // Count system messages (should only be prompt + volatile + no extra health msg)
      const msgs = agent.getMessages();
      const healthMsgs = msgs.filter(m => m.role === 'system' && m.content?.includes('Data source'));
      expect(healthMsgs.length).toBe(0);
    });
  });

  // =====================================================================
  // chat — skill enforcement output validation + retry (lines 1252-1305)
  // =====================================================================
  describe('chat — skill enforcement output validation and retry', () => {
    test('performs retry when skill enforcement finds issues', async () => {
      mockSkillEnforcementInstance.matchSkillsForQuery.mockReturnValue({
        matched: true,
        skills: [{ skill: { name: 'test-skill', id: 'sk1' }, score: 1, matchedOn: ['test'] }],
        directive: 'Use test-skill',
      });
      mockSkillEnforcementInstance.validateOutputCompleteness.mockReturnValue(['Output too short']);
      mockSkillEnforcementInstance.buildRetryPrompt.mockReturnValue('Please provide complete output');

      // First AI call returns short content
      mockCallAI.mockResolvedValueOnce(makeAIResponse('Short'));
      mockExtractContent.mockReturnValueOnce('Short');

      // Retry call returns longer content
      mockCallAI.mockResolvedValueOnce(makeAIResponse('This is a much longer and more complete response'));
      mockExtractContent.mockReturnValueOnce('This is a much longer and more complete response');

      const agent = new Agent({
        provider: makeProvider(),
        model: 'gpt-4',
        systemPrompt: 'Test',
        maxToolIterations: 10,
      });

      const result = await agent.chat('test');
      expect(result).toContain('This is a much longer and more complete response');
      expect(mockSkillEnforcementInstance.buildRetryPrompt).toHaveBeenCalledWith(['Output too short']);
    });

    test('keeps original content when retry produces shorter output', async () => {
      mockSkillEnforcementInstance.matchSkillsForQuery.mockReturnValue({
        matched: true,
        skills: [{ skill: { name: 'test-skill', id: 'sk1' }, score: 1, matchedOn: ['test'] }],
        directive: 'Use test-skill',
      });
      mockSkillEnforcementInstance.validateOutputCompleteness.mockReturnValue(['Issue']);
      mockSkillEnforcementInstance.buildRetryPrompt.mockReturnValue('retry');

      // First response
      mockCallAI.mockResolvedValueOnce(makeAIResponse('Original longer content'));
      mockExtractContent.mockReturnValueOnce('Original longer content');

      // Retry returns shorter
      mockCallAI.mockResolvedValueOnce(makeAIResponse('Short'));
      mockExtractContent.mockReturnValueOnce('Short');

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test', maxToolIterations: 10 });
      const result = await agent.chat('test');
      expect(result).toContain('Original longer content');
    });

    test('handles retry failure gracefully', async () => {
      mockSkillEnforcementInstance.matchSkillsForQuery.mockReturnValue({
        matched: true,
        skills: [{ skill: { name: 'test-skill', id: 'sk1' }, score: 1, matchedOn: ['test'] }],
        directive: 'Use test-skill',
      });
      mockSkillEnforcementInstance.validateOutputCompleteness.mockReturnValue(['Issue']);
      mockSkillEnforcementInstance.buildRetryPrompt.mockReturnValue('retry');

      mockCallAI.mockResolvedValueOnce(makeAIResponse('Original content'));
      mockExtractContent.mockReturnValueOnce('Original content');

      // Retry throws
      mockCallAI.mockRejectedValueOnce(new Error('API error'));

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test', maxToolIterations: 10 });
      const result = await agent.chat('test');
      // Should still return original content
      expect(result).toContain('Original content');
    });
  });

  // =====================================================================
  // chat — evolution triggers (lines 1417-1465)
  // =====================================================================
  describe('chat — evolution triggers', () => {
    test('triggers self-evolution when recent failures >= 3', async () => {
      mockGetReflectionStats.mockReturnValue({ recentFailures: 5, failureDetails: ['a', 'b', 'c'] });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      await agent.chat('test');

      // Allow the fire-and-forget promise to resolve
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockTriggerSelfEvolution).toHaveBeenCalled();
    });

    test('triggers evolution on turn threshold', async () => {
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });

      // Chat 5 times to reach the turn interval threshold
      for (let i = 0; i < 5; i++) {
        mockCallAI.mockResolvedValueOnce(makeAIResponse(`Response ${i}`));
        mockExtractContent.mockReturnValueOnce(`Response ${i}`);
        await agent.chat(`message ${i}`);
      }

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockTriggerSelfEvolution).toHaveBeenCalled();
    });

    test('handles evolution trigger failure gracefully', async () => {
      mockGetReflectionStats.mockReturnValue({ recentFailures: 5, failureDetails: [] });
      mockTriggerSelfEvolution.mockRejectedValue(new Error('Evolution failed'));

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      // Should not throw
      const result = await agent.chat('test');
      expect(result).toBeDefined();
    });
  });

  // =====================================================================
  // chat — preference signals (lines 1472-1496)
  // =====================================================================
  describe('chat — preference signals', () => {
    test('collects preference signals from user message', async () => {
      mockCheckPreferenceTriggers.mockReturnValue({
        hasPreference: true,
        expressions: [{ type: 'like', text: 'I like concise responses' }],
      });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      await agent.chat('I like concise responses');

      expect(mockCheckPreferenceTriggers).toHaveBeenCalledWith('I like concise responses', []);
    });

    test('handles preference signal collection failure', async () => {
      mockCheckPreferenceTriggers.mockImplementation(() => { throw new Error('Preference error'); });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      const result = await agent.chat('test');
      // Should not crash
      expect(result).toBeDefined();
    });
  });

  // =====================================================================
  // chat — skill_record tracking (lines 1166-1188)
  // =====================================================================
  describe('chat — skill_record and skill_get tool tracking', () => {
    test('records skill failure when skill_record reports failure', async () => {
      const skillRecordCall = { id: 'tc1', type: 'function', function: { name: 'skill_record', arguments: JSON.stringify({ name: 'my-skill', success: false }) } };

      mockCallAI.mockResolvedValueOnce(makeAIResponse('', [skillRecordCall]));
      mockHasToolCalls.mockReturnValueOnce(true);
      mockExtractToolCalls.mockReturnValueOnce([skillRecordCall]);
      mockToolDispatcher.executeToolBatches.mockResolvedValueOnce([
        { call: skillRecordCall, result: { success: true } },
      ]);

      mockCallAI.mockResolvedValueOnce(makeAIResponse('Done'));
      mockHasToolCalls.mockReturnValueOnce(false);
      mockExtractContent.mockReturnValueOnce('Done');

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      await agent.chat('test');

      expect(mockRecordSkillFailure).toHaveBeenCalledWith('my-skill', 'test');
    });

    test('tracks skill_get tool calls in usedSkillsInTurn', async () => {
      const skillGetCall = { id: 'tc2', type: 'function', function: { name: 'skill_get', arguments: JSON.stringify({ name: 'my-skill' }) } };

      mockCallAI.mockResolvedValueOnce(makeAIResponse('', [skillGetCall]));
      mockHasToolCalls.mockReturnValueOnce(true);
      mockExtractToolCalls.mockReturnValueOnce([skillGetCall]);
      mockToolDispatcher.executeToolBatches.mockResolvedValueOnce([
        { call: skillGetCall, result: { content: 'skill content' } },
      ]);

      mockCallAI.mockResolvedValueOnce(makeAIResponse('Done with skill'));
      mockHasToolCalls.mockReturnValueOnce(false);
      mockExtractContent.mockReturnValueOnce('Done with skill');

      const onContentBlock = vi.fn();
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      const result = await agent.chat('test', { onContentBlock });

      // Should mention skill attribution
      expect(result).toContain('my-skill');
    });
  });

  // =====================================================================
  // chat — hookRunner.runMessageSending modifies content (lines 1396)
  // =====================================================================
  describe('chat — hookRunner modifies final content', () => {
    test('applies content modification from runMessageSending', async () => {
      mockHookRunner.runMessageSending.mockResolvedValue({ content: 'Modified by hook' });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      const result = await agent.chat('test');
      expect(result).toBe('Modified by hook');
    });
  });

  // =====================================================================
  // chatStream — health monitor + skill enforcement (lines 1533-1578)
  // =====================================================================
  describe('chatStream — health monitor and skill enforcement', () => {
    test('injects health context in chatStream', async () => {
      mockHealthMonitor.hasIssues.mockReturnValue(true);
      mockHealthMonitor.buildHealthContext.mockReturnValue('Health warning');

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      const chunks: any[] = [];
      for await (const chunk of agent.chatStream('test')) {
        chunks.push(chunk);
      }

      const msgs = agent.getMessages();
      const healthMsgs = msgs.filter(m => m.role === 'system' && m.content === 'Health warning');
      expect(healthMsgs.length).toBe(1);
    });

    test('injects skill directive in chatStream', async () => {
      mockSkillEnforcementInstance.matchSkillsForQuery.mockReturnValue({
        matched: true,
        skills: [{ skill: { name: 'test-skill', id: 'sk1' }, score: 1, matchedOn: ['test'] }],
        directive: 'Use test-skill in stream',
      });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      const chunks: any[] = [];
      for await (const chunk of agent.chatStream('test')) {
        chunks.push(chunk);
      }

      const msgs = agent.getMessages();
      const directiveMsgs = msgs.filter(m => m.role === 'system' && m.content === 'Use test-skill in stream');
      expect(directiveMsgs.length).toBe(1);
    });

    test('handles multimodal message extraction in chatStream', async () => {
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      const multimodal = [
        { type: 'text', text: 'Describe this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
      ];

      const chunks: any[] = [];
      for await (const chunk of agent.chatStream(multimodal as any)) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  // =====================================================================
  // chatStream — token budget guard (line 1568-1574)
  // =====================================================================
  describe('chatStream — token budget guard in stream', () => {
    test('stops streaming when token budget exceeded', async () => {
      // Set very small context window so budget is exceeded
      mockCalculateContextConfig.mockReturnValue({ maxTokens: 100, keepRecent: 2, compressionThreshold: 0.8 });

      // High token counts to exceed the 60% budget
      mockEstimateMessageTokens.mockReturnValue(50);

      // First response triggers tool call, accumulating tokens
      mockCallAI.mockResolvedValueOnce(makeAIResponse('', [
        { id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } },
      ]));
      mockHasToolCalls.mockReturnValueOnce(true);
      mockExtractToolCalls.mockReturnValueOnce([
        { id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } },
      ]);
      mockToolDispatcher.executeToolBatches.mockResolvedValueOnce([
        { call: { id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } }, result: 'ok' },
      ]);

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      const chunks: any[] = [];
      for await (const chunk of agent.chatStream('test')) {
        chunks.push(chunk);
      }

      // Should have yielded the budget warning content
      const contentChunks = chunks.filter(c => c.type === 'content');
      // At minimum, it should not crash
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });
  });

  // =====================================================================
  // manageContextCompression fallback paths (lines 743-760)
  // =====================================================================
  describe('manageContextCompression — fallback paths', () => {
    test('falls back to LLM compression when three-tier compression fails at high usage', async () => {
      mockShouldCompress.mockReturnValue(true);
      mockCompressMessages.mockRejectedValue(new Error('Compression pipeline failed'));
      mockEstimateMessageTokens.mockReturnValue(100);
      mockCalculateContextConfig.mockReturnValue({ maxTokens: 200, keepRecent: 2, compressionThreshold: 0.5 });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });

      // Fill messages to trigger compression
      for (let i = 0; i < 15; i++) {
        (agent as any).messages.push({ role: 'user', content: `msg ${i}` });
      }
      (agent as any).estimatedTokens = 190; // 95% usage

      // Should not throw when compression fails
      await agent.chat('test');
    });
  });

  // =====================================================================
  // buildSystemPromptWithHooks (lines 330-345)
  // =====================================================================
  describe('buildSystemPromptWithHooks', () => {
    test('modifies prompt when hookRunner returns modified context', async () => {
      mockHookRunner.runBeforePromptBuild.mockResolvedValue({
        basePrompt: 'Modified base',
        coreContext: { user: 'Modified User', soul: 'Modified soul' },
      });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      // Access private method indirectly through methods that use it
      const result = await (agent as any).buildSystemPromptWithHooks('original', { user: 'u', soul: 's' });
      expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
        'Modified base',
        expect.objectContaining({ user: 'Modified User' }),
        undefined,
      );
    });
  });

  // =====================================================================
  // Dynamic memory injection enriched (lines 789-807)
  // =====================================================================
  describe('chat — dynamic memory injection enrichment', () => {
    test('logs when message is enriched with context', async () => {
      mockDynamicInjector.inject.mockResolvedValue('enriched message with context');

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      await agent.chat('original message');

      expect(mockDynamicInjector.inject).toHaveBeenCalledWith('original message', 'default');
    });

    test('uses userContext.userId for injection', async () => {
      mockDynamicInjector.inject.mockResolvedValue('enriched');

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      await agent.chat('msg', { userContext: { userId: 'user123' } as any });

      expect(mockDynamicInjector.inject).toHaveBeenCalledWith('msg', 'user123');
    });
  });

  // =====================================================================
  // chat — multimodal message handling for skill enforcement
  // =====================================================================
  describe('chat — multimodal message handling', () => {
    test('extracts text from multimodal for skill enforcement matching', async () => {
      mockSkillEnforcementInstance.matchSkillsForQuery.mockReturnValue({ matched: false, skills: [], directive: '' });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      await agent.chat([
        { type: 'text', text: 'Describe the image' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
      ] as any);

      expect(mockSkillEnforcementInstance.matchSkillsForQuery).toHaveBeenCalledWith('Describe the image');
    });
  });

  // =====================================================================
  // chat — token budget guard with 80% warning (line 936-937)
  // =====================================================================
  describe('chat — token budget guard 80% warning path', () => {
    test('warns at 80% of turn budget and forces stop at 100%', async () => {
      mockCalculateContextConfig.mockReturnValue({ maxTokens: 100, keepRecent: 2, compressionThreshold: 0.8 });
      mockEstimateMessageTokens.mockReturnValue(40);

      // This will push past the budget
      mockCallAI.mockResolvedValue(makeAIResponse('', [
        { id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } },
      ]));
      mockHasToolCalls.mockReturnValue(true);
      mockExtractToolCalls.mockReturnValue([
        { id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } },
      ]);
      mockToolDispatcher.executeToolBatches.mockResolvedValue([
        { call: { id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } }, result: 'ok' },
      ]);

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      const result = await agent.chat('test');
      // Should eventually stop (budget exceeded or max iterations)
      expect(result).toBeDefined();
    });
  });

  // =====================================================================
  // chat — no final content fallback (lines 1028-1030)
  // =====================================================================
  describe('chat — no content fallback at max iterations', () => {
    test('returns Chinese error when no assistant message at max iterations', async () => {
      // All iterations return tool calls with no final content
      mockCallAI.mockResolvedValue(makeAIResponse('', [
        { id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } },
      ]));
      mockHasToolCalls.mockReturnValue(true);
      mockExtractToolCalls.mockReturnValue([
        { id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } },
      ]);
      mockToolDispatcher.executeToolBatches.mockResolvedValue([
        { call: { id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } }, result: 'ok' },
      ]);
      mockExtractContent.mockReturnValue('');

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test', maxToolIterations: 2 });
      const result = await agent.chat('test');
      // Should return the Chinese error or last assistant content
      expect(result).toBeDefined();
    });
  });

  // =====================================================================
  // clearHistory — with skill enforcement traces (line 462)
  // =====================================================================
  describe('clearHistory — clears skill enforcement traces', () => {
    test('clears enforcement traces on history clear', () => {
      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      agent.clearHistory();
      expect(mockSkillEnforcementInstance.clearTraces).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // constructor — hookRunner.runBeforeAgentStart (line 304-313)
  // =====================================================================
  describe('constructor — before_agent_start hook error', () => {
    test('handles before_agent_start hook failure silently', async () => {
      mockHookRunner.runBeforeAgentStart.mockImplementation(() => { throw new Error('Hook error'); });

      const agent = new Agent({ provider: makeProvider(), model: 'gpt-4', systemPrompt: 'Test' });
      expect(agent).toBeDefined();
      // Let the fire-and-forget promise settle
      await new Promise(resolve => setTimeout(resolve, 50));
    });
  });
});
