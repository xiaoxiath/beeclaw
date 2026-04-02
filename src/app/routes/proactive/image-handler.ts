/**
 * Image Message Handler Module
 *
 * Handles downloading and processing image messages from Feishu.
 * Converts Feishu image resources to base64 for multimodal AI processing.
 */

import { logger } from '../../../infra/observability/logger';
import { getTenantAccessToken } from './feishu-auth';

/**
 * Download and process an image message from Feishu.
 * Returns the image as a base64 string, or null if download fails.
 */
export async function downloadFeishuImage(
  messageId: string,
  messageContent: string,
  pid: number,
): Promise<string | null> {
  let imageBase64: string | null = null;

  try {
    // Extract image key and download
    const content = JSON.parse(messageContent);
    const imageKey = content.image_key;

    if (imageKey) {
      logger.debug(`[FeishuWS:${pid}] Downloading image: ${imageKey}`);

      // Download image from user message using "Get Message Resources" API
      // API: GET /open-apis/im/v1/messages/:message_id/resources/:file_key?type=image
      // Note: This is different from downloading bot-uploaded images
      const imageResponse = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`,
        {
          method: 'GET',  // Use GET, not POST
          headers: {
            'Authorization': `Bearer ${await getTenantAccessToken()}`,
          },
        }
      );

      if (imageResponse.ok) {
        const arrayBuffer = await imageResponse.arrayBuffer();
        imageBase64 = Buffer.from(arrayBuffer).toString('base64');
        logger.info(`[FeishuWS:${pid}] Image downloaded (${Math.round(imageBase64.length / 1024)}KB)`);
      } else {
        const errorText = await imageResponse.text();
        logger.error(`[FeishuWS:${pid}] Failed to download image: ${imageResponse.status} - ${errorText}`);
      }
    }
  } catch (error) {
    logger.error(`[FeishuWS:${pid}] Error processing image:`, error);
  }

  return imageBase64;
}

/**
 * Build multimodal message content from image and text.
 * Returns either a plain string or a multimodal content array.
 */
export function buildMultimodalContent(
  imageBase64: string | null,
  messageText: string,
  pid: number,
): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  if (imageBase64) {
    // Image message - build multimodal content
    const dataUrl = `data:image/jpeg;base64,${imageBase64}`;
    const textPrompt = (messageText && !messageText.includes('{') && messageText.trim().length > 0)
      ? messageText
      : '请识别并分析这张图片';

    const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: textPrompt }
    ];
    logger.debug(`[FeishuWS:${pid}] Built multimodal message with image (${Math.round(imageBase64.length / 1024)}KB) and text: "${textPrompt.substring(0, 50)}..."`);
    return content;
  } else {
    // Text-only message
    return messageText;
  }
}
