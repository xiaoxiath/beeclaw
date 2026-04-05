/**
 * bee — Context compression barrel export.
 */

export type {
  CompressionLevel,
  CompressionResult,
  CompressionPlan,
  CompressionLLMClient,
  CompressionStats,
  AgeZone,
} from './types';

export {
  createEmptyStats,
  DEFAULT_AGE_ZONES,
} from './types';

export {
  L1FormatCompressor,
  type CompressionRule,
} from './l1-format-compressor';

export {
  L2ExtractiveCompressor,
} from './l2-extractive-compressor';

export {
  L3AbstractiveCompressor,
} from './l3-abstractive-compressor';

export {
  TieredCompressor,
  type CompressionPlan as TieredCompressionPlan,
} from './tiered-compressor';
