/**
 * Tests for the compression system (L1, L2, L3, TieredCompressor).
 *
 * TDD: Tests written first, then implementation.
 */

import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../token-estimator';
import { L1FormatCompressor } from './l1-format-compressor';
import { L2ExtractiveCompressor } from './l2-extractive-compressor';
import { L3AbstractiveCompressor } from './l3-abstractive-compressor';
import { TieredCompressor } from './tiered-compressor';
import type { CompressionLLMClient, CompressionResult } from './types';

// ============================================================================
// L1 Format Compressor
// ============================================================================

describe('L1FormatCompressor', () => {
  const compressor = new L1FormatCompressor();

  it('should collapse multiple newlines', () => {
    const input = 'Hello\n\n\n\nWorld';
    const result = compressor.compress(input);
    expect(result.compressed).toBe('Hello\n\nWorld');
    expect(result.ratio).toBeGreaterThan(0);
  });

  it('should remove HTML comments', () => {
    const input = 'Before <!-- this is a comment --> After';
    const result = compressor.compress(input);
    expect(result.compressed).toBe('Before  After');
  });

  it('should collapse multiple spaces', () => {
    const input = 'Hello     World';
    const result = compressor.compress(input);
    expect(result.compressed).toBe('Hello World');
  });

  it('should normalize bullet points', () => {
    const input = '* Item 1\n+ Item 2\n- Item 3';
    const result = compressor.compress(input);
    expect(result.compressed).not.toContain('* Item');
    expect(result.compressed).not.toContain('+ Item');
    // All should use -
    const lines = result.compressed.split('\n');
    expect(lines[0]).toMatch(/^- Item/);
  });

  it('should remove zero-width characters', () => {
    const input = 'Hello\u200bWorld\ufeff!';
    const result = compressor.compress(input);
    expect(result.compressed).toBe('HelloWorld!');
  });

  it('should trim trailing whitespace on lines', () => {
    const input = 'Line 1   \nLine 2\t\n';
    const result = compressor.compress(input);
    // Lines should not have trailing spaces/tabs (but final \n is OK)
    const lines = result.compressed.split('\n').filter(l => l.length > 0);
    for (const line of lines) {
      expect(line).not.toMatch(/[ \t]+$/);
    }
  });

  it('should return correct metadata', () => {
    const result = compressor.compress('Test content');
    expect(result.method).toContain('L1');
    expect(result.infoRetention).toBeGreaterThanOrEqual(0.99);
    expect(result.latencyMs).toBeLessThan(100);
    expect(typeof result.originalTokens).toBe('number');
    expect(typeof result.compressedTokens).toBe('number');
  });

  it('should handle empty string', () => {
    const result = compressor.compress('');
    expect(result.compressed).toBe('');
    expect(result.ratio).toBe(0);
  });

  it('should support custom rules', () => {
    const custom = new L1FormatCompressor([{
      name: 'remove_emoji',
      pattern: /👋/g,
      replacement: '',
      description: 'Remove wave emoji',
    }]);
    const result = custom.compress('Hello 👋 World');
    expect(result.compressed).toBe('Hello  World');
  });

  it('should allow adding and removing rules', () => {
    const c = new L1FormatCompressor();
    c.addRule({
      name: 'test_rule',
      pattern: /TEST/g,
      replacement: 'test',
      description: 'Test',
    });
    const result = c.compress('hello TEST world');
    expect(result.compressed).toBe('hello test world');

    expect(c.removeRule('test_rule')).toBe(true);
    expect(c.removeRule('nonexistent')).toBe(false);
  });
});

// ============================================================================
// L2 Extractive Compressor
// ============================================================================

describe('L2ExtractiveCompressor', () => {
  const compressor = new L2ExtractiveCompressor();

  it('should extract key sentences from multi-sentence text', () => {
    const input = [
      'Machine learning is a subset of artificial intelligence.',
      'It focuses on building systems that learn from data.',
      'Deep learning is a specialized form of machine learning.',
      'Neural networks are the foundation of deep learning.',
      'These technologies have revolutionized many industries.',
      'Natural language processing enables computers to understand text.',
      'Computer vision allows machines to interpret images.',
      'Reinforcement learning trains agents through rewards.',
    ].join(' ');

    const result = compressor.compress(input, 0.5);

    expect(result.compressed.length).toBeLessThan(input.length);
    expect(result.compressed.split(/[.!?]/).length).toBeLessThan(
      input.split(/[.!?]/).length,
    );
    expect(result.infoRetention).toBeGreaterThanOrEqual(0.8);
    expect(result.method).toContain('L2');
  });

  it('should return as-is for too few sentences', () => {
    const input = 'Short text. Only two sentences.';
    const result = compressor.compress(input);
    expect(result.compressed).toBe(input);
    expect(result.method).toContain('skipped');
  });

  it('should respect target ratio', () => {
    const sentences = Array.from({ length: 20 }, (_, i) =>
      `Sentence number ${i + 1} contains some meaningful content about topics.`
    ).join(' ');

    const result50 = compressor.compress(sentences, 0.5);
    const result30 = compressor.compress(sentences, 0.3);

    // Lower ratio should result in fewer sentences kept
    const sentences50 = result50.compressed.split(/[.!?]/).filter(s => s.trim()).length;
    const sentences30 = result30.compressed.split(/[.!?]/).filter(s => s.trim()).length;
    expect(sentences30).toBeLessThanOrEqual(sentences50);
  });

  it('should handle Chinese text', () => {
    const input = '机器学习是人工智能的一个分支。它专注于从数据中学习的系统。深度学习是机器学习的特殊形式。神经网络是深度学习的基础。这些技术已经革命了许多行业。自然语言处理使计算机能理解文本。';

    const result = compressor.compress(input, 0.5);
    expect(result.compressed.length).toBeGreaterThan(0);
  });

  it('should return correct metadata', () => {
    const sentences = Array.from({ length: 10 }, (_, i) =>
      `This is sentence number ${i + 1} with some content.`
    ).join(' ');

    const result = compressor.compress(sentences);
    expect(result.method).toContain('L2');
    expect(typeof result.ratio).toBe('number');
    expect(typeof result.latencyMs).toBe('number');
  });
});

// ============================================================================
// L3 Abstractive Compressor
// ============================================================================

describe('L3AbstractiveCompressor', () => {
  it('should return as-is when no LLM client configured', async () => {
    const compressor = new L3AbstractiveCompressor();
    const input = 'Some text that is long enough to compress.';
    const result = await compressor.compress(input);

    expect(result.compressed).toBe(input);
    expect(result.method).toContain('no-llm');
  });

  it('should use LLM client to generate summary', async () => {
    const mockClient: CompressionLLMClient = {
      complete: async (prompt: string, maxTokens: number) => {
        return 'The text discusses machine learning and its applications.';
      },
    };

    const compressor = new L3AbstractiveCompressor({ llmClient: mockClient });
    const input = 'This is a long piece of text that contains multiple sentences. '.repeat(20).trim();
    const result = await compressor.compress(input);

    expect(result.compressed).toBe('The text discusses machine learning and its applications.');
    expect(result.method).toContain('llm-summary');
    expect(result.infoRetention).toBe(0.70);
  });

  it('should skip already small text', async () => {
    const mockClient: CompressionLLMClient = {
      complete: async () => 'should not be called',
    };

    const compressor = new L3AbstractiveCompressor({ llmClient: mockClient });
    const result = await compressor.compress('Short text', 200);

    expect(result.compressed).toBe('Short text');
    expect(result.method).toContain('skipped');
  });

  it('should fallback to truncation on LLM error', async () => {
    const failingClient: CompressionLLMClient = {
      complete: async () => { throw new Error('LLM unavailable'); },
    };

    const compressor = new L3AbstractiveCompressor({ llmClient: failingClient });
    const input = 'Word '.repeat(200).trim();
    const result = await compressor.compress(input, 50);

    expect(result.method).toContain('fallback');
    expect(result.method).toContain('truncate');
    expect(result.compressed.length).toBeGreaterThan(0);
  });

  it('should accept LLM client via setLLMClient', async () => {
    const compressor = new L3AbstractiveCompressor();
    compressor.setLLMClient({
      complete: async () => 'Condensed output here.',
    });

    const input = 'Long text. '.repeat(50).trim();
    const result = await compressor.compress(input);

    expect(result.compressed).toBe('Condensed output here.');
  });
});

// ============================================================================
// TieredCompressor
// ============================================================================

describe('TieredCompressor', () => {
  it('should plan L1 when utilization < 70%', () => {
    const compressor = new TieredCompressor();
    const plan = compressor.plan(50, 100); // 50% utilization

    expect(plan.level).toBe('L1');
    expect(plan.estimatedLatency).toBe('<1ms');
  });

  it('should plan L1+L2 when utilization 70-85%', () => {
    const compressor = new TieredCompressor();
    const plan = compressor.plan(75, 100); // 75% utilization

    expect(plan.level).toBe('L1+L2');
  });

  it('should plan L1+L2+L3 when utilization >= 85%', () => {
    const compressor = new TieredCompressor();
    const plan = compressor.plan(90, 100); // 90% utilization

    expect(plan.level).toBe('L1+L2+L3');
  });

  it('should execute L1 compression', async () => {
    const compressor = new TieredCompressor();
    const input = 'Hello\n\n\n\nWorld     !';
    const plan = compressor.plan(50, 100);

    const result = await compressor.execute(input, plan);

    expect(result.compressed).not.toContain('\n\n\n\n');
    expect(result.compressed).toContain('Hello');
    expect(result.compressed).toContain('World');
    expect(result.method).toContain('L1');
  });

  it('should execute L1+L2 compression', async () => {
    const compressor = new TieredCompressor();
    const sentences = Array.from({ length: 20 }, (_, i) =>
      `Sentence ${i + 1} about topic number ${i + 1}.`
    ).join(' ');
    const plan = compressor.plan(75, 100);

    const result = await compressor.execute(sentences, plan);

    expect(result.method).toContain('L1');
    expect(result.method).toContain('L2');
    expect(result.compressed.length).toBeLessThan(sentences.length);
  });

  it('should execute L1+L2+L3 with LLM client', async () => {
    const mockClient: CompressionLLMClient = {
      complete: async () => 'Compressed summary.',
    };
    const compressor = new TieredCompressor({ llmClient: mockClient });
    const input = 'Text '.repeat(100).trim();
    const plan = compressor.plan(90, 100);

    const result = await compressor.execute(input, plan);

    expect(result.method).toContain('L1');
    expect(result.method).toContain('L2');
    expect(result.method).toContain('L3');
  });

  it('should handle L3 internal fallback when LLM fails', async () => {
    const failingClient: CompressionLLMClient = {
      complete: async () => { throw new Error('LLM down'); },
    };
    const compressor = new TieredCompressor({ llmClient: failingClient });
    const input = Array.from({ length: 20 }, (_, i) =>
      `Sentence ${i + 1} about machine learning topics.`
    ).join(' ');
    const plan = compressor.plan(90, 100);

    const result = await compressor.execute(input, plan);

    // L3 catches its own error and uses truncation fallback
    expect(result.method).toContain('L3');
    expect(result.compressed).toBeDefined();
    expect(result.compressed.length).toBeGreaterThan(0);
  });

  it('should track statistics', async () => {
    const compressor = new TieredCompressor();
    const input = 'Hello\n\n\n\nWorld';

    await compressor.compress(input, 50, 100);
    await compressor.compress(input, 75, 100);

    const stats = compressor.getStats();
    expect(stats.totalCompressions).toBe(2);
    expect(stats.totalTokensSaved).toBeGreaterThanOrEqual(0);
  });

  it('should reset statistics', async () => {
    const compressor = new TieredCompressor();
    await compressor.compress('Test\n\n\n\nContent', 50, 100);

    compressor.resetStats();
    const stats = compressor.getStats();
    expect(stats.totalCompressions).toBe(0);
  });

  it('should compress with convenience method', async () => {
    const compressor = new TieredCompressor();
    const input = 'Text with   lots   of   spaces';
    const result = await compressor.compress(input);

    expect(result.compressed).toBeDefined();
    expect(result.ratio).toBeGreaterThanOrEqual(0);
  });
});
