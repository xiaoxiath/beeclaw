import type { FeishuCLIRunner } from '../cli-runner';
/**
 * Test user info tool
 */

import { describe, it, expect } from 'bun:test';
import { executeUserInfoTool, userInfoToolDefinitions } from '../user-info';
import type { UserContext } from '../../../../domain/agent/types';

describe('User Info Tool', () => {
  it('should export tool definition', () => {
    expect(userInfoToolDefinitions.feishu_get_current_user).toBeDefined();
    expect(userInfoToolDefinitions.feishu_get_current_user.name).toBe('feishu_get_current_user');
    expect(userInfoToolDefinitions.feishu_get_current_user.description).toContain('open_id');
  });

  it('should get user info from context', async () => {
    const userContext: UserContext = {
      openId: 'ou_84aad35d084aa403a838cf73ee18467',
      userId: 'e33ggbyz',
      chatId: 'oc_5ce6d572455d361153b7xx51da133945',
      messageId: 'om_5ce6d572455d361153b7cb51da133945',
    };

    const result = await executeUserInfoTool(
      {} as any, // Mock client (not used)
      'feishu_get_current_user',
      {},
      userContext
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      openId: 'ou_84aad35d084aa403a838cf73ee18467',
      userId: 'e33ggbyz',
      chatId: 'oc_5ce6d572455d361153b7xx51da133945',
      messageId: 'om_5ce6d572455d361153b7cb51da133945',
    });
  });

  it('should handle missing context', async () => {
    const result = await executeUserInfoTool(
      {} as any,
      'feishu_get_current_user',
      {},
      undefined
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No user context available');
  });

  it('should return error for unknown tool', async () => {
    const result = await executeUserInfoTool(
      {} as any,
      'unknown_tool',
      {},
      { openId: 'test' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown user info tool');
  });
});
