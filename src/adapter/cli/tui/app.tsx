/**
 * Beeclaw TUI root component.
 *
 * Layout (top → bottom):
 *   Banner                       fixed header
 *   <Static items={history}>     completed turns flushed to scrollback
 *   <MessageView active />        currently-streaming live region
 *   <Hint />                      transient banner (errors / unknown cmd)
 *   <InputEditor commands={...}/> multi-line input + slash command picker
 *
 * Slash commands route through the registry from PR5: built-ins like
 * /clear /exit and dynamically discovered skills become first-class
 * picker entries. The picker UI lives inside InputEditor; this file
 * just wires the command list and dispatches Result handling.
 *
 * Per-turn lifecycle:
 *   1. user submits a non-slash line via InputEditor
 *   2. push user message into a turn-local sequence (live)
 *   3. iterate agent.chatStream(line):
 *        content event       → append to streaming assistant text
 *        tool_call event     → append a pending ToolCard to live sequence
 *        tool_result event   → resolve the matching pending tool by name
 *   4. on stream end, commit the whole turn sequence to history (Static
 *      flushes it to scrollback) and clear live state
 *
 * Ctrl+C lives in a separate top-level useInput so it works regardless
 * of whether the InputEditor is disabled.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Static, Text, useInput, useApp } from 'ink';
import { theme } from './theme';
import { getLogger } from '../../../infra/observability/logger';

const logger = getLogger('tui.app');
import { MessageView } from './MessageView';
import { InputEditor } from './InputEditor';
import { Footer } from './Footer';
import { HitlPrompt, type HitlSignal } from './HitlPrompt';
import { expandHitlAnswer } from './hitl-expand';
import type { ChatMessage } from './messages';
import {
  composeRegistry,
  parseCommandLine,
  type Command,
  type CommandResult,
} from './commands';

export interface AppProps {
  /**
   * Submit a single user line. Yields streaming events:
   *   { type: 'content', content: string }                — text delta
   *   { type: 'tool_call', name, params }                 — tool start
   *   { type: 'tool_result', name, result }               — tool end
   * Returns when the turn is done.
   */
  onSubmit?: (line: string) => AsyncIterable<{
    type: string;
    content?: string;
    name?: string;
    params?: Record<string, unknown>;
    result?: unknown;
  }>;
  /** Called when the user issues /exit or /quit. */
  onExit?: () => Promise<void> | void;
  /** Banner subtitle, e.g. the active model. PR6 wires this from config. */
  modelLabel?: string;
  /**
   * Skills discovered at App mount. Each entry becomes a /<name> slash
   * command in the picker. Missing → empty list (only built-ins shown).
   */
  skills?: Array<{ name: string; description?: string }>;
  /** Ops-info supplier for /model and /sessions hints. */
  getInfo?: () => { modelLine: string; sessionsLine: string };
  /**
   * Total token count for the footer's right-hand stat. Polled at
   * idle moments — App calls this on mount and after each turn-end.
   * Wired in PR6 from getTokenUsageTracker().snapshot().totalTokens.
   */
  getTotalTokens?: () => number;
}

type Status = 'idle' | 'busy' | 'exiting';

export function App({
  onSubmit,
  onExit,
  modelLabel,
  skills,
  getInfo,
  getTotalTokens,
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [status, setStatus] = useState<Status>('idle');
  const [phase, setPhase] = useState<string | undefined>(undefined);
  const [totalTokens, setTotalTokens] = useState<number | undefined>(
    () => getTotalTokens?.() ?? undefined,
  );
  const [hint, setHint] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [liveTurn, setLiveTurn] = useState<ChatMessage[]>([]);
  const liveTurnRef = useRef<ChatMessage[]>([]);
  // Synchronous re-entry guard. setStatus('busy') schedules a re-render
  // that flips InputEditor.disabled, but that only takes effect on
  // React's next commit. If the user mashes Enter during the ~ms gap
  // between submit and commit, useInput fires multiple times with
  // isActive=true (stale) and we'd end up running N concurrent chat
  // turns. The ref blocks the second-to-Nth submission immediately.
  const isRunningRef = useRef(false);
  // PR7: HITL state. Set when a tool_result arrives with needsUserInput=true.
  // The next user submission becomes the answer (auto-submitted via runChat).
  const [pendingHitl, setPendingHitl] = useState<HitlSignal | null>(null);

  // Build the slash-command registry once per skills change.
  const registry: readonly Command[] = React.useMemo(
    () => composeRegistry(skills ?? []),
    [skills],
  );

  // Monotonic id counter. Previously we derived ids from `[...history,
  // ...liveTurnRef.current]` which broke when we started pushing user
  // msgs to history mid-turn (history is async via setHistory, so the
  // counter wouldn't see in-flight items and we'd recycle ids).
  const idCounterRef = useRef(0);
  const allocateId = useCallback((): number => ++idCounterRef.current, []);
  // Keep the counter strictly above the largest existing id (handles
  // future reseed from /clear etc).
  useEffect(() => {
    const maxId = Math.max(
      0,
      ...history.map(m => m.id),
      ...liveTurnRef.current.map(m => m.id),
    );
    if (maxId >= idCounterRef.current) idCounterRef.current = maxId;
  }, [history]);

  const updateLive = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    const next = updater(liveTurnRef.current);
    liveTurnRef.current = next;
    setLiveTurn(next);
  }, []);

  /**
   * Resolve a slash-command result from the registry. Returns true if
   * the line was handled as a command (chat path should NOT fire).
   */
  const dispatchCommand = useCallback(async (line: string): Promise<boolean> => {
    const parsed = parseCommandLine(line);
    if (!parsed) return false;

    const command = registry.find(c => c.name === parsed.name);
    if (!command) {
      setHint(`Unknown command: /${parsed.name}. Type / and browse the picker.`);
      return true;
    }

    // Skill commands: send as a chat turn that asks the agent to run
    // the skill. The agent already knows skill_get / skill_run.
    if (command.kind === 'skill') {
      const text = parsed.args
        ? `Use the ${command.name} skill: ${parsed.args}`
        : `Use the ${command.name} skill.`;
      // Fall through to chat path by returning false WITH the text
      // injected. Easier: just call handleChat directly here.
      void runChat(text);
      return true;
    }

    // Built-in: invoke exec. /model and /sessions need ops info from
    // App, so handle them here directly (their exec returns a stub
    // 'continue' just so they appear in the picker).
    if (parsed.name === 'model' || parsed.name === 'sessions') {
      const info = getInfo?.() ?? { modelLine: '(unknown)', sessionsLine: '(unknown)' };
      setHint(parsed.name === 'model' ? info.modelLine : info.sessionsLine);
      return true;
    }

    if (!command.exec) {
      setHint(`Command /${command.name} has no handler.`);
      return true;
    }

    const result: CommandResult = await command.exec({
      args: parsed.args,
      clearHistory: () => setHistory([]),
    });

    if (result.kind === 'exit') {
      setStatus('exiting');
      if (onExit) await onExit();
      exit();
      return true;
    }
    if (result.kind === 'send') {
      void runChat(result.text);
      return true;
    }
    if (result.hint) setHint(result.hint);
    else setHint(null);
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, getInfo, onExit, exit]);

  const runChat = useCallback(async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed) {
      logger.debug('runChat aborted — empty trimmed line');
      return;
    }

    // Synchronous re-entry guard. See isRunningRef declaration above.
    if (isRunningRef.current) {
      logger.debug('runChat ignored — turn already in progress');
      return;
    }
    isRunningRef.current = true;

    logger.debug(`runChat START (len=${trimmed.length})`);
    setHint(null);
    setStatus('busy');
    setPhase('thinking…');

    const userMsg: ChatMessage = { id: allocateId(), kind: 'user', content: trimmed };
    // CRITICAL: push user msg directly to history (Static), NOT liveTurn.
    // If user msg lives in liveTurn during the turn, every re-render
    // (including ones triggered by InputEditor's own setStates when the
    // user mashes Enter) redraws the dynamic region with that msg in it
    // — and Ink's diff leaves a tombstone in scrollback each time the
    // region grows. Committing to Static at submit time makes it appear
    // exactly once in scrollback and keeps liveTurn small (only the
    // streaming assistant or in-progress tool card).
    setHistory(prev => [...prev, userMsg]);
    logger.debug(`user message committed to history (id=${userMsg.id})`);

    try {
      if (!onSubmit) {
        const stub: ChatMessage = {
          id: allocateId() + 1,
          kind: 'assistant',
          content: '(no agent wired — stub)',
        };
        updateLive(prev => [...prev, stub]);
        return;
      }

      let assistantId: number | null = null;
      let eventCount = 0;

      logger.debug('entering for-await loop on onSubmit()');
      for await (const ev of onSubmit(trimmed)) {
        eventCount++;
        logger.debug(`event #${eventCount} type=${ev.type} contentLen=${ev.content?.length ?? 'n/a'}`);
        if (ev.type === 'content' && typeof ev.content === 'string') {
          setPhase('writing…');
          if (assistantId === null) {
            const seed: ChatMessage = {
              id: allocateId(),
              kind: 'assistant',
              content: ev.content,
            };
            assistantId = seed.id;
            updateLive(prev => [...prev, seed]);
          } else {
            updateLive(prev => prev.map(m =>
              m.id === assistantId && m.kind === 'assistant'
                ? { ...m, content: m.content + ev.content! }
                : m
            ));
          }
          continue;
        }

        if (ev.type === 'tool_call' && typeof ev.name === 'string') {
          setPhase(`calling ${ev.name}…`);
          assistantId = null;
          const tool: ChatMessage = {
            id: allocateId(),
            kind: 'tool',
            name: ev.name,
            params: ev.params ?? {},
            resolved: false,
          };
          updateLive(prev => [...prev, tool]);
          continue;
        }

        if (ev.type === 'tool_result' && typeof ev.name === 'string') {
          setPhase('thinking…');
          updateLive(prev => {
            let updated = false;
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const m = next[i];
              if (m.kind === 'tool' && !m.resolved && m.name === ev.name) {
                next[i] = { ...m, result: ev.result, resolved: true };
                updated = true;
                break;
              }
            }
            return updated ? next : prev;
          });

          // HITL signal detection. The ask_user_question tool returns
          // { success: false, needsUserInput: true, question, options?, ... }
          // — we extract that into pendingHitl so the HitlPrompt panel
          // shows above the input editor on the next render.
          const r = ev.result as Record<string, unknown> | undefined;
          if (r && r.needsUserInput === true && typeof r.question === 'string') {
            setPendingHitl({
              question: r.question,
              options: Array.isArray(r.options) ? (r.options as string[]) : undefined,
              inputType: typeof r.inputType === 'string' ? r.inputType : undefined,
              context: typeof r.context === 'string' ? r.context : undefined,
            });
          }
          continue;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[TUI/App] runChat error: ${msg}`, err);
      setHint(`error: ${msg}`);
    } finally {
      // CRITICAL: snapshot the ref BEFORE clearing it. setHistory takes
      // an updater function that React runs asynchronously; if the
      // updater reads liveTurnRef.current at that point, the ref has
      // already been emptied below and the flush drops the entire turn.
      // (Symptom: user/assistant messages flashed in liveTurn then
      // vanished, history never grew, allocateId kept returning 1.)
      const flushed = liveTurnRef.current;
      liveTurnRef.current = [];
      logger.debug(`runChat FINALLY — flushing ${flushed.length} liveTurn messages to history`);
      setHistory(prev => [...prev, ...flushed]);
      setLiveTurn([]);
      setStatus('idle');
      setPhase(undefined);
      // Refresh the footer's token count snapshot now that the turn
      // emitted at least one usage event.
      if (getTotalTokens) setTotalTokens(getTotalTokens());
      // Re-enable submissions. Done LAST so any Enter racing the final
      // setState commit still hits the guard.
      isRunningRef.current = false;
    }
  }, [allocateId, onSubmit, updateLive, getTotalTokens]);

  const handleSubmit = useCallback(async (line: string) => {
    const isSlash = line.trim().startsWith('/');
    logger.debug(`handleSubmit (isSlash=${isSlash}, hasHitl=${!!pendingHitl}, status=${status})`);
    if (isSlash) {
      // Slash commands work even mid-HITL — they cancel the prompt.
      setPendingHitl(null);
      await dispatchCommand(line);
      return;
    }
    // PR7: if a HITL prompt is pending, treat this submission as the
    // answer. Digit-only answers expand to "Option N: <text>" so the
    // model gets self-explanatory context. The pending prompt clears
    // before runChat fires (so we don't loop on the same question).
    if (pendingHitl) {
      const expanded = expandHitlAnswer(line, pendingHitl.options);
      setPendingHitl(null);
      await runChat(expanded);
      return;
    }
    await runChat(line);
  }, [dispatchCommand, runChat, pendingHitl, status]);

  // Top-level useInput — handles Ctrl+C as graceful exit. The
  // InputEditor's own useInput coexists; Ink dispatches to both.
  useInput((char, key) => {
    if (key.ctrl && char === 'c' && status !== 'exiting') {
      setStatus('exiting');
      void (async () => {
        if (onExit) await onExit();
        exit();
      })();
    }
  });

  return (
    <Box flexDirection="column">
      {/*
        Banner deliberately NOT inside this tree — the entry point
        (src/adapter/cli/tui/index.ts) writes it to stdout BEFORE
        Ink's render() mounts, so it sits in scrollback as a one-time
        header. Keeping it in the React tree caused it to stack on
        every turn: each <Static> commit pushes the dynamic region
        down in real terminal coordinates, but Ink still erases at
        its OLD tracked position — leaving the previous banner line
        orphaned in scrollback.
      */}

      {/*
        History is committed to Ink's <Static> region — items render
        ONCE per key and become permanent scrollback. The live region
        below (liveTurn, input, footer) re-renders on every state
        change; without Static there, a tall App would push the
        live area off-screen each turn and Ink (unable to erase
        scrolled-out lines) would re-print everything below.
      */}
      <Static items={history}>
        {(m) => <MessageView key={m.id} message={m} />}
      </Static>
      {liveTurn.map(m => (
        <MessageView key={m.id} message={m} />
      ))}

      {hint && (
        <Box marginBottom={1}>
          <Text color={theme.warn}>{hint}</Text>
        </Box>
      )}

      {pendingHitl && <HitlPrompt signal={pendingHitl} />}

      <InputEditor
        onSubmit={handleSubmit}
        disabled={status !== 'idle'}
        commands={registry}
      />

      <Footer
        modelLabel={modelLabel}
        totalTokens={totalTokens}
        status={status}
        phase={phase}
      />
    </Box>
  );
}
