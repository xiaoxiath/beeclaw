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

// Mock agent
const mockAgent = {
  chat: vi.fn().mockResolvedValue('Hello! How can I help you?'),
  getLastToolCalls: vi.fn().mockReturnValue([]),
};

vi.mock('@/app', () => ({
  getAgent: () => mockAgent,
}));

// Mock streamSSE - need to handle it properly
vi.mock('hono/streaming', () => ({
  streamSSE: vi.fn(async (_c: any, callback: any) => {
    const events: any[] = [];
    const stream = {
      writeSSE: vi.fn(async (event: any) => { events.push(event); }),
    };
    await callback(stream);
    // Return a response with the events
    return new Response(JSON.stringify(events), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }),
}));

import chatRoutes from '../chat';

describe('Chat Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock session messages each time
    mockSession.messages = [];
    mockGetOrCreateSession.mockResolvedValue(mockSession);
    mockAgent.chat.mockResolvedValue('Hello! How can I help you?');
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
      expect(mockAgent.chat).toHaveBeenCalledWith('Hello', expect.objectContaining({
        sessionId: 'session-123',
        loadMemory: true,
      }));
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

    it('sends tool_calls event when agent returns tool calls', async () => {
      mockAgent.getLastToolCalls.mockReturnValue([
        { function: { name: 'search', arguments: '{}' } },
      ]);

      const res = await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Search for something',
          sessionId: 'session-123',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockAgent.getLastToolCalls).toHaveBeenCalled();
    });

    it('handles agent.chat error in SSE stream', async () => {
      mockAgent.chat.mockRejectedValue(new Error('AI service down'));

      const res = await chatRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Hello',
          sessionId: 'session-123',
        }),
      });

      // The SSE handler catches errors and writes an error event
      expect(res.status).toBe(200);
    });

    it('handles non-Error thrown in SSE stream', async () => {
      mockAgent.chat.mockRejectedValue('string error');

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

    it('saves tool calls to session when present', async () => {
      const toolCalls = [{ function: { name: 'read_file', arguments: '{"path":"test"}' } }];
      mockAgent.getLastToolCalls.mockReturnValue(toolCalls);

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
