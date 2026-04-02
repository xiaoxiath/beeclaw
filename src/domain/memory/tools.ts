import { z } from 'zod';
import type { MemoryToolResult } from './types';
import { getMemoryStore } from './store';
import { getCompressionEngine } from './compression';
import { scoreImportance } from './scoring';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

// Knowledge file templates
const KNOWLEDGE_TEMPLATES: Record<string, string> = {
  health: `# 健康信息

## 基本信息
- 血型: (待补充)
- 身高: (待补充)
- 当前体重: (待补充)

## 健康状况
| 问题 | 状态 | 行动 |
|------|------|------|
| (待补充) | - | - |

## 生活习惯
### 饮食
- (待补充)

### 运动
- (待补充)

---
*knowledge/health.md - ${new Date().toISOString().split('T')[0]}*
`,
  travel: `# 旅行偏好

## 目的地偏好
- 国内: (待补充)
- 国外: (待补充)

## 旅行风格
- (待补充)

## 历史旅行
| 时间 | 目的地 | 评价 |
|------|--------|------|
| (待补充) | - | - |

---
*knowledge/travel.md - ${new Date().toISOString().split('T')[0]}*
`,
  hobbies: `# 兴趣爱好

## 主要爱好
- (待补充)

## 游戏偏好
- (待补充)

## 阅读偏好
- (待补充)

---
*knowledge/hobbies.md - ${new Date().toISOString().split('T')[0]}*
`,
  education: `# 教育背景

## 学历
- (待补充)

## 技能证书
- (待补充)

## 持续学习
- (待补充)

---
*knowledge/education.md - ${new Date().toISOString().split('T')[0]}*
`,
};

// Generate template for unknown category
function generateTemplate(category: string): string {
  const title = category.charAt(0).toUpperCase() + category.slice(1);
  return `# ${title}

## 概述
- (待补充)

## 详情
- (待补充)

---
*knowledge/${category}.md - ${new Date().toISOString().split('T')[0]}*
`;
}

// Tool parameter schemas
export const MemoryLsSchema = z.object({
  path: z.string().describe('Path relative to memory root (e.g., "facts", "conversations/2025-02")'),
});

export const MemoryGrepSchema = z.object({
  query: z.string().describe('Search query string'),
  path: z.string().optional().describe('Optional path to search within'),
});

export const MemoryReadSchema = z.object({
  file: z.string().describe('File path relative to memory root (e.g., "facts/user.md")'),
});

export const MemoryWriteSchema = z.object({
  file: z.string().describe('File path relative to memory root'),
  content: z.string().describe('Content to write'),
  mode: z.enum(['append', 'overwrite']).optional().default('append').describe('Write mode'),
});

export const MemoryRecordSchema = z.object({
  category: z.enum(['user', 'preferences', 'events', 'investments', 'lessons']).describe('Fact category'),
  fact: z.string().describe('Fact to record'),
});

// Tool definitions for AI function calling
export const memoryTools = {
  memory_ls: {
    name: 'memory_ls',
    description: 'List contents of a memory directory. Use this to browse available memories.',
    parameters: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path relative to memory root (e.g., "facts", "conversations/2025-02", "skills")',
        },
      },
      required: ['path'],
    },
  },

  memory_grep: {
    name: 'memory_grep',
    description: 'Search for content across memory files. Use this to find specific information.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        path: {
          type: 'string',
          description: 'Optional path to limit search scope',
        },
      },
      required: ['query'],
    },
  },

  memory_read: {
    name: 'memory_read',
    description: 'Read the content of a memory file. Use this to retrieve specific memories.',
    parameters: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'File path relative to memory root (e.g., "facts/user.md")',
        },
      },
      required: ['file'],
    },
  },

  memory_write: {
    name: 'memory_write',
    description: 'Write or append content to a memory file. Use this to store new information.',
    parameters: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'File path relative to memory root',
        },
        content: {
          type: 'string',
          description: 'Content to write',
        },
        mode: {
          type: 'string',
          enum: ['append', 'overwrite'],
          description: 'Write mode (default: append)',
        },
      },
      required: ['file', 'content'],
    },
  },

  memory_record: {
    name: 'memory_record',
    description: 'Record a new fact about the user. Use this to remember user preferences, info, or project details.',
    parameters: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['user', 'preferences', 'events', 'investments', 'lessons'],
          description: 'Category of the fact: user (profile), preferences (AI settings), events (important dates), investments (holdings), lessons (learned)',
        },
        fact: {
          type: 'string',
          description: 'The fact to record',
        },
      },
      required: ['category', 'fact'],
    },
  },

  memory_compress: {
    name: 'memory_compress',
    description: 'Compress old memories to save space. Summarizes old conversations and archives them.',
    parameters: {
      type: 'object' as const,
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'Preview what would be compressed without making changes',
        },
        force: {
          type: 'boolean',
          description: 'Force compression even of recent memories',
        },
      },
      required: [],
    },
  },

  memory_score: {
    name: 'memory_score',
    description: 'Score the importance of a memory entry. Returns recommendation (keep/summarize/archive/delete).',
    parameters: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'Content to score',
        },
        timestamp: {
          type: 'string',
          description: 'ISO timestamp of the content',
        },
      },
      required: ['content', 'timestamp'],
    },
  },

  memory_dedupe: {
    name: 'memory_dedupe',
    description: 'Find and mark duplicate/similar memories for cleanup.',
    parameters: {
      type: 'object' as const,
      properties: {
        threshold: {
          type: 'number',
          description: 'Similarity threshold (0-1, default 0.7)',
        },
      },
      required: [],
    },
  },

  memory_knowledge_create: {
    name: 'memory_knowledge_create',
    description: 'Create a new knowledge file. Use this when user mentions a new topic area that deserves its own knowledge file.',
    parameters: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Category name (e.g., "health", "travel", "hobbies"). Will create knowledge/{category}.md',
        },
        content: {
          type: 'string',
          description: 'Optional initial content. If not provided, a template will be used.',
        },
      },
      required: ['category'],
    },
  },

  memory_index: {
    name: 'memory_index',
    description: 'Rebuild the keyword index for fast searching. Use this after creating new files.',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  memory_search: {
    name: 'memory_search',
    description: 'Search using keyword index (faster than grep for known terms).',
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        scope: {
          type: 'string',
          enum: ['facts', 'knowledge', 'all'],
          description: 'Search scope (default: all)',
        },
      },
      required: ['query'],
    },
  },
};

// Tool executor
export async function executeMemoryTool(name: string, params: Record<string, unknown>): Promise<MemoryToolResult> {
  const store = getMemoryStore();

  switch (name) {
    case 'memory_ls': {
      const parsed = MemoryLsSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.ls(parsed.data.path);
    }

    case 'memory_grep': {
      const parsed = MemoryGrepSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.grep(parsed.data.query, parsed.data.path);
    }

    case 'memory_read': {
      const parsed = MemoryReadSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.read(parsed.data.file);
    }

    case 'memory_write': {
      const parsed = MemoryWriteSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return await store.write(parsed.data.file, parsed.data.content, parsed.data.mode);
    }

    case 'memory_record': {
      const parsed = MemoryRecordSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return await store.record(parsed.data.category, parsed.data.fact);
    }

    case 'memory_compress': {
      const parsed = z.object({
        dryRun: z.boolean().optional().default(false),
        force: z.boolean().optional().default(false),
      }).safeParse(params);

      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      try {
        const engine = getCompressionEngine(store.getBasePath());
        // Note: In production, this should be awaited
        // For now, return a synchronous preview
        const stats = engine.getStats();
        return {
          success: true,
          data: {
            note: 'Use CLI command /memory compress to run compression',
            stats,
            dryRun: parsed.data.dryRun,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: `Compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }

    case 'memory_score': {
      const parsed = z.object({
        content: z.string(),
        timestamp: z.string(),
      }).safeParse(params);

      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      const score = scoreImportance({
        content: parsed.data.content,
        timestamp: parsed.data.timestamp,
      });

      return { success: true, data: score };
    }

    case 'memory_dedupe': {
      const parsed = z.object({
        threshold: z.number().min(0).max(1).optional().default(0.7),
      }).safeParse(params);

      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      // Get all facts from the store
      const factsResult = store.ls('facts');
      if (!factsResult.success) {
        return { success: false, error: 'Failed to list facts' };
      }

      // This is a simplified version - in production, you'd read all fact files
      return {
        success: true,
        data: {
          note: 'Deduplication analysis requires reading all fact files',
          threshold: parsed.data.threshold,
        },
      };
    }

    case 'memory_knowledge_create': {
      const parsed = z.object({
        category: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Category must be lowercase alphanumeric with dashes'),
        content: z.string().optional(),
      }).safeParse(params);

      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      const { category, content } = parsed.data;
      const basePath = store.getBasePath();
      const filePath = join(basePath, 'knowledge', `${category}.md`);

      // Check if file already exists
      if (existsSync(filePath)) {
        return {
          success: false,
          error: `Knowledge file "${category}" already exists. Use memory_write to update it.`,
        };
      }

      // Use provided content or template
      const fileContent = content || KNOWLEDGE_TEMPLATES[category] || generateTemplate(category);

      try {
        writeFileSync(filePath, fileContent, 'utf-8');

        // Rebuild index to include new file
        store.rebuildIndex();

        return {
          success: true,
          data: `Created knowledge/${category}.md with ${fileContent.split('\n').length} lines.`,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to create file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }

    case 'memory_index': {
      const result = store.rebuildIndex();
      if (result.success) {
        const stats = store.getIndexStats();
        return {
          success: true,
          data: {
            message: result.data,
            factsKeywords: stats?.factsKeywords || 0,
            knowledgeKeywords: stats?.knowledgeKeywords || 0,
          },
        };
      }
      return result;
    }

    case 'memory_search': {
      const parsed = z.object({
        query: z.string(),
        scope: z.enum(['facts', 'knowledge', 'all']).optional().default('all'),
      }).safeParse(params);

      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      return store.searchByKeyword(parsed.data.query, parsed.data.scope);
    }

    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ============================================================================
// Phase 4: Layered Tool Loading
// ============================================================================

/** Core memory tool names — always registered */
const CORE_MEMORY_TOOL_NAMES = [
  'memory_ls',
  'memory_grep',
  'memory_read',
  'memory_write',
  'memory_record',
] as const;

/** Advanced memory tool names — conditionally registered */
const ADVANCED_MEMORY_TOOL_NAMES = [
  'memory_compress',
  'memory_score',
  'memory_dedupe',
  'memory_knowledge_create',
  'memory_index',
  'memory_search',
] as const;

/**
 * Get core memory tools (always registered).
 * These are the essential tools for basic memory operations.
 */
export function getCoreMemoryTools() {
  return CORE_MEMORY_TOOL_NAMES.map(name => memoryTools[name]);
}

/**
 * Get advanced memory tools (conditionally registered).
 * These are maintenance/management tools for power users.
 */
export function getAdvancedMemoryTools() {
  return ADVANCED_MEMORY_TOOL_NAMES.map(name => memoryTools[name]);
}

// Get all memory tools for AI (backward compatible — returns all 11)
export function getMemoryToolsForAI() {
  return Object.values(memoryTools);
}

// Get all memory tools (alias, backward compatible)
export function getAllMemoryTools() {
  return getMemoryToolsForAI();
}

// Export tool names (backward compatible — all tool names)
export const MEMORY_TOOL_NAMES = Object.keys(memoryTools);

// Export layered name arrays for external use
export { CORE_MEMORY_TOOL_NAMES, ADVANCED_MEMORY_TOOL_NAMES };
