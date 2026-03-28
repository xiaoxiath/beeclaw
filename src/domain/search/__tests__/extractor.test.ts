import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContentExtractor, getContentExtractor, type ExtractOptions } from '../extractor';

/* ------------------------------------------------------------------ */
/*  fetch mock helpers                                                */
/* ------------------------------------------------------------------ */

function mockFetchOk(body: string, contentType = 'text/html') {
  const headers = new Map([['content-type', contentType]]);
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (k: string) => headers.get(k) ?? null },
    text: vi.fn().mockResolvedValue(body),
    json: vi.fn().mockImplementation(() => Promise.resolve(JSON.parse(body || '{}')))
  });
}

function mockFetchJson(data: unknown) {
  const body = JSON.stringify(data);
  const headers = new Map([['content-type', 'application/json']]);
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (k: string) => headers.get(k) ?? null },
    text: vi.fn().mockResolvedValue(body),
    json: vi.fn().mockResolvedValue(data),
  });
}

function mockFetchStatus(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: { get: () => null },
    text: vi.fn().mockResolvedValue(''),
  });
}

function mockFetchError(error: Error) {
  return vi.fn().mockRejectedValue(error);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('ContentExtractor', () => {
  let extractor: ContentExtractor;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    extractor = new ContentExtractor();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  /* ---- constructor ---- */

  describe('constructor', () => {
    test('uses defaults when no options', () => {
      const e = new ContentExtractor();
      expect(e).toBeDefined();
    });

    test('accepts custom timeout and maxLength', () => {
      const e = new ContentExtractor({ timeout: 3000, maxLength: 500 });
      expect(e).toBeDefined();
    });

    test('accepts partial options (timeout only)', () => {
      const e = new ContentExtractor({ timeout: 8000 });
      expect(e).toBeDefined();
    });

    test('accepts partial options (maxLength only)', () => {
      const e = new ContentExtractor({ maxLength: 2000 });
      expect(e).toBeDefined();
    });

    test('accepts undefined options', () => {
      const e = new ContentExtractor(undefined);
      expect(e).toBeDefined();
    });
  });

  /* ---- extract - HTML content ---- */

  describe('extract - HTML', () => {
    test('fetches URL and converts HTML to markdown', async () => {
      const html = '<html><body><h1>Hello</h1><p>World</p></body></html>';
      globalThis.fetch = mockFetchOk(html);

      const result = await extractor.extract('https://example.com');
      expect(result).toContain('# Hello');
      expect(result).toContain('World');
    });

    test('sends correct headers', async () => {
      globalThis.fetch = mockFetchOk('<p>ok</p>');
      await extractor.extract('https://example.com');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('Beeclaw'),
            Accept: expect.stringContaining('text/html'),
          }),
          signal: expect.any(AbortSignal),
        }),
      );
    });

    test('uses default maxLength (10000) when not specified', async () => {
      const long = '<p>' + 'x'.repeat(20000) + '</p>';
      globalThis.fetch = mockFetchOk(long);

      const result = await extractor.extract('https://example.com');
      // 10000 + truncation suffix
      expect(result.length).toBeLessThanOrEqual(10100);
      expect(result).toContain('... (content truncated)');
    });

    test('uses custom maxLength from extract options', async () => {
      const long = '<p>' + 'x'.repeat(1000) + '</p>';
      globalThis.fetch = mockFetchOk(long);

      const result = await extractor.extract('https://example.com', { maxLength: 50 });
      expect(result.length).toBeLessThanOrEqual(80);
    });

    test('uses default maxLength from constructor when extract options omit it', async () => {
      const e = new ContentExtractor({ maxLength: 30 });
      const long = '<p>' + 'a'.repeat(500) + '</p>';
      globalThis.fetch = mockFetchOk(long);

      const result = await e.extract('https://example.com');
      expect(result.length).toBeLessThanOrEqual(80);
    });

    test('uses default timeout from constructor', async () => {
      globalThis.fetch = mockFetchOk('<p>ok</p>');
      const result = await extractor.extract('https://example.com');
      expect(result).toBeDefined();
    });

    test('uses custom timeout from extract options', async () => {
      globalThis.fetch = mockFetchOk('<p>ok</p>');
      const result = await extractor.extract('https://example.com', { timeout: 30000 });
      expect(result).toBeDefined();
    });
  });

  /* ---- extract - non-HTML content ---- */

  describe('extract - JSON content', () => {
    test('returns formatted JSON for application/json', async () => {
      const data = { foo: 'bar', num: 42 };
      globalThis.fetch = mockFetchJson(data);

      const result = await extractor.extract('https://api.example.com/data');
      expect(result).toContain('"foo"');
      expect(result).toContain('"bar"');
      expect(result).toContain('42');
    });

    test('truncates JSON to maxLength', async () => {
      const data = { long: 'x'.repeat(5000) };
      globalThis.fetch = mockFetchJson(data);

      const result = await extractor.extract('https://api.example.com/data', { maxLength: 50 });
      expect(result.length).toBeLessThanOrEqual(50);
    });
  });

  describe('extract - plain text / other content types', () => {
    test('returns raw text for non-HTML non-JSON', async () => {
      const text = 'Some plain text content here';
      const headers = new Map([['content-type', 'text/plain']]);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: (k: string) => headers.get(k) ?? null },
        text: vi.fn().mockResolvedValue(text),
      });

      const result = await extractor.extract('https://example.com/file.txt');
      expect(result).toBe(text);
    });

    test('truncates plain text to maxLength', async () => {
      const text = 'y'.repeat(200);
      const headers = new Map([['content-type', 'text/plain']]);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: (k: string) => headers.get(k) ?? null },
        text: vi.fn().mockResolvedValue(text),
      });

      const result = await extractor.extract('https://example.com/file.txt', { maxLength: 50 });
      expect(result.length).toBe(50);
    });

    test('handles missing content-type header (null)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: vi.fn().mockResolvedValue('raw content'),
      });

      const result = await extractor.extract('https://example.com/unknown');
      expect(result).toBe('raw content');
    });
  });

  /* ---- extract - error handling ---- */

  describe('extract - errors', () => {
    test('throws on non-ok HTTP status', async () => {
      globalThis.fetch = mockFetchStatus(404);
      await expect(extractor.extract('https://example.com/404')).rejects.toThrow('Failed to fetch: 404');
    });

    test('throws on 500 status', async () => {
      globalThis.fetch = mockFetchStatus(500);
      await expect(extractor.extract('https://example.com/500')).rejects.toThrow('Failed to fetch: 500');
    });

    test('converts AbortError to "Content extraction timeout"', async () => {
      const abortError = new DOMException('signal is aborted', 'AbortError');
      globalThis.fetch = mockFetchError(abortError);

      await expect(extractor.extract('https://example.com')).rejects.toThrow('Content extraction timeout');
    });

    test('re-throws non-abort errors as-is', async () => {
      const err = new Error('Network failure');
      globalThis.fetch = mockFetchError(err);

      await expect(extractor.extract('https://example.com')).rejects.toThrow('Network failure');
    });

    test('re-throws non-Error objects', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue('string error');
      await expect(extractor.extract('https://example.com')).rejects.toBe('string error');
    });
  });

  /* ---- htmlToMarkdown ---- */

  describe('htmlToMarkdown - tag stripping', () => {
    test('removes <script> tags and content', async () => {
      const html = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).not.toContain('alert');
      expect(result).not.toContain('script');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });

    test('removes <style> tags and content', async () => {
      const html = '<p>A</p><style>.body{color:red}</style><p>B</p>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).not.toContain('color');
    });

    test('removes <nav> tags', async () => {
      const html = '<nav><a href="/">Home</a></nav><p>Content</p>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).toContain('Content');
    });

    test('removes <footer> tags', async () => {
      const html = '<p>Body</p><footer>Copyright 2024</footer>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).not.toContain('Copyright');
    });

    test('removes <header> tags', async () => {
      const html = '<header>Logo Nav</header><p>Main</p>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).not.toContain('Logo');
    });

    test('removes <aside> tags', async () => {
      const html = '<aside>Sidebar</aside><p>Content</p>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).not.toContain('Sidebar');
    });

    test('removes <form> tags', async () => {
      const html = '<form><input type="text"/></form><p>Content</p>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).not.toContain('input');
    });
  });

  describe('htmlToMarkdown - main content extraction', () => {
    test('extracts content from <article>', async () => {
      const html = '<div>Other</div><article><p>Article content</p></article>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).toContain('Article content');
    });

    test('extracts content from <main> when no <article>', async () => {
      const html = '<div>Other</div><main><p>Main content</p></main>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).toContain('Main content');
    });

    test('prefers <article> over <main>', async () => {
      const html = '<article><p>Article</p></article><main><p>Main</p></main>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).toContain('Article');
    });

    test('uses full content when no article or main', async () => {
      const html = '<body><p>Body content</p></body>';
      globalThis.fetch = mockFetchOk(html);
      const result = await extractor.extract('https://example.com');
      expect(result).toContain('Body content');
    });
  });

  describe('htmlToMarkdown - heading conversion', () => {
    test('converts h1 to # heading', async () => {
      globalThis.fetch = mockFetchOk('<h1>Title</h1>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('# Title');
    });

    test('converts h2 to ## heading', async () => {
      globalThis.fetch = mockFetchOk('<h2>Sub</h2>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('## Sub');
    });

    test('converts h3 to ### heading', async () => {
      globalThis.fetch = mockFetchOk('<h3>H3</h3>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('### H3');
    });

    test('converts h4 to #### heading', async () => {
      globalThis.fetch = mockFetchOk('<h4>H4</h4>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('#### H4');
    });

    test('converts h5 to ##### heading', async () => {
      globalThis.fetch = mockFetchOk('<h5>H5</h5>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('##### H5');
    });

    test('converts h6 to ###### heading', async () => {
      globalThis.fetch = mockFetchOk('<h6>H6</h6>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('###### H6');
    });
  });

  describe('htmlToMarkdown - inline formatting', () => {
    test('converts links to markdown links', async () => {
      globalThis.fetch = mockFetchOk('<a href="https://x.com">Link</a>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('[Link](https://x.com)');
    });

    test('converts <b> to bold', async () => {
      globalThis.fetch = mockFetchOk('<b>Bold</b>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('**Bold**');
    });

    test('converts <strong> to bold', async () => {
      globalThis.fetch = mockFetchOk('<strong>Strong</strong>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('**Strong**');
    });

    test('converts <i> to italic', async () => {
      globalThis.fetch = mockFetchOk('<i>Italic</i>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('*Italic*');
    });

    test('converts <em> to italic', async () => {
      globalThis.fetch = mockFetchOk('<em>Emphasis</em>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('*Emphasis*');
    });

    test('converts <code> to inline code', async () => {
      globalThis.fetch = mockFetchOk('<code>const x = 1</code>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('`const x = 1`');
    });

    test('converts <pre> to code block', async () => {
      globalThis.fetch = mockFetchOk('<pre>function foo() {}</pre>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('```');
      expect(r).toContain('function foo() {}');
    });
  });

  describe('htmlToMarkdown - lists', () => {
    test('converts <li> to dash list items', async () => {
      globalThis.fetch = mockFetchOk('<ul><li>Item 1</li><li>Item 2</li></ul>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('- Item 1');
      expect(r).toContain('- Item 2');
    });

    test('converts ordered list items the same way', async () => {
      globalThis.fetch = mockFetchOk('<ol><li>First</li><li>Second</li></ol>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('- First');
      expect(r).toContain('- Second');
    });
  });

  describe('htmlToMarkdown - blockquotes', () => {
    test('converts blockquote to > prefix', async () => {
      globalThis.fetch = mockFetchOk('<blockquote>Quote text</blockquote>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('> Quote text');
    });
  });

  describe('htmlToMarkdown - images', () => {
    test('removes images when includeImages is false (default)', async () => {
      globalThis.fetch = mockFetchOk('<img src="https://img.com/a.png" alt="Photo"/>');
      const r = await extractor.extract('https://e.com');
      expect(r).not.toContain('![');
      expect(r).not.toContain('img.com');
    });

    test('converts images with alt text when includeImages is true', async () => {
      globalThis.fetch = mockFetchOk('<img src="https://img.com/a.png" alt="Photo"/>');
      const r = await extractor.extract('https://e.com', { includeImages: true });
      expect(r).toContain('![Photo](https://img.com/a.png)');
    });

    test('converts images without alt text when includeImages is true', async () => {
      globalThis.fetch = mockFetchOk('<img src="https://img.com/b.png"/>');
      const r = await extractor.extract('https://e.com', { includeImages: true });
      expect(r).toContain('![](https://img.com/b.png)');
    });
  });

  describe('htmlToMarkdown - paragraphs and breaks', () => {
    test('converts <br> to newline', async () => {
      globalThis.fetch = mockFetchOk('Line1<br/>Line2');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('Line1');
      expect(r).toContain('Line2');
    });

    test('converts <p> to paragraphs', async () => {
      globalThis.fetch = mockFetchOk('<p>Para1</p><p>Para2</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('Para1');
      expect(r).toContain('Para2');
    });

    test('converts <div> to blocks', async () => {
      globalThis.fetch = mockFetchOk('<div>Div1</div><div>Div2</div>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('Div1');
      expect(r).toContain('Div2');
    });
  });

  describe('htmlToMarkdown - remaining tag removal', () => {
    test('strips unknown HTML tags', async () => {
      globalThis.fetch = mockFetchOk('<span class="x">Text</span><custom>More</custom>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('Text');
      expect(r).toContain('More');
      expect(r).not.toContain('<span');
      expect(r).not.toContain('<custom');
    });
  });

  describe('htmlToMarkdown - HTML entity decoding', () => {
    test('decodes &nbsp;', async () => {
      globalThis.fetch = mockFetchOk('<p>Hello&nbsp;World</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('Hello World');
    });

    test('decodes &amp;', async () => {
      globalThis.fetch = mockFetchOk('<p>A &amp; B</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('A & B');
    });

    test('decodes &lt; and &gt;', async () => {
      globalThis.fetch = mockFetchOk('<p>&lt;div&gt;</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('<div>');
    });

    test('decodes &quot;', async () => {
      globalThis.fetch = mockFetchOk('<p>&quot;quoted&quot;</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('"quoted"');
    });

    test('decodes numeric entities &#NNN;', async () => {
      globalThis.fetch = mockFetchOk('<p>&#65;&#66;&#67;</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('ABC');
    });

    test('decodes hex entities &#xNN;', async () => {
      globalThis.fetch = mockFetchOk('<p>&#x41;&#x42;</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).toContain('AB');
    });
  });

  describe('htmlToMarkdown - whitespace cleanup', () => {
    test('normalizes \\r\\n to \\n', async () => {
      globalThis.fetch = mockFetchOk('<p>Line1</p>\r\n\r\n<p>Line2</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).not.toContain('\r');
    });

    test('normalizes \\r to \\n', async () => {
      globalThis.fetch = mockFetchOk('<p>A</p>\r<p>B</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).not.toContain('\r');
    });

    test('collapses 3+ newlines to 2', async () => {
      globalThis.fetch = mockFetchOk('<p>A</p>\n\n\n\n\n<p>B</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).not.toMatch(/\n{3,}/);
    });

    test('collapses multiple spaces to single', async () => {
      globalThis.fetch = mockFetchOk('<p>A     B</p>');
      const r = await extractor.extract('https://e.com');
      expect(r).not.toMatch(/  /);
    });

    test('trims result', async () => {
      globalThis.fetch = mockFetchOk('  <p>Content</p>  ');
      const r = await extractor.extract('https://e.com');
      expect(r).toBe(r.trim());
    });
  });

  describe('htmlToMarkdown - truncation', () => {
    test('truncates and appends marker when content exceeds maxLength', async () => {
      const html = '<p>' + 'z'.repeat(200) + '</p>';
      globalThis.fetch = mockFetchOk(html);
      const r = await extractor.extract('https://e.com', { maxLength: 50 });
      expect(r).toContain('... (content truncated)');
      expect(r.indexOf('... (content truncated)')).toBeGreaterThan(0);
    });

    test('does not truncate when content is under maxLength', async () => {
      globalThis.fetch = mockFetchOk('<p>Short</p>');
      const r = await extractor.extract('https://e.com', { maxLength: 1000 });
      expect(r).not.toContain('truncated');
    });
  });

  /* ---- comprehensive HTML conversion ---- */

  describe('htmlToMarkdown - combined elements', () => {
    test('converts a realistic HTML page', async () => {
      const html = '<html><head><style>body{margin:0}</style></head><body><header><nav><a href="/">Home</a></nav></header><article><h1>Article Title</h1><p>First paragraph with <strong>bold</strong> and <em>italic</em> text.</p><h2>Section Two</h2><p>A <a href="https://link.com">link here</a>.</p><ul><li>Item A</li><li>Item B</li></ul><blockquote>Famous quote</blockquote><pre>code block</pre><p>Entity test: &amp; &lt; &gt; &quot;</p></article><footer>Copyright</footer><script>evil()</script></body></html>';
      globalThis.fetch = mockFetchOk(html);
      const r = await extractor.extract('https://e.com');

      expect(r).toContain('# Article Title');
      expect(r).toContain('## Section Two');
      expect(r).toContain('**bold**');
      expect(r).toContain('*italic*');
      expect(r).toContain('[link here](https://link.com)');
      expect(r).toContain('- Item A');
      expect(r).toContain('- Item B');
      expect(r).toContain('> Famous quote');
      expect(r).toContain('```');
      expect(r).toContain('code block');
      expect(r).toContain('& < > "');
      expect(r).not.toContain('Copyright');
      expect(r).not.toContain('evil');
      expect(r).not.toContain('Home');
    });
  });
});

/* ------------------------------------------------------------------ */
/*  getContentExtractor singleton                                     */
/* ------------------------------------------------------------------ */

describe('getContentExtractor', () => {
  test('returns a ContentExtractor instance', () => {
    const instance = getContentExtractor();
    expect(instance).toBeInstanceOf(ContentExtractor);
  });

  test('returns the same instance on repeated calls (singleton)', () => {
    const a = getContentExtractor();
    const b = getContentExtractor();
    const c = getContentExtractor();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

/* ------------------------------------------------------------------ */
/*  ExtractOptions interface                                          */
/* ------------------------------------------------------------------ */

describe('ExtractOptions interface', () => {
  test('accepts all fields', () => {
    const opts: ExtractOptions = { maxLength: 100, timeout: 5000, includeImages: true };
    expect(opts.maxLength).toBe(100);
  });

  test('accepts empty object', () => {
    const opts: ExtractOptions = {};
    expect(opts).toBeDefined();
  });
});
