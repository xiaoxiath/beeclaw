/**
 * Slash command registry for the TUI.
 *
 * Two kinds of entries:
 *   - 'builtin': implemented in-process (clear, exit, help, quit, etc.)
 *   - 'skill':   discovered from the skill store at App mount, listed
 *                for autocomplete + insertion. Execution is delegated
 *                to the agent (the user submits "/skill-name [args]"
 *                which gets fed to chat as-is, letting the model
 *                decide how to invoke skill_get).
 *
 * Built-in commands take a CommandContext and return one of:
 *   - { kind: 'continue', hint?: string }  → keep input loop running,
 *                                            optionally show a hint line
 *   - { kind: 'exit' }                     → leave the TUI
 *   - { kind: 'send', text: string }       → submit `text` as a chat turn
 *
 * The 'send' result lets a built-in trigger a chat exchange — e.g.
 * a hypothetical /summarize could expand to a real prompt.
 */

export type CommandResult =
  | { kind: 'continue'; hint?: string }
  | { kind: 'exit' }
  | { kind: 'send'; text: string };

export interface CommandContext {
  /** Free-form arg portion after the command name (already trimmed). */
  args: string;
  /** Lets a builtin clear chat history (e.g. /clear). */
  clearHistory: () => void;
}

export interface Command {
  /** Without leading '/'; e.g. "exit", "skill-name". */
  name: string;
  description: string;
  kind: 'builtin' | 'skill';
  exec?: (ctx: CommandContext) => CommandResult | Promise<CommandResult>;
}

/**
 * Built-in commands shipped with the TUI. The exec functions are
 * stable; runtime concerns (current model, sessions) are intentionally
 * not coupled here so this module stays a pure registry.
 */
export const builtinCommands: Command[] = [
  {
    name: 'help',
    description: 'List available commands',
    kind: 'builtin',
    exec: () => ({ kind: 'continue', hint: '(see picker — type / and browse)' }),
  },
  {
    name: 'clear',
    description: 'Clear conversation history',
    kind: 'builtin',
    exec: ({ clearHistory }) => {
      clearHistory();
      return { kind: 'continue', hint: 'history cleared' };
    },
  },
  {
    name: 'exit',
    description: 'Leave the TUI',
    kind: 'builtin',
    exec: () => ({ kind: 'exit' }),
  },
  {
    name: 'quit',
    description: 'Alias for /exit',
    kind: 'builtin',
    exec: () => ({ kind: 'exit' }),
  },
  {
    name: 'model',
    description: 'Show the current model + role',
    kind: 'builtin',
    // Hint actually populated at App level (it owns config); we surface
    // a placeholder so the picker still lists this entry.
    exec: () => ({ kind: 'continue' }),
  },
  {
    name: 'sessions',
    description: 'Show session count',
    kind: 'builtin',
    exec: () => ({ kind: 'continue' }),
  },
];

/**
 * Compose a registry from built-ins + dynamically-discovered skills.
 * Skills are appended (built-ins win on name collision so a malicious
 * skill can't shadow /exit).
 */
export function composeRegistry(skills: Array<{ name: string; description?: string }>): Command[] {
  const seen = new Set(builtinCommands.map(c => c.name));
  const out = [...builtinCommands];
  for (const s of skills) {
    if (!s.name || seen.has(s.name)) continue;
    seen.add(s.name);
    out.push({
      name: s.name,
      description: s.description ?? `Skill: ${s.name}`,
      kind: 'skill',
    });
  }
  return out;
}

/**
 * Parse a raw input line into { name, args }. Returns null for inputs
 * that don't start with '/'.
 */
export function parseCommandLine(line: string): { name: string; args: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return null;
  const body = trimmed.slice(1);
  const spaceIdx = body.search(/\s/);
  if (spaceIdx === -1) return { name: body.toLowerCase(), args: '' };
  return {
    name: body.slice(0, spaceIdx).toLowerCase(),
    args: body.slice(spaceIdx + 1).trim(),
  };
}
