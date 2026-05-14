/**
 * CLI REPL — interactive chat loop.
 *
 * Background: `bun run cli` previously launched the app, registered
 * the CLIAdapter (which only set running=true), then `await import`ed
 * a re-exports-only module and waited for SIGINT. There was no read
 * loop anywhere — the CLI was non-functional.
 *
 * This module provides the missing loop. It uses InputHandler for
 * line-buffered prompts (with paste detection + history) and consumes
 * agent.chatStream() so the user sees tokens appearing as they arrive
 * rather than blocking on the entire response.
 *
 * Slash commands implemented (more is a separate PR):
 *   /help       — list available commands
 *   /clear      — clear conversation history (keeps system prompt)
 *   /exit, /quit — leave the REPL gracefully
 */

import type { Agent } from '../../domain/agent';
import type { InputHandler } from './input';
import { logger } from '../../infra/observability/logger';

interface ReplOptions {
  agent: Agent;
  input: InputHandler;
  /** Called once when the loop is exiting normally (e.g. /exit). */
  onExit?: () => void | Promise<void>;
}

const HELP_TEXT = `
Available commands:
  /help        Show this message
  /clear       Clear conversation history (keeps system prompt)
  /exit, /quit Leave the REPL

Type anything else to chat with the assistant.
`.trim();

/** Format tool params compactly for the inline tool-call indicator. */
function formatToolParams(params: Record<string, unknown>): string {
  const json = JSON.stringify(params);
  return json.length > 120 ? json.slice(0, 117) + '...' : json;
}

/**
 * Handle a slash command. Returns:
 *   'exit'     — caller should break the loop
 *   true       — handled; caller should continue to next prompt
 *   false      — not a command; caller should treat input as chat
 */
function handleSlashCommand(
  input: string,
  agent: Agent,
): 'exit' | true | false {
  const cmd = input.trim().split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case '/help':
      process.stdout.write('\n' + HELP_TEXT + '\n\n');
      return true;
    case '/exit':
    case '/quit':
      return 'exit';
    case '/clear':
      agent.clearHistory();
      process.stdout.write('\n[history cleared]\n\n');
      return true;
    default:
      // Unknown command — print a hint, treat as no-op to avoid
      // accidentally sending "/foo" to the LLM.
      if (cmd.startsWith('/')) {
        process.stdout.write(`\nUnknown command: ${cmd}. Type /help for a list.\n\n`);
        return true;
      }
      return false;
  }
}

/**
 * Run the REPL. Blocks until the user issues /exit, /quit, or sends
 * SIGINT (which the InputHandler exposes via its `close` event).
 */
export async function runRepl(opts: ReplOptions): Promise<void> {
  const { agent, input, onExit } = opts;

  process.stdout.write('\nBeeclaw CLI — type /help for commands, /exit to quit\n\n');

  // SIGINT during await prompt() rejects the promise via readline; we
  // surface it as a clean exit rather than a stack trace.
  let exiting = false;

  while (!exiting) {
    let line: string;
    try {
      line = await input.prompt('> ');
    } catch (err) {
      // readline interface closed (Ctrl+D / Ctrl+C with default behavior).
      logger.debug('[REPL] prompt closed', { err: String(err) });
      break;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    const cmdResult = handleSlashCommand(trimmed, agent);
    if (cmdResult === 'exit') {
      exiting = true;
      break;
    }
    if (cmdResult === true) continue;

    // Real chat turn. Stream tokens as they arrive.
    process.stdout.write('\n');
    try {
      for await (const ev of agent.chatStream(trimmed)) {
        if (ev.type === 'content') {
          process.stdout.write(ev.content);
        } else if (ev.type === 'tool_call') {
          // Dim grey marker so it doesn't compete visually with the
          // assistant text. Newline before so we don't mid-line interrupt.
          process.stdout.write(
            `\n\x1B[90m[tool] ${ev.name} ${formatToolParams(ev.params)}\x1B[0m\n`,
          );
        }
        // tool_result intentionally not printed — usually large and
        // the assistant's follow-up content already summarizes it.
      }
      process.stdout.write('\n\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\n\x1B[31m[error] ${msg}\x1B[0m\n\n`);
      logger.error('[REPL] chat turn failed', err);
    }
  }

  process.stdout.write('\nGoodbye.\n');
  if (onExit) await onExit();
}
