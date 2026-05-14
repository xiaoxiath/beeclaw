/**
 * CLI REPL — interactive chat loop.
 *
 * The CLI was non-functional before this PR (no input loop existed).
 * These tests cover the new loop's behavior with a fake InputHandler
 * that scripts a sequence of inputs and a fake Agent that yields
 * scripted streaming events. We don't need the real readline.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runRepl } from '../repl';

// ─── Test doubles ──────────────────────────────────────────────────────────

class FakeInput extends EventEmitter {
  private queue: (string | Error)[];
  constructor(inputs: (string | Error)[]) {
    super();
    this.queue = [...inputs];
  }
  async prompt(_query?: string): Promise<string> {
    const next = this.queue.shift();
    if (next === undefined) {
      // Mimics readline closing — runRepl should treat this as exit.
      throw new Error('input exhausted');
    }
    if (next instanceof Error) throw next;
    return next;
  }
}

type StreamEv =
  | { type: 'content'; content: string }
  | { type: 'tool_call'; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: unknown };

function makeAgent(scripts: Record<string, StreamEv[] | Error>): any {
  let cleared = 0;
  return {
    chatStream: vi.fn(async function* (msg: string): AsyncGenerator<StreamEv> {
      const ev = scripts[msg];
      if (ev instanceof Error) throw ev;
      if (!ev) {
        // Fallback: a single content event echoing the input.
        yield { type: 'content', content: `echo: ${msg}` };
        return;
      }
      for (const e of ev) yield e;
    }),
    clearHistory: vi.fn(() => { cleared++; }),
    _clearedCount: () => cleared,
  };
}

// Capture stdout writes per test for assertion.
let stdoutBuf: string[] = [];
let originalWrite: typeof process.stdout.write;

beforeEach(() => {
  stdoutBuf = [];
  originalWrite = process.stdout.write.bind(process.stdout);
  (process.stdout.write as any) = (chunk: any) => {
    stdoutBuf.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  };
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const out = () => stdoutBuf.join('');

// `afterEach` shorthand without import — we already imported describe/test/expect.
import { afterEach } from 'vitest';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('runRepl — slash commands', () => {
  test('/exit ends the loop and calls onExit', async () => {
    const onExit = vi.fn();
    const input = new FakeInput(['/exit']);
    const agent = makeAgent({});

    await runRepl({ agent, input: input as any, onExit });

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(out()).toContain('Goodbye');
    expect(agent.chatStream).not.toHaveBeenCalled();
  });

  test('/quit also ends the loop', async () => {
    const input = new FakeInput(['/quit']);
    const agent = makeAgent({});
    await runRepl({ agent, input: input as any });
    expect(agent.chatStream).not.toHaveBeenCalled();
  });

  test('/help prints command list and continues', async () => {
    const input = new FakeInput(['/help', '/exit']);
    const agent = makeAgent({});
    await runRepl({ agent, input: input as any });
    expect(out()).toContain('Available commands');
    expect(out()).toContain('/clear');
    expect(out()).toContain('/exit');
  });

  test('/clear calls agent.clearHistory and continues', async () => {
    const input = new FakeInput(['/clear', '/exit']);
    const agent = makeAgent({});
    await runRepl({ agent, input: input as any });
    expect(agent._clearedCount()).toBe(1);
    expect(out()).toContain('history cleared');
  });

  test('unknown /foo prints hint and does NOT send to chat', async () => {
    const input = new FakeInput(['/notacommand', '/exit']);
    const agent = makeAgent({});
    await runRepl({ agent, input: input as any });
    expect(out()).toContain('Unknown command');
    expect(agent.chatStream).not.toHaveBeenCalled();
  });

  test('empty input is skipped (no chatStream call)', async () => {
    const input = new FakeInput(['', '   ', '/exit']);
    const agent = makeAgent({});
    await runRepl({ agent, input: input as any });
    expect(agent.chatStream).not.toHaveBeenCalled();
  });
});

describe('runRepl — chat turns', () => {
  test('plain text → calls chatStream and writes content tokens', async () => {
    const input = new FakeInput(['hello', '/exit']);
    const agent = makeAgent({
      hello: [
        { type: 'content', content: 'Hi ' },
        { type: 'content', content: 'there!' },
      ],
    });

    await runRepl({ agent, input: input as any });

    expect(agent.chatStream).toHaveBeenCalledWith('hello');
    expect(out()).toContain('Hi there!');
  });

  test('tool_call event prints inline marker', async () => {
    const input = new FakeInput(['search foo', '/exit']);
    const agent = makeAgent({
      'search foo': [
        { type: 'content', content: 'Looking up...' },
        { type: 'tool_call', name: 'web_search', params: { q: 'foo' } },
        { type: 'content', content: 'Done.' },
      ],
    });

    await runRepl({ agent, input: input as any });

    expect(out()).toContain('[tool] web_search');
    expect(out()).toContain('"q":"foo"');
    expect(out()).toContain('Done.');
  });

  test('tool_result events are NOT printed (would be too noisy)', async () => {
    const input = new FakeInput(['x', '/exit']);
    const agent = makeAgent({
      x: [
        { type: 'tool_call', name: 't', params: {} },
        { type: 'tool_result', name: 't', result: 'huge result text 1234567890' },
        { type: 'content', content: 'summary' },
      ],
    });

    await runRepl({ agent, input: input as any });

    expect(out()).not.toContain('huge result text');
    expect(out()).toContain('[tool] t');
    expect(out()).toContain('summary');
  });

  test('chatStream throwing → prints red error marker, loop continues', async () => {
    const input = new FakeInput(['boom', 'recovered', '/exit']);
    const agent = makeAgent({
      boom: new Error('LLM failed'),
      recovered: [{ type: 'content', content: 'ok now' }],
    });

    await runRepl({ agent, input: input as any });

    expect(out()).toContain('[error] LLM failed');
    expect(out()).toContain('ok now'); // loop continued and processed next turn
  });

  test('long tool params get truncated in the inline marker', async () => {
    const longVal = 'x'.repeat(200);
    const input = new FakeInput(['cmd', '/exit']);
    const agent = makeAgent({
      cmd: [
        { type: 'tool_call', name: 'big', params: { val: longVal } },
      ],
    });

    await runRepl({ agent, input: input as any });

    // Truncation marker
    expect(out()).toContain('[tool] big');
    expect(out()).toContain('...');
    // Full long value should NOT appear
    expect(out()).not.toContain(longVal);
  });
});

describe('runRepl — input close', () => {
  test('exhausted input (readline close) exits cleanly', async () => {
    const input = new FakeInput([]); // empty — first prompt() throws
    const agent = makeAgent({});
    await runRepl({ agent, input: input as any });
    expect(out()).toContain('Goodbye');
  });
});
