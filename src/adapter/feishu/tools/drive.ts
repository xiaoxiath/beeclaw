/**
 * Feishu Drive Tools
 *
 * Tools for managing Feishu cloud storage
 */

import type { Client } from '@larksuiteoapi/node-sdk';
import { getLogger } from '../../../infra/observability/logger';
import { z } from 'zod';

const logger = getLogger('feishu:drive');

/**
 * Get root folder token
 */
export async function getRootFolderToken(
  client: Client
): Promise<string> {
  try {
    const response = await client.drive.drive.getRootFolderMeta({
      params: {},
    });

    if (response.code !== 0) {
      logger.warn('Failed to get root folder, using fallback "0"');
      return '0';
    }

    const token = response.data?.token || '0';
    logger.info(`✅ Got root folder token: ${token}`);
    return token;
  } catch (error) {
    logger.warn('Failed to get root folder, using fallback "0"');
    return '0';
  }
}

/**
 * List files in folder
 */
export async function listFiles(
  client: Client,
  folderToken: string,
  options?: {
    pageSize?: number;
    pageToken?: string;
    orderBy?: 'name' | 'created_time' | 'modified_time';
    orderDirection?: 'ASC' | 'DESC';
  }
): Promise<{
  files: FeishuFile[];
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.drive.file.listFiles({
      params: {
        folder_token,
        page_size: options?.pageSize || 50,
        page_token: options?.pageToken,
        order_by: options?.orderBy || 'modified_time',
        order_direction: options?.orderDirection || 'DESC',
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to list files: ${response.msg}`);
    }

    logger.info(`✅ Listed ${response.data?.files?.length || 0} files`);
    return {
      files: response.data?.files || [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
    };
  } catch (error) {
    logger.error('Failed to list files:', error);
    throw error;
  }
}

/**
 * Get file metadata
 */
export async function getFileInfo(
  client: Client,
  token: string
): Promise<FeishuFile> {
  try {
    const response = await client.drive.file.getFileInfo({
      path: {
        token,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get file info: ${response.msg}`);
    }

    logger.info(`✅ Got file info: ${token}`);
    return response.data as FeishuFile;
  } catch (error) {
    logger.error('Failed to get file info:', error);
    throw error;
  }
}

/**
 * Create folder
 */
export async function createFolder(
  client: Client,
  parentToken: string,
  name: string
): Promise<FeishuFile> {
  try {
    // If parent token is 'root', get actual root token
    if (parentToken === 'root') {
      parentToken = await getRootFolderToken(client);
    }

    const response = await client.drive.file.createFolder({
      params: {
        token: parentToken,
      },
      data: {
        name,
        folder_type: 'docx',
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to create folder: ${response.msg}`);
    }

    logger.info(`✅ Created folder: ${name}`);
    return response.data as FeishuFile;
  } catch (error) {
    logger.error('Failed to create folder:', error);
    throw error;
  }
}

/**
 * Move file to another folder
 */
export async function moveFile(
  client: Client,
  token: string,
  toFolderToken: string
): Promise<void> {
  try {
    // If toFolderToken is 'root', get actual root token
    if (toFolderToken === 'root') {
      toFolderToken = await getRootFolderToken(client);
    }

    const response = await client.drive.file.moveFileToFolder({
      path: {
        token,
      },
      params: {
        folder_token: toFolderToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to move file: ${response.msg}`);
    }

    logger.info(`✅ Moved file ${token} to folder ${toFolderToken}`);
  } catch (error) {
    logger.error('Failed to move file:', error);
    throw error;
  }
}

/**
 * Delete file or folder
 */
export async function deleteFile(
  client: Client,
  token: string,
  type: 'file' | 'folder' = 'file'
): Promise<void> {
  try {
    const response = await client.drive.file.deleteFile({
      path: {
        token,
      },
      params: {
        type,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to delete file: ${response.msg}`);
    }

    logger.info(`✅ Deleted ${type}: ${token}`);
  } catch (error) {
    logger.error('Failed to delete file:', error);
    throw error;
  }
}

/**
 * Copy file
 */
export async function copyFile(
  client: Client,
  token: string,
  toFolderToken: string,
  newName?: string
): Promise<FeishuFile> {
  try {
    // If toFolderToken is 'root', get actual root token
    if (toFolderToken === 'root') {
      toFolderToken = await getRootFolderToken(client);
    }

    const response = await client.drive.file.copyFile({
      path: {
        token,
      },
      params: {
        folder_token: toFolderToken,
      },
      data: {
        name: newName,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to copy file: ${response.msg}`);
    }

    logger.info(`✅ Copied file ${token} to folder ${toFolderToken}`);
    return response.data as FeishuFile;
  } catch (error) {
    logger.error('Failed to copy file:', error);
    throw error;
  }
}

/**
 * Rename file
 */
export async function renameFile(
  client: Client,
  token: string,
  newName: string
): Promise<FeishuFile> {
  try {
    const response = await client.drive.file.patch({
      path: {
        token,
      },
      params: {},
      data: {
        name: newName,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to rename file: ${response.msg}`);
    }

    logger.info(`✅ Renamed file ${token} to ${newName}`);
    return response.data as FeishuFile;
  } catch (error) {
    logger.error('Failed to rename file:', error);
    throw error;
  }
}

/**
 * Search files
 */
export async function searchFiles(
  client: Client,
  query: string,
  options?: {
    pageSize?: number;
    pageToken?: string;
  }
): Promise<{
  files: FeishuFile[];
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.drive.file.searchFiles({
      params: {
        search_query: query,
        page_size: options?.pageSize || 50,
        page_token: options?.pageToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to search files: ${response.msg}`);
    }

    logger.info(`✅ Found ${response.data?.files?.length || 0} files`);
    return {
      files: response.data?.files || [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
    };
  } catch (error) {
    logger.error('Failed to search files:', error);
    throw error;
  }
}

/**
 * Download file
 */
export async function downloadFile(
  client: Client,
  token: string
): Promise<Buffer> {
  try {
    const response = await client.drive.file.download({
      path: {
        token,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to download file: ${response.msg}`);
    }

    // Convert response to buffer
    const buffer = await readResponseBuffer(response.data);
    logger.info(`✅ Downloaded file: ${token} (${buffer.length} bytes)`);
    return buffer;
  } catch (error) {
    logger.error('Failed to download file:', error);
    throw error;
  }
}

/**
 * Upload file
 */
export async function uploadFile(
  client: Client,
  parentToken: string,
  fileName: string,
  fileData: Buffer,
  options?: {
    blockSize?: number;
  }
): Promise<FeishuFile> {
  try {
    // If parent token is 'root', get actual root token
    if (parentToken === 'root') {
      parentToken = await getRootFolderToken(client);
    }

    const blockSize = options?.blockSize || 4 * 1024 * 1024; // 4MB default

    const response = await client.drive.file.upload({
      params: {
        parent_token: parentToken,
        parent_type: 'ccm_resource_folder',
      },
      data: {
        block_size: blockSize,
        file_name: fileName,
        file_data: fileData,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to upload file: ${response.msg}`);
    }

    logger.info(`✅ Uploaded file: ${fileName}`);
    return response.data as FeishuFile;
  } catch (error) {
    logger.error('Failed to upload file:', error);
    throw error;
  }
}

/**
 * Get file permissions
 */
export async function getFilePermissions(
  client: Client,
  token: string
): Promise<FeishuPermission[]> {
  try {
    const response = await client.drive.permission.getPermissionPublic({
      path: {
        token,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get permissions: ${response.msg}`);
    }

    logger.info(`✅ Got permissions for file: ${token}`);
    return response.data as FeishuPermission[];
  } catch (error) {
    logger.error('Failed to get permissions:', error);
    throw error;
  }
}

/**
 * Create file share link
 */
export async function createShareLink(
  client: Client,
  token: string,
  options?: {
    expireTime?: string;
    password?: string;
  }
): Promise<{
  link: string;
  shortLink: string;
}> {
  try {
    const response = await client.drive.permission.createFileShareLink({
      path: {
        token,
      },
      data: {
        expire_time: options?.expireTime,
        password: options?.password,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to create share link: ${response.msg}`);
    }

    logger.info(`✅ Created share link for file: ${token}`);
    return {
      link: response.data?.share_link || '',
      shortLink: response.data?.short_link || '',
    };
  } catch (error) {
    logger.error('Failed to create share link:', error);
    throw error;
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Read response buffer from various formats
 */
async function readResponseBuffer(data: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (data && typeof data === 'object') {
    if ('buffer' in data && data.buffer instanceof ArrayBuffer) {
      return Buffer.from(data.buffer);
    }

    if ('getReader' in data && typeof data.getReader === 'function') {
      const reader = (data as ReadableStream).getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      return Buffer.concat(chunks);
    }
  }

  throw new Error('Unable to read response as buffer');
}

// ============================================================
// Tool Definitions
// ============================================================

export const driveToolDefinitions = {
  feishu_drive_list: {
    name: 'feishu_drive_list',
    description: 'List files in a folder (use "root" for root folder)',
    parameters: {
      type: 'object' as const,
      properties: {
        folderToken: {
          type: 'string',
          description: 'Folder token (use "root" for root folder)',
        },
        pageSize: {
          type: 'number',
          description: 'Number of files per page (default: 50)',
        },
        orderBy: {
          type: 'string',
          enum: ['name', 'created_time', 'modified_time'],
          description: 'Order by field (default: modified_time)',
        },
      },
      required: ['folderToken'],
    },
  },

  feishu_drive_get: {
    name: 'feishu_drive_get',
    description: 'Get file or folder metadata',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'File or folder token',
        },
      },
      required: ['token'],
    },
  },

  feishu_drive_create_folder: {
    name: 'feishu_drive_create_folder',
    description: 'Create a new folder',
    parameters: {
      type: 'object' as const,
      properties: {
        parentToken: {
          type: 'string',
          description: 'Parent folder token (use "root" for root folder)',
        },
        name: {
          type: 'string',
          description: 'Folder name',
        },
      },
      required: ['parentToken', 'name'],
    },
  },

  feishu_drive_move: {
    name: 'feishu_drive_move',
    description: 'Move file to another folder',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'File token to move',
        },
        toFolderToken: {
          type: 'string',
          description: 'Destination folder token (use "root" for root folder)',
        },
      },
      required: ['token', 'toFolderToken'],
    },
  },

  feishu_drive_copy: {
    name: 'feishu_drive_copy',
    description: 'Copy file to another folder',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'File token to copy',
        },
        toFolderToken: {
          type: 'string',
          description: 'Destination folder token (use "root" for root folder)',
        },
        newName: {
          type: 'string',
          description: 'New file name (optional)',
        },
      },
      required: ['token', 'toFolderToken'],
    },
  },

  feishu_drive_rename: {
    name: 'feishu_drive_rename',
    description: 'Rename file or folder',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'File or folder token',
        },
        newName: {
          type: 'string',
          description: 'New name',
        },
      },
      required: ['token', 'newName'],
    },
  },

  feishu_drive_delete: {
    name: 'feishu_drive_delete',
    description: 'Delete file or folder',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'File or folder token',
        },
        type2: {
          type: 'string',
          enum: ['file', 'folder'],
          description: 'Type of resource (default: file)',
        },
      },
      required: ['token'],
    },
  },

  feishu_drive_search: {
    name: 'feishu_drive_search',
    description: 'Search files by keyword',
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        pageSize: {
          type: 'number',
          description: 'Number of results per page (default: 50)',
        },
      },
      required: ['query'],
    },
  },

  feishu_drive_download: {
    name: 'feishu_drive_download',
    description: 'Download file content',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'File token',
        },
      },
      required: ['token'],
    },
  },

  feishu_drive_upload: {
    name: 'feishu_drive_upload',
    description: 'Upload file to folder',
    parameters: {
      type: 'object' as const,
      properties: {
        parentToken: {
          type: 'string',
          description: 'Parent folder token (use "root" for root folder)',
        },
        fileName: {
          type: 'string',
          description: 'File name',
        },
        filePath: {
          type: 'string',
          description: 'Local file path',
        },
      },
      required: ['parentToken', 'fileName', 'filePath'],
    },
  },

  feishu_drive_share: {
    name: 'feishu_drive_share',
    description: 'Create file share link',
    parameters: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'File token',
        },
        password: {
          type: 'string',
          description: 'Optional password for link',
        },
      },
      required: ['token'],
    },
  },
};

/**
 * Execute drive tool
 */
export async function executeDriveTool(
  client: Client,
  name: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case 'feishu_drive_list': {
        const parsed = z.object({
          folderToken: z.string(),
          pageSize: z.number().optional(),
          orderBy: z.enum(['name', 'created_time', 'modified_time']).optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        // Handle 'root' token
        let folderToken = parsed.data.folderToken;
        if (folderToken === 'root') {
          folderToken = await getRootFolderToken(client);
        }

        const result = await listFiles(client, folderToken, {
          pageSize: parsed.data.pageSize,
          orderBy: parsed.data.orderBy,
        });
        return {
          success: true,
          data: {
            files: result.files,
            hasMore: result.hasMore,
          },
        };
      }

      case 'feishu_drive_get': {
        const parsed = z.object({
          token: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const file = await getFileInfo(client, parsed.data.token);
        return { success: true, data: file };
      }

      case 'feishu_drive_create_folder': {
        const parsed = z.object({
          parentToken: z.string(),
          name: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const file = await createFolder(
          client,
          parsed.data.parentToken,
          parsed.data.name
        );
        return { success: true, data: file };
      }

      case 'feishu_drive_move': {
        const parsed = z.object({
          token: z.string(),
          toFolderToken: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        await moveFile(client, parsed.data.token, parsed.data.toFolderToken);
        return { success: true, data: { moved: true } };
      }

      case 'feishu_drive_copy': {
        const parsed = z.object({
          token: z.string(),
          toFolderToken: z.string(),
          newName: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const file = await copyFile(
          client,
          parsed.data.token,
          parsed.data.toFolderToken,
          parsed.data.newName
        );
        return { success: true, data: file };
      }

      case 'feishu_drive_rename': {
        const parsed = z.object({
          token: z.string(),
          newName: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const file = await renameFile(client, parsed.data.token, parsed.data.newName);
        return { success: true, data: file };
      }

      case 'feishu_drive_delete': {
        const parsed = z.object({
          token: z.string(),
          type2: z.enum(['file', 'folder']).optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        await deleteFile(client, parsed.data.token, parsed.data.type2 || 'file');
        return { success: true, data: { deleted: true } };
      }

      case 'feishu_drive_search': {
        const parsed = z.object({
          query: z.string(),
          pageSize: z.number().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result = await searchFiles(client, parsed.data.query, {
          pageSize: parsed.data.pageSize,
        });
        return {
          success: true,
          data: {
            files: result.files,
            hasMore: result.hasMore,
          },
        };
      }

      case 'feishu_drive_download': {
        const parsed = z.object({
          token: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const buffer = await downloadFile(client, parsed.data.token);
        return {
          success: true,
          data: {
            size: buffer.length,
            content: buffer.toString('base64'),
          },
        };
      }

      case 'feishu_drive_upload': {
        const parsed = z.object({
          parentToken: z.string(),
          fileName: z.string(),
          filePath: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const { readFile } = await import('fs/promises');
        const fileData = await readFile(parsed.data.filePath);

        const file = await uploadFile(
          client,
          parsed.data.parentToken,
          parsed.data.fileName,
          fileData
        );
        return { success: true, data: file };
      }

      case 'feishu_drive_share': {
        const parsed = z.object({
          token: z.string(),
          password: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result = await createShareLink(
          client,
          parsed.data.token,
          { password: parsed.data.password }
        );
        return { success: true, data: result };
      }

      default:
        return { success: false, error: `Unknown drive tool: ${name}` };
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

export interface FeishuFile {
  token: string;
  name: string;
  type: 'file' | 'folder';
  parent_token: string;
  size?: number;
  create_time: string;
  modify_time: string;
  creator: string;
  modifier: string;
  file_extension?: string;
  mime_type?: string;
  starred?: boolean;
  trashed?: boolean;
}

export interface FeishuPermission {
  token: string;
  type: 'user' | 'group' | 'anyone';
  id: string;
  role: 'viewer' | 'editor' | 'owner';
}
