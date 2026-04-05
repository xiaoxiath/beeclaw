/**
 * bee — Memory store interface.
 *
 * Defines the contract for memory persistence.
 * Implementations are provided by consumers (e.g. beeclaw's filesystem store).
 */

export interface MemoryReadResult {
  success: boolean;
  content?: string;
  error?: string;
}

export interface MemoryWriteResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface MemorySearchOptions {
  scope?: 'facts' | 'knowledge' | 'all';
  limit?: number;
}

export interface MemorySearchResult {
  success: boolean;
  results?: Array<{ path: string; content: string; score?: number }>;
  error?: string;
}

/**
 * Memory store interface.
 *
 * Bee defines the interface; consumers provide the implementation
 * (e.g., filesystem, database, vector store).
 */
export interface IMemoryStore {
  read(path: string): Promise<MemoryReadResult> | MemoryReadResult;
  write(path: string, content: string, mode?: 'append' | 'overwrite'): Promise<MemoryWriteResult> | MemoryWriteResult;
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult> | MemorySearchResult;
  record(category: string, entry: string): Promise<MemoryWriteResult> | MemoryWriteResult;
}
