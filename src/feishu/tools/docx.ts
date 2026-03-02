/**
 * Feishu Document (Docx) Tools
 *
 * Tools for managing Feishu documents
 */

import type { Client } from '@larksuiteoapi/node-sdk';
import { getLogger } from '../utils/logger';
import { z } from 'zod';

const logger = getLogger('feishu:docx');

// Block type mapping
const BLOCK_TYPE_MAP: Record<string, number> = {
  'page': 1,
  'text': 2,
  'heading1': 3,
  'heading2': 4,
  'heading3': 5,
  'heading4': 6,
  'heading5': 7,
  'heading6': 8,
  'heading7': 9,
  'heading8': 10,
  'heading9': 11,
  'bullet': 12,
  'ordered': 13,
  'code': 14,
  'quote': 15,
  'equation': 16,
  'todo': 17,
  'bitable': 18,
  'callout': 19,
  'chat_card': 20,
  'diagram': 21,
  'divider': 22,
  'file': 23,
  'grid': 24,
  'grid_column': 25,
  'iframe': 26,
  'image': 27,
  'isv': 28,
  'mindnote': 29,
  'sheet': 30,
  'table': 31,
  'table_cell': 32,
  'table_row': 33,
  'toc': 34,
  'view': 35,
};

const BLOCK_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(BLOCK_TYPE_MAP).map(([k, v]) => [v, k])
);

// Batch size limit
const BATCH_SIZE = 50;

/**
 * Get document block by ID
 */
export async function getBlock(
  client: Client,
  documentId: string,
  blockId: string
): Promise<FeishuBlock> {
  try {
    const response = await client.docx.documentBlock.get({
      path: {
        document_id: documentId,
        block_id: blockId,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get block: ${response.msg}`);
    }

    logger.info(`✅ Got block: ${blockId}`);
    return response.data?.block as FeishuBlock;
  } catch (error) {
    logger.error('Failed to get block:', error);
    throw error;
  }
}

/**
 * List children blocks
 */
export async function listChildren(
  client: Client,
  documentId: string,
  blockId: string,
  options?: {
    pageSize?: number;
    pageToken?: string;
  }
): Promise<{
  blocks: FeishuBlock[];
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.docx.documentBlockChildren.get({
      path: {
        document_id: documentId,
        block_id: blockId,
      },
      params: {
        page_size: options?.pageSize || 50,
        page_token: options?.pageToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to list children: ${response.msg}`);
    }

    logger.info(`✅ Listed ${response.data?.items?.length || 0} children`);
    return {
      blocks: response.data?.items || [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
    };
  } catch (error) {
    logger.error('Failed to list children:', error);
    throw error;
  }
}

/**
 * Search in document
 */
export async function searchDocument(
  client: Client,
  documentId: string,
  query: string,
  options?: {
    pageSize?: number;
    pageToken?: string;
  }
): Promise<{
  results: Array<{
    block: FeishuBlock;
    highlights?: string[];
  }>;
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.docx.documentSearch.query({
      path: {
        document_id: documentId,
      },
      params: {
        query,
        page_size: options?.pageSize || 50,
        page_token: options?.pageToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to search document: ${response.msg}`);
    }

    logger.info(`✅ Found ${response.data?.items?.length || 0} results`);
    return {
      results: (response.data?.items || []).map((item: any) => ({
        block: item.block,
        highlights: item.highlights,
      })),
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
    };
  } catch (error) {
    logger.error('Failed to search document:', error);
    throw error;
  }
}

/**
 * Create block
 */
export async function createBlock(
  client: Client,
  documentId: string,
  block: BlockCreateRequest
): Promise<FeishuBlock> {
  try {
    const response = await client.docx.documentBlock.create({
      path: {
        document_id: documentId,
      },
      params: {
        document_revision_id: -1,
      },
      data: {
        index: block.index,
        children: block.children,
        text: block.text,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to create block: ${response.msg}`);
    }

    logger.info(`✅ Created block`);
    return response.data?.block as FeishuBlock;
  } catch (error) {
    logger.error('Failed to create block:', error);
    throw error;
  }
}

/**
 * Batch create blocks (with automatic chunking)
 */
export async function batchCreateBlocks(
  client: Client,
  documentId: string,
  parentId: string,
  blocks: Array<BlockCreateRequest>,
  options?: {
    index?: number;
  }
): Promise<FeishuBlock[]> {
  const createdBlocks: FeishuBlock[] = [];

  // Chunk blocks to avoid API limit
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const chunk = blocks.slice(i, i + BATCH_SIZE);
    const startIndex = (options?.index ?? -1) + i;

    const response = await client.docx.documentBlockChildren.patch({
      path: {
        document_id: documentId,
        block_id: parentId,
      },
      params: {
        document_revision_id: -1,
      },
      data: {
        index: startIndex,
        insert_horizontal: false,
        children: chunk.map(b => ({
          type: b.type,
          text: b.text,
        })),
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to batch create blocks: ${response.msg}`);
    }

    createdBlocks.push(...(response.data?.children || []));
  }

  logger.info(`✅ Batch created ${createdBlocks.length} blocks`);
  return createdBlocks;
}

/**
 * Update block
 */
export async function updateBlock(
  client: Client,
  documentId: string,
  blockId: string,
  updates: Partial<{
    text: TextContent;
    children: BlockCreateRequest[];
  }>
): Promise<FeishuBlock> {
  try {
    const response = await client.docx.documentBlock.patch({
      path: {
        document_id: documentId,
        block_id: blockId,
      },
      params: {
        document_revision_id: -1,
      },
      data: {
        update_text_elements: updates.text ? {
          elements: updates.text.elements,
          style: updates.text.style,
        } : undefined,
        update_children: updates.children ? {
          children: updates.children,
        } : undefined,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to update block: ${response.msg}`);
    }

    logger.info(`✅ Updated block: ${blockId}`);
    return response.data?.block as FeishuBlock;
  } catch (error) {
    logger.error('Failed to update block:', error);
    throw error;
  }
}

/**
 * Delete block
 */
export async function deleteBlock(
  client: Client,
  documentId: string,
  blockId: string
): Promise<void> {
  try {
    const response = await client.docx.documentBlock.delete({
      path: {
        document_id: documentId,
        block_id: blockId,
      },
      params: {
        document_revision_id: -1,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to delete block: ${response.msg}`);
    }

    logger.info(`✅ Deleted block: ${blockId}`);
  } catch (error) {
    logger.error('Failed to delete block:', error);
    throw error;
  }
}

/**
 * Append blocks to end of parent
 */
export async function appendBlocks(
  client: Client,
  documentId: string,
  parentId: string,
  blocks: Array<BlockCreateRequest>
): Promise<FeishuBlock[]> {
  // Get current children count
  const { blocks: existing } = await listChildren(client, documentId, parentId);
  const index = existing.length;

  return await batchCreateBlocks(client, documentId, parentId, blocks, { index });
}

/**
 * Insert blocks at specific position
 */
export async function insertBlocks(
  client: Client,
  documentId: string,
  parentId: string,
  blocks: Array<BlockCreateRequest>,
  index: number
): Promise<FeishuBlock[]> {
  return await batchCreateBlocks(client, documentId, parentId, blocks, { index });
}

/**
 * Create simple text block
 */
export async function createTextBlock(
  client: Client,
  documentId: string,
  parentId: string,
  text: string,
  options?: {
    index?: number;
    style?: 'normal' | 'heading1' | 'heading2' | 'heading3' | 'bullet' | 'ordered';
  }
): Promise<FeishuBlock> {
  const blockType = options?.style ? BLOCK_TYPE_MAP[options.style] : BLOCK_TYPE_MAP.text;

  const blocks = await batchCreateBlocks(
    client,
    documentId,
    parentId,
    [{
      type: blockType,
      text: {
        elements: [{
          text_run: {
            content: text,
          },
        }],
      },
    }],
    { index: options?.index }
  );

  return blocks[0];
}

/**
 * Create table
 */
export async function createTable(
  client: Client,
  documentId: string,
  parentId: string,
  rows: number,
  columns: number,
  options?: {
    index?: number;
  }
): Promise<FeishuBlock> {
  const blocks = await batchCreateBlocks(
    client,
    documentId,
    parentId,
    [{
      type: BLOCK_TYPE_MAP.table,
      table: {
        property: {
          row_size: rows,
          column_size: columns,
        },
        cells: Array(rows * columns).fill(null).map(() => ({
          content: '',
        })),
      },
    }],
    { index: options?.index }
  );

  return blocks[0];
}

/**
 * Insert table row
 */
export async function insertTableRow(
  client: Client,
  documentId: string,
  tableBlockId: string,
  rowIndex: number
): Promise<void> {
  const response = await client.docx.documentBlock.patch({
    path: {
      document_id: documentId,
      block_id: tableBlockId,
    },
    params: {
      document_revision_id: -1,
    },
    data: {
      insert_table_rows: {
        row_index: rowIndex,
        row_count: 1,
      },
    },
  });

  if (response.code !== 0) {
    throw new Error(`Failed to insert table row: ${response.msg}`);
  }

  logger.info(`✅ Inserted row at index ${rowIndex}`);
}

/**
 * Insert table column
 */
export async function insertTableColumn(
  client: Client,
  documentId: string,
  tableBlockId: string,
  columnIndex: number
): Promise<void> {
  const response = await client.docx.documentBlock.patch({
    path: {
      document_id: documentId,
      block_id: tableBlockId,
    },
    params: {
      document_revision_id: -1,
    },
    data: {
      insert_table_columns: {
        column_index: columnIndex,
        column_count: 1,
      },
    },
  });

  if (response.code !== 0) {
    throw new Error(`Failed to insert table column: ${response.msg}`);
  }

  logger.info(`✅ Inserted column at index ${columnIndex}`);
}

/**
 * Delete table row
 */
export async function deleteTableRow(
  client: Client,
  documentId: string,
  tableBlockId: string,
  rowIndex: number
): Promise<void> {
  const response = await client.docx.documentBlock.patch({
    path: {
      document_id: documentId,
      block_id: tableBlockId,
    },
    params: {
      document_revision_id: -1,
    },
    data: {
      delete_table_rows: {
        row_index: rowIndex,
        row_count: 1,
      },
    },
  });

  if (response.code !== 0) {
    throw new Error(`Failed to delete table row: ${response.msg}`);
  }

  logger.info(`✅ Deleted row at index ${rowIndex}`);
}

/**
 * Delete table column
 */
export async function deleteTableColumn(
  client: Client,
  documentId: string,
  tableBlockId: string,
  columnIndex: number
): Promise<void> {
  const response = await client.docx.documentBlock.patch({
    path: {
      document_id: documentId,
      block_id: tableBlockId,
    },
    params: {
      document_revision_id: -1,
    },
    data: {
      delete_table_columns: {
        column_index: columnIndex,
        column_count: 1,
      },
    },
  });

  if (response.code !== 0) {
    throw new Error(`Failed to delete table column: ${response.msg}`);
  }

  logger.info(`✅ Deleted column at index ${columnIndex}`);
}

/**
 * Extract image URLs from markdown
 */
function extractImageUrls(markdown: string): string[] {
  const regex = /!\[.*?\]\((.*?)\)/g;
  const urls: string[] = [];
  let match;

  while ((match = regex.exec(markdown)) !== null) {
    urls.push(match[1]);
  }

  return urls;
}

// ============================================================
// Tool Definitions
// ============================================================

export const docxToolDefinitions = {
  feishu_docx_get: {
    name: 'feishu_docx_get',
    description: 'Get document block by ID',
    parameters: {
      type: 'object' as const,
      properties: {
        documentId: {
          type: 'string',
          description: 'Document ID',
        },
        blockId: {
          type: 'string',
          description: 'Block ID to retrieve',
        },
      },
      required: ['documentId', 'blockId'],
    },
  },

  feishu_docx_list_children: {
    name: 'feishu_docx_list_children',
    description: 'List children blocks of a parent block',
    parameters: {
      type: 'object' as const,
      properties: {
        documentId: {
          type: 'string',
          description: 'Document ID',
        },
        blockId: {
          type: 'string',
          description: 'Parent block ID',
        },
        pageSize: {
          type: 'number',
          description: 'Number of blocks per page (default: 50)',
        },
      },
      required: ['documentId', 'blockId'],
    },
  },

  feishu_docx_search: {
    name: 'feishu_docx_search',
    description: 'Search for text in document',
    parameters: {
      type: 'object' as const,
      properties: {
        documentId: {
          type: 'string',
          description: 'Document ID',
        },
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['documentId', 'query'],
    },
  },

  feishu_docx_create_text: {
    name: 'feishu_docx_create_text',
    description: 'Create a simple text block',
    parameters: {
      type: 'object' as const,
      properties: {
        documentId: {
          type: 'string',
          description: 'Document ID',
        },
        parentId: {
          type: 'string',
          description: 'Parent block ID',
        },
        text: {
          type: 'string',
          description: 'Text content',
        },
        style: {
          type: 'string',
          enum: ['normal', 'heading1', 'heading2', 'heading3', 'bullet', 'ordered'],
          description: 'Text style (default: normal)',
        },
        index: {
          type: 'number',
          description: 'Insert position (default: append to end)',
        },
      },
      required: ['documentId', 'parentId', 'text'],
    },
  },

  feishu_docx_append: {
    name: 'feishu_docx_append',
    description: 'Append blocks to end of parent',
    parameters: {
      type: 'object' as const,
      properties: {
        documentId: {
          type: 'string',
          description: 'Document ID',
        },
        parentId: {
          type: 'string',
          description: 'Parent block ID',
        },
        blocks: {
          type: 'array',
          description: 'Array of block data',
          items: {
            type: 'object',
          },
        },
      },
      required: ['documentId', 'parentId', 'blocks'],
    },
  },

  feishu_docx_update: {
    name: 'feishu_docx_update',
    description: 'Update block content',
    parameters: {
      type: 'object' as const,
      properties: {
        documentId: {
          type: 'string',
          description: 'Document ID',
        },
        blockId: {
          type: 'string',
          description: 'Block ID to update',
        },
        text: {
          type: 'string',
          description: 'New text content',
        },
      },
      required: ['documentId', 'blockId', 'text'],
    },
  },

  feishu_docx_delete: {
    name: 'feishu_docx_delete',
    description: 'Delete a block',
    parameters: {
      type: 'object' as const,
      properties: {
        documentId: {
          type: 'string',
          description: 'Document ID',
        },
        blockId: {
          type: 'string',
          description: 'Block ID to delete',
        },
      },
      required: ['documentId', 'blockId'],
    },
  },

  feishu_docx_create_table: {
    name: 'feishu_docx_create_table',
    description: 'Create a table',
    parameters: {
      type: 'object' as const,
      properties: {
        documentId: {
          type: 'string',
          description: 'Document ID',
        },
        parentId: {
          type: 'string',
          description: 'Parent block ID',
        },
        rows: {
          type: 'number',
          description: 'Number of rows',
        },
        columns: {
          type: 'number',
          description: 'Number of columns',
        },
        index: {
          type: 'number',
          description: 'Insert position',
        },
      },
      required: ['documentId', 'parentId', 'rows', 'columns'],
    },
  },
};

/**
 * Execute docx tool
 */
export async function executeDocxTool(
  client: Client,
  name: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case 'feishu_docx_get': {
        const parsed = z.object({
          documentId: z.string(),
          blockId: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const block = await getBlock(client, parsed.data.documentId, parsed.data.blockId);
        return { success: true, data: block };
      }

      case 'feishu_docx_list_children': {
        const parsed = z.object({
          documentId: z.string(),
          blockId: z.string(),
          pageSize: z.number().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result = await listChildren(
          client,
          parsed.data.documentId,
          parsed.data.blockId,
          { pageSize: parsed.data.pageSize }
        );
        return {
          success: true,
          data: {
            blocks: result.blocks,
            hasMore: result.hasMore,
          },
        };
      }

      case 'feishu_docx_search': {
        const parsed = z.object({
          documentId: z.string(),
          query: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result = await searchDocument(client, parsed.data.documentId, parsed.data.query);
        return {
          success: true,
          data: {
            results: result.results,
            hasMore: result.hasMore,
          },
        };
      }

      case 'feishu_docx_create_text': {
        const parsed = z.object({
          documentId: z.string(),
          parentId: z.string(),
          text: z.string(),
          style: z.enum(['normal', 'heading1', 'heading2', 'heading3', 'bullet', 'ordered']).optional(),
          index: z.number().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const block = await createTextBlock(
          client,
          parsed.data.documentId,
          parsed.data.parentId,
          parsed.data.text,
          { style: parsed.data.style, index: parsed.data.index }
        );
        return { success: true, data: block };
      }

      case 'feishu_docx_append': {
        const parsed = z.object({
          documentId: z.string(),
          parentId: z.string(),
          blocks: z.array(z.any()),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const blocks = await appendBlocks(
          client,
          parsed.data.documentId,
          parsed.data.parentId,
          parsed.data.blocks
        );
        return { success: true, data: { blocks } };
      }

      case 'feishu_docx_update': {
        const parsed = z.object({
          documentId: z.string(),
          blockId: z.string(),
          text: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const block = await updateBlock(client, parsed.data.documentId, parsed.data.blockId, {
          text: {
            elements: [{
              text_run: {
                content: parsed.data.text,
              },
            }],
          },
        });
        return { success: true, data: block };
      }

      case 'feishu_docx_delete': {
        const parsed = z.object({
          documentId: z.string(),
          blockId: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        await deleteBlock(client, parsed.data.documentId, parsed.data.blockId);
        return { success: true, data: { deleted: true } };
      }

      case 'feishu_docx_create_table': {
        const parsed = z.object({
          documentId: z.string(),
          parentId: z.string(),
          rows: z.number(),
          columns: z.number(),
          index: z.number().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const block = await createTable(
          client,
          parsed.data.documentId,
          parsed.data.parentId,
          parsed.data.rows,
          parsed.data.columns,
          { index: parsed.data.index }
        );
        return { success: true, data: block };
      }

      default:
        return { success: false, error: `Unknown docx tool: ${name}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================
// Types
// ============================================================

export interface BlockCreateRequest {
  type: number;
  text?: TextContent;
  children?: BlockCreateRequest[];
  table?: {
    property: {
      row_size: number;
      column_size: number;
    };
    cells: Array<{ content: string }>;
  };
  index?: number;
}

export interface TextContent {
  elements: Array<{
    text_run?: {
      content: string;
      text_element_style?: Record<string, unknown>;
    };
    mention_user?: {
      user_id: string;
    };
    file?: {
      file_token: string;
    };
  }>;
  style?: Record<string, unknown>;
}

export interface FeishuBlock {
  block_id: string;
  document_id: string;
  parent_id: string;
  type: number;
  text?: TextContent;
  children?: FeishuBlock[];
  table?: {
    property: {
      row_size: number;
      column_size: number;
    };
    cells: Array<{ block_id: string }>;
  };
  create_time: string;
  update_time: string;
}
