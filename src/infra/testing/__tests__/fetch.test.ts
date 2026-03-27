import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupMockFetch,
  setupMockFetchWithResponses,
  setupMockFetchWithResponse,
  setupMockFetchWithError,
  setupMockFetchWithDelay,
  restoreFetch,
  getMockRequests,
  clearMockRequests,
  type MockResponse,
} from '../mocks/fetch';

describe('testing/mocks/fetch', () => {
  afterEach(() => {
    restoreFetch();
  });

  describe('setupMockFetch', () => {
    it('should mock global fetch', () => {
      setupMockFetch(() => ({ status: 200, body: { ok: true } }));
      expect(typeof fetch).toBe('function');
    });

    it('should call handler with request info', async () => {
      let receivedRequest: any;
      setupMockFetch((req) => {
        receivedRequest = req;
        return { status: 200 };
      });

      await fetch('https://example.com/api', {
        method: 'POST',
        body: JSON.stringify({ key: 'value' }),
      });

      expect(receivedRequest.url).toBe('https://example.com/api');
      expect(receivedRequest.method).toBe('POST');
    });

    it('should record requests', async () => {
      setupMockFetch(() => ({ status: 200 }));
      await fetch('https://example.com/a');
      await fetch('https://example.com/b');

      const requests = getMockRequests();
      expect(requests).toHaveLength(2);
      expect(requests[0].url).toBe('https://example.com/a');
      expect(requests[1].url).toBe('https://example.com/b');
    });
  });

  describe('setupMockFetchWithResponse', () => {
    it('should return the same response for all requests', async () => {
      setupMockFetchWithResponse({ status: 200, body: { data: 'test' } });

      const res1 = await fetch('https://example.com/a');
      const res2 = await fetch('https://example.com/b');

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const body1 = await res1.json();
      expect(body1).toEqual({ data: 'test' });
    });
  });

  describe('setupMockFetchWithResponses', () => {
    it('should match by URL', async () => {
      const responses = new Map<string, MockResponse>();
      responses.set('https://api.example.com/users', { status: 200, body: { users: [] } });
      responses.set('https://api.example.com/posts', { status: 200, body: { posts: [] } });

      setupMockFetchWithResponses(responses);

      const usersRes = await fetch('https://api.example.com/users');
      expect(usersRes.status).toBe(200);
      const usersBody = await usersRes.json();
      expect(usersBody.users).toEqual([]);

      const postsRes = await fetch('https://api.example.com/posts');
      const postsBody = await postsRes.json();
      expect(postsBody.posts).toEqual([]);
    });

    it('should return 404 for unmatched URLs', async () => {
      setupMockFetchWithResponses(new Map());
      const res = await fetch('https://unknown.com');
      expect(res.status).toBe(404);
    });

    it('should support sequential responses', async () => {
      const responses = new Map<string, MockResponse[]>();
      responses.set('https://api.com/data', [
        { status: 200, body: { page: 1 } },
        { status: 200, body: { page: 2 } },
      ]);

      setupMockFetchWithResponses(responses as any);

      const res1 = await fetch('https://api.com/data');
      const body1 = await res1.json();
      expect(body1.page).toBe(1);

      const res2 = await fetch('https://api.com/data');
      const body2 = await res2.json();
      expect(body2.page).toBe(2);
    });
  });

  describe('setupMockFetchWithError', () => {
    it('should throw the specified error', async () => {
      setupMockFetchWithError(new Error('Network failure'));
      await expect(fetch('https://example.com')).rejects.toThrow('Network failure');
    });
  });

  describe('setupMockFetchWithDelay', () => {
    it('should delay the response', async () => {
      setupMockFetchWithDelay({ status: 200, body: { delayed: true } }, 50);

      const start = Date.now();
      const res = await fetch('https://example.com');
      const elapsed = Date.now() - start;

      expect(res.status).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(40); // allow small tolerance
    });
  });

  describe('restoreFetch', () => {
    it('should restore original fetch', () => {
      const originalFetch = globalThis.fetch;
      setupMockFetch(() => ({ status: 200 }));
      restoreFetch();
      // After restore, fetch should be the original
      expect(globalThis.fetch).toBe(originalFetch);
    });

    it('should clear requests', () => {
      setupMockFetch(() => ({ status: 200 }));
      restoreFetch();
      expect(getMockRequests()).toEqual([]);
    });
  });

  describe('getMockRequests / clearMockRequests', () => {
    it('should return copy of requests', async () => {
      setupMockFetch(() => ({ status: 200 }));
      await fetch('https://example.com');

      const requests = getMockRequests();
      expect(requests).toHaveLength(1);

      // Should be a copy
      requests.push({ url: 'fake', method: 'GET', headers: {} });
      expect(getMockRequests()).toHaveLength(1); // original unchanged
    });

    it('should clear requests', async () => {
      setupMockFetch(() => ({ status: 200 }));
      await fetch('https://example.com');
      expect(getMockRequests()).toHaveLength(1);

      clearMockRequests();
      expect(getMockRequests()).toHaveLength(0);
    });
  });

  describe('mock Response object', () => {
    it('should have ok=true for 2xx status', async () => {
      setupMockFetchWithResponse({ status: 200 });
      const res = await fetch('https://example.com');
      expect(res.ok).toBe(true);
    });

    it('should have ok=false for 4xx status', async () => {
      setupMockFetchWithResponse({ status: 404 });
      const res = await fetch('https://example.com');
      expect(res.ok).toBe(false);
    });

    it('should support text() method', async () => {
      setupMockFetchWithResponse({ status: 200, body: 'plain text' });
      const res = await fetch('https://example.com');
      const text = await res.text();
      expect(text).toBe('plain text');
    });

    it('should support json() method', async () => {
      setupMockFetchWithResponse({ status: 200, body: { key: 'value' } });
      const res = await fetch('https://example.com');
      const json = await res.json();
      expect(json).toEqual({ key: 'value' });
    });
  });
});
