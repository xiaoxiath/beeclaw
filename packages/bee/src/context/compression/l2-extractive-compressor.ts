/**
 * bee — L2 Extractive Compressor.
 *
 * Compress text by extracting key sentences using TextRank algorithm.
 * Compression rate: 30-60%, Information retention: ~85%, Latency: ~10ms
 *
 * Extracted from beeclaw's src/domain/agent/compression/l2-extractive-compressor.ts.
 * Changes: uses bee's estimateTokens, no singleton.
 */

import { estimateTokens } from '../token-estimator';
import type { CompressionResult } from './types';

interface ScoredSentence {
  index: number;
  text: string;
  score: number;
}

export class L2ExtractiveCompressor {
  readonly name = 'L2-Extractive';

  private damping: number;
  private iterations: number;
  private minSentences: number;

  constructor(config?: {
    damping?: number;
    iterations?: number;
    minSentences?: number;
  }) {
    this.damping = config?.damping ?? 0.85;
    this.iterations = config?.iterations ?? 20;
    this.minSentences = config?.minSentences ?? 3;
  }

  compress(text: string, targetRatio: number = 0.5): CompressionResult {
    const startTime = Date.now();
    const originalTokens = estimateTokens(text);

    const sentences = this.splitSentences(text);

    if (sentences.length <= this.minSentences) {
      return {
        compressed: text,
        originalTokens,
        compressedTokens: originalTokens,
        ratio: 0,
        infoRetention: 1.0,
        method: 'L2-Extractive[skipped:too_few_sentences]',
        latencyMs: Date.now() - startTime,
      };
    }

    const simMatrix = this.buildSimilarityMatrix(sentences);
    const scores = this.textRank(simMatrix, sentences.length);

    const scored: ScoredSentence[] = sentences.map((s, i) => ({
      index: i,
      text: s,
      score: scores[i],
    }));

    scored.sort((a, b) => b.score - a.score);
    const keepCount = Math.max(this.minSentences, Math.ceil(sentences.length * targetRatio));
    const selected = scored.slice(0, keepCount);

    // Restore original order
    selected.sort((a, b) => a.index - b.index);

    const compressed = selected.map(s => s.text).join(' ');
    const compressedTokens = estimateTokens(compressed);
    const latencyMs = Date.now() - startTime;

    return {
      compressed,
      originalTokens,
      compressedTokens,
      ratio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
      infoRetention: 0.85,
      method: `L2-Extractive[kept ${selected.length}/${sentences.length} sentences]`,
      latencyMs,
    };
  }

  private splitSentences(text: string): string[] {
    const sentences = text
      .split(/(?<=[.!?。！？])\s+(?=[A-Z\u4e00-\u9fff])/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (sentences.length < 2) {
      return text
        .split(/[.!?。！？]/)
        .map(s => s.trim())
        .filter(s => s.length > 10);
    }

    return sentences;
  }

  private buildSimilarityMatrix(sentences: string[]): number[][] {
    const n = sentences.length;
    const wordSets = sentences.map(s => {
      const words = s.toLowerCase().split(/\s+/);
      return new Set(words.filter(w => w.length > 2));
    });

    const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = this.sentenceSimilarity(wordSets[i], wordSets[j]);
        matrix[i][j] = sim;
        matrix[j][i] = sim;
      }
    }

    return matrix;
  }

  private sentenceSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 || setB.size === 0) return 0;

    const intersection = [...setA].filter(w => setB.has(w)).length;
    const denom = Math.log(setA.size + 1) + Math.log(setB.size + 1);

    return denom > 0 ? intersection / denom : 0;
  }

  private textRank(matrix: number[][], n: number): number[] {
    let scores = new Array(n).fill(1 / n);

    for (let iter = 0; iter < this.iterations; iter++) {
      const newScores = new Array(n).fill(0);

      for (let i = 0; i < n; i++) {
        let sum = 0;

        for (let j = 0; j < n; j++) {
          if (i === j) continue;

          const rowSum = matrix[j].reduce((a, b) => a + b, 0);
          if (rowSum > 0) {
            sum += (matrix[j][i] / rowSum) * scores[j];
          }
        }

        newScores[i] = (1 - this.damping) / n + this.damping * sum;
      }

      scores = newScores;
    }

    return scores;
  }
}
