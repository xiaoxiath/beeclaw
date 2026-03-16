import { existsSync, mkdirSync } from 'fs';
import { appendFile, readFile, writeFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';

/**
 * [AUDIT FIX M-04 (F-04)] Upgraded Message interface to support multimodal metadata.
 *
 * Previous version only supported `content: string`, causing multimodal context loss
 * during persistence. Now includes `_meta` field for tracking original content type
 * and vision descriptions.
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  timestamp?: string;
  /** [AUDIT FIX M-03/M-04] Multimodal and source tracking metadata */
  _meta?: {
    /** Original content type before text conversion */
    originalType?: 'text' | 'multimodal';
    /** Vision model description (from two-stage processing) */
    visionDescription?: string;
    /** Message source for context-aware processing */
    source?: 'user' | 'proactive' | 'recovery' | 'system';
  };
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  messages: Message[];
}

class SessionService {
  private basePath: string = './data/sessions';
  private initialized: boolean = false;

  configure(path: string): void {
    this.basePath = path;
    this.ensureDir();
    this.initialized = true;
  }

  private ensureDir(): void {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getFilePath(sessionId: string): string {
    return join(this.basePath, `${sessionId}.jsonl`);
  }

  async create(metadata?: Record<string, unknown>): Promise<Session> {
    this.ensureDir();

    const session: Session = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata,
      messages: [],
    };

    const filePath = this.getFilePath(session.id);
    await writeFile(filePath, JSON.stringify(session) + '\n', 'utf-8');

    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    const filePath = this.getFilePath(sessionId);

    if (!existsSync(filePath)) {
      return null;
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    if (lines.length === 0) {
      return null;
    }

    // First line is the session metadata
    const session: Session = JSON.parse(lines[0]);

    // Subsequent lines are messages
    session.messages = lines.slice(1).map((line) => JSON.parse(line));

    return session;
  }

  async addMessage(sessionId: string, message: Omit<Message, 'timestamp'>): Promise<void> {
    const filePath = this.getFilePath(sessionId);

    if (!existsSync(filePath)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const fullMessage: Message = {
      ...message,
      timestamp: new Date().toISOString(),
    };

    await appendFile(filePath, JSON.stringify(fullMessage) + '\n', 'utf-8');
  }

  async updateMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<Session | null> {
    const session = await this.get(sessionId);
    if (!session) return null;

    session.metadata = { ...session.metadata, ...metadata };
    session.updatedAt = new Date().toISOString();

    // Rewrite the file with updated metadata
    const filePath = this.getFilePath(sessionId);
    const lines = [JSON.stringify({
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      metadata: session.metadata,
    })];

    for (const msg of session.messages) {
      lines.push(JSON.stringify(msg));
    }

    await writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
    return session;
  }

  async delete(sessionId: string): Promise<boolean> {
    const filePath = this.getFilePath(sessionId);

    if (!existsSync(filePath)) {
      return false;
    }

    await unlink(filePath);
    return true;
  }

  async list(options?: { limit?: number; offset?: number }): Promise<Session[]> {
    this.ensureDir();

    const files = await readdir(this.basePath);
    const sessionFiles = files.filter((f) => f.endsWith('.jsonl'));

    const sessions: Session[] = [];

    for (const file of sessionFiles) {
      const content = await readFile(join(this.basePath, file), 'utf-8');
      const lines = content.trim().split('\n');
      if (lines.length > 0) {
        const session: Session = JSON.parse(lines[0]);
        session.messages = []; // Don't load all messages for list
        sessions.push(session);
      }
    }

    // Sort by createdAt descending
    sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const offset = options?.offset || 0;
    const limit = options?.limit || 50;

    return sessions.slice(offset, offset + limit);
  }

  async clearMessages(sessionId: string): Promise<Session | null> {
    const session = await this.get(sessionId);
    if (!session) return null;

    session.messages = [];
    session.updatedAt = new Date().toISOString();

    const filePath = this.getFilePath(sessionId);
    await writeFile(filePath, JSON.stringify({
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      metadata: session.metadata,
      messages: [],
    }) + '\n', 'utf-8');

    return session;
  }
}

// UUID polyfill for Bun
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export const sessionService = new SessionService();
export default sessionService;
