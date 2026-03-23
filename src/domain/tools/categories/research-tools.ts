/**
 * Research Tools — Extracted from builtin.ts (Phase 4)
 *
 * Re-exports research-related tools for modular access.
 */
export {
  webSearchTool,
  executeWebSearch,
  WebSearchSchema,
  webFetchTool,
  executeWebFetch,
  WebFetchSchema,
  deepResearchTool,
  executeDeepResearch,
  DeepResearchSchema,
} from '../builtin';

import {
  webSearchTool,
  webFetchTool,
  deepResearchTool,
} from '../builtin';

/** All research-oriented tool definitions. */
export const researchTools = [
  webSearchTool,
  webFetchTool,
  deepResearchTool,
];
