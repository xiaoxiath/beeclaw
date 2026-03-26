/**
 * Research Tools — Extracted from builtin.ts (Phase 4)
 *
 * Re-exports research-related tools for modular access.
 * Now imports directly from focused submodules instead of the builtin aggregator.
 */
export {
  webSearchTool,
  executeWebSearch,
  WebSearchSchema,
  webFetchTool,
  executeWebFetch,
  WebFetchSchema,
} from '../search-tools';

export {
  deepResearchTool,
  executeDeepResearch,
  DeepResearchSchema,
} from '../deep-research-tools';

import type { OpenAITool } from '../../agent/types';

/** All research-oriented tool definitions. */
export const researchTools: OpenAITool[] = [
  // INTENTIONALLY EMPTY — circular dependency guard.
  //
  // Consumers should import individual tools (webSearchTool, webFetchTool, deepResearchTool)
  // directly from this module rather than using this array.
];
