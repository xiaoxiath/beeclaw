/**
 * Mock Fetch Utility
 *
 * Provides mock fetch for testing API calls
 */

export interface MockResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface MockFetchRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

type MockFetchHandler = (request: MockFetchRequest) => MockResponse | Promise<MockResponse>;

let mockHandler: MockFetchHandler | null = null;
let requests: MockFetchRequest[] = [];
let originalFetch: typeof fetch | null = null;

/**
 * Create a mock Response object
 */
function createMockResponse(mockResponse: MockResponse): Response {
  const body = mockResponse.body !== undefined
    ? (typeof mockResponse.body === 'string'
        ? mockResponse.body
        : JSON.stringify(mockResponse.body))
    : '';

  return {
    ok: (mockResponse.status || 200) >= 200 && (mockResponse.status || 200) < 300,
    status: mockResponse.status || 200,
    statusText: mockResponse.statusText || 'OK',
    headers: new Headers(mockResponse.headers || {}),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(mockResponse.body || {}),
    blob: () => Promise.resolve(new Blob()),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    clone: function() { return this; },
    body: null,
    bodyUsed: false,
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
  } as Response;
}

/**
 * Mock fetch implementation
 */
async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method || 'GET';

  const request: MockFetchRequest = {
    url,
    method,
    headers: init?.headers as Record<string, string> || {},
    body: init?.body as string | undefined,
  };

  requests.push(request);

  if (!mockHandler) {
    throw new Error('No mock handler set. Use mockFetch.setHandler() first.');
  }

  const response = await mockHandler(request);
  return createMockResponse(response);
}

/**
 * Set up mock fetch with a handler
 */
export function setupMockFetch(handler: MockFetchHandler): void {
  mockHandler = handler;
  requests = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
}

/**
 * Set up mock fetch with predefined responses
 */
export function setupMockFetchWithResponses(responses: Map<string, MockResponse | MockResponse[]>): void {
  const responseIterators = new Map<string, { responses: MockResponse[]; index: number }>();

  for (const [url, res] of responses) {
    const resArray = Array.isArray(res) ? res : [res];
    responseIterators.set(url, { responses: resArray, index: 0 });
  }

  setupMockFetch((request) => {
    // Try exact match first
    let iterator = responseIterators.get(request.url);

    // Try pattern match
    if (!iterator) {
      for (const [pattern] of responseIterators) {
        if (request.url.includes(pattern) || pattern.includes('*') && new RegExp(pattern.replace('*', '.*')).test(request.url)) {
          iterator = responseIterators.get(pattern);
          break;
        }
      }
    }

    if (!iterator) {
      return { status: 404, statusText: 'Not Found', body: { error: 'Mock not found' } };
    }

    const response = iterator.responses[iterator.index];
    if (iterator.index < iterator.responses.length - 1) {
      iterator.index++;
    }

    return response;
  });
}

/**
 * Set up mock fetch to return a single response for all requests
 */
export function setupMockFetchWithResponse(response: MockResponse): void {
  setupMockFetch(() => response);
}

/**
 * Restore original fetch
 */
export function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
  mockHandler = null;
  requests = [];
}

/**
 * Get all recorded requests
 */
export function getMockRequests(): MockFetchRequest[] {
  return [...requests];
}

/**
 * Clear recorded requests
 */
export function clearMockRequests(): void {
  requests = [];
}

/**
 * Create a mock fetch that simulates network errors
 */
export function setupMockFetchWithError(error: Error): void {
  setupMockFetch(() => {
    throw error;
  });
}

/**
 * Create a mock fetch that simulates delays
 */
export function setupMockFetchWithDelay(response: MockResponse, delayMs: number): void {
  setupMockFetch(async () => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return response;
  });
}
