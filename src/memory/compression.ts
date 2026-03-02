/**
 * Memory Compression
 *
 * Automatic compression and archival of old memories
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import type { MemoryConfig, MemoryToolResult } from './types';
import { scoreImportance, findDuplicates, type ImportanceScore } from './scoring';

// Compression configuration
export interface CompressionConfig {
  autoCompress: boolean;
  compressAfterDays: number;
  runSchedule: string; // Cron pattern
  keepOriginalDays: number;
  archiveAfterDays: number;
}

// Default configuration
export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  autoCompress: true,
  compressAfterDays: 7,
  runSchedule: '0 3 * * *', // 3 AM daily
  keepOriginalDays: 7,
  archiveAfterDays: 90,
};

// Compression result
export interface CompressionResult {
  processed: number;
  summarized: number;
  archived: number;
  deleted: number;
  errors: string[];
}

// Summary entry
export interface SummaryEntry {
  originalFile: string;
  originalDate: string;
  summary: string;
  keyFacts: string[];
  createdAt: string;
}

/**
 * Memory Compression Engine
 */
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

  // Initialize compression directories
  init(): void {
    if (!existsSync(this.consolidatedPath)) {
      mkdirSync(this.consolidatedPath, { recursive: true });
    }
    if (!existsSync(this.archivePath)) {
      mkdirSync(this.archivePath, { recursive: true });
    }
  }

  // Run compression process
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

    // Get all conversation directories (YYYY-MM format)
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

        // Skip if not old enough (unless force)
        if (!options?.force && ageMs < compressThreshold) {
          continue;
        }

        try {
          const content = readFileSync(filePath, 'utf-8');
          const score = scoreImportance({
            content,
            timestamp: stats.mtime.toISOString(),
          });

          // Take action based on recommendation
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
              // Do nothing
              break;
          }
        } catch (error) {
          result.errors.push(`Failed to process ${monthDir}/${dayFile}: ${error}`);
        }
      }
    }

    // Log compression run
    this.logCompressionRun(result);

    return result;
  }

  // Summarize a conversation file
  private async summarizeConversation(
    filePath: string,
    monthDir: string,
    dayFile: string
  ): Promise<void> {
    const content = readFileSync(filePath, 'utf-8');

    // Extract key information
    const summary = this.generateSummary(content);
    const keyFacts = this.extractKeyFacts(content);

    // Create summary entry
    const entry: SummaryEntry = {
      originalFile: `${monthDir}/${dayFile}`,
      originalDate: dayFile.replace('.md', ''),
      summary,
      keyFacts,
      createdAt: new Date().toISOString(),
    };

    // Append to monthly consolidated file
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

    // Remove original file
    rmSync(filePath);
  }

  // Generate a summary from conversation content
  private generateSummary(content: string): string {
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
        // Truncate long assistant responses
        const truncated = line.length > 200 ? line.slice(0, 200) + '...' : line;
        currentSection += truncated + '\n';
      }
    }

    if (currentSection) {
      sections.push(currentSection.trim());
    }

    // Return first 3 sections or all if less than 3
    return sections.slice(0, 3).join('\n\n---\n\n');
  }

  // Extract key facts from conversation
  private extractKeyFacts(content: string): string[] {
    const facts: string[] = [];
    const lines = content.split('\n');

    // Look for decision markers
    const decisionPatterns = [
      /\*\*关键决策\*\*[：:]\s*(.+)/,
      /\*\*决策\*\*[：:]\s*(.+)/,
      /\*\*Decision\*\*[：:]\s*(.+)/,
    ];

    // Look for important information
    const importantPatterns = [
      /重要[：:]\s*(.+)/,
      /Important[：:]\s*(.+)/,
      /注意[：:]\s*(.+)/,
      /Note[：:]\s*(.+)/,
    ];

    for (const line of lines) {
      for (const pattern of decisionPatterns) {
        const match = line.match(pattern);
        if (match) {
          facts.push(`Decision: ${match[1].trim()}`);
        }
      }

      for (const pattern of importantPatterns) {
        const match = line.match(pattern);
        if (match) {
          facts.push(`Note: ${match[1].trim()}`);
        }
      }
    }

    return facts.slice(0, 5); // Max 5 facts
  }

  // Archive a file
  private archiveFile(filePath: string, monthDir: string, dayFile: string): void {
    const archiveMonthPath = join(this.archivePath, monthDir);
    if (!existsSync(archiveMonthPath)) {
      mkdirSync(archiveMonthPath, { recursive: true });
    }

    const content = readFileSync(filePath, 'utf-8');
    const archiveFile = join(archiveMonthPath, dayFile);

    // Compress with metadata
    const archived = {
      originalPath: `${monthDir}/${dayFile}`,
      archivedAt: new Date().toISOString(),
      content,
    };

    writeFileSync(archiveFile + '.json', JSON.stringify(archived, null, 2), 'utf-8');
    rmSync(filePath);
  }

  // Log compression run
  private logCompressionRun(result: CompressionResult): void {
    let log: Array<{
      timestamp: string;
      result: CompressionResult;
    }> = [];

    if (existsSync(this.logPath)) {
      try {
        log = JSON.parse(readFileSync(this.logPath, 'utf-8'));
      } catch {
        log = [];
      }
    }

    log.push({
      timestamp: new Date().toISOString(),
      result,
    });

    // Keep only last 30 runs
    if (log.length > 30) {
      log = log.slice(-30);
    }

    writeFileSync(this.logPath, JSON.stringify(log, null, 2), 'utf-8');
  }

  // Get compression statistics
  getStats(): {
    lastRun?: string;
    totalRuns: number;
    totalProcessed: number;
    totalSummarized: number;
    totalArchived: number;
    totalDeleted: number;
  } {
    if (!existsSync(this.logPath)) {
      return {
        totalRuns: 0,
        totalProcessed: 0,
        totalSummarized: 0,
        totalArchived: 0,
        totalDeleted: 0,
      };
    }

    try {
      const log = JSON.parse(readFileSync(this.logPath, 'utf-8')) as Array<{
        timestamp: string;
        result: CompressionResult;
      }>;

      const stats = {
        lastRun: log[log.length - 1]?.timestamp,
        totalRuns: log.length,
        totalProcessed: log.reduce((sum, r) => sum + r.result.processed, 0),
        totalSummarized: log.reduce((sum, r) => sum + r.result.summarized, 0),
        totalArchived: log.reduce((sum, r) => sum + r.result.archived, 0),
        totalDeleted: log.reduce((sum, r) => sum + r.result.deleted, 0),
      };

      return stats;
    } catch {
      return {
        totalRuns: 0,
        totalProcessed: 0,
        totalSummarized: 0,
        totalArchived: 0,
        totalDeleted: 0,
      };
    }
  }

  // Read consolidated summaries
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

    // Read all summaries
    const allSummaries: SummaryEntry[] = [];
    if (existsSync(this.consolidatedPath)) {
      const files = readdirSync(this.consolidatedPath).filter(f => f.endsWith('-summary.json'));
      for (const file of files) {
        try {
          const summaries = JSON.parse(readFileSync(join(this.consolidatedPath, file), 'utf-8'));
          allSummaries.push(...summaries);
        } catch {
          // Skip invalid files
        }
      }
    }
    return allSummaries;
  }
}

// Singleton instance
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
