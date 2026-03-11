/**
 * Feishu Wiki Tools
 *
 * Tools for managing Feishu wiki spaces and pages
 */

import type { Client } from '@larksuiteoapi/node-sdk';
import { getLogger } from '../../../infra/observability/logger';
import { z } from 'zod';

const logger = getLogger('feishu:wiki');

/**
 * List wiki spaces
 */
export async function listSpaces(
  client: Client,
  options?: {
    pageSize?: number;
    pageToken?: string;
  }
): Promise<{
  spaces: FeishuWikiSpace[];
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.wiki.space.list({
      params: {
        page_size: options?.pageSize || 20,
        page_token: options?.pageToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to list wiki spaces: ${response.msg}`);
    }

    logger.info(`✅ Listed ${response.data?.items?.length || 0} wiki spaces`);
    return {
      spaces: response.data?.items || [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
    };
  } catch (error) {
    logger.error('Failed to list wiki spaces:', error);
    throw error;
  }
}

/**
 * Get wiki space info
 */
export async function getSpaceInfo(
  client: Client,
  spaceId: string
): Promise<FeishuWikiSpace> {
  try {
    const response = await client.wiki.space.get({
      path: {
        space_id: spaceId,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get space info: ${response.msg}`);
    }

    logger.info(`✅ Got wiki space: ${spaceId}`);
    return response.data as FeishuWikiSpace;
  } catch (error) {
    logger.error('Failed to get space info:', error);
    throw error;
  }
}

/**
 * List wiki nodes (pages)
 */
export async function listNodes(
  client: Client,
  spaceId: string,
  options?: {
    parentNodeId?: string;
    pageSize?: number;
    pageToken?: string;
  }
): Promise<{
  nodes: FeishuWikiNode[];
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.wiki.spaceNode.list({
      path: {
        space_id: spaceId,
      },
      params: {
        parent_node_token: options?.parentNodeId,
        page_size: options?.pageSize || 50,
        page_token: options?.pageToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to list wiki nodes: ${response.msg}`);
    }

    logger.info(`✅ Listed ${response.data?.items?.length || 0} wiki nodes`);
    return {
      nodes: response.data?.items || [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
    };
  } catch (error) {
    logger.error('Failed to list wiki nodes:', error);
    throw error;
  }
}

/**
 * Get wiki node info
 */
export async function getNodeInfo(
  client: Client,
  token: string
): Promise<FeishuWikiNode> {
  try {
    const response = await client.wiki.spaceNode.get({
      path: {
        token,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get node info: ${response.msg}`);
    }

    logger.info(`✅ Got wiki node: ${token}`);
    return response.data as FeishuWikiNode;
  } catch (error) {
    logger.error('Failed to get node info:', error);
    throw error;
  }
}

/**
 * Create wiki page
 */
export async function createPage(
  client: Client,
  spaceId: string,
  options: {
    title: string;
    parentNodeId?: string;
    objType?: 'doc' | 'docx' | 'sheet' | 'bitable' | 'mindnote' | 'file';
    objToken?: string;
  }
): Promise<FeishuWikiNode> {
  try {
    const response = await client.wiki.spaceNode.create({
      path: {
        space_id: spaceId,
      },
      params: {},
      data: {
        title: options.title,
        parent_node_token: options.parentNodeId,
        obj_type: options.objType || 'docx',
        obj_token: options.objToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to create wiki page: ${response.msg}`);
    }

    logger.info(`✅ Created wiki page: ${options.title}`);
    return response.data as FeishuWikiNode;
  } catch (error) {
    logger.error('Failed to create wiki page:', error);
    throw error;
  }
}

/**
 * Move wiki node
 */
export async function moveNode(
  client: Client,
  token: string,
  options: {
    targetParentToken?: string;
    targetSpaceId?: string;
    previousSiblingToken?: string;
    nextSiblingToken?: string;
  }
): Promise<void> {
  try {
    const response = await client.wiki.spaceNode.move({
      path: {
        token,
      },
      params: {},
      data: {
        target_parent_token: options.targetParentToken,
        target_space_id: options.targetSpaceId,
        previous_sibling_token: options.previousSiblingToken,
        next_sibling_token: options.nextSiblingToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to move wiki node: ${response.msg}`);
    }

    logger.info(`✅ Moved wiki node: ${token}`);
  } catch (error) {
    logger.error('Failed to move wiki node:', error);
    throw error;
  }
}

/**
 * Rename wiki node
 */
export async function renameNode(
  client: Client,
  token: string,
  title: string
): Promise<void> {
  try {
    const response = await client.wiki.spaceNode.patch({
      path: {
        token,
      },
      params: {},
      data: {
        title,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to rename wiki node: ${response.msg}`);
    }

    logger.info(`✅ Renamed wiki node to: ${title}`);
  } catch (error) {
    logger.error('Failed to rename wiki node:', error);
    throw error;
  }
}

/**
 * Delete wiki node
 */
export async function deleteNode(
  client: Client,
  token: string
): Promise<void> {
  try {
    const response = await client.wiki.spaceNode.delete({
      path: {
        token,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to delete wiki node: ${response.msg}`);
    }

    logger.info(`✅ Deleted wiki node: ${token}`);
  } catch (error) {
    logger.error('Failed to delete wiki node:', error);
    throw error;
  }
}

/**
 * Copy wiki node
 */
export async function copyNode(
  client: Client,
  token: string,
  targetSpaceId: string,
  options?: {
    targetParentToken?: string;
    title?: string;
  }
): Promise<FeishuWikiNode> {
  try {
    const response = await client.wiki.spaceNode.copy({
      path: {
        token,
      },
      params: {},
      data: {
        target_space_id: targetSpaceId,
        target_parent_token: options?.targetParentToken,
        title: options?.title,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to copy wiki node: ${response.msg}`);
    }

    logger.info(`✅ Copied wiki node: ${token}`);
    return response.data as FeishuWikiNode;
  } catch (error) {
    logger.error('Failed to copy wiki node:', error);
    throw error;
  }
}

/**
 * Search wiki pages
 */
export async function searchPages(
  client: Client,
  spaceId: string,
  query: string,
  options?: {
    pageSize?: number;
    pageToken?: string;
  }
): Promise<{
  nodes: FeishuWikiNode[];
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.wiki.spaceNode.search({
      path: {
        space_id: spaceId,
      },
      params: {
        query,
        page_size: options?.pageSize || 50,
        page_token: options?.pageToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to search wiki pages: ${response.msg}`);
    }

    logger.info(`✅ Found ${response.data?.items?.length || 0} wiki pages`);
    return {
      nodes: response.data?.items || [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
    };
  } catch (error) {
    logger.error('Failed to search wiki pages:', error);
    throw error;
  }
}

/**
 * Get wiki node children (tree structure)
 */
export async function getNodeTree(
  client: Client,
  spaceId: string,
  parentNodeId?: string,
  depth: number = 2
): Promise<FeishuWikiNode[]> {
  const nodes: FeishuWikiNode[] = [];
  let pageToken: string | undefined;

  do {
    const result = await listNodes(client, spaceId, {
      parentNodeId,
      pageSize: 50,
      pageToken,
    });

    for (const node of result.nodes) {
      nodes.push(node);

      // Recursively get children if depth > 1
      if (depth > 1 && node.has_child) {
        const children = await getNodeTree(
          client,
          spaceId,
          node.node_token,
          depth - 1
        );
        nodes.push(...children);
      }
    }

    pageToken = result.pageToken;
  } while (pageToken);

  return nodes;
}

// ============================================================
// Tool Definitions
// ============================================================

export const wikiToolDefinitions = {
  feishu_wiki_list_spaces: {
    name: 'feishu_wiki_list_spaces',
    description: 'List all wiki spaces user has access to',
    parameters: {
      type: 'object' as const,
      properties: {
        pageSize: {
          type: 'number',
          description: 'Number of spaces per page (default: 20)',
        },
      },
      required: [],
    },
  },

  feishu_wiki_get_space: {
    name: 'feishu_wiki_get_space',
    description: 'Get wiki space details',
    parameters: {
      type: 'object' as const,
      properties: {
        spaceId: {
          type: 'string',
          description: 'Wiki space ID',
        },
      },
      required: ['spaceId'],
    },
  },

  feishu_wiki_list_nodes: {
    name: 'feishu_wiki_list_nodes',
    description: 'List wiki pages/nodes in a space',
    parameters: {
      type: 'object' as const,
      properties: {
        spaceId: {
          type: 'string',
          description: 'Wiki space ID',
        },
        parentNodeId: {
          type: 'string',
          description: 'Parent node ID (optional, root if not specified)',
        },
        pageSize: {
          type: 'number',
          description: 'Number of nodes per page (default: 50)',
        },
      },
      required: ['spaceId'],
    },
  },

  feishu_wiki_get_node: {
    name: 'feishu_wiki_get_node',
    description: 'Get wiki page/node details',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'Wiki node token',
        },
      },
      required: ['token'],
    },
  },

  feishu_wiki_create_page: {
    name: 'feishu_wiki_create_page',
    description: 'Create a new wiki page',
    parameters: {
      type: 'object' as const,
      properties: {
        spaceId: {
          type: 'string',
          description: 'Wiki space ID',
        },
        title: {
          type: 'string',
          description: 'Page title',
        },
        parentNodeId: {
          type: 'string',
          description: 'Parent node ID (optional)',
        },
        objType: {
          type: 'string',
          enum: ['doc', 'docx', 'sheet', 'bitable', 'mindnote', 'file'],
          description: 'Object type (default: docx)',
        },
      },
      required: ['spaceId', 'title'],
    },
  },

  feishu_wiki_move_node: {
    name: 'feishu_wiki_move_node',
    description: 'Move wiki node to different location',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'Node token to move',
        },
        targetParentToken: {
          type: 'string',
          description: 'Target parent node token',
        },
        targetSpaceId: {
          type: 'string',
          description: 'Target space ID (if moving to different space)',
        },
      },
      required: ['token'],
    },
  },

  feishu_wiki_rename_node: {
    name: 'feishu_wiki_rename_node',
    description: 'Rename wiki page/node',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'Node token',
        },
        title: {
          type: 'string',
          description: 'New title',
        },
      },
      required: ['token', 'title'],
    },
  },

  feishu_wiki_delete_node: {
    name: 'feishu_wiki_delete_node',
    description: 'Delete wiki page/node',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'Node token to delete',
        },
      },
      required: ['token'],
    },
  },

  feishu_wiki_copy_node: {
    name: 'feishu_wiki_copy_node',
    description: 'Copy wiki node to another space',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'Node token to copy',
        },
        targetSpaceId: {
          type: 'string',
          description: 'Target space ID',
        },
        targetParentToken: {
          type: 'string',
          description: 'Target parent node token',
        },
        title: {
          type: 'string',
          description: 'New title (optional)',
        },
      },
      required: ['token', 'targetSpaceId'],
    },
  },

  feishu_wiki_search: {
    name: 'feishu_wiki_search',
    description: 'Search wiki pages by keyword',
    parameters: {
      type: 'object' as const,
      properties: {
        spaceId: {
          type: 'string',
          description: 'Wiki space ID',
        },
        query: {
          type: 'string',
          description: 'Search query',
        },
        pageSize: {
          type: 'number',
          description: 'Number of results per page (default: 50)',
        },
      },
      required: ['spaceId', 'query'],
    },
  },

  feishu_wiki_tree: {
    name: 'feishu_wiki_tree',
    description: 'Get wiki node tree structure',
    parameters: {
      type: 'object' as const,
      properties: {
        spaceId: {
          type: 'string',
          description: 'Wiki space ID',
        },
        parentNodeId: {
          type: 'string',
          description: 'Parent node ID (optional, root if not specified)',
        },
        depth: {
          type: 'number',
          description: 'Tree depth (default: 2, max: 3)',
        },
      },
      required: ['spaceId'],
    },
  },
};

/**
 * Execute wiki tool
 */
export async function executeWikiTool(
  client: Client,
  name: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case 'feishu_wiki_list_spaces': {
        const parsed = z.object({
          pageSize: z.number().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result = await listSpaces(client, parsed.data);
        return {
          success: true,
          data: {
            spaces: result.spaces,
            hasMore: result.hasMore,
          },
        };
      }

      case 'feishu_wiki_get_space': {
        const parsed = z.object({
          spaceId: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const space = await getSpaceInfo(client, parsed.data.spaceId);
        return { success: true, data: space };
      }

      case 'feishu_wiki_list_nodes': {
        const parsed = z.object({
          spaceId: z.string(),
          parentNodeId: z.string().optional(),
          pageSize: z.number().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result = await listNodes(
          client,
          parsed.data.spaceId,
          parsed.data
        );
        return {
          success: true,
          data: {
            nodes: result.nodes,
            hasMore: result.hasMore,
          },
        };
      }

      case 'feishu_wiki_get_node': {
        const parsed = z.object({
          token: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const node = await getNodeInfo(client, parsed.data.token);
        return { success: true, data: node };
      }

      case 'feishu_wiki_create_page': {
        const parsed = z.object({
          spaceId: z.string(),
          title: z.string(),
          parentNodeId: z.string().optional(),
          objType: z.enum(['doc', 'docx', 'sheet', 'bitable', 'mindnote', 'file']).optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const node = await createPage(client, parsed.data.spaceId, parsed.data);
        return { success: true, data: node };
      }

      case 'feishu_wiki_move_node': {
        const parsed = z.object({
          token: z.string(),
          targetParentToken: z.string().optional(),
          targetSpaceId: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        await moveNode(client, parsed.data.token, parsed.data);
        return { success: true, data: { moved: true } };
      }

      case 'feishu_wiki_rename_node': {
        const parsed = z.object({
          token: z.string(),
          title: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        await renameNode(client, parsed.data.token, parsed.data.title);
        return { success: true, data: { renamed: true } };
      }

      case 'feishu_wiki_delete_node': {
        const parsed = z.object({
          token: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        await deleteNode(client, parsed.data.token);
        return { success: true, data: { deleted: true } };
      }

      case 'feishu_wiki_copy_node': {
        const parsed = z.object({
          token: z.string(),
          targetSpaceId: z.string(),
          targetParentToken: z.string().optional(),
          title: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const node = await copyNode(
          client,
          parsed.data.token,
          parsed.data.targetSpaceId,
          parsed.data
        );
        return { success: true, data: node };
      }

      case 'feishu_wiki_search': {
        const parsed = z.object({
          spaceId: z.string(),
          query: z.string(),
          pageSize: z.number().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result = await searchPages(
          client,
          parsed.data.spaceId,
          parsed.data.query,
          { pageSize: parsed.data.pageSize }
        );
        return {
          success: true,
          data: {
            nodes: result.nodes,
            hasMore: result.hasMore,
          },
        };
      }

      case 'feishu_wiki_tree': {
        const parsed = z.object({
          spaceId: z.string(),
          parentNodeId: z.string().optional(),
          depth: z.number().min(1).max(3).optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const nodes = await getNodeTree(
          client,
          parsed.data.spaceId,
          parsed.data.parentNodeId,
          parsed.data.depth || 2
        );
        return { success: true, data: { nodes } };
      }

      default:
        return { success: false, error: `Unknown wiki tool: ${name}` };
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

export interface FeishuWikiSpace {
  space_id: string;
  name: string;
  description?: string;
  create_time: string;
  modify_time: string;
  creator: string;
  modifier: string;
  members_count?: number;
  nodes_count?: number;
  role?: 'viewer' | 'editor' | 'admin';
}

export interface FeishuWikiNode {
  node_token: string;
  obj_token: string;
  obj_type: 'doc' | 'docx' | 'sheet' | 'bitable' | 'mindnote' | 'file' | 'slides' | 'wiki';
  parent_node_token?: string;
  space_id: string;
  title: string;
  create_time: string;
  modify_time: string;
  creator: string;
  modifier: string;
  has_child: boolean;
  node_create_time: string;
}
