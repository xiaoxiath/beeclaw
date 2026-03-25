import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../infra/observability/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TSV_HEADER =
  'timestamp\tskill\tversion\tcomposite_score\tsuccess_rate\tcomplexity\tstatus\tdescription';
const LEDGER_FILENAME = 'results.tsv';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LedgerStatus = 'keep' | 'discard' | 'crash';

export interface LedgerRow {
  timestamp: string;
  skill: string;
  version: string;
  compositeScore: number;
  successRate: number;
  complexity: number;
  status: LedgerStatus;
  description: string;
}

// ---------------------------------------------------------------------------
// ExperimentLedger
// ---------------------------------------------------------------------------

/**
 * Structured experiment logging in TSV format, analogous to autoresearch's
 * `results.tsv`. Each row captures one experiment evaluation outcome.
 */
export class ExperimentLedger {
  private readonly filePath: string;
  private readonly basePath: string;

  constructor(basePath = 'data/experiments') {
    this.basePath = basePath;
    this.filePath = join(basePath, LEDGER_FILENAME);
  }

  /** Ensure the output directory exists. */
  ensureDir(): void {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
      logger.debug(`[ledger] created directory ${this.basePath}`);
    }
  }

  /**
   * Append an experiment result row to the TSV ledger.
   * Automatically writes the header if the file is empty or absent.
   */
  log(
    skillName: string,
    compositeScore: number,
    successRate: number,
    complexityScore: number,
    versionId: string,
    status: LedgerStatus,
    description: string,
  ): void {
    this.ensureDir();

    const needsHeader = !existsSync(this.filePath) || this.isFileEmpty();

    if (needsHeader) {
      appendFileSync(this.filePath, TSV_HEADER + '\n', 'utf-8');
    }

    const timestamp = new Date().toISOString();
    const sanitised = description.replace(/[\t\n\r]/g, ' ');
    const row = [
      timestamp,
      skillName,
      versionId,
      compositeScore.toFixed(4),
      successRate.toFixed(4),
      complexityScore.toFixed(4),
      status,
      sanitised,
    ].join('\t');

    appendFileSync(this.filePath, row + '\n', 'utf-8');
    logger.debug(
      `[ledger] logged ${skillName}@${versionId} score=${compositeScore.toFixed(4)} status=${status}`,
    );
  }

  /**
   * Read and parse all ledger rows, optionally filtering by skill name.
   */
  getHistory(skillName?: string): LedgerRow[] {
    if (!existsSync(this.filePath)) return [];

    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    // Skip header
    const dataLines = lines.slice(1);

    const rows: LedgerRow[] = dataLines.map((line) => {
      const parts = line.split('\t');
      return {
        timestamp: parts[0] ?? '',
        skill: parts[1] ?? '',
        version: parts[2] ?? '',
        compositeScore: parseFloat(parts[3] ?? '0'),
        successRate: parseFloat(parts[4] ?? '0'),
        complexity: parseFloat(parts[5] ?? '0'),
        status: (parts[6] ?? 'crash') as LedgerStatus,
        description: parts[7] ?? '',
      };
    });

    if (skillName) {
      return rows.filter((r) => r.skill === skillName);
    }
    return rows;
  }

  /**
   * Return the composite-score trend for a skill (oldest → newest).
   * Useful for detecting regressions and plotting progress.
   */
  getTrend(skillName: string, lastN = 10): number[] {
    const history = this.getHistory(skillName);
    // history is in file-order (oldest first) already.
    const tail = history.slice(-lastN);
    return tail.map((r) => r.compositeScore);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private isFileEmpty(): boolean {
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      return content.trim().length === 0;
    } catch {
      return true;
    }
  }
}
