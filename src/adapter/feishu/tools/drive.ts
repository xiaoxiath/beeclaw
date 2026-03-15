/**
 * Feishu Drive Tools
 *
 * Tools for managing Feishu cloud storage
 */

import type { Client } from '@larksuiteoapi/node-sdk';
import { getLogger } from '../../../infra/observability/logger';
import { z } from 'zod';
import { readFile } from 'fs/promises';

const logger = getLogger('feishu:drive');

/**
 * List available drives for the application
 *
 * With tenant_access_token (app permissions), you can list drives/spaces
 * that the application has access to, then use their root_folder_token
 */
async function listAccessibleDrives(client: Client): Promise<any[]> {
  try {
    // Use the drive v1 API to list drives
    // Note: This endpoint might not be available in all SDK versions
    // so we'll make a direct HTTP call
    const response = await fetch('https://open.feishu.cn/open-apis/drive/v1/drives', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${(client as any).tokenManager?.tenantAccessToken || ''}`,
      },
    });

    if (!response.ok) {
      logger.warn(`Drive list API returned ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.data?.drives || [];
  } catch (error) {
    logger.debug('Failed to list drives (this is expected for some app configurations):', error);
    return [];
  }
}

/**
 * Get root folder token - for "root" keyword, try to get first available drive's root
 *
 * Note: With tenant_access_token (app permissions), you cannot access users' personal "My Drive" root.
 * You can only access:
 * - Folders shared with the application
 * - Shared drives/spaces
 * - Specific folders with explicit permissions
 *
 * For accessing user's personal drive files, user authorization (user_access_token) is required.
 */
export async function getRootFolderToken(
  client: Client
): Promise<string> {
  try {
    // Try to get the list of accessible drives
    const drives = await listAccessibleDrives(client);

    if (drives.length > 0 && drives[0].root_folder_token) {
      const rootToken = drives[0].root_folder_token;
      logger.info(`✅ Using root folder token from drive: ${drives[0].name || rootToken}`);
      return rootToken;
    }

    // If no drives found, provide helpful message and return empty
    // The listFiles will fail with a clear API error
    logger.warn('⚠️  No accessible drives found for application');
    logger.warn('For app permissions, you need:');
    logger.warn('  1. Folder permissions configured in Feishu admin console');
    logger.warn('  2. Or use a specific folder token instead of "root"');
    logger.warn('For personal drive access, user authorization is required');

    // Return empty string - this will cause the API to return a clear error
    return '';
  } catch (error) {
    logger.error('Failed to get root folder token:', error);
    return '';
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
    orderBy?: 'EditedTime' | 'CreatedTime';
    orderDirection?: 'ASC' | 'DESC';
  }
): Promise<{
  files: FeishuFile[];
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.drive.file.list({
      params: {
        folder_token: folderToken,
        page_size: options?.pageSize || 50,
        page_token: options?.pageToken,
        order_by: options?.orderBy || 'EditedTime',
        direction: options?.orderDirection || 'DESC',
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to list files: ${response.msg}`);
    }

    const files = (response.data?.files || []).map(file => ({
      token: file.token,
      name: file.name,
      type: file.type,
      parent_token: file.parent_token || '',
      create_time: file.created_time || '',
      modify_time: file.modified_time || '',
      creator: file.owner_id || '',
      modifier: file.owner_id || '',
    })) as FeishuFile[];

    logger.info(`✅ Listed ${files.length} files`);
    return {
      files,
      pageToken: response.data?.next_page_token,
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
    const response = await client.drive.meta.batchQuery({
      data: {
        request_docs: [
          {
            doc_token: token,
            doc_type: 'file',
          },
        ],
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get file info: ${response.msg}`);
    }

    const meta = response.data?.metas?.[0];
    if (!meta) {
      throw new Error('File not found');
    }

    // Convert meta to FeishuFile format
    const fileInfo: FeishuFile = {
      token: meta.doc_token,
      name: meta.title,
      type: 'file',
      parent_token: '',
      create_time: meta.create_time,
      modify_time: meta.latest_modify_time,
      creator: meta.owner_id,
      modifier: meta.latest_modify_user,
    };

    logger.info(`✅ Got file info: ${token}`);
    return fileInfo;
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
      data: {
        name,
        folder_token: parentToken,
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
 * Create a new Feishu document (docx)
 */
export async function createDocument(
  client: Client,
  title: string,
  options?: {
    folderToken?: string;
    content?: string;
  }
): Promise<{
  documentId: string;
  title: string;
  url: string;
}> {
  try {
    // Create document using docx API
    const response = await client.docx.document.create({
      data: {
        title: title,
        folder_token: options?.folderToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to create document: ${response.msg}`);
    }

    const documentId = response.data?.document?.document_id;
    const documentTitle = response.data?.document?.title || title;

    // If initial content provided, add it to the document
    if (options?.content && documentId) {
      try {
        // Get the root block (page block) of the document
        const rootBlock = await client.docx.documentBlock.get({
          path: {
            document_id: documentId,
            block_id: documentId,
          },
        });

        if (rootBlock.code === 0 && rootBlock.data?.block) {
          // Add text content to the document
          await client.docx.documentBlockChildren.patch({
            path: {
              document_id: documentId,
              block_id: documentId,
            },
            params: {
              document_revision_id: -1,
            },
            data: {
              index: 0,
              insert_horizontal: false,
              children: [{
                type: 2, // text block type
                text: {
                  elements: [{
                    text_run: {
                      content: options.content,
                    },
                  }],
                },
              }],
            },
          });
        }
      } catch (contentError) {
        // Non-fatal: document created but content addition failed
        logger.warn('Failed to add initial content to document:', contentError);
      }
    }

    logger.info(`✅ Created document: ${documentTitle} (${documentId})`);

    return {
      documentId,
      title: documentTitle,
      url: `https://feishu.cn/docx/${documentId}`,
    };
  } catch (error) {
    logger.error('Failed to create document:', error);
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

    const response = await client.drive.file.move({
      path: {
        file_token: token,
      },
      data: {
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
    const response = await client.drive.file.delete({
      path: {
        file_token: token,
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

    const response = await client.drive.file.copy({
      path: {
        file_token: token,
      },
      data: {
        name: newName || '',
        folder_token: toFolderToken,
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
  throw new Error(
    'Rename operation is not supported by the Feishu Drive SDK. ' +
    'Use move operation with the same parent folder to rename a file.'
  );
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
  throw new Error(
    'Search operation is not supported by the Feishu Drive SDK. ' +
    'Use the list operation to browse files.'
  );
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
        file_token: token,
      },
    });

    // Download returns a stream, not standard response
    const buffer = await readResponseBuffer(response);
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

    const response = await client.drive.file.uploadAll({
      data: {
        file_name: fileName,
        parent_type: 'explorer',
        parent_node: parentToken,
        size: fileData.length,
        file: fileData,
      },
    });

    // uploadAll returns file_token directly
    const fileToken = response.file_token;

    if (!fileToken) {
      throw new Error('Failed to get file token from upload response');
    }

    const fileInfo: FeishuFile = {
      token: fileToken,
      name: fileName,
      type: 'file',
      parent_token: parentToken,
      create_time: new Date().toISOString(),
      modify_time: new Date().toISOString(),
      creator: '',
      modifier: '',
    };

    logger.info(`✅ Uploaded file: ${fileName}`);
    return fileInfo;
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
    const response = await client.drive.permissionPublic.get({
      path: {
        token,
      },
      params: {
        type: 'file',
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
  throw new Error(
    'Create share link operation is not supported by the Feishu Drive SDK. ' +
    'Use permission management APIs to share files.'
  );
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
    description: 'List files in a folder. Note: For app permissions, you need a specific folder token (not "root"). Get folder token from Feishu Drive URL or use "列出我的云盘" to browse interactively.',
    parameters: {
      type: 'object' as const,
      properties: {
        folderToken: {
          type: 'string',
          description: 'Folder token (e.g., "fldcnXXXXXXXXXXXX"). For root, use specific folder token from your Feishu Drive URL. Example: From URL https://feishu.cn/drive/folder/fldcnABC123, use "fldcnABC123"',
        },
        pageSize: {
          type: 'number',
          description: 'Number of files per page (default: 50)',
        },
        orderBy: {
          type: 'string',
          enum: ['CreatedTime', 'EditedTime'],
          description: 'Order by field (default: EditedTime)',
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

  feishu_drive_create_document: {
    name: 'feishu_drive_create_document',
    description: 'Create a new Feishu document (docx) in cloud drive',
    parameters: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Document title',
        },
        folderToken: {
          type: 'string',
          description: 'Folder token where to create the document (optional, creates in root if not specified)',
        },
        content: {
          type: 'string',
          description: 'Initial content for the document (optional)',
        },
      },
      required: ['title'],
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
  params: Record<string, unknown>,
  userContext?: unknown // Keep parameter for compatibility but don't use it
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case 'feishu_drive_list': {
        const parsed = z.object({
          folderToken: z.string(),
          pageSize: z.number().optional(),
          orderBy: z.enum(['CreatedTime', 'EditedTime']).optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        // Check if user is trying to use "root" keyword
        if (parsed.data.folderToken.toLowerCase() === 'root') {
          return {
            success: false,
            error: '❌ 无法访问云盘根目录\n\n' +
              '**应用权限限制**：应用无法直接访问您的"我的云盘"根目录\n\n' +
              '**解决方案**：\n' +
              '1. **获取文件夹token**：\n' +
              '   - 在飞书云盘中打开要访问的文件夹\n' +
              '   - 从浏览器地址栏复制文件夹token\n' +
              '   - URL格式：`https://feishu.cn/drive/folder/fldcnXXXXXXXXX`\n' +
              '   - 其中的 `fldcnXXXXXXXXX` 就是 folderToken\n\n' +
              '2. **使用具体token**：\n' +
              '   ```\n' +
              '   "列出文件夹 fldcnXXXXXXXXX 的文件"\n' +
              '   ```\n\n' +
              '3. **或使用用户授权**：\n' +
              '   - 个人云盘需要用户授权才能访问\n' +
              '   - 我可以帮您设置用户授权流程',
          };
        }

        const result = await listFiles(client, parsed.data.folderToken, {
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

      case 'feishu_drive_create_document': {
        const parsed = z.object({
          title: z.string(),
          folderToken: z.string().optional(),
          content: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        // If folderToken is 'root', get actual root token
        let folderToken = parsed.data.folderToken;
        if (folderToken === 'root') {
          folderToken = await getRootFolderToken(client);
        }

        const doc = await createDocument(client, parsed.data.title, {
          folderToken,
          content: parsed.data.content,
        });
        return {
          success: true,
          data: doc,
        };
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
