/**
 * Extended tests for media.ts - covering readFeishuResponseBuffer branches,
 * download type param, empty key paths, and additional error scenarios
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

vi.mock('fs/promises', () => ({
  readFile: vi.fn(() => Promise.resolve(Buffer.from('file-data'))),
}));

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

describe('media-extended', () => {
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

  // =====================================================
  // readFeishuResponseBuffer branches (via downloadImage)
  // =====================================================
  describe('readFeishuResponseBuffer branches', () => {
    it('handles Buffer response directly', async () => {
      client.im.image.get.mockResolvedValue(Buffer.from('direct-buffer'));
      const buf = await downloadImage(client, 'img_1');
      expect(buf.toString()).toBe('direct-buffer');
    });

    it('handles ArrayBuffer response', async () => {
      const ab = new ArrayBuffer(5);
      const view = new Uint8Array(ab);
      view.set([72, 69, 76, 76, 79]); // "HELLO"
      client.im.image.get.mockResolvedValue(ab);
      const buf = await downloadImage(client, 'img_1');
      expect(buf.toString()).toBe('HELLO');
    });

    it('handles object with buffer property (typed array-like)', async () => {
      const ab = new ArrayBuffer(3);
      new Uint8Array(ab).set([65, 66, 67]); // "ABC"
      client.im.image.get.mockResolvedValue({ buffer: ab });
      const buf = await downloadImage(client, 'img_1');
      expect(buf.toString()).toBe('ABC');
    });

    it('handles ReadableStream response', async () => {
      const chunks = [new Uint8Array([72, 73])]; // "HI"
      let readIndex = 0;
      const mockReader = {
        read: vi.fn(() => {
          if (readIndex < chunks.length) {
            return Promise.resolve({ done: false, value: chunks[readIndex++] });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      };
      const mockStream = { getReader: vi.fn(() => mockReader) };
      client.im.image.get.mockResolvedValue(mockStream);
      const buf = await downloadImage(client, 'img_1');
      expect(buf.toString()).toBe('HI');
    });

    it('handles async iterable response', async () => {
      const asyncIterable = {
        [Symbol.asyncIterator]() {
          let done = false;
          return {
            next() {
              if (!done) {
                done = true;
                return Promise.resolve({ done: false, value: new Uint8Array([79, 75]) }); // "OK"
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      };
      client.im.image.get.mockResolvedValue(asyncIterable);
      const buf = await downloadImage(client, 'img_1');
      expect(buf.toString()).toBe('OK');
    });

    it('throws on unsupported response type (string)', async () => {
      client.im.image.get.mockResolvedValue('just a string');
      await expect(downloadImage(client, 'img_1'))
        .rejects.toThrow('Unable to read response as buffer');
    });

    it('throws on null response data', async () => {
      client.im.image.get.mockResolvedValue(null);
      await expect(downloadImage(client, 'img_1'))
        .rejects.toThrow('Failed to download image: no response');
    });

    it('throws on number response data', async () => {
      client.im.image.get.mockResolvedValue(42);
      await expect(downloadImage(client, 'img_1'))
        .rejects.toThrow('Unable to read response as buffer');
    });

    it('handles ReadableStream with multiple chunks', async () => {
      let readIndex = 0;
      const chunks = [
        new Uint8Array([65, 66]),
        new Uint8Array([67, 68]),
        new Uint8Array([69]),
      ];
      const mockReader = {
        read: vi.fn(() => {
          if (readIndex < chunks.length) {
            return Promise.resolve({ done: false, value: chunks[readIndex++] });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      };
      client.im.image.get.mockResolvedValue({ getReader: () => mockReader });
      const buf = await downloadImage(client, 'img_1');
      expect(buf.toString()).toBe('ABCDE');
    });
  });

  // =====================================================
  // readFeishuResponseBuffer via downloadMessageResource
  // =====================================================
  describe('downloadMessageResource readFeishuResponseBuffer', () => {
    it('handles ArrayBuffer response in messageResource', async () => {
      const ab = new ArrayBuffer(2);
      new Uint8Array(ab).set([79, 75]);
      client.im.messageResource.get.mockResolvedValue(ab);
      const buf = await downloadMessageResource(client, 'msg_1', 'fk_1');
      expect(buf.toString()).toBe('OK');
    });

    it('passes type=file param', async () => {
      await downloadMessageResource(client, 'msg_1', 'fk_1', 'file');
      const call = client.im.messageResource.get.mock.calls[0][0];
      expect(call.params.type).toBe('file');
    });

    it('passes type=image param by default', async () => {
      await downloadMessageResource(client, 'msg_1', 'fk_1');
      const call = client.im.messageResource.get.mock.calls[0][0];
      expect(call.params.type).toBe('image');
    });

    it('throws on network error', async () => {
      client.im.messageResource.get.mockRejectedValue(new Error('timeout'));
      await expect(downloadMessageResource(client, 'msg_1', 'fk_1'))
        .rejects.toThrow('timeout');
    });
  });

  // =====================================================
  // downloadImage additional branches
  // =====================================================
  describe('downloadImage additional', () => {
    it('throws on network error', async () => {
      client.im.image.get.mockRejectedValue(new Error('conn refused'));
      await expect(downloadImage(client, 'img_1'))
        .rejects.toThrow('conn refused');
    });
  });

  // =====================================================
  // uploadImage: URL with no extension
  // =====================================================
  describe('uploadImage URL edge cases', () => {
    it('URL with no extension uses default filename', async () => {
      // URL path has no extension -> ext is '' -> if(ext) false -> filename stays 'image.png'
      // Then extname('image.png') = '.png' which is valid
      const result = await uploadImage(client, 'https://example.com/image');
      expect(result.imageKey).toBe('img_key_1');
    });

    it('URL fetch failure throws before validation', async () => {
      mockFetch.mockResolvedValue({ ok: false, statusText: 'Forbidden' } as Response);
      await expect(uploadImage(client, 'https://example.com/img'))
        .rejects.toThrow('Failed to download image from URL: Forbidden');
    });
  });

  // =====================================================
  // uploadFile: URL and local path branches
  // =====================================================
  describe('uploadFile URL and path branches', () => {
    it('URL with no extension uses default filename for file', async () => {
      // URL has no extension -> ext='' -> if(ext) false -> filename='file.pdf'
      const result = await uploadFile(client, 'https://example.com/download');
      expect(result.fileKey).toBe('file_key_1');
    });

    it('URL fetch failure for file', async () => {
      mockFetch.mockResolvedValue({ ok: false, statusText: 'Not Found' } as Response);
      await expect(uploadFile(client, 'https://example.com/file'))
        .rejects.toThrow('Failed to download file from URL: Not Found');
    });

    it('local file path reads from filesystem (extname bug)', async () => {
      // extname('/tmp/doc.pdf') = '.pdf', then filename = '.pdf'
      // then extname('.pdf') = '' -> fails validation
      await expect(uploadFile(client, '/tmp/doc.pdf'))
        .rejects.toThrow('Unsupported file type');
    });

    it('custom maxMb limit', async () => {
      const buf = Buffer.alloc(6 * 1024 * 1024);
      await expect(uploadFile(client, buf, { filename: 'big.pdf', maxMb: 5 }))
        .rejects.toThrow('exceeds maximum');
    });

    it('returns empty fileKey when response has no file_key', async () => {
      client.im.file.create.mockResolvedValue({});
      const result = await uploadFile(client, Buffer.from('data'), { filename: 'test.pdf' });
      expect(result.fileKey).toBe('');
    });

    it('throws on network error', async () => {
      client.im.file.create.mockRejectedValue(new Error('timeout'));
      await expect(uploadFile(client, Buffer.from('data'), { filename: 'test.pdf' }))
        .rejects.toThrow('timeout');
    });
  });

  // =====================================================
  // uploadImage: empty imageKey return
  // =====================================================
  describe('uploadImage empty key return', () => {
    it('returns empty imageKey when response has no image_key', async () => {
      client.im.image.create.mockResolvedValue({});
      const result = await uploadImage(client, Buffer.from('data'), { filename: 'test.png' });
      expect(result.imageKey).toBe('');
    });

    it('throws on network error', async () => {
      client.im.image.create.mockRejectedValue(new Error('fail'));
      await expect(uploadImage(client, Buffer.from('data'), { filename: 'test.png' }))
        .rejects.toThrow('fail');
    });
  });

  // =====================================================
  // sendImageMessage / sendFileMessage edge cases
  // =====================================================
  describe('sendImageMessage additional', () => {
    it('returns empty messageId when data missing', async () => {
      client.im.message.create.mockResolvedValue({ code: 0, data: {} });
      const result = await sendImageMessage(client, 'oc_1', 'chat_id', 'img_1');
      expect(result.messageId).toBe('');
    });

    it('throws on network error', async () => {
      client.im.message.create.mockRejectedValue(new Error('fail'));
      await expect(sendImageMessage(client, 'oc_1', 'chat_id', 'img_1'))
        .rejects.toThrow('fail');
    });
  });

  describe('sendFileMessage additional', () => {
    it('throws on API error', async () => {
      client.im.message.create.mockResolvedValue({ code: 50001, msg: 'fail' });
      await expect(sendFileMessage(client, 'oc_1', 'chat_id', 'fk_1'))
        .rejects.toThrow('Failed to send file message');
    });

    it('returns empty messageId when data missing', async () => {
      client.im.message.create.mockResolvedValue({ code: 0, data: {} });
      const result = await sendFileMessage(client, 'oc_1', 'chat_id', 'fk_1');
      expect(result.messageId).toBe('');
    });

    it('throws on network error', async () => {
      client.im.message.create.mockRejectedValue(new Error('fail'));
      await expect(sendFileMessage(client, 'oc_1', 'chat_id', 'fk_1'))
        .rejects.toThrow('fail');
    });
  });

  // =====================================================
  // sendMedia extended
  // =====================================================
  describe('sendMedia extended', () => {
    it('detects .jpg as image', async () => {
      await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('img'), { filename: 'photo.jpg' });
      expect(client.im.image.create).toHaveBeenCalledTimes(1);
    });

    it('detects .jpeg as image', async () => {
      await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('img'), { filename: 'photo.jpeg' });
      expect(client.im.image.create).toHaveBeenCalledTimes(1);
    });

    it('detects .webp as image', async () => {
      await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('img'), { filename: 'photo.webp' });
      expect(client.im.image.create).toHaveBeenCalledTimes(1);
    });

    it('detects .gif as image', async () => {
      await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('img'), { filename: 'anim.gif' });
      expect(client.im.image.create).toHaveBeenCalledTimes(1);
    });

    it('detects .doc as file', async () => {
      await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('doc'), { filename: 'report.doc' });
      expect(client.im.file.create).toHaveBeenCalledTimes(1);
    });

    it('detects .xlsx as file', async () => {
      await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('xls'), { filename: 'data.xlsx' });
      expect(client.im.file.create).toHaveBeenCalledTimes(1);
    });

    it('detects .pptx as file', async () => {
      await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('ppt'), { filename: 'slides.pptx' });
      expect(client.im.file.create).toHaveBeenCalledTimes(1);
    });

    it('detects .mp4 as file', async () => {
      await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('vid'), { filename: 'video.mp4' });
      expect(client.im.file.create).toHaveBeenCalledTimes(1);
    });

    it('string source without explicit filename triggers extname bug in upload', async () => {
      // sendMedia: filename = source = '/tmp/photo.jpg', ext = '.jpg' -> IMAGE match
      // Then uploadImage('/tmp/photo.jpg') -> local path -> filename = extname = '.jpg'
      // Then extname('.jpg') = '' -> fails validation
      await expect(sendMedia(client, 'oc_1', 'chat_id', '/tmp/photo.jpg'))
        .rejects.toThrow();
    });

    it('Buffer source with no filename defaults to file upload with file.pdf', async () => {
      // sendMedia: filename = 'file', ext = '' -> not image
      // uploadFile(client, buf, undefined) -> filename defaults to 'file.pdf'
      // Buffer path doesn't overwrite filename -> extname('file.pdf')='.pdf' -> valid
      const result = await sendMedia(client, 'oc_1', 'chat_id', Buffer.from('data'));
      expect(result.messageId).toBe('msg_media');
      expect(client.im.file.create).toHaveBeenCalledTimes(1);
    });

    it('buffer with unrecognized extension fails in file upload', async () => {
      await expect(
        sendMedia(client, 'oc_1', 'chat_id', Buffer.from('data'), { filename: 'test.xyz' })
      ).rejects.toThrow('Unsupported file type');
    });

    it('propagates upload error', async () => {
      client.im.image.create.mockRejectedValue(new Error('upload failed'));
      await expect(
        sendMedia(client, 'oc_1', 'chat_id', Buffer.from('img'), { filename: 'photo.png' })
      ).rejects.toThrow('upload failed');
    });

    it('propagates send error after successful upload', async () => {
      client.im.message.create.mockResolvedValue({ code: 50001, msg: 'send failed' });
      await expect(
        sendMedia(client, 'oc_1', 'chat_id', Buffer.from('img'), { filename: 'photo.png' })
      ).rejects.toThrow('Failed to send image message');
    });
  });
});
