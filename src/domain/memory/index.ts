export { MemoryStore, getMemoryStore, resetMemoryStore } from './store';
export { executeMemoryTool, getMemoryToolsForAI, memoryTools, MEMORY_TOOL_NAMES } from './tools';
export { MemoryCompression, getCompressionEngine, resetCompressionEngine, DEFAULT_COMPRESSION_CONFIG } from './compression';
export type { CompressionConfig, CompressionResult, SummaryEntry } from './compression';
export {
  scoreImportance,
  scoreMultiple,
  findDuplicates,
  calculateSimilarity,
  calculateRecencyScore,
  calculateFrequencyScore,
  calculateRelevanceScore,
  calculateUniquenessScore,
} from './scoring';
export type { ImportanceScore } from './scoring';
export type {
  MemoryConfig,
  MemoryCategory,
  ConversationEntry,
  Fact,
  DecisionRecord,
  Skill,
  MemoryToolResult,
} from './types';
export { MemoryConfigSchema } from './types';

// P0 优化：短期记忆缓存
export {
  ShortTermMemoryCache,
  getShortTermCache,
  resetShortTermCache,
  type ShortTermCacheConfig,
} from './short-term-cache';

// P0 优化：动态记忆注入
export {
  DynamicMemoryInjector,
  getDynamicMemoryInjector,
  resetDynamicMemoryInjector,
  type InjectorConfig,
} from './dynamic-injector';
