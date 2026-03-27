import { describe, it, expect, mock } from 'bun:test';

// Mock upstream modules
mock.module('../../search-tools', () => ({
  webSearchTool: { name: 'web_search' },
  executeWebSearch: mock(() => Promise.resolve({ success: true })),
  webFetchTool: { name: 'web_fetch' },
  executeWebFetch: mock(() => Promise.resolve({ success: true })),
}));

mock.module('../../deep-research-tools', () => ({
  deepResearchTool: { name: 'deep_research' },
  executeDeepResearch: mock(() => Promise.resolve({ success: true })),
  DeepResearchSchema: {},
}));

import {
  webSearchTool,
  executeWebSearch,
  webFetchTool,
  executeWebFetch,
  deepResearchTool,
  executeDeepResearch,
  DeepResearchSchema,
} from '../search';

describe('categories/search re-exports', () => {
  it('exports webSearchTool', () => {
    expect(webSearchTool).toBeDefined();
    expect(webSearchTool.name).toBe('web_search');
  });

  it('exports executeWebSearch as function', () => {
    expect(typeof executeWebSearch).toBe('function');
  });

  it('exports webFetchTool', () => {
    expect(webFetchTool).toBeDefined();
    expect(webFetchTool.name).toBe('web_fetch');
  });

  it('exports executeWebFetch as function', () => {
    expect(typeof executeWebFetch).toBe('function');
  });

  it('exports deepResearchTool', () => {
    expect(deepResearchTool).toBeDefined();
    expect(deepResearchTool.name).toBe('deep_research');
  });

  it('exports executeDeepResearch as function', () => {
    expect(typeof executeDeepResearch).toBe('function');
  });

  it('exports DeepResearchSchema', () => {
    expect(DeepResearchSchema).toBeDefined();
  });
});
