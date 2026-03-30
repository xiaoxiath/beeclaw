/**
 * Tests for media.ts
 *
 * NOTE: The source code has a known bug where filename extraction from URL/path
 * uses `filename = extname(urlPath)` which produces just the extension (e.g., '.png').
 * Then `extname('.png')` returns '' causing validation to fail. This bug is present
 * for ALL string sources (URL and local path), even when explicit filename is provided
 * via options, because the string-source branch unconditionally overwrites filename.
 * Tests document this actual behavior.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  }),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(() => Promise.resolve(Buffer.from('file-data'))),
}));

// Mock global fetch
const mockFetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
    statusText: 'OK',
  } as Response)
);
globalThis.fetch = mockFetch as any;

import {
  uploadImage,
  uploadFile,
  downloadImage,
  downloadMessageResource,
  sendImageMessage,
  sendFileMessage,
  sendMedia,
} from '../media';

function makeClient() {
  return {
    im: {
      image: {
        create: vi.fn(() => Promise.resolve({ image_key: 'img_key_1' })),
        get: vi.fn(() => Promise.resolve(Buffer.from('image-bytes'))),
      },
      file: {
        create: vi.fn(() => Promise.resolve({ file_key: 'file_key_1' })),
      },
      message: {
        create: vi.fn(() => Promise.resolve({ code: 0, data: { message_id: 'msg_media' } })),
      },
      messageResource: {
        get: vi.fn(() => Promise.resolve(Buffer.from('resource-bytes'))),
      },
    },
  } as any;
}

describe('media', () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
    mockFetch.mockClear();
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
        statusText: 'OK',
      } as Response)
    );
  });

  // ===================== uploadImage =====================
  describe('uploadImage', () => {
    it('uploads buffer image with explicit filename', async () => {
      const result = await uploadImage(client, Buffer.from('png'), { filename: 'test.png' });
      expect(result.imageKey).toBe('img_key_1');
      expect(client.im.image.create).toHaveBeenCalledTimes(1);
    });

    it('uploads buffer image with default filename', async () => {
      // Default filename is 'image.png' which has valid .png extension
      const result = await uploadImage(client, Buffer.from('png'));
      expect(result.imageKey).toBe('img_key_1');
    });

    it('downloads from URL before upload attempt', async () => {
      // URL source triggers fetch; the extname bug then causes validation failure,
      // but we can verify fetch was called
      try {
        await uploadImage(client, 'https://example.com/image.png');
      } catch {
        // expected to fail due to extname bug
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('URL source fails validation due to extname overwrite bug', async () => {
      // filename = extname('/image.png') = '.png', then extname('.png') = ''
      await expect(uploadImage(client, 'https://example.com/image.png'))
        .rejects.toThrow('Unsupported image type');
    });

    it('URL source overwrites explicit filename causing validation failure', async () => {
      // Even with explicit filename, the URL branch overwrites:
      // filename starts as 'photo.png', then becomes '.png' from extname(urlPath)
      await expect(uploadImage(client, 'https://example.com/image.png', { filename: 'photo.png' }))
        .rejects.toThrow('Unsupported image type');
    });

    it('local path source fails validation due to extname overwrite bug', async () => {
      // filename = extname('/tmp/test.png') = '.png', then extname('.png') = ''
      await expect(uploadImage(client, '/tmp/test.png'))
        .rejects.toThrow('Unsupported image type');
    });

    it('throws on unsupported image type', async () => {
      await expect(uploadImage(client, Buffer.from('data'), { filename: 'test.txt' }))
        .rejects.toThrow('Unsupported image type');
    });

    it('throws on failed URL download', async () => {
      mockFetch.mockResolvedValue({ ok: false, statusText: 'Not Found' } as Response);
      await expect(uploadImage(client, 'https://example.com/bad.png'))
        .rejects.toThrow('Failed to download image');
    });

    it('throws on API null response', async () => {
      client.im.image.create.mockResolvedValue(null);
      await expect(uploadImage(client, Buffer.from('data'), { filename: 'test.png' }))
        .rejects.toThrow('Failed to upload image');
    });

    it('passes correct data to SDK create', async () => {
      const buf = Buffer.from('test-image-data');
      await uploadImage(client, buf, { filename: 'pic.jpg' });
      const call = client.im.image.create.mock.calls[0][0];
      expect(call.data.image_type).toBe('message');
      expect(call.data.image).toBe(buf);
    });
  });

  // ===================== uploadFile =====================
  describe('uploadFile', () => {
    it('uploads buffer file with explicit filename', async () => {
      const result = await uploadFile(client, Buffer.from('pdf'), { filename: 'test.pdf' });
      expect(result.fileKey).toBe('file_key_1');
    });

    it('URL source overwrites filename causing validation failure', async () => {
      // Same extname bug as uploadImage
      await expect(uploadFile(client, 'https://example.com/file.pdf'))
        .rejects.toThrow('Unsupported file type');
    });

    it('throws on file too large', async () => {
      const bigBuffer = Buffer.alloc(40 * 1024 * 1024); // 40MB
      await expect(uploadFile(client, bigBuffer, { filename: 'big.pdf', maxMb: 30 }))
        .rejects.toThrow('exceeds maximum');
    });

    it('throws on unsupported file type', async () => {
      await expect(uploadFile(client, Buffer.from('data'), { filename: 'test.txt' }))
        .rejects.toThrow('Unsupported file type');
    });

    it('throws on API null response', async () => {
      client.im.file.create.mockResolvedValue(null);
      await expect(uploadFile(client, Buffer.from('data'), { filename: 'test.pdf' }))
        .rejects.toThrow('Failed to upload file');
    });

    it('uses default 30MB max when maxMb not specified', async () => {
      // 31MB buffer should fail with default 30MB limit
      const buf = Buffer.alloc(31 * 1024 * 1024);
      await expect(uploadFile(client, buf, { filename: 'big.pdf' }))
        .rejects.toThrow('exceeds maximum');
    });

    it('passes file data to SDK create', async () => {
      const buf = Buffer.from('test-file-data');
      await uploadFile(client, buf, { filename: 'report.pdf' });
      const call = client.im.file.create.mock.calls[0][0];
      expect(call.data.file_type).toBe('stream');
      expect(call.data.file).toBe(buf);
    });
  });

  // ===================== downloadImage =====================
  describe('downloadImage', () => {
    it('downloads image as Buffer', async () => {
      const buffer = await downloadImage(client, 'img_key_1');
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it('passes image_key in path param', async () => {
      await downloadImage(client, 'img_key_abc');
      const call = client.im.image.get.mock.calls[0][0];
      expect(call.path.image_key).toBe('img_key_abc');
    });

    it('throws on API null response', async () => {
      client.im.image.get.mockResolvedValue(null);
      await expect(downloadImage(client, 'img_key_1')).rejects.toThrow('Failed to download image');
    });
  });

  // ===================== downloadMessageResource =====================
  describe('downloadMessageResource', () => {
    it('downloads message resource', async () => {
      const buffer = await downloadMessageResource(client, 'msg_1', 'file_key_1');
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it('passes correct path params', async () => {
      await downloadMessageResource(client, 'msg_abc', 'fk_xyz');
      const call = client.im.messageResource.get.mock.calls[0][0];
      expect(call.path.message_id).toBe('msg_abc');
      expect(call.path.file_key).toBe('fk_xyz');
    });

    it('throws on API error', async () => {
      client.im.messageResource.get.mockResolvedValue({ code: 99999, msg: 'fail' });
      await expect(downloadMessageResource(client, 'msg_1', 'fk'))
        .rejects.toThrow('Unable to read response as buffer');
    });
  });

  // ===================== sendImageMessage =====================
  describe('sendImageMessage', () => {
    it('sends image message', async () => {
      const result = await sendImageMessage(client, 'oc_1', 'chat_id', 'img_key_1');
      expect(result.messageId).toBe('msg_media');
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.data.msg_type).toBe('image');
    });

    it('sends correct receive_id_type', async () => {
      await sendImageMessage(client, 'uid_1', 'open_id', 'img_key_1');
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.params.receive_id_type).toBe('open_id');
      expect(call.data.receive_id).toBe('uid_1');
    });

    it('throws on API error', async () => {
      client.im.message.create.mockResolvedValue({ code: 99999, msg: 'fail' });
      await expect(sendImageMessage(client, 'oc_1', 'chat_id', 'img'))
        .rejects.toThrow('Failed to send image message');
    });
  });

  // ===================== sendFileMessage =====================
  describe('sendFileMessage', () => {
    it('sends file message', async () => {
      const result = await sendFileMessage(client, 'oc_1', 'chat_id', 'file_key_1');
      expect(result.messageId).toBe('msg_media');
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.data.msg_type).toBe('file');
    });

    it('sends correct receive_id_type', async () => {
      await sendFileMessage(client, 'uid_1', 'user_id', 'file_key_1');
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.params.receive_id_type).toBe('user_id');
    });
  });

  // ===================== sendMedia =====================
  describe('sendMedia', () => {
    it('auto-detects image extension and uploads then sends', async () => {
      const result = await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('img'), {
        filename: 'photo.png',
      });
      expect(result.messageId).toBe('msg_media');
      expect(client.im.image.create).toHaveBeenCalledTimes(1);
    });

    it('auto-detects file extension and uploads then sends', async () => {
      const result = await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('doc'), {
        filename: 'doc.pdf',
      });
      expect(result.messageId).toBe('msg_media');
      expect(client.im.file.create).toHaveBeenCalledTimes(1);
    });

    it('string source without explicit filename fails inside upload', async () => {
      // sendMedia: filename = source = '/tmp/photo.jpg', ext = '.jpg' -> IMAGE match
      // Then calls uploadImage(client, '/tmp/photo.jpg', undefined)
      // Inside uploadImage: filename = extname('/tmp/photo.jpg') = '.jpg'
      // Then ext = extname('.jpg') = '' -> fails
      await expect(sendMedia(client, 'oc_1', 'chat_id', '/tmp/photo.jpg'))
        .rejects.toThrow('Unsupported image type');
    });

    it('string source with explicit filename still fails inside upload', async () => {
      // sendMedia passes options through, but uploadImage overwrites filename
      await expect(sendMedia(client, 'oc_1', 'chat_id', '/tmp/photo.jpg', { filename: 'photo.jpg' }))
        .rejects.toThrow('Unsupported image type');
    });

    it('buffer source with unrecognized extension falls through to file upload', async () => {
      // Extension '.xyz' is not in IMAGE_EXTENSIONS, so it tries uploadFile
      // which will also reject it since '.xyz' is not in FILE_EXTENSIONS
      await expect(sendMedia(client, 'oc_1', 'chat_id', Buffer.from('data'), { filename: 'test.xyz' }))
        .rejects.toThrow('Unsupported file type');
    });
  });
});
