import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock session functions
const mockSession = {
  id: 'session-123',
  channel: 'web',
  messages: [] as any[],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  summary: 'Test session',
};

const mockGetOrCreateSession = vi.fn().mockResolvedValue(mockSession);
const mockGetSession = vi.fn();
const mockSaveSession = vi.fn();
const mockListSessions = vi.fn();
const mockDeleteSession = vi.fn();

vi.mock('@/domain/session', () => ({
  getOrCreateSession: (...args: any[]) => mockGetOrCreateSession(...args),
  getSession: (...args: any[]) => mockGetSession(...args),
  saveSession: (...args: any[]) => mockSaveSession(...args),
  listSessions: () => mockListSessions(),
  deleteSession: (...args: any[]) => mockDeleteSession(...args),
}));

// Mock agent. The route now uses chatStream() (an async generator);
// we provide a default stream that yields a single content chunk so
// the legacy tests still pass without changes. Per-test overrides can
// supply richer event sequences (multiple content yields, tool calls).
type StreamEvent =
  | { type: 'content'; content: string }
  | { type: 'tool_call'; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: unknown };

let mockStreamEvents: StreamEvent[] = [{ type: 'content', content: 'Hello! How can I help you?' }];
let mockStreamShouldThrow: Error | string | null = null;

const mockAgent = {
  chatStream: vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    if (mockStreamShouldThrow) throw mockStreamShouldThrow;
    for (const ev of mockStreamEvents) yield ev;
  }),
  getLastToolCalls: vi.fn().mockReturnValue([]),
};

vi.mock('@/app', () => ({
  getAgent: () => mockAgent,
}));

// Mock streamSSE — captures every writeSSE() call so tests can assert
// on the event sequence.
let lastStreamEvents: any[] = [];
vi.mock('hono/streaming', () => ({
  streamSSE: vi.fn(async (_c: any, callback: any) => {
    lastStreamEvents = [];
    const stream = {
      writeSSE: vi.fn(async (event: any) => { lastStreamEvents.push(event); }),
    };
    await callback(stream);
    return new Response(JSON.stringify(lastStreamEvents), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }),
}));

import chatRoutes from '../chat';

describe('Chat Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.messages = [];
    mockGetOrCreateSession.mockResolvedValue(mockSession);
    mockStreamEvents = [{ type: 'content', content: 'Hello! How can I help you?' }];
    mockStreamShouldThrow = null;
    mockAgent.getLastToolCalls.mockReturnValue([]);
  });

  // ─── POST / (send message) ───
  describe('POST / (send message with SSE)', () => {
    it('processes a message and streams SSE response', async () => {
      const res = await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Hello',
          sessionId: 'session-123',
          channel: 'web',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockGetOrCreateSession).toHaveBeenCalled();
      expect(mockAgent.chatStream).toHaveBeenCalledWith('Hello');
      expect(mockSaveSession).toHaveBeenCalled();
    });

    it('creates session with default ID when sessionId is null', async () => {
      const res = await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Hello',
          sessionId: null,
        }),
      });

      expect(res.status).toBe(200);
      expect(mockGetOrCreateSession).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: expect.stringContaining('web-'),
        channel: 'web',
      }));
    });

    it('sends tool_calls aggregate event when agent yields tool events', async () => {
      mockStreamEvents = [
        { type: 'content', content: 'Looking it up' },
        { type: 'tool_call', name: 'search', params: { query: 'foo' } },
        { type: 'tool_result', name: 'search', result: 'found' },
        { type: 'content', content: ' — done.' },
      ];

      const res = await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Search for something',
          sessionId: 'session-123',
        }),
      });

      expect(res.status).toBe(200);
      const events = lastStreamEvents.map(e => e.event);
      expect(events).toContain('tool_call');
      expect(events).toContain('tool_result');
      expect(events).toContain('tool_calls'); // backward-compat aggregate
    });

    it('handles agent.chatStream error in SSE stream', async () => {
      mockStreamShouldThrow = new Error('AI service down');

      const res = await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Hello',
          sessionId: 'session-123',
        }),
      });

      expect(res.status).toBe(200);
      const errorEvent = lastStreamEvents.find(e => e.event === 'error');
      expect(errorEvent).toBeDefined();
      expect(JSON.parse(errorEvent.data).message).toBe('AI service down');
    });

    it('handles non-Error thrown in SSE stream', async () => {
      mockStreamShouldThrow = 'string error';

      const res = await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Hello',
          sessionId: 'session-123',
        }),
      });

      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid body (empty message)', async () => {
      const res = await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '' }),
      });

      expect(res.status).toBe(400);
    });

    it('defaults channel to web when not specified', async () => {
      const res = await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Hello',
          sessionId: 'session-123',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockGetOrCreateSession).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'web',
      }));
    });

    it('saves tool calls to session message when present', async () => {
      mockStreamEvents = [
        { type: 'tool_call', name: 'read_file', params: { path: 'test' } },
        { type: 'tool_result', name: 'read_file', result: 'file contents' },
        { type: 'content', content: 'Done.' },
      ];

      const res = await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Read test file',
          sessionId: 'session-123',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockSaveSession).toHaveBeenCalled();
      const savedAssistantMsg = mockSession.messages.find((m: any) => m.role === 'assistant');
      expect(savedAssistantMsg?.toolCalls).toBeDefined();
      expect(savedAssistantMsg!.toolCalls!.length).toBe(1);
      // Stored in OpenAI tool-call format (what the session schema requires).
      expect(savedAssistantMsg!.toolCalls![0].function.name).toBe('read_file');
      expect(JSON.parse(savedAssistantMsg!.toolCalls![0].function.arguments)).toEqual({ path: 'test' });
    });
  });

  // ─── Streaming-specific assertions ───
  describe('SSE streaming behavior', () => {
    it('emits one chunk event per content yield with cumulative text', async () => {
      mockStreamEvents = [
        { type: 'content', content: 'Hello' },
        { type: 'content', content: ', ' },
        { type: 'content', content: 'world!' },
      ];

      await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hi', sessionId: 's1' }),
      });

      const chunks = lastStreamEvents
        .filter(e => e.event === 'chunk')
        .map(e => JSON.parse(e.data).chunk);
      expect(chunks).toEqual(['Hello', 'Hello, ', 'Hello, world!']);
    });

    it('emits done event with the full cumulative text', async () => {
      mockStreamEvents = [
        { type: 'content', content: 'foo' },
        { type: 'content', content: 'bar' },
      ];

      await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'm', sessionId: 's1' }),
      });

      const doneEvent = lastStreamEvents.find(e => e.event === 'done');
      expect(doneEvent).toBeDefined();
      expect(JSON.parse(doneEvent.data).response).toBe('foobar');
    });

    it('truncates large tool results in tool_result event', async () => {
      const huge = 'x'.repeat(5000);
      mockStreamEvents = [
        { type: 'tool_call', name: 'big', params: {} },
        { type: 'tool_result', name: 'big', result: huge },
      ];

      await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'm', sessionId: 's1' }),
      });

      const trEvent = lastStreamEvents.find(e => e.event === 'tool_result');
      const data = JSON.parse(trEvent.data);
      expect(data.result.length).toBeLessThanOrEqual(1100);
      expect(data.result).toMatch(/truncated/);
    });

    it('does NOT emit tool_calls aggregate when no tools were used', async () => {
      mockStreamEvents = [{ type: 'content', content: 'plain answer' }];

      await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'm', sessionId: 's1' }),
      });

      expect(lastStreamEvents.find(e => e.event === 'tool_calls')).toBeUndefined();
    });

    it('saves the full cumulative response (not just last chunk) to session', async () => {
      mockStreamEvents = [
        { type: 'content', content: 'aa' },
        { type: 'content', content: 'bb' },
        { type: 'content', content: 'cc' },
      ];

      await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'm', sessionId: 's1' }),
      });

      const savedAssistantMsg = mockSession.messages.find((m: any) => m.role === 'assistant');
      expect(savedAssistantMsg?.content).toBe('aabbcc');
    });
  });

  // ─── GET /sessions ───
  describe('GET /sessions', () => {
    it('returns all sessions', async () => {
      mockListSessions.mockReturnValue([
        {
          id: 'session-1',
          channel: 'web',
          messages: [{ role: 'user', content: 'Hi' }],
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T01:00:00Z',
          summary: 'Greeting',
        },
        {
          id: 'session-2',
          channel: 'cli',
          messages: [],
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          summary: null,
        },
      ]);

      const res = await chatRoutes.request('/sessions');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.sessions).toHaveLength(2);
      expect(json.sessions[0].messageCount).toBe(1);
      expect(json.sessions[1].messageCount).toBe(0);
      expect(json.total).toBe(2);
    });

    it('returns empty when no sessions', async () => {
      mockListSessions.mockReturnValue([]);

      const res = await chatRoutes.request('/sessions');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.sessions).toEqual([]);
      expect(json.total).toBe(0);
    });
  });

  // ─── GET /sessions/:id ───
  describe('GET /sessions/:id', () => {
    it('returns session details', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        channel: 'web',
        messages: [{ role: 'user', content: 'Hello' }],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T01:00:00Z',
        summary: 'Test',
      });

      const res = await chatRoutes.request('/sessions/session-1');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.session.id).toBe('session-1');
      expect(json.session.messages).toHaveLength(1);
    });

    it('returns 404 when session not found', async () => {
      mockGetSession.mockReturnValue(null);

      const res = await chatRoutes.request('/sessions/nonexistent');
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Not found');
    });
  });

  // ─── DELETE /sessions/:id ───
  describe('DELETE /sessions/:id', () => {
    it('deletes a session successfully', async () => {
      mockDeleteSession.mockReturnValue(true);

      const res = await chatRoutes.request('/sessions/session-1', { method: 'DELETE' });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });

    it('returns 404 when session not found', async () => {
      mockDeleteSession.mockReturnValue(false);

      const res = await chatRoutes.request('/sessions/missing', { method: 'DELETE' });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Not found');
    });
  });
});
