/**
 * [P1 FIX #15] Memory Compression with LLM-based Summarization
 *
 * Changes from original:
 * 1. generateSummary() now uses LLM for intelligent semantic compression
 *    instead of simple rule-based text truncation
 * 2. extractKeyFacts() uses LLM to extract structured facts when available
 * 3. Added LLM provider injection via setCompressionLLMProvider()
 * 4. Falls back to improved rule-based approach when LLM is unavailable
 * 5. Uses async/await pattern for LLM calls while maintaining sync fallbacks
 *
 * Replace: src/memory/compression.ts
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import { scoreImportance, scoreImportanceAsync, type ImportanceScore } from './scoring';
import { logger } from '../../infra/observability/logger';

// ---------------------------------------------------------------------------
// [P1 FIX #15] LLM Provider Interface
// ---------------------------------------------------------------------------

/**
 * Minimal interface for LLM calls used by memory compression.
 * Inject an implementation via setCompressionLLMProvider() at startup.
 */
export interface CompressionLLMProvider {
  /**
   * Generate a response from the LLM.
   */
  chat(messages: Array<{ role: string; content: string }>, maxTokens?: number): Promise<string>;
}

let _llmProvider: CompressionLLMProvider | null = null;

/**
 * Set the LLM provider for memory compression.
 *
 * Example:
 * ```typescript
 * import { callAI } from '../agent/api';
 *
 * setCompressionLLMProvider({
 *   async chat(messages, maxTokens = 500) {
 *     const response = await callAI({
 *       provider: yourProvider,
 *       model: 'glm-4-flash', // Use a cheap/fast model
 *       messages: messages as any,
 *       maxTokens,
 *     });
 *     return response.choices[0]?.message?.content || '';
 *   },
 * });
 * ```
 */
export function setCompressionLLMProvider(provider: CompressionLLMProvider): void {
  _llmProvider = provider;
  logger.info('[MemoryCompression] LLM provider configured for intelligent summarization');
}

export function getCompressionLLMProvider(): CompressionLLMProvider | null {
  return _llmProvider;
}

// ---------------------------------------------------------------------------
// Configuration (unchanged)
// ---------------------------------------------------------------------------

export interface CompressionConfig {
  autoCompress: boolean;
  compressAfterDays: number;
  runSchedule: string;
  keepOriginalDays: number;
  archiveAfterDays: number;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  autoCompress: true,
  compressAfterDays: 7,
  runSchedule: '0 3 * * *',
  keepOriginalDays: 7,
  archiveAfterDays: 90,
};

export interface CompressionResult {
  processed: number;
  summarized: number;
  archived: number;
  deleted: number;
  errors: string[];
}

export interface SummaryEntry {
  originalFile: string;
  originalDate: string;
  summary: string;
  keyFacts: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Memory Compression Engine (enhanced)
// ---------------------------------------------------------------------------

export class MemoryCompression {
  private basePath: string;
  private config: CompressionConfig;
  private logPath: string;
  private consolidatedPath: string;
  private archivePath: string;

  constructor(basePath: string, config?: Partial<CompressionConfig>) {
    this.basePath = basePath;
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
    this.logPath = join(basePath, 'compression-log.json');
    this.consolidatedPath = join(basePath, 'consolidated');
    this.archivePath = join(basePath, 'archive');
  }

  init(): void {
    if (!existsSync(this.consolidatedPath)) {
      mkdirSync(this.consolidatedPath, { recursive: true });
    }
    if (!existsSync(this.archivePath)) {
      mkdirSync(this.archivePath, { recursive: true });
    }
  }

  async compress(options?: {
    dryRun?: boolean;
    force?: boolean;
  }): Promise<CompressionResult> {
    this.init();

    const result: CompressionResult = {
      processed: 0,
      summarized: 0,
      archived: 0,
      deleted: 0,
      errors: [],
    };

    const conversationsPath = join(this.basePath, 'conversations');
    if (!existsSync(conversationsPath)) {
      return result;
    }

    const now = Date.now();
    const compressThreshold = this.config.compressAfterDays * 24 * 60 * 60 * 1000;
    const archiveThreshold = this.config.archiveAfterDays * 24 * 60 * 60 * 1000;

    const monthDirs = readdirSync(conversationsPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
      .map(e => e.name);

    for (const monthDir of monthDirs) {
      const monthPath = join(conversationsPath, monthDir);
      const dayFiles = readdirSync(monthPath)
        .filter(f => f.endsWith('.md'));

      for (const dayFile of dayFiles) {
        const filePath = join(monthPath, dayFile);
        const stats = statSync(filePath);
        const ageMs = now - stats.mtimeMs;

        result.processed++;

        if (!options?.force && ageMs < compressThreshold) {
          continue;
        }

        try {
          const content = readFileSync(filePath, 'utf-8');

          // [P1 FIX #15] Use async scoring when embedding provider is available
          let score: ImportanceScore;
          try {
            score = await scoreImportanceAsync({
              content,
              timestamp: stats.mtime.toISOString(),
            });
          } catch {
            score = scoreImportance({
              content,
              timestamp: stats.mtime.toISOString(),
            });
          }

          switch (score.recommendation) {
            case 'summarize':
              if (!options?.dryRun) {
                await this.summarizeConversation(filePath, monthDir, dayFile);
              }
              result.summarized++;
              break;

            case 'archive':
              if (ageMs > archiveThreshold) {
                if (!options?.dryRun) {
                  this.archiveFile(filePath, monthDir, dayFile);
                }
                result.archived++;
              } else if (!options?.dryRun) {
                await this.summarizeConversation(filePath, monthDir, dayFile);
                result.summarized++;
              }
              break;

            case 'delete':
              if (!options?.dryRun) {
                rmSync(filePath);
              }
              result.deleted++;
              break;

            case 'keep':
              break;
          }
        } catch (error) {
          result.errors.push(`Failed to process ${monthDir}/${dayFile}: ${error}`);
        }
      }
    }

    this.logCompressionRun(result);
    return result;
  }

  /**
   * Summarize a conversation file.
   * [P1 FIX #15] Now uses LLM when available for intelligent summarization.
   */
  private async summarizeConversation(
    filePath: string,
    monthDir: string,
    dayFile: string
  ): Promise<void> {
    const content = readFileSync(filePath, 'utf-8');

    let summary: string;
    let keyFacts: string[];

    if (_llmProvider) {
      // [P1 FIX #15] LLM-based summarization
      try {
        const llmResult = await this.generateSummaryWithLLM(content);
        summary = llmResult.summary;
        keyFacts = llmResult.keyFacts;
        logger.info(`[MemoryCompression] LLM summary for ${monthDir}/${dayFile}: ${summary.length} chars, ${keyFacts.length} facts`);
      } catch (error) {
        logger.warn(`[MemoryCompression] LLM summary failed for ${monthDir}/${dayFile}, using rule-based fallback:`, error);
        summary = this.generateSummaryRuleBased(content);
        keyFacts = this.extractKeyFactsRuleBased(content);
      }
    } else {
      // Rule-based fallback (improved from original)
      summary = this.generateSummaryRuleBased(content);
      keyFacts = this.extractKeyFactsRuleBased(content);
    }

    const entry: SummaryEntry = {
      originalFile: `${monthDir}/${dayFile}`,
      originalDate: dayFile.replace('.md', ''),
      summary,
      keyFacts,
      createdAt: new Date().toISOString(),
    };

    const consolidatedFile = join(this.consolidatedPath, `${monthDir}-summary.json`);
    let summaries: SummaryEntry[] = [];

    if (existsSync(consolidatedFile)) {
      try {
        summaries = JSON.parse(readFileSync(consolidatedFile, 'utf-8'));
      } catch {
        summaries = [];
      }
    }

    summaries.push(entry);
    writeFileSync(consolidatedFile, JSON.stringify(summaries, null, 2), 'utf-8');
    rmSync(filePath);
  }

  /**
   * [P1 FIX #15] NEW: LLM-based conversation summarization.
   *
   * Generates a semantic summary that:
   * 1. Preserves user's core questions and final conclusions
   * 2. Extracts structured key facts (preferences, decisions, important info)
   * 3. Compresses to ~20-30% of original length
   */
  private async generateSummaryWithLLM(content: string): Promise<{ summary: string; keyFacts: string[] }> {
    if (!_llmProvider) {
      throw new Error('LLM provider not configured');
    }

    // Truncate very long conversations to avoid exceeding model context
    const maxInputChars = 8000;
    const truncatedContent = content.length > maxInputChars
      ? content.slice(0, maxInputChars / 2) + '\n\n... [中间内容省略] ...\n\n' + content.slice(-maxInputChars / 2)
      : content;

    const response = await _llmProvider.chat([
      {
        role: 'system',
        content: '你是对话记忆压缩专家。你的任务是将对话记录压缩为简洁但信息完整的摘要，同时提取值得长期保留的关键事实。',
      },
      {
        role: 'user',
        content: `请压缩以下对话记录：

${truncatedContent}

## 输出要求

### 摘要
按主题组织（不要按时间流水账），保留：
- 用户的核心问题和最终需求
- 关键决定和结论
- 工具调用的成功/失败结果（概要）
- 用户的情绪和态度变化

### 关键事实
提取值得长期保留的信息，每条一行，格式为"- [事实]"：
- 用户偏好和习惯
- 重要决定和承诺
- 个人信息（名字、角色、位置等）
- 项目名称和关键技术选型
- 需要后续跟进的事项

请按以下格式输出：

SUMMARY_START
[摘要内容]
SUMMARY_END

FACTS_START
- [事实1]
- [事实2]
FACTS_END`,
      },
    ], 800);

    // Parse response
    const summaryMatch = response.match(/SUMMARY_START\s*\n([\s\S]*?)\nSUMMARY_END/);
    const factsMatch = response.match(/FACTS_START\s*\n([\s\S]*?)\nFACTS_END/);

    const summary = summaryMatch?.[1]?.trim() || response.slice(0, 500);
    const factsText = factsMatch?.[1]?.trim() || '';
    const keyFacts = factsText
      .split('\n')
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 2);

    return { summary, keyFacts };
  }

  /**
   * Rule-based summary generation (improved from original).
   * Kept as fallback when LLM is unavailable.
   */
  private generateSummaryRuleBased(content: string): string {
    const lines = content.split('\n');
    const sections: string[] = [];
    let currentSection = '';

    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (currentSection) {
          sections.push(currentSection.trim());
        }
        currentSection = line + '\n';
      } else if (line.startsWith('**用户**：') || line.startsWith('**User**:')) {
        currentSection += line + '\n';
      } else if (line.startsWith('**助手**：') || line.startsWith('**Assistant**:')) {
        const truncated = line.length > 200 ? line.slice(0, 200) + '...' : line;
        currentSection += truncated + '\n';
      }
    }

    if (currentSection) {
      sections.push(currentSection.trim());
    }

    return sections.slice(0, 3).join('\n\n---\n\n');
  }

  /**
   * Rule-based key fact extraction (improved from original).
   * Added more patterns and Chinese language support.
   */
  private extractKeyFactsRuleBased(content: string): string[] {
    const facts: string[] = [];
    const lines = content.split('\n');

    const patterns = [
      // Decision markers
      /\*\*关键决策\*\*[：:]\s*(.+)/,
      /\*\*决策\*\*[：:]\s*(.+)/,
      /\*\*Decision\*\*[：:]\s*(.+)/,
      // Important info
      /重要[：:]\s*(.+)/,
      /Important[：:]\s*(.+)/,
      /注意[：:]\s*(.+)/,
      /Note[：:]\s*(.+)/,
      // Preferences (new)
      /偏好[：:]\s*(.+)/,
      /习惯[：:]\s*(.+)/,
      /(?:我|用户)(?:喜欢|不喜欢|偏好|习惯)[：:]?\s*(.+)/,
      // Conclusions (new)
      /(?:结论|总结)[：:]\s*(.+)/,
      /(?:最终|确定)[：:]\s*(.+)/,
    ];

    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          const fact = match[1].trim();
          if (fact.length > 5 && !facts.includes(fact)) {
            facts.push(fact);
          }
        }
      }
    }

    return facts.slice(0, 10); // Max 10 facts
  }

  // Archive a file (unchanged)
  private archiveFile(filePath: string, monthDir: string, dayFile: string): void {
    const archiveMonthPath = join(this.archivePath, monthDir);
    if (!existsSync(archiveMonthPath)) {
      mkdirSync(archiveMonthPath, { recursive: true });
    }

    const content = readFileSync(filePath, 'utf-8');
    const archiveFile = join(archiveMonthPath, dayFile);

    const archived = {
      originalPath: `${monthDir}/${dayFile}`,
      archivedAt: new Date().toISOString(),
      content,
    };

    writeFileSync(archiveFile + '.json', JSON.stringify(archived, null, 2), 'utf-8');
    rmSync(filePath);
  }

  // Log compression run (unchanged)
  private logCompressionRun(result: CompressionResult): void {
    let log: Array<{ timestamp: string; result: CompressionResult }> = [];

    if (existsSync(this.logPath)) {
      try {
        log = JSON.parse(readFileSync(this.logPath, 'utf-8'));
      } catch {
        log = [];
      }
    }

    log.push({ timestamp: new Date().toISOString(), result });
    if (log.length > 30) log = log.slice(-30);
    writeFileSync(this.logPath, JSON.stringify(log, null, 2), 'utf-8');
  }

  // Get compression statistics (unchanged)
  getStats(): {
    lastRun?: string;
    totalRuns: number;
    totalProcessed: number;
    totalSummarized: number;
    totalArchived: number;
    totalDeleted: number;
  } {
    if (!existsSync(this.logPath)) {
      return { totalRuns: 0, totalProcessed: 0, totalSummarized: 0, totalArchived: 0, totalDeleted: 0 };
    }

    try {
      const log = JSON.parse(readFileSync(this.logPath, 'utf-8')) as Array<{
        timestamp: string;
        result: CompressionResult;
      }>;

      return {
        lastRun: log[log.length - 1]?.timestamp,
        totalRuns: log.length,
        totalProcessed: log.reduce((sum, r) => sum + r.result.processed, 0),
        totalSummarized: log.reduce((sum, r) => sum + r.result.summarized, 0),
        totalArchived: log.reduce((sum, r) => sum + r.result.archived, 0),
        totalDeleted: log.reduce((sum, r) => sum + r.result.deleted, 0),
      };
    } catch {
      return { totalRuns: 0, totalProcessed: 0, totalSummarized: 0, totalArchived: 0, totalDeleted: 0 };
    }
  }

  // Read consolidated summaries (unchanged)
  readSummaries(month?: string): SummaryEntry[] {
    if (month) {
      const file = join(this.consolidatedPath, `${month}-summary.json`);
      if (existsSync(file)) {
        try {
          return JSON.parse(readFileSync(file, 'utf-8'));
        } catch {
          return [];
        }
      }
      return [];
    }

    const allSummaries: SummaryEntry[] = [];
    if (existsSync(this.consolidatedPath)) {
      const files = readdirSync(this.consolidatedPath).filter(f => f.endsWith('-summary.json'));
      for (const file of files) {
        try {
          const summaries = JSON.parse(readFileSync(join(this.consolidatedPath, file), 'utf-8'));
          allSummaries.push(...summaries);
        } catch { /* Skip invalid files */ }
      }
    }
    return allSummaries;
  }
}

// Singleton
let compressionEngine: MemoryCompression | null = null;

export function getCompressionEngine(basePath?: string, config?: Partial<CompressionConfig>): MemoryCompression {
  if (!compressionEngine && basePath) {
    compressionEngine = new MemoryCompression(basePath, config);
    compressionEngine.init();
  }
  if (!compressionEngine) {
    throw new Error('CompressionEngine not initialized. Call getCompressionEngine with basePath first.');
  }
  return compressionEngine;
}

export function resetCompressionEngine(): void {
  compressionEngine = null;
}
