import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Mock session functions
const mockListSessions = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@/domain/session', () => ({
  listSessions: () => mockListSessions(),
  getSession: (...args: any[]) => mockGetSession(...args),
}));

import sessionsRoutes from '../sessions';

describe('Sessions Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET / (list sessions) ───
  describe('GET / (list sessions)', () => {
    it('returns all sessions when no userId header', async () => {
      mockListSessions.mockReturnValue([
        {
          id: 'session-1',
          channel: 'web',
          messages: [{ role: 'user', content: 'hi' }],
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T01:00:00Z',
          summary: 'Test',
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

      const res = await sessionsRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.sessions).toHaveLength(2);
      expect(json.sessions[0].messageCount).toBe(1);
      expect(json.sessions[1].messageCount).toBe(0);
      expect(json.total).toBe(2);
    });

    it('filters sessions by userId when x-user-id header present', async () => {
      mockListSessions.mockReturnValue([
        {
          id: 'session-1',
          userId: 'user-A',
          channel: 'web',
          messages: [],
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          summary: null,
        },
        {
          id: 'session-2',
          userId: 'user-B',
          channel: 'web',
          messages: [],
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          summary: null,
        },
        {
          id: 'session-3',
          channel: 'web',
          messages: [],
          createdAt: '2024-01-03T00:00:00Z',
          updatedAt: '2024-01-03T00:00:00Z',
          summary: null,
        },
      ]);

      const res = await sessionsRoutes.request('/', {
        headers: { 'x-user-id': 'user-A' },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      // user-A's session + session without owner
      expect(json.sessions).toHaveLength(2);
    });

    it('returns empty list when no sessions', async () => {
      mockListSessions.mockReturnValue([]);

      const res = await sessionsRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.sessions).toEqual([]);
    });
  });

  // ─── GET /:id (session details) ───
  describe('GET /:id', () => {
    it('returns session details when owned by user', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        userId: 'user-A',
        channel: 'web',
        messages: [{ role: 'user', content: 'Hello' }],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T01:00:00Z',
        summary: 'Greeting',
      });

      const res = await sessionsRoutes.request('/session-1', {
        headers: { 'x-user-id': 'user-A' },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.session.id).toBe('session-1');
      expect(json.session.messages).toHaveLength(1);
    });

    it('returns 404 when session not found', async () => {
      mockGetSession.mockReturnValue(null);

      const res = await sessionsRoutes.request('/nonexistent', {
        headers: { 'x-user-id': 'user-A' },
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Not found');
    });

    it('returns 403 when user does not own session', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        userId: 'user-B',
        channel: 'web',
        messages: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        summary: null,
      });

      const res = await sessionsRoutes.request('/session-1', {
        headers: { 'x-user-id': 'user-A' },
      });
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBe('Forbidden');
    });

    it('returns 403 when no userId provided (unauthenticated)', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        channel: 'web',
        messages: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        summary: null,
      });

      const res = await sessionsRoutes.request('/session-1');
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBe('Forbidden');
    });
  });

  // ─── GET /:id/dag ───
  describe('GET /:id/dag', () => {
    it('returns DAG data from session tool calls', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        userId: 'user-A',
        channel: 'web',
        messages: [
          { role: 'user', content: 'Do something' },
          {
            role: 'assistant',
            content: 'Done',
            timestamp: '2024-01-01T00:01:00Z',
            toolCalls: [
              { function: { name: 'search', arguments: '{"q":"test"}' } },
              { function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
            ],
          },
        ],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
        summary: null,
      });

      const res = await sessionsRoutes.request('/session-1/dag', {
        headers: { 'x-user-id': 'user-A' },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.sessionId).toBe('session-1');
      expect(json.nodes).toHaveLength(2);
      expect(json.nodes[0].data.label).toBe('search');
      expect(json.nodes[1].data.label).toBe('read_file');
      expect(json.edges).toHaveLength(1);
      expect(json.edges[0].source).toBe('node-0');
      expect(json.edges[0].target).toBe('node-1');
    });

    it('returns empty DAG when no tool calls', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        userId: 'user-A',
        channel: 'web',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
        ],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        summary: null,
      });

      const res = await sessionsRoutes.request('/session-1/dag', {
        headers: { 'x-user-id': 'user-A' },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.nodes).toEqual([]);
      expect(json.edges).toEqual([]);
    });

    it('returns 404 when session not found', async () => {
      mockGetSession.mockReturnValue(null);

      const res = await sessionsRoutes.request('/missing/dag', {
        headers: { 'x-user-id': 'user-A' },
      });
      const json = await res.json();

      expect(res.status).toBe(404);
    });

    it('returns 403 when user does not own session', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        userId: 'user-B',
        channel: 'web',
        messages: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        summary: null,
      });

      const res = await sessionsRoutes.request('/session-1/dag', {
        headers: { 'x-user-id': 'user-A' },
      });
      const json = await res.json();

      expect(res.status).toBe(403);
    });

    it('handles tool calls with missing function name', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        userId: 'user-A',
        channel: 'web',
        messages: [
          {
            role: 'assistant',
            content: 'Done',
            timestamp: '2024-01-01T00:01:00Z',
            toolCalls: [
              { function: {} }, // Missing name
            ],
          },
        ],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
        summary: null,
      });

      const res = await sessionsRoutes.request('/session-1/dag', {
        headers: { 'x-user-id': 'user-A' },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.nodes[0].data.label).toBe('Unknown Tool');
    });

    it('returns 403 when unauthenticated for DAG', async () => {
      mockGetSession.mockReturnValue({
        id: 'session-1',
        channel: 'web',
        messages: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        summary: null,
      });

      const res = await sessionsRoutes.request('/session-1/dag');
      const json = await res.json();

      expect(res.status).toBe(403);
    });
  });
});
