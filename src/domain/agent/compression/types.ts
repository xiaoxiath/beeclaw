/**
 * Context Compression Types — beeclaw wrapper
 *
 * Types re-exported from bee package. Only beeclaw-specific additions live here.
 */

export type {
  CompressionLevel,
  CompressionResult,
  CompressionPlan,
  CompressionStats,
  CompressionLLMClient,
  AgeZone,
  Compressor,
} from '@bee/context/compression/types';

export { DEFAULT_AGE_ZONES, createEmptyStats } from '@bee/context/compression/types';

/**
 * Message with turn number for progressive compaction (beeclaw-specific)
 */
export interface TimedMessage {
  turn: number;
  role: string;
  content: string;
}
