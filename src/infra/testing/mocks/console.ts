/**
 * Mock Console Utility
 *
 * Provides mock console methods for testing log output
 */

export interface ConsoleCall {
  method: string;
  args: unknown[];
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'table' | 'group' | 'groupEnd' | 'time' | 'timeEnd' | 'assert' | 'clear' | 'count' | 'countReset' | 'dir' | 'dirxml';

let calls: ConsoleCall[] = [];
let originalConsole: Record<string, (...args: unknown[]) => void> | null = null;
let mutedMethods: Set<string> = new Set();

/**
 * Create a mock console method
 */
function createMockMethod(method: string): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    calls.push({ method, args });
    // Optionally still output to original console (useful for debugging)
    if (!mutedMethods.has(method) && originalConsole) {
      const original = originalConsole[method];
      if (original) original(...args);
    }
  };
}

/**
 * Set up mock console
 * @param methods Methods to mock (default: all)
 * @param mute Whether to suppress output (default: true)
 */
export function setupMockConsole(
  methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug'],
  mute: boolean = true
): void {
  calls = [];
  originalConsole = {};
  mutedMethods = mute ? new Set(methods) : new Set();

  for (const method of methods) {
    originalConsole[method] = (console as unknown as Record<string, (...args: unknown[]) => void>)[method].bind(console);
    (console as unknown as Record<string, unknown>)[method] = createMockMethod(method);
  }
}

/**
 * Restore original console
 */
export function restoreConsole(): void {
  if (originalConsole) {
    for (const key of Object.keys(originalConsole)) {
      (console as unknown as Record<string, unknown>)[key] = originalConsole[key];
    }
    originalConsole = null;
  }
  calls = [];
  mutedMethods.clear();
}

/**
 * Get all recorded console calls
 */
export function getConsoleCalls(): ConsoleCall[] {
  return [...calls];
}

/**
 * Get calls for a specific method
 */
export function getConsoleCallsFor(method: ConsoleMethod): ConsoleCall[] {
  return calls.filter(call => call.method === method);
}

/**
 * Clear recorded calls
 */
export function clearConsoleCalls(): void {
  calls = [];
}

/**
 * Check if a specific message was logged
 */
export function consoleCalledWith(method: ConsoleMethod, ...expectedArgs: unknown[]): boolean {
  return calls.some(call =>
    call.method === method &&
    expectedArgs.every((arg, i) => {
      const actual = call.args[i];
      if (typeof arg === 'string' && typeof actual === 'string') {
        return actual.includes(arg);
      }
      return actual === arg;
    })
  );
}

/**
 * Get all logged messages as strings
 */
export function getConsoleMessages(method?: ConsoleMethod): string[] {
  const filteredCalls = method ? calls.filter(c => c.method === method) : calls;
  return filteredCalls.map(call =>
    call.args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ')
  );
}

/**
 * Create a console interceptor that passes through to original
 */
export function interceptConsole(
  onCall: (call: ConsoleCall) => void,
  methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug']
): void {
  originalConsole = {};

  for (const method of methods) {
    const original = (console as unknown as Record<string, (...args: unknown[]) => void>)[method].bind(console);
    originalConsole[method] = original;
    (console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      const call: ConsoleCall = { method, args };
      onCall(call);
      calls.push(call);
      original(...args);
    };
  }
}
