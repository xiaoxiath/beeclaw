/**
 * Feishu Authentication Module
 *
 * Handles Feishu tenant access token acquisition and caching.
 * Provides authenticated access to Feishu Open APIs.
 */

// Cache tenant access token
let cachedTenantAccessToken: string | null = null;
let tokenExpireTime = 0;

/**
 * Get Feishu tenant access token with caching
 */
export async function getTenantAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedTenantAccessToken && Date.now() < tokenExpireTime) {
    return cachedTenantAccessToken;
  }

  const appId = process.env.LARK_BEECLAW_APPID;
  const appSecret = process.env.LARK_BEECLAW_AS;

  if (!appId || !appSecret) {
    throw new Error('Missing Feishu credentials');
  }

  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });

  const data = await response.json();

  if (data.code !== 0) {
    throw new Error(`Failed to get tenant access token: ${data.msg}`);
  }

  // Cache token (expire in 1 hour, but refresh 5 minutes before)
  cachedTenantAccessToken = data.tenant_access_token;
  tokenExpireTime = Date.now() + (data.expire - 300) * 1000;

  return data.tenant_access_token;
}
