/**
 * Atomic File Operations — Bug #3 Fix (Persistence Safety)
 *
 * Problem: Original code used writeFileSync() directly. If the process crashes
 * mid-write, the session JSON file is left half-written / corrupted.
 *
 * Solution: Write-to-temp-then-rename pattern (POSIX rename is atomic).
 * Also maintains .bak files for crash recovery.
 */

import { writeFileSync, readFileSync, renameSync, unlinkSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

/**
 * Write file atomically using temp-file + rename strategy.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = dirname(filePath);
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;

  mkdirSync(dir, { recursive: true });

  // Step 1: Write to temp file
  writeFileSync(tmpPath, content, 'utf-8');

  // Step 2: Create backup of existing file
  try {
    if (existsSync(filePath)) {
      const currentContent = readFileSync(filePath, 'utf-8');
      writeFileSync(bakPath, currentContent, 'utf-8');
    }
  } catch (error) {
    console.warn(`[AtomicFS] Backup creation failed for ${filePath}:`, error);
  }

  // Step 3: Atomic rename
  renameSync(tmpPath, filePath);
}

/**
 * Read a JSON file with automatic corruption recovery from .bak file.
 */
export function readFileWithRecovery<T>(
  filePath: string,
  validator?: (data: unknown) => data is T
): T | undefined {
  // Attempt 1: Read primary file
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      if (validator) {
        if (validator(data)) return data;
        console.warn(`[AtomicFS] Primary file validation failed: ${filePath}`);
      } else {
        return data as T;
      }
    }
  } catch (error) {
    console.warn(`[AtomicFS] Primary file corrupted: ${filePath}`, error);
  }

  // Attempt 2: Read backup file
  const bakPath = `${filePath}.bak`;
  try {
    if (existsSync(bakPath)) {
      const content = readFileSync(bakPath, 'utf-8');
      const data = JSON.parse(content);
      if (validator) {
        if (validator(data)) {
          console.log(`[AtomicFS] Recovered from backup: ${bakPath}`);
          writeFileSync(filePath, content, 'utf-8');
          return data;
        }
        console.warn(`[AtomicFS] Backup file validation also failed: ${bakPath}`);
      } else {
        console.log(`[AtomicFS] Recovered from backup: ${bakPath}`);
        writeFileSync(filePath, content, 'utf-8');
        return data as T;
      }
    }
  } catch (error) {
    console.warn(`[AtomicFS] Backup file also corrupted: ${bakPath}`, error);
  }

  return undefined;
}

/**
 * Clean up leftover .tmp files from a directory (e.g., after a crash).
 * Should be called at startup.
 */
export function cleanupTempFiles(dirPath: string): number {
  let cleaned = 0;
  try {
    if (!existsSync(dirPath)) return 0;
    const files = readdirSync(dirPath);
    for (const file of files) {
      if (file.endsWith('.tmp')) {
        try {
          unlinkSync(join(dirPath, file));
          cleaned++;
        } catch { /* ignore */ }
      }
    }
    if (cleaned > 0) {
      console.log(`[AtomicFS] Cleaned up ${cleaned} leftover temp file(s) in ${dirPath}`);
    }
  } catch (error) {
    console.warn(`[AtomicFS] Cleanup failed for ${dirPath}:`, error);
  }
  return cleaned;
}
