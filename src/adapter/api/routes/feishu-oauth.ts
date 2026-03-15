/**
 * Feishu OAuth Callback Handler
 *
 * 处理飞书 OAuth 2.0 授权回调
 */

import { Hono } from 'hono';
import { getFeishuWSClient } from '../../adapter/feishu';
import {
  exchangeCodeForToken,
  verifyAuthState,
  saveUserToken,
  getUserInfo,
} from '../../adapter/feishu/oauth';
import { getLogger } from '../../infra/observability/logger';

const logger = getLogger('api:feishu:oauth');
const app = new Hono();

/**
 * OAuth 回调端点
 *
 * GET /api/feishu/oauth/callback?code=xxx&state=xxx
 */
app.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const errorDescription = c.req.query('error_description');

  logger.info('📱 OAuth callback received', { code: !!code, state, error });

  // 1. 处理错误
  if (error) {
    logger.error(`OAuth error: ${error} - ${errorDescription}`);
    return c.html(`
      <html>
        <head><title>授权失败</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>❌ 授权失败</h1>
          <p>错误: ${error}</p>
          <p>详情: ${errorDescription}</p>
          <p><a href="javascript:window.close()">关闭窗口</a></p>
        </body>
      </html>
    `, 400);
  }

  // 2. 验证参数
  if (!code || !state) {
    return c.html(`
      <html>
        <head><title>参数错误</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>❌ 参数错误</h1>
          <p>缺少 code 或 state 参数</p>
          <p><a href="javascript:window.close()">关闭窗口</a></p>
        </body>
      </html>
    `, 400);
  }

  // 3. 验证 state
  const authState = verifyAuthState(state);
  if (!authState) {
    return c.html(`
      <html>
        <head><title>授权已过期</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>❌ 授权已过期</h1>
          <p>请重新发起授权请求</p>
          <p><a href="javascript:window.close()">关闭窗口</a></p>
        </body>
      </html>
    `, 400);
  }

  // 4. 创建临时 SDK 客户端（工具使用 CLI runner）
  const { default: Lark } = await import('@larksuiteoapi/node-sdk');
  const appConfig = loadConfig();
  const client = new Lark.Client({
    appId: appConfig.feishu.appId!,
    appSecret: appConfig.feishu.appSecret!,
  });

  try {
    // 5. 用 code 换取 access_token
    logger.info(`Exchanging code for token, openId: ${authState.openId}`);
    const token = await exchangeCodeForToken(client, code);

    // 6. 获取用户信息
    const userInfo = await getUserInfo(client, token.accessToken);
    logger.info(`✅ Got user info: ${userInfo.name} (${userInfo.openId})`);

    // 7. 存储 token
    await saveUserToken(authState.openId, token);

    // 8. 发送成功消息给用户
    if (authState.chatId) {
      await client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: authState.chatId,
          msg_type: 'text',
          content: JSON.stringify({
            text: `✅ 授权成功！\n\n` +
                  `用户: ${userInfo.name}\n` +
                  `权限: ${token.scope}\n\n` +
                  `现在可以访问你的日历、云盘和知识库了！`,
          }),
        },
      });
    }

    // 9. 返回成功页面
    return c.html(`
      <html>
        <head>
          <title>授权成功</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              padding: 40px;
              text-align: center;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              min-height: 100vh;
              margin: 0;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              color: #333;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              max-width: 400px;
            }
            .icon { font-size: 64px; margin-bottom: 20px; }
            h1 { margin: 0 0 10px; color: #333; }
            p { color: #666; margin: 10px 0; }
            .user-info {
              background: #f5f5f5;
              padding: 15px;
              border-radius: 8px;
              margin: 20px 0;
              text-align: left;
            }
            .user-info p { margin: 5px 0; }
            .close-btn {
              background: #667eea;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 16px;
              margin-top: 20px;
            }
            .close-btn:hover { background: #5568d3; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">✅</div>
            <h1>授权成功</h1>
            <p>你已成功授权 Beeclaw 访问你的资源</p>

            <div class="user-info">
              <p><strong>👤 用户:</strong> ${userInfo.name}</p>
              <p><strong>📧 邮箱:</strong> ${userInfo.email || '未设置'}</p>
              <p><strong>📱 手机:</strong> ${userInfo.mobile || '未设置'}</p>
              <p><strong>🔑 权限:</strong> ${token.scope.split(' ').join(', ')}</p>
            </div>

            <p>现在你可以在飞书中使用以下功能:</p>
            <ul style="text-align: left; color: #666;">
              <li>📅 访问你的个人日历</li>
              <li>📁 管理你的云盘文件</li>
              <li>📚 浏览你的知识库</li>
            </ul>

            <button class="close-btn" onclick="window.close()">关闭窗口</button>

            <script>
              // 3 秒后自动关闭
              setTimeout(() => window.close(), 3000);
            </script>
          </div>
        </body>
      </html>
    `);

  } catch (error: any) {
    logger.error('OAuth callback failed:', error);

    return c.html(`
      <html>
        <head><title>授权失败</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>❌ 授权失败</h1>
          <p>错误: ${error.message}</p>
          <p><a href="javascript:window.close()">关闭窗口</a></p>
        </body>
      </html>
    `, 500);
  }
});

/**
 * 检查授权状态
 *
 * GET /api/feishu/oauth/status?openId=xxx
 */
app.get('/status', async (c) => {
  const openId = c.req.query('openId');

  if (!openId) {
    return c.json({ error: 'Missing openId' }, 400);
  }

  // Create temporary SDK client for OAuth operations
  const { default: Lark } = await import('@larksuiteoapi/node-sdk');
  const appConfig = loadConfig();
  const client = new Lark.Client({
    appId: appConfig.feishu.appId!,
    appSecret: appConfig.feishu.appSecret!,
  });

  const { getUserToken } = await import('../../adapter/feishu/oauth');
  const token = await getUserToken(client, openId);

  return c.json({
    authorized: token !== null,
    expiresAt: token?.expiresAt,
    scope: token?.scope,
  });
});

/**
 * 生成授权链接
 *
 * POST /api/feishu/oauth/authorize
 * Body: { openId: string, chatId?: string }
 */
app.post('/authorize', async (c) => {
  const body = await c.req.json();
  const { openId, chatId } = body;

  if (!openId) {
    return c.json({ error: 'Missing openId' }, 400);
  }

  const { generateAuthUrl } = await import('../../adapter/feishu/oauth');
  const { loadConfig } = await import('../../infra/config');

  const config = loadConfig();

  const authUrl = generateAuthUrl(
    {
      appId: config.feishu.appId!,
      appSecret: config.feishu.appSecret!,
      redirectUri: config.feishu.oauthRedirectUri || `${config.server.host}:${config.server.port}/api/feishu/oauth/callback`,
      scopes: [
        'contact:user.base:readonly',
        'calendar:calendar:readonly',
        'calendar:calendar',
        'drive:drive:readonly',
        'drive:drive',
        'wiki:wiki:readonly',
        'wiki:wiki',
      ],
    },
    {
      userId: openId,
      openId,
      chatId,
    }
  );

  return c.json({
    authUrl,
    message: 'Please visit the URL to authorize',
  });
});

export default app;
