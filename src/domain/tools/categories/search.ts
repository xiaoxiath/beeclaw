/**
 * Search & web tools
 *
 * Re-export from focused submodules for modular imports.
 * Usage: import { webSearchTool } from '../tools/categories/search';
 */
export {
  webSearchTool,
  executeWebSearch,
  webFetchTool,
  executeWebFetch,
} from '../search-tools';

export {
  deepResearchTool,
  executeDeepResearch,
  DeepResearchSchema,
} from '../deep-research-tools';
