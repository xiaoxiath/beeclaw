/**
 * ShareGPT Format Trajectory Generation
 *
 * Converts chat sessions into ShareGPT-formatted trajectory records
 * for RL training data collection and analysis.
 */

import type { ChatMessage, MultimodalContent, ToolCall } from '../core/types';
import { appendFile } from 'fs/promises';

function isTextContent(part: MultimodalContent): part is Extract<MultimodalContent, { type: 'text' }> {
  return part.type === 'text';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShareGPTTurn {
  from: 'human' | 'gpt' | 'tool' | 'system';
  value: string;
}

export interface TrajectoryRecord {
  id: string;
  conversations: ShareGPTTurn[];
  metadata: {
    model: string;
    timestamp: string;
    sessionId: string;
    totalTokens: number;
    toolsUsed: string[];
    outcome: 'success' | 'failure' | 'partial';
  };
}

export interface TrajectoryConfig {
  /** Directory / file path for JSONL output */
  outputPath: string;
  /** Include system messages in the trajectory */
  includeSystem: boolean;
  /** Include tool call / tool result messages */
  includeToolCalls: boolean;
  /** Minimum number of turns required to save a trajectory */
  minTurns: number;
  /** Maximum character length for tool result content */
  toolResultMaxLength: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TrajectoryConfig = {
  outputPath: './trajectories.jsonl',
  includeSystem: true,
  includeToolCalls: true,
  minTurns: 4,
  toolResultMaxLength: 2000,
};

// ---------------------------------------------------------------------------
// Role mapping
// ---------------------------------------------------------------------------

function mapRole(role: string): ShareGPTTurn['from'] {
  switch (role) {
    case 'user':
      return 'human';
    case 'assistant':
      return 'gpt';
    case 'tool':
      return 'tool';
    case 'system':
      return 'system';
    default:
      return 'human';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert an array of ChatMessages into ShareGPT turns.
 *
 * - Maps roles: user → human, assistant → gpt, tool → tool, system → system
 * - Truncates tool results to `toolResultMaxLength`
 * - Annotates assistant messages that contain tool_calls
 */
export function convertToShareGPT(
  messages: ChatMessage[],
  config?: Partial<TrajectoryConfig>,
): ShareGPTTurn[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const turns: ShareGPTTurn[] = [];

  for (const msg of messages) {
    const role = mapRole(msg.role);

    // Filter based on config
    if (role === 'system' && !cfg.includeSystem) continue;
    if (role === 'tool' && !cfg.includeToolCalls) continue;

    // Build value string
    let value = '';

    if (typeof msg.content === 'string') {
      value = msg.content;
    } else if (Array.isArray(msg.content)) {
      // Multimodal content — concatenate text parts
      value = msg.content
        .filter(isTextContent)
        .map((part) => part.text)
        .join('\n');
    }

    // Truncate tool results
    if (role === 'tool' && value.length > cfg.toolResultMaxLength) {
      value = value.slice(0, cfg.toolResultMaxLength) + '\n... [truncated]';
    }

    // Annotate assistant messages that issued tool calls
    if (
      role === 'gpt' &&
      cfg.includeToolCalls &&
      msg.tool_calls &&
      Array.isArray(msg.tool_calls)
    ) {
      const toolCalls = msg.tool_calls as ToolCall[];
      const callDescriptions = toolCalls
        .map((tc) => `${tc.function.name}(${tc.function.arguments})`)
        .join('\n');
      value = value
        ? `${value}\n\n[Tool Calls]\n${callDescriptions}`
        : `[Tool Calls]\n${callDescriptions}`;
    }

    turns.push({ from: role, value });
  }

  return turns;
}

/**
 * Save a trajectory record by appending a JSONL line to the output file.
 *
 * Uses Bun.file() if available, otherwise falls back to Node fs.appendFile.
 */
export async function saveTrajectory(
  record: TrajectoryRecord,
  outputPath?: string,
): Promise<void> {
  const path = outputPath ?? DEFAULT_CONFIG.outputPath;
  const line = JSON.stringify(record) + '\n';

  // Try Bun runtime first
  if (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>).Bun) {
    const Bun = (globalThis as Record<string, unknown>).Bun as {
      file: (path: string) => { exists: () => Promise<boolean>; text: () => Promise<string> };
      write: (path: string, data: string) => Promise<void>;
    };
    try {
      const file = Bun.file(path);
      const exists = await file.exists();
      const existing = exists ? await file.text() : '';
      await Bun.write(path, existing + line);
      return;
    } catch {
      // Fall through to Node.js fs
    }
  }

  // Node.js fallback
  try {
    await appendFile(path, line, 'utf-8');
  } catch (err) {
    // If fs module not available (e.g., edge runtime), throw informative error
    throw new Error(
      `Failed to save trajectory to "${path}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Convenience wrapper: generate a TrajectoryRecord from a session and save it.
 *
 * Skips saving if the conversation has fewer turns than `minTurns`.
 */
export async function generateAndSaveTrajectory(
  sessionId: string,
  messages: ChatMessage[],
  metadata: Omit<TrajectoryRecord['metadata'], 'sessionId'>,
  config?: Partial<TrajectoryConfig>,
): Promise<TrajectoryRecord | null> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const conversations = convertToShareGPT(messages, cfg);

  // Skip short conversations
  if (conversations.length < cfg.minTurns) {
    return null;
  }

  // Collect tool names used
  const toolsUsed = new Set<string>(metadata.toolsUsed);
  for (const msg of messages) {
    const toolCalls = msg.tool_calls;
    if (toolCalls) {
      for (const tc of toolCalls) {
        toolsUsed.add(tc.function.name);
      }
    }
  }

  const record: TrajectoryRecord = {
    id: `traj_${sessionId}_${Date.now()}`,
    conversations,
    metadata: {
      ...metadata,
      sessionId,
      toolsUsed: Array.from(toolsUsed),
    },
  };

  await saveTrajectory(record, cfg.outputPath);
  return record;
}
