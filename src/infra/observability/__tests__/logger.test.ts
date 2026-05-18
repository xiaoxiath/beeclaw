/**
 * Logger behavior tests — uses a memory destination stream so we assert
 * on the actual JSON-line pino emits rather than mocking console.{info,...}
 * (pino doesn't go through console at all).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  logger,
  getLogger,
  setLoggerDestination,
  type LoggerConfig,
} from '../logger';

function memDestination() {
  const lines: string[] = [];
  return {
    stream: { write: (chunk: string) => { lines.push(chunk.trimEnd()); } } as any,
    lines,
    parsed(): any[] {
      return lines.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    },
    clear(): void { lines.length = 0; },
  };
}

describe('Logger — configure', () => {
  let mem: ReturnType<typeof memDestination>;

  beforeEach(() => {
    mem = memDestination();
    logger.configure({ level: 'info', format: 'json', namespaces: {} } as LoggerConfig);
    setLoggerDestination(mem.stream);
  });
  afterEach(() => {
    setLoggerDestination(undefined);
    logger.configure({ level: 'info', format: 'pretty', namespaces: {} } as LoggerConfig);
  });

  test('sets log level — debug enables debug output', () => {
    logger.configure({ level: 'debug' });
    logger.debug('a debug message');
    const parsed = mem.parsed();
    expect(parsed.length).toBe(1);
    expect(parsed[0].msg).toBe('a debug message');
  });

  test('JSON format produces parseable lines with level + time + msg', () => {
    logger.info('hello');
    const [line] = mem.parsed();
    expect(line.msg).toBe('hello');
    expect(line.level).toBe(30); // pino: info=30
    expect(typeof line.time).toBe('string');
  });

  test('partial configuration updates only specified fields', () => {
    logger.configure({ level: 'warn' }); // namespaces stays empty, format stays json
    logger.info('hidden');
    logger.warn('shown');
    const parsed = mem.parsed();
    expect(parsed.length).toBe(1);
    expect(parsed[0].msg).toBe('shown');
  });
});

describe('Logger — level filtering', () => {
  let mem: ReturnType<typeof memDestination>;

  beforeEach(() => {
    mem = memDestination();
    logger.configure({ level: 'info', format: 'json', namespaces: {} } as LoggerConfig);
    setLoggerDestination(mem.stream);
  });
  afterEach(() => setLoggerDestination(undefined));

  test('info level filters out debug', () => {
    logger.debug('x'); logger.info('y'); logger.warn('z'); logger.error('w');
    const msgs = mem.parsed().map(l => l.msg);
    expect(msgs).toEqual(['y', 'z', 'w']);
  });

  test('warn level filters out debug and info', () => {
    logger.configure({ level: 'warn' });
    logger.debug('x'); logger.info('y'); logger.warn('z'); logger.error('w');
    const msgs = mem.parsed().map(l => l.msg);
    expect(msgs).toEqual(['z', 'w']);
  });

  test('error level only logs errors', () => {
    logger.configure({ level: 'error' });
    logger.debug('x'); logger.info('y'); logger.warn('z'); logger.error('w');
    const msgs = mem.parsed().map(l => l.msg);
    expect(msgs).toEqual(['w']);
  });
});

describe('Logger — log methods', () => {
  let mem: ReturnType<typeof memDestination>;

  beforeEach(() => {
    mem = memDestination();
    logger.configure({ level: 'debug', format: 'json', namespaces: {} } as LoggerConfig);
    setLoggerDestination(mem.stream);
  });
  afterEach(() => setLoggerDestination(undefined));

  test.each([
    ['debug', 20],
    ['info', 30],
    ['warn', 40],
    ['error', 50],
  ] as const)('%s logs at pino level %s', (method, expectedLevel) => {
    (logger as any)[method]('the message');
    const [line] = mem.parsed();
    expect(line.level).toBe(expectedLevel);
    expect(line.msg).toBe('the message');
  });

  test('single-object arg is lifted to top-level fields', () => {
    logger.info('config', { provider: 'openai', model: 'gpt-5.5' });
    const [line] = mem.parsed();
    expect(line.provider).toBe('openai');
    expect(line.model).toBe('gpt-5.5');
  });

  test('multi-arg lands under args[]', () => {
    logger.info('multi', 'second', 42, true);
    const [line] = mem.parsed();
    expect(line.args).toEqual(['second', 42, true]);
  });
});

describe('Logger — namespace levels', () => {
  let mem: ReturnType<typeof memDestination>;

  beforeEach(() => {
    mem = memDestination();
    logger.configure({
      level: 'warn',
      format: 'json',
      namespaces: { 'agent': 'info', 'memory.*': 'error' },
    });
    setLoggerDestination(mem.stream);
  });
  afterEach(() => {
    setLoggerDestination(undefined);
    logger.configure({ level: 'info', namespaces: {} });
  });

  test('namespaced logger uses per-ns override (info, looser than default warn)', () => {
    const log = getLogger('agent');
    log.info('agent info should appear');
    const parsed = mem.parsed();
    expect(parsed.length).toBe(1);
    expect(parsed[0].ns).toBe('agent');
    expect(parsed[0].msg).toBe('agent info should appear');
  });

  test('glob-matched ns uses override (error, stricter than default warn)', () => {
    const log = getLogger('memory.injector');
    log.warn('warn-level should be filtered');
    log.error('error-level passes');
    const msgs = mem.parsed().map(l => l.msg);
    expect(msgs).toEqual(['error-level passes']);
  });

  test('unmatched ns falls back to default level', () => {
    const log = getLogger('other.thing');
    log.info('info filtered by default warn');
    log.warn('warn passes');
    const msgs = mem.parsed().map(l => l.msg);
    expect(msgs).toEqual(['warn passes']);
  });

  test('exact match wins over glob', () => {
    logger.configure({
      level: 'warn',
      namespaces: { 'memory.injector': 'debug', 'memory.*': 'error' },
    });
    const log = getLogger('memory.injector');
    log.debug('exact match wins → debug passes');
    expect(mem.parsed().length).toBe(1);
  });
});

describe('Logger — child bindings', () => {
  let mem: ReturnType<typeof memDestination>;

  beforeEach(() => {
    mem = memDestination();
    logger.configure({ level: 'info', format: 'json', namespaces: {} });
    setLoggerDestination(mem.stream);
  });
  afterEach(() => setLoggerDestination(undefined));

  test('child() attaches bindings to every line', () => {
    const c = logger.child({ requestId: 'req-1', userId: 'u-7' });
    c.info('something happened');
    const [line] = mem.parsed();
    expect(line.requestId).toBe('req-1');
    expect(line.userId).toBe('u-7');
    expect(line.msg).toBe('something happened');
  });
});
