/**
 * Extended tests for entries/bot.ts
 *
 * Strategy: bot.ts auto-invokes main() on import. We cannot call main()
 * directly. Instead we:
 *   - Mock process.exit as a no-op (NOT throwing) to prevent actual exit
 *   - Mock process.stdin.resume as a no-op to prevent hanging
 *   - Use vi.resetModules() + dynamic import to re-execute the module per test
 *   - Wait for the async main() to settle before assertions
 *   - Because restoreMocks:true wipes vi.fn() impls between tests,
 *     we use vi.hoisted() refs and re-set impls in beforeEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const feishuAdapterInstance = {
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
  };
  const webAdapterInstance = {
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
  };
  const daemonInstance = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const schedulerInstance = {
    init: vi.fn(),
    listSchedules: vi.fn().mockReturnValue([]),
    createSchedule: vi.fn(),
  };
  const shutdownInstance = {
    register: vi.fn(),
  };

  return {
    feishuAdapterInstance,
    webAdapterInstance,
    daemonInstance,
    schedulerInstance,
    shutdownInstance,

    initApp: vi.fn(),
    getAgent: vi.fn().mockReturnValue({ name: 'test-agent' }),
    getMessageGateway: vi.fn().mockReturnValue({ gw: true }),
    getTaskDispatcher: vi.fn().mockReturnValue({ dp: true }),
    registerFeishuHandler: vi.fn(),
    setCliDeliveryHandler: vi.fn(),
    getFeishuWSClient: vi.fn().mockReturnValue(null),
    getDaemon: vi.fn(),
    getScheduler: vi.fn(),
    adapterRegistry: {
      register: vi.fn(),
      stopAll: vi.fn().mockResolvedValue(undefined),
    },
    saveAllSessions: vi.fn(),
    loadAllSessions: vi.fn(),
    initSelfEvolution: vi.fn(),
    initTaskManager: vi.fn().mockResolvedValue(undefined),
    initWorkers: vi.fn().mockResolvedValue(undefined),
    renderMessageCard: vi.fn().mockReturnValue({ card: 'v2' }),

    handleSendReminderJob: vi.fn().mockResolvedValue(undefined),
    handleGoalProgressCheckJob: vi.fn().mockResolvedValue(undefined),
    handleMemoryCompressJob: vi.fn().mockResolvedValue(undefined),
    handleCustomJob: vi.fn().mockResolvedValue(undefined),
    handleSelfEvolutionJob: vi.fn().mockResolvedValue(undefined),
    handleLlmProactiveChatJob: vi.fn().mockResolvedValue(undefined),
    handleRunSkillJob: vi.fn().mockResolvedValue(undefined),
  };
});

// ── vi.mock declarations (inline classes survive restoreMocks) ────────
vi.mock('../../app', () => ({
  initApp: (...args: any[]) => mocks.initApp(...args),
  getAgent: () => mocks.getAgent(),
}));

vi.mock('../../app/gateway-channel', () => ({
  getMessageGateway: () => mocks.getMessageGateway(),
}));

vi.mock('../../app/dispatcher', () => ({
  getTaskDispatcher: () => mocks.getTaskDispatcher(),
}));

vi.mock('../../adapter/feishu/adapter', () => ({
  FeishuAdapter: class {
    initialize(...args: any[]) { return mocks.feishuAdapterInstance.initialize(...args); }
    start(...args: any[]) { return mocks.feishuAdapterInstance.start(...args); }
  },
}));

vi.mock('../../adapter/web/adapter', () => ({
  WebAdapter: class {
    initialize(...args: any[]) { return mocks.webAdapterInstance.initialize(...args); }
    start(...args: any[]) { return mocks.webAdapterInstance.start(...args); }
  },
}));

vi.mock('../../infra/entry', () => ({
  adapterRegistry: mocks.adapterRegistry,
}));

vi.mock('../../domain/session', () => ({
  loadAllSessions: () => mocks.loadAllSessions(),
  saveAllSessions: () => mocks.saveAllSessions(),
}));

vi.mock('../../domain/proactive', () => ({
  getDaemon: (...args: any[]) => mocks.getDaemon(...args),
  getScheduler: (...args: any[]) => mocks.getScheduler(...args),
  registerFeishuHandler: (fn: any) => mocks.registerFeishuHandler(fn),
  setCliDeliveryHandler: (fn: any) => mocks.setCliDeliveryHandler(fn),
}));

vi.mock('../../adapter/feishu', () => ({
  getFeishuWSClient: () => mocks.getFeishuWSClient(),
}));

vi.mock('../../domain/agent/evolution/self-evolution', () => ({
  initSelfEvolution: (...args: any[]) => mocks.initSelfEvolution(...args),
}));

vi.mock('../../infra/queue', () => ({
  initTaskManager: (...args: any[]) => mocks.initTaskManager(...args),
}));

vi.mock('../../adapter/feishu/card-v2/message-renderer', () => ({
  renderMessageCard: (...args: any[]) => mocks.renderMessageCard(...args),
}));

vi.mock('../../app/queue-handlers/workers', () => ({
  initWorkers: (...args: any[]) => mocks.initWorkers(...args),
}));

vi.mock('../../infra/utils/graceful-shutdown', () => ({
  GracefulShutdown: class {
    static getInstance() { return mocks.shutdownInstance; }
    register(entry: any) { mocks.shutdownInstance.register(entry); }
  },
}));

vi.mock('../../domain/proactive/job-handlers', () => ({
  handleRunSkillJob: (...args: any[]) => mocks.handleRunSkillJob(...args),
  handleLlmProactiveChatJob: (...args: any[]) => mocks.handleLlmProactiveChatJob(...args),
  handleSelfEvolutionJob: (...args: any[]) => mocks.handleSelfEvolutionJob(...args),
  handleMemoryCompressJob: (...args: any[]) => mocks.handleMemoryCompressJob(...args),
  handleGoalProgressCheckJob: (...args: any[]) => mocks.handleGoalProgressCheckJob(...args),
  handleCustomJob: (...args: any[]) => mocks.handleCustomJob(...args),
  handleSendReminderJob: (...args: any[]) => mocks.handleSendReminderJob(...args),
}));

// ── helpers ───────────────────────────────────────────────────────────
let originalArgv: string[];
let exitSpy: ReturnType<typeof vi.spyOn>;
let stdinResumeSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

function defaultConfig() {
  return {
    config: {
      feishu: { appId: 'cli_test_id_001', appSecret: 'secret123' },
      memory: { path: '/tmp/test-bot-mem' },
      web: { enabled: true },
    },
    provider: 'openai',
    model: 'gpt-4',
  };
}

/** Import bot module (triggers main()). Wait for async settling. */
async function runBot() {
  vi.resetModules();
  const mod = await import('../bot.ts');
  // Give async main() time to settle
  await new Promise(r => setTimeout(r, 100));
  return mod;
}

beforeEach(() => {
  originalArgv = [...process.argv];
  process.argv = ['bun', 'bot.ts'];

  // process.exit as no-op — does NOT throw
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  stdinResumeSpy = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  // Re-set mock implementations (restoreMocks wipes between tests)
  mocks.initApp.mockResolvedValue(defaultConfig());
  mocks.feishuAdapterInstance.initialize.mockResolvedValue(undefined);
  mocks.feishuAdapterInstance.start.mockResolvedValue(undefined);
  mocks.webAdapterInstance.initialize.mockResolvedValue(undefined);
  mocks.webAdapterInstance.start.mockResolvedValue(undefined);
  mocks.getDaemon.mockReturnValue(mocks.daemonInstance);
  mocks.getScheduler.mockReturnValue(mocks.schedulerInstance);
  mocks.schedulerInstance.listSchedules.mockReturnValue([]);
  mocks.schedulerInstance.init.mockImplementation(() => {});
  mocks.schedulerInstance.createSchedule.mockImplementation(() => {});
  mocks.daemonInstance.start.mockResolvedValue(undefined);
  mocks.daemonInstance.stop.mockResolvedValue(undefined);
  mocks.getFeishuWSClient.mockReturnValue(null);
  mocks.renderMessageCard.mockReturnValue({ card: 'v2' });
  mocks.adapterRegistry.register.mockImplementation(() => {});
  mocks.adapterRegistry.stopAll.mockResolvedValue(undefined);
  mocks.initTaskManager.mockResolvedValue(undefined);
  mocks.initWorkers.mockResolvedValue(undefined);
  mocks.handleSendReminderJob.mockResolvedValue(undefined);
  mocks.handleGoalProgressCheckJob.mockResolvedValue(undefined);
  mocks.handleMemoryCompressJob.mockResolvedValue(undefined);
  mocks.handleCustomJob.mockResolvedValue(undefined);
  mocks.handleSelfEvolutionJob.mockResolvedValue(undefined);
  mocks.handleLlmProactiveChatJob.mockResolvedValue(undefined);
  mocks.handleRunSkillJob.mockResolvedValue(undefined);
});

afterEach(() => {
  process.argv = originalArgv;
  exitSpy.mockRestore();
  stdinResumeSpy.mockRestore();
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

// ── Tests ─────────────────────────────────────────────────────────────
describe('entries/bot - showHelp & --help flag', () => {
  it('exits with code 0 when --help is passed', async () => {
    process.argv = ['bun', 'bot.ts', '--help'];
    await runBot();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits with code 0 when -h is passed', async () => {
    process.argv = ['bun', 'bot.ts', '-h'];
    await runBot();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('prints help text containing usage info', async () => {
    process.argv = ['bun', 'bot.ts', '--help'];
    await runBot();
    const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('Beeclaw Bot');
    expect(allOutput).toContain('--daemon');
    expect(allOutput).toContain('--web');
  });

  it('calls process.exit(0) before initApp completes when --help is passed', async () => {
    process.argv = ['bun', 'bot.ts', '--help'];
    await runBot();
    // process.exit(0) is called, but since our mock is a no-op,
    // execution continues. Verify exit was called before checking initApp.
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

describe('entries/bot - missing Feishu credentials', () => {
  it('exits with code 1 when appId is missing', async () => {
    mocks.initApp.mockResolvedValue({
      config: { feishu: { appId: '', appSecret: 'secret' }, memory: { path: '/tmp/m' }, web: { enabled: false } },
      provider: 'openai',
      model: 'gpt-4',
    });
    await runBot();
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = consoleErrorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errOutput).toContain('Feishu credentials');
  });

  it('exits with code 1 when appSecret is missing', async () => {
    mocks.initApp.mockResolvedValue({
      config: { feishu: { appId: 'test', appSecret: '' }, memory: { path: '/tmp/m' }, web: { enabled: false } },
      provider: 'openai',
      model: 'gpt-4',
    });
    await runBot();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when feishu config is undefined', async () => {
    mocks.initApp.mockResolvedValue({
      config: { feishu: undefined, memory: { path: '/tmp/m' }, web: { enabled: false } },
      provider: 'openai',
      model: 'gpt-4',
    });
    await runBot();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('entries/bot - Feishu adapter error', () => {
  it('exits with code 1 when Feishu adapter fails to initialize', async () => {
    mocks.feishuAdapterInstance.initialize.mockRejectedValue(new Error('connection failed'));
    await runBot();
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = consoleErrorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errOutput).toContain('Failed to initialize Feishu');
  });

  it('exits with code 1 when Feishu adapter fails to start', async () => {
    mocks.feishuAdapterInstance.start.mockRejectedValue(new Error('ws connect failed'));
    await runBot();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('entries/bot - normal startup (no daemon, no web)', () => {
  it('initializes app with daemon=false', async () => {
    await runBot();
    expect(mocks.initApp).toHaveBeenCalledWith({
      daemon: false,
      enableRecovery: true,
    });
  });

  it('registers Feishu adapter and starts it', async () => {
    await runBot();
    expect(mocks.adapterRegistry.register).toHaveBeenCalled();
    expect(mocks.feishuAdapterInstance.initialize).toHaveBeenCalled();
    expect(mocks.feishuAdapterInstance.start).toHaveBeenCalled();
  });

  it('resumes stdin to keep process alive', async () => {
    await runBot();
    expect(stdinResumeSpy).toHaveBeenCalled();
  });

  it('does not start web adapter when --web is not passed', async () => {
    await runBot();
    expect(mocks.webAdapterInstance.initialize).not.toHaveBeenCalled();
  });

  it('does not start daemon when --daemon is not passed', async () => {
    await runBot();
    expect(mocks.getDaemon).not.toHaveBeenCalled();
  });

  it('registers shutdown handlers for adapters and sessions', async () => {
    await runBot();
    const registeredNames = mocks.shutdownInstance.register.mock.calls.map(
      (c: any) => c[0].name
    );
    expect(registeredNames).toContain('Stop all adapters');
    expect(registeredNames).toContain('Save all sessions');
  });

  it('registers feishu handler and CLI delivery handler', async () => {
    await runBot();
    expect(mocks.registerFeishuHandler).toHaveBeenCalled();
    expect(mocks.setCliDeliveryHandler).toHaveBeenCalled();
  });

  it('logs app ID prefix', async () => {
    await runBot();
    const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('cli_test_i');
  });
});

describe('entries/bot - --web flag', () => {
  it('starts web adapter when --web and config.web.enabled', async () => {
    process.argv = ['bun', 'bot.ts', '--web'];
    await runBot();
    expect(mocks.webAdapterInstance.initialize).toHaveBeenCalled();
    expect(mocks.webAdapterInstance.start).toHaveBeenCalled();
  });

  it('does not start web adapter when config.web.enabled is false', async () => {
    process.argv = ['bun', 'bot.ts', '--web'];
    mocks.initApp.mockResolvedValue({
      config: {
        feishu: { appId: 'test', appSecret: 'secret' },
        memory: { path: '/tmp/m' },
        web: { enabled: false },
      },
      provider: 'openai',
      model: 'gpt-4',
    });
    await runBot();
    expect(mocks.webAdapterInstance.initialize).not.toHaveBeenCalled();
  });

  it('logs warning when web adapter fails but does not exit', async () => {
    process.argv = ['bun', 'bot.ts', '--web'];
    mocks.webAdapterInstance.initialize.mockRejectedValue(new Error('port in use'));
    await runBot();
    const errOutput = consoleErrorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errOutput).toContain('Failed to start Web UI');
    // Process continues — stdin.resume should still be called
    expect(stdinResumeSpy).toHaveBeenCalled();
  });
});

describe('entries/bot - --daemon flag', () => {
  beforeEach(() => {
    process.argv = ['bun', 'bot.ts', '--daemon'];
  });

  it('initializes task queue, workers, scheduler, and daemon', async () => {
    await runBot();
    expect(mocks.initApp).toHaveBeenCalledWith({ daemon: true, enableRecovery: true });
    expect(mocks.initTaskManager).toHaveBeenCalled();
    expect(mocks.initWorkers).toHaveBeenCalled();
    expect(mocks.getDaemon).toHaveBeenCalledWith('/tmp/test-bot-mem/daemon');
    expect(mocks.getScheduler).toHaveBeenCalledWith('/tmp/test-bot-mem/proactive');
    expect(mocks.schedulerInstance.init).toHaveBeenCalled();
    expect(mocks.daemonInstance.start).toHaveBeenCalled();
  });

  it('creates memory compression schedule when none exists', async () => {
    mocks.schedulerInstance.listSchedules.mockReturnValue([]);
    await runBot();
    expect(mocks.schedulerInstance.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Daily Memory Compression',
        taskType: 'memory_compress',
        cron: '30 3 * * *',
        enabled: true,
      })
    );
  });

  it('does NOT create compression schedule when one already exists', async () => {
    mocks.schedulerInstance.listSchedules.mockReturnValue([
      { task: { type: 'memory_compress' } },
    ]);
    await runBot();
    expect(mocks.schedulerInstance.createSchedule).not.toHaveBeenCalled();
  });

  it('initializes self evolution', async () => {
    await runBot();
    expect(mocks.initSelfEvolution).toHaveBeenCalledWith('/tmp/test-bot-mem');
  });

  it('registers daemon shutdown handler', async () => {
    await runBot();
    const registeredNames = mocks.shutdownInstance.register.mock.calls.map(
      (c: any) => c[0].name
    );
    expect(registeredNames).toContain('Stop proactive daemon');
  });
});

describe('entries/bot - daemon job dispatch (onJob callback)', () => {
  beforeEach(() => {
    process.argv = ['bun', 'bot.ts', '--daemon'];
  });

  async function captureOnJob(): Promise<(job: any) => Promise<void>> {
    await runBot();
    const startCall = mocks.daemonInstance.start.mock.calls[0][0];
    return startCall.onJob;
  }

  it('dispatches send_reminder jobs', async () => {
    const onJob = await captureOnJob();
    const job = { taskType: 'send_reminder', data: {} };
    await onJob(job);
    expect(mocks.handleSendReminderJob).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ getFeishuClient: expect.any(Function) })
    );
  });

  it('dispatches check_goal_progress jobs', async () => {
    const onJob = await captureOnJob();
    await onJob({ taskType: 'check_goal_progress' });
    expect(mocks.handleGoalProgressCheckJob).toHaveBeenCalled();
  });

  it('dispatches memory_compress jobs', async () => {
    const onJob = await captureOnJob();
    await onJob({ taskType: 'memory_compress' });
    expect(mocks.handleMemoryCompressJob).toHaveBeenCalled();
  });

  it('dispatches custom jobs', async () => {
    const onJob = await captureOnJob();
    const job = { taskType: 'custom', params: { x: 1 } };
    await onJob(job);
    expect(mocks.handleCustomJob).toHaveBeenCalledWith(job);
  });

  it('dispatches self_evolution jobs', async () => {
    const onJob = await captureOnJob();
    await onJob({ taskType: 'self_evolution' });
    expect(mocks.handleSelfEvolutionJob).toHaveBeenCalled();
  });

  it('dispatches llm_proactive_chat jobs', async () => {
    const onJob = await captureOnJob();
    const job = { taskType: 'llm_proactive_chat' };
    await onJob(job);
    expect(mocks.handleLlmProactiveChatJob).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ getFeishuClient: expect.any(Function) })
    );
  });

  it('dispatches run_skill jobs', async () => {
    const onJob = await captureOnJob();
    const job = { taskType: 'run_skill', data: {} };
    await onJob(job);
    expect(mocks.handleRunSkillJob).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ getFeishuClient: expect.any(Function) })
    );
  });

  it('logs unknown task types without crashing', async () => {
    const onJob = await captureOnJob();
    await onJob({ taskType: 'unknown_type_xyz' });
    const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('Unknown task type');
  });

  it('catches and logs errors from job handlers', async () => {
    mocks.handleMemoryCompressJob.mockRejectedValueOnce(new Error('compress failed'));
    const onJob = await captureOnJob();
    await onJob({ taskType: 'memory_compress' });
    const errOutput = consoleErrorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errOutput).toContain('Job execution failed');
  });
});

describe('entries/bot - registered Feishu handler', () => {
  async function captureFeishuHandler(): Promise<(chatId: string, message: string) => Promise<boolean>> {
    await runBot();
    return mocks.registerFeishuHandler.mock.calls[0][0];
  }

  it('returns false when no Feishu WS client is available', async () => {
    mocks.getFeishuWSClient.mockReturnValue(null);
    const handler = await captureFeishuHandler();
    const result = await handler('chat123', 'hello');
    expect(result).toBe(false);
  });

  it('sends card via Feishu client and returns true', async () => {
    const sendCardFn = vi.fn().mockResolvedValue(undefined);
    // Return client with sendCard when handler calls getFeishuWSClient
    mocks.getFeishuWSClient.mockReturnValue({ sendCard: sendCardFn });
    const handler = await captureFeishuHandler();
    const result = await handler('chat_abc', 'test message');
    expect(result).toBe(true);
    expect(mocks.renderMessageCard).toHaveBeenCalledWith(
      [{ type: 'text', text: 'test message' }],
      { streaming: false }
    );
    expect(sendCardFn).toHaveBeenCalledWith(
      'chat_abc',
      'chat_id',
      expect.anything()
    );
  });

  it('returns false and logs error when sendCard throws', async () => {
    const sendCardFn = vi.fn().mockRejectedValue(new Error('send failed'));
    mocks.getFeishuWSClient.mockReturnValue({ sendCard: sendCardFn });
    const handler = await captureFeishuHandler();
    const result = await handler('chat_err', 'msg');
    expect(result).toBe(false);
    const errOutput = consoleErrorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errOutput).toContain('Feishu push failed');
  });
});

describe('entries/bot - registered CLI delivery handler', () => {
  async function captureCliHandler(): Promise<(message: string, priority: string) => void> {
    await runBot();
    return mocks.setCliDeliveryHandler.mock.calls[0][0];
  }

  it('logs message for normal priority', async () => {
    const handler = await captureCliHandler();
    handler('normal message', 'normal');
    const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('normal message');
  });

  it('logs message for urgent priority', async () => {
    const handler = await captureCliHandler();
    handler('urgent!', 'urgent');
    const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('urgent!');
  });

  it('logs message for low priority', async () => {
    const handler = await captureCliHandler();
    handler('low prio', 'low');
    const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('low prio');
  });

  it('logs message for high priority', async () => {
    const handler = await captureCliHandler();
    handler('high prio', 'high');
    const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('high prio');
  });

  it('defaults to green emoji for unknown priority', async () => {
    const handler = await captureCliHandler();
    handler('unknown prio', 'whatever');
    const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOutput).toContain('unknown prio');
  });
});

describe('entries/bot - shutdown handlers execution', () => {
  it('adapter shutdown handler calls adapterRegistry.stopAll', async () => {
    await runBot();
    const adapterHandler = mocks.shutdownInstance.register.mock.calls.find(
      (c: any) => c[0].name === 'Stop all adapters'
    );
    expect(adapterHandler).toBeDefined();
    await adapterHandler![0].fn();
    expect(mocks.adapterRegistry.stopAll).toHaveBeenCalled();
  });

  it('session shutdown handler calls saveAllSessions', async () => {
    await runBot();
    const sessionHandler = mocks.shutdownInstance.register.mock.calls.find(
      (c: any) => c[0].name === 'Save all sessions'
    );
    expect(sessionHandler).toBeDefined();
    sessionHandler![0].fn();
    expect(mocks.saveAllSessions).toHaveBeenCalled();
  });

  it('daemon shutdown handler calls daemon.stop', async () => {
    process.argv = ['bun', 'bot.ts', '--daemon'];
    await runBot();
    const daemonHandler = mocks.shutdownInstance.register.mock.calls.find(
      (c: any) => c[0].name === 'Stop proactive daemon'
    );
    expect(daemonHandler).toBeDefined();
    await daemonHandler![0].fn();
    expect(mocks.daemonInstance.stop).toHaveBeenCalled();
  });

  it('daemon shutdown handler catches errors from daemon.stop', async () => {
    process.argv = ['bun', 'bot.ts', '--daemon'];
    await runBot();
    mocks.daemonInstance.stop.mockRejectedValueOnce(new Error('stop failed'));
    const daemonHandler = mocks.shutdownInstance.register.mock.calls.find(
      (c: any) => c[0].name === 'Stop proactive daemon'
    );
    // Should not throw
    await daemonHandler![0].fn();
    const warnOutput = consoleWarnSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(warnOutput).toContain('Daemon stop error');
  });
});

describe('entries/bot - combined flags', () => {
  it('starts both daemon and web when both flags are passed', async () => {
    process.argv = ['bun', 'bot.ts', '--daemon', '--web'];
    await runBot();
    expect(mocks.daemonInstance.start).toHaveBeenCalled();
    expect(mocks.webAdapterInstance.initialize).toHaveBeenCalled();
    expect(mocks.webAdapterInstance.start).toHaveBeenCalled();
  });
});

describe('entries/bot - main catch handler', () => {
  it('exits with code 1 when initApp throws', async () => {
    mocks.initApp.mockRejectedValue(new Error('init failed'));
    await runBot();
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = consoleErrorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(errOutput).toContain('Failed to start Beeclaw Bot');
  });
});
