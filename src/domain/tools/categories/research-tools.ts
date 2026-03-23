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

import type { OpenAITool } from '../../agent/types';

/** All research-oriented tool definitions. */
export const researchTools: OpenAITool[] = [
  // Lazy-loaded to avoid circular dependency
  // Tools are imported by consumers via individual exports above
];
