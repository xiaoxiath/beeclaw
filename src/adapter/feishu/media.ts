/**
 * Feishu Media Upload & Download
 *
 * Handles uploading and downloading images and files
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { getLogger } from '../../infra/observability/logger';
import { extname } from 'path';
import { readFile } from 'fs/promises';

const logger = getLogger('feishu:media');

/** Client type alias for the Lark SDK Client */
type Client = InstanceType<typeof Lark.Client>;

// Supported image types
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.bmp', '.ico'];

// Supported file types
const FILE_EXTENSIONS = ['.opus', '.mp4', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.stream'];

/**
 * Upload image to Feishu
 */
export async function uploadImage(
  client: Client,
  source: Buffer | string,
  options?: {
    filename?: string;
  }
): Promise<{ imageKey: string }> {
  try {
    let imageBuffer: Buffer;
    let filename = options?.filename || 'image.png';

    if (typeof source === 'string') {
      // URL or path
      if (source.startsWith('http://') || source.startsWith('https://')) {
        // Download from URL
        const response = await fetch(source);
        if (!response.ok) {
          throw new Error(`Failed to download image from URL: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);

        // Extract filename from URL
        const urlPath = new URL(source).pathname;
        const ext = extname(urlPath);
        if (ext) {
          filename = extname(urlPath) || filename;
        }
      } else {
        // Local file path - read from filesystem
        imageBuffer = await readFile(source);
        filename = extname(source) || filename;
      }
    } else {
      imageBuffer = source;
    }

    // Validate image type
    const ext = extname(filename).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported image type: ${ext}. Supported: ${IMAGE_EXTENSIONS.join(', ')}`);
    }

    // Upload to Feishu
    const response = await client.im.image.create({
      data: {
        image_type: 'message',
        image: imageBuffer,
      },
    });

    if (!response) {
      throw new Error('Failed to upload image: no response');
    }

    logger.info(`✅ Image uploaded: ${response.image_key}`);
    return { imageKey: response.image_key || '' };
  } catch (error) {
    logger.error('Failed to upload image:', error);
    throw error;
  }
}

/**
 * Upload file to Feishu
 */
export async function uploadFile(
  client: Client,
  source: Buffer | string,
  options?: {
    filename?: string;
    maxMb?: number;
  }
): Promise<{ fileKey: string }> {
  try {
    const maxMb = options?.maxMb || 30; // Default 30MB

    let fileBuffer: Buffer;
    let filename = options?.filename || 'file.pdf';

    if (typeof source === 'string') {
      // URL or path
      if (source.startsWith('http://') || source.startsWith('https://')) {
        // Download from URL
        const response = await fetch(source);
        if (!response.ok) {
          throw new Error(`Failed to download file from URL: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);

        // Extract filename from URL
        const urlPath = new URL(source).pathname;
        const ext = extname(urlPath);
        if (ext) {
          filename = extname(urlPath) || filename;
        }
      } else {
        // Local file path
        fileBuffer = await readFile(source);
        filename = extname(source) || filename;
      }
    } else {
      fileBuffer = source;
    }

    // Check file size
    const sizeMb = fileBuffer.length / (1024 * 1024);
    if (sizeMb > maxMb) {
      throw new Error(`File size ${sizeMb.toFixed(2)}MB exceeds maximum ${maxMb}MB`);
    }

    // Validate file type
    const ext = extname(filename).toLowerCase();
    if (!FILE_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported file type: ${ext}. Supported: ${FILE_EXTENSIONS.join(', ')}`);
    }

    // Upload to Feishu
    const response = await client.im.file.create({
      data: {
        file_type: 'stream',
        file_name: filename,
        file: fileBuffer,
      },
    });

    if (!response) {
      throw new Error('Failed to upload file: no response');
    }

    logger.info(`✅ File uploaded: ${response.file_key}`);
    return { fileKey: response.file_key || '' };
  } catch (error) {
    logger.error('Failed to upload file:', error);
    throw error;
  }
}

/**
 * Download image from Feishu
 */
export async function downloadImage(
  client: Client,
  imageKey: string
): Promise<Buffer> {
  try {
    const response = await client.im.image.get({
      path: {
        image_key: imageKey,
      },
    });

    if (!response) {
      throw new Error('Failed to download image: no response');
    }

    // Convert response to buffer
    const buffer = await readFeishuResponseBuffer(response);
    logger.info(`✅ Image downloaded: ${buffer.length} bytes`);
    return buffer;
  } catch (error) {
    logger.error('Failed to download image:', error);
    throw error;
  }
}

/**
 * Download message resource (attachments)
 */
export async function downloadMessageResource(
  client: Client,
  messageId: string,
  fileKey: string,
  type: 'image' | 'file' = 'image'
): Promise<Buffer> {
  try {
    const response = await client.im.messageResource.get({
      path: {
        message_id: messageId,
        file_key: fileKey,
      },
      params: {
        type,
      },
    });

    if (!response) {
      throw new Error('Failed to download message resource: no response');
    }

    const buffer = await readFeishuResponseBuffer(response);
    logger.info(`✅ Message resource downloaded: ${buffer.length} bytes`);
    return buffer;
  } catch (error) {
    logger.error('Failed to download message resource:', error);
    throw error;
  }
}

/**
 * Send image message
 */
export async function sendImageMessage(
  client: Client,
  receiveId: string,
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id',
  imageKey: string
): Promise<{ messageId: string }> {
  try {
    const response = await client.im.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: 'image',
        content: JSON.stringify({
          image_key: imageKey,
        }),
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to send image message: ${response.msg}`);
    }

    logger.info(`✅ Image message sent: ${response.data?.message_id}`);
    return { messageId: response.data?.message_id || '' };
  } catch (error) {
    logger.error('Failed to send image message:', error);
    throw error;
  }
}

/**
 * Send file message
 */
export async function sendFileMessage(
  client: Client,
  receiveId: string,
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id',
  fileKey: string
): Promise<{ messageId: string }> {
  try {
    const response = await client.im.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: 'file',
        content: JSON.stringify({
          file_key: fileKey,
        }),
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to send file message: ${response.msg}`);
    }

    logger.info(`✅ File message sent: ${response.data?.message_id}`);
    return { messageId: response.data?.message_id || '' };
  } catch (error) {
    logger.error('Failed to send file message:', error);
    throw error;
  }
}

/**
 * Send media (auto-detect type and upload)
 */
export async function sendMedia(
  client: Client,
  receiveId: string,
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id',
  source: Buffer | string,
  options?: {
    filename?: string;
    maxMb?: number;
  }
): Promise<{ messageId: string }> {
  try {
    const filename = options?.filename || (typeof source === 'string' ? source : 'file');
    const ext = extname(filename).toLowerCase();

    // Check if it's an image
    if (IMAGE_EXTENSIONS.includes(ext)) {
      const { imageKey } = await uploadImage(client, source, options);
      return await sendImageMessage(client, receiveId, receiveIdType, imageKey);
    }

    // Otherwise treat as file
    const { fileKey } = await uploadFile(client, source, options);
    return await sendFileMessage(client, receiveId, receiveIdType, fileKey);
  } catch (error) {
    logger.error('Failed to send media:', error);
    throw error;
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Read Feishu response buffer from various formats
 */
async function readFeishuResponseBuffer(data: unknown): Promise<Buffer> {
  // Handle different response formats
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (data && typeof data === 'object') {
    // Check for array buffer in data.buffer
    if ('buffer' in data && data.buffer instanceof ArrayBuffer) {
      return Buffer.from(data.buffer);
    }

    // Check for ReadableStream
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

    // Check for async iterator
    if (Symbol.asyncIterator in data) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of data as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }
  }

  throw new Error('Unable to read response as buffer');
}
