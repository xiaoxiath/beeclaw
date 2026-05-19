/**
 * Beeclaw TUI root component — helixent-style architecture.
 *
 * Key idea: messages older than the latest are flushed to terminal
 * SCROLLBACK via useStdout().write() (plain ANSI text), NOT rendered
 * through Ink. Ink's dynamic region only ever contains:
 *   - the SINGLE latest message (streaming-friendly: assistant text
 *     grows in place without expanding the dynamic region's row count
 *     much; tool cards are short and fixed)
 *   - the streaming indicator
 *   - HITL prompt OR the InputEditor
 *   - Footer
 *
 * This sidesteps every issue we hit with <Static>:
 *   - <Static> commits push the dynamic region down in real terminal
 *     coords while Ink still erases at the OLD tracked position →
 *     banner / `> ` prompt / live message tombstones in scrollback.
 *   - All-history-in-React makes the dynamic region taller than the
 *     terminal, after which Ink can't ANSI-erase off-screen content.
 *
 * By writing scrollback-bound content through stdout BEFORE Ink lays
 * out the dynamic region, the terminal handles the natural scroll and
 * Ink's tracked area stays small + stable. Inspired by helixent.
 *
 * Slash commands route through the registry (built-ins like /clear
 * /exit + auto-discovered skills become picker entries). Ctrl+C is
 * a separate top-level useInput so it works regardless of the editor.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { theme } from './theme';
import { getLogger } from '../../../infra/observability/logger';

const logger = getLogger('tui.app');
import { MessageView } from './MessageView';
import { messageToPlainText } from './message-text';
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
  onSubmit?: (line: string) => AsyncIterable<{
    type: string;
    content?: string;
    name?: string;
    params?: Record<string, unknown>;
    result?: unknown;
  }>;
  onExit?: () => Promise<void> | void;
  modelLabel?: string;
  skills?: Array<{ name: string; description?: string }>;
  getInfo?: () => { modelLine: string; sessionsLine: string };
  getTotalTokens?: () => number;
}

type Status = 'idle' | 'busy' | 'exiting';

/**
 * Batch window for stream events. Each event arrives via for-await and
 * normally triggers an immediate setState; batching collapses bursts
 * (e.g. fast content deltas) into one render. 50ms feels live without
 * pinning the CPU on re-renders.
 */
const BATCH_FLUSH_MS = 50;

export function App({
  onSubmit,
  onExit,
  modelLabel,
  skills,
  getInfo,
  getTotalTokens,
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { write } = useStdout();

  const [status, setStatus] = useState<Status>('idle');
  const [phase, setPhase] = useState<string | undefined>(undefined);
  const [totalTokens, setTotalTokens] = useState<number | undefined>(
    () => getTotalTokens?.() ?? undefined,
  );
  const [hint, setHint] = useState<string | null>(null);
  // Unified messages array — old impl split history + liveTurn; that
  // separation only existed to make <Static> work, which we've now
  // removed. The flusher hook below pushes everything except the
  // tail into scrollback automatically.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingHitl, setPendingHitl] = useState<HitlSignal | null>(null);

  // Sync re-entry guard. setStatus('busy') flips InputEditor's disabled
  // prop only on the next React commit, so Enter mashing in the gap
  // would otherwise spawn N concurrent chat turns.
  const isRunningRef = useRef(false);

  // Monotonic id counter — replaces the derive-from-state version that
  // raced with async setMessages. Bumped above any existing message id
  // on /clear or other reseeds via the useEffect below.
  const idCounterRef = useRef(0);
  const allocateId = useCallback((): number => ++idCounterRef.current, []);
  useEffect(() => {
    const maxId = Math.max(0, ...messages.map(m => m.id));
    if (maxId >= idCounterRef.current) idCounterRef.current = maxId;
  }, [messages]);

  // ──────────────────────────────────────────────────────────────────
  // Scrollback flush — write all messages EXCEPT the last one to
  // stdout. The terminal naturally accumulates them above Ink's
  // render area. Tracks how many we've already flushed so we never
  // re-emit anything; on reseed (count goes down, e.g. /clear) we
  // reset to 0.
  // ──────────────────────────────────────────────────────────────────
  const flushedCountRef = useRef(0);
  useEffect(() => {
    // /clear or similar reseed — drop our cursor so a future grow
    // doesn't double-emit messages 0..flushedCount.
    if (messages.length < flushedCountRef.current) {
      flushedCountRef.current = 0;
      return;
    }
    const target = Math.max(0, messages.length - 1); // never flush the last
    if (target <= flushedCountRef.current) return;
    for (let i = flushedCountRef.current; i < target; i++) {
      const text = messageToPlainText(messages[i]);
      if (text) write(text + '\n\n');
    }
    flushedCountRef.current = target;
  }, [messages, write]);

  // ──────────────────────────────────────────────────────────────────
  // Stream-event batching — accumulate updates and flush every 50ms.
  // Each event would otherwise trigger an immediate setState; batching
  // collapses bursts (especially streaming content deltas) into a
  // single render pass.
  // ──────────────────────────────────────────────────────────────────
  type Mutation = (prev: ChatMessage[]) => ChatMessage[];
  const pendingMutationsRef = useRef<Mutation[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingMutationsRef.current;
    if (pending.length === 0) return;
    pendingMutationsRef.current = [];
    setMessages(prev => pending.reduce((acc, m) => m(acc), prev));
  }, []);

  const enqueueMutation = useCallback((m: Mutation) => {
    pendingMutationsRef.current.push(m);
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(flushPending, BATCH_FLUSH_MS);
  }, [flushPending]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  // ──────────────────────────────────────────────────────────────────
  // Slash-command registry & dispatcher.
  // ──────────────────────────────────────────────────────────────────
  const registry: readonly Command[] = React.useMemo(
    () => composeRegistry(skills ?? []),
    [skills],
  );

  const dispatchCommand = useCallback(async (line: string): Promise<boolean> => {
    const parsed = parseCommandLine(line);
    if (!parsed) return false;

    const command = registry.find(c => c.name === parsed.name);
    if (!command) {
      setHint(`Unknown command: /${parsed.name}. Type / and browse the picker.`);
      return true;
    }

    if (command.kind === 'skill') {
      const text = parsed.args
        ? `Use the ${command.name} skill: ${parsed.args}`
        : `Use the ${command.name} skill.`;
      void runChat(text);
      return true;
    }

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
      clearHistory: () => {
        setMessages([]);
        // Hard-reset flushed cursor too — otherwise the next message
        // would be flushed at offset 0 and double-print if anything
        // was previously visible.
        flushedCountRef.current = 0;
      },
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

  // ──────────────────────────────────────────────────────────────────
  // Main chat turn driver.
  // ──────────────────────────────────────────────────────────────────
  const runChat = useCallback(async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (isRunningRef.current) {
      logger.debug('runChat ignored — turn already in progress');
      return;
    }
    isRunningRef.current = true;

    setHint(null);
    setStatus('busy');
    setPhase('thinking…');

    const userMsg: ChatMessage = { id: allocateId(), kind: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg]);

    try {
      if (!onSubmit) {
        const stub: ChatMessage = {
          id: allocateId(),
          kind: 'assistant',
          content: '(no agent wired — stub)',
        };
        setMessages(prev => [...prev, stub]);
        return;
      }

      let assistantId: number | null = null;
      let eventCount = 0;

      for await (const ev of onSubmit(trimmed)) {
        eventCount++;
        logger.debug(`event #${eventCount} type=${ev.type} len=${ev.content?.length ?? 'n/a'}`);

        if (ev.type === 'content' && typeof ev.content === 'string') {
          setPhase('writing…');
          if (assistantId === null) {
            const id = allocateId();
            assistantId = id;
            const content = ev.content;
            enqueueMutation(prev => [...prev, { id, kind: 'assistant', content }]);
          } else {
            const id = assistantId;
            const delta = ev.content;
            enqueueMutation(prev => prev.map(m =>
              m.id === id && m.kind === 'assistant'
                ? { ...m, content: m.content + delta }
                : m,
            ));
          }
          continue;
        }

        if (ev.type === 'tool_call' && typeof ev.name === 'string') {
          setPhase(`calling ${ev.name}…`);
          assistantId = null;
          const id = allocateId();
          const name = ev.name;
          const params = ev.params ?? {};
          enqueueMutation(prev => [...prev, { id, kind: 'tool', name, params, resolved: false }]);
          continue;
        }

        if (ev.type === 'tool_result' && typeof ev.name === 'string') {
          setPhase('thinking…');
          const name = ev.name;
          const result = ev.result;
          enqueueMutation(prev => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const m = next[i];
              if (m.kind === 'tool' && !m.resolved && m.name === name) {
                next[i] = { ...m, result, resolved: true };
                return next;
              }
            }
            return prev;
          });

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
      logger.error(`runChat error: ${msg}`, err);
      setHint(`error: ${msg}`);
    } finally {
      // Drain any still-pending batched events before flipping to idle.
      flushPending();
      setStatus('idle');
      setPhase(undefined);
      if (getTotalTokens) setTotalTokens(getTotalTokens());
      isRunningRef.current = false;
    }
  }, [allocateId, onSubmit, enqueueMutation, flushPending, getTotalTokens]);

  const handleSubmit = useCallback(async (line: string) => {
    const isSlash = line.trim().startsWith('/');
    if (isSlash) {
      setPendingHitl(null);
      await dispatchCommand(line);
      return;
    }
    if (pendingHitl) {
      const expanded = expandHitlAnswer(line, pendingHitl.options);
      setPendingHitl(null);
      await runChat(expanded);
      return;
    }
    await runChat(line);
  }, [dispatchCommand, runChat, pendingHitl]);

  // Ctrl+C — graceful exit. Always-active hook so it works regardless
  // of busy state. Other keys fall through to InputEditor.
  useInput((char, key) => {
    if (key.ctrl && char === 'c' && status !== 'exiting') {
      setStatus('exiting');
      void (async () => {
        if (onExit) await onExit();
        exit();
      })();
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // Render — dynamic region only. The flusher hook above has already
  // written messages[0..length-2] to stdout (scrollback). We only show
  // the most recent message inline alongside the indicator + input.
  // ──────────────────────────────────────────────────────────────────
  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  return (
    <Box flexDirection="column">
      {latestMessage && (
        <MessageView key={`live:${latestMessage.id}`} message={latestMessage} />
      )}

      {hint && (
        <Box marginBottom={1}>
          <Text color={theme.warn}>{hint}</Text>
        </Box>
      )}

      {pendingHitl ? (
        <HitlPrompt signal={pendingHitl} />
      ) : (
        <InputEditor
          onSubmit={handleSubmit}
          isBusy={() => isRunningRef.current}
          commands={registry}
        />
      )}

      <Footer
        modelLabel={modelLabel}
        totalTokens={totalTokens}
        status={status}
        phase={phase}
      />
    </Box>
  );
}
