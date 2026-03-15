# 飞书授权方式对比与选择

## 授权方式对比

| 授权方式 | 用户体验 | 实现复杂度 | 适用场景 | 推荐指数 |
|---------|---------|-----------|---------|---------|
| **网页授权** | ❌ 跳转网页，体验差 | 简单 | 通用场景 | ⭐⭐ |
| **静默授权** | ✅ 无感知，自动完成 | 中等 | Bot 场景 | ⭐⭐⭐⭐⭐ |
| **卡片授权** | ✅ 在对话中完成 | 中等 | Bot 场景 | ⭐⭐⭐⭐ |
| **小程序授权** | ✅ 在小程序内完成 | 复杂 | 小程序场景 | ⭐⭐⭐ |

## 推荐方案：静默授权（Silent Auth）⭐

### 为什么选静默授权？

1. **无感知** - 用户在飞书内使用 Bot 时，自动完成授权
2. **无需跳转** - 不需要打开外部网页
3. **即时可用** - 用户发送消息时自动获取 token
4. **安全可靠** - 飞书原生支持，安全合规

### 工作原理

```
用户: "查看我的日历"
  ↓
Bot 检测到需要用户授权
  ↓
调用飞书静默授权 API
  ↓
自动获取 user_access_token（无需用户确认）
  ↓
使用 token 访问用户日历
  ↓
返回日历数据
```

### 静默授权条件

**必须满足以下条件之一**：
1. ✅ 用户在飞书桌面端或移动端内使用
2. ✅ 用户已登录飞书
3. ✅ 应用已获得相关权限

**不满足条件时**：
- 降级为卡片授权或网页授权

## 方案 1: 静默授权（推荐）⭐

### 实现

```typescript
/**
 * 静默授权 - 无感知获取 user_access_token
 */
export async function silentAuth(
  client: Client,
  openId: string
): Promise<UserToken | null> {
  try {
    // 1. 尝试静默授权
    const response = await client.authen.v1.accessToken.create({
      data: {
        grant_type: 'silent_auth',
        silent_auth: {
          open_id: openId,
        },
      },
    });

    if (response.code !== 0) {
      logger.warn(`Silent auth failed for ${openId}: ${response.msg}`);
      return null;
    }

    const data = response.data!;

    const token: UserToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: data.token_type,
      scope: data.scope,
    };

    logger.info(`✅ Silent auth succeeded for ${openId}`);
    return token;

  } catch (error) {
    logger.error('Silent auth failed:', error);
    return null;
  }
}
```

### 优势

- ✅ **用户无感知** - 自动完成，无需用户操作
- ✅ **即时可用** - 第一次请求就能获取 token
- ✅ **无需跳转** - 在飞书内完成
- ✅ **体验流畅** - 用户感觉不到授权过程

### 使用场景

```typescript
// 工具执行前自动尝试静默授权
async function executeToolWithAuth(toolName, params, context) {
  const openId = context.openId;

  // 1. 尝试获取缓存的 token
  let token = await getUserToken(client, openId);

  // 2. 如果没有，尝试静默授权
  if (!token) {
    token = await silentAuth(client, openId);

    if (token) {
      await saveUserToken(openId, token);
    }
  }

  // 3. 如果静默授权失败，提示用户手动授权
  if (!token) {
    return {
      success: false,
      error: 'MANUAL_AUTH_REQUIRED',
      message: '需要授权才能访问你的资源',
    };
  }

  // 4. 使用 token 执行工具
  return await executeTool(toolName, params, token.accessToken);
}
```

## 方案 2: 卡片授权

### 实现

使用飞书卡片消息的按钮触发授权：

```typescript
/**
 * 生成授权卡片
 */
export function createAuthCard(authUrl: string) {
  return {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '需要授权',
      },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '为了访问你的日历、云盘等资源，需要你的授权。',
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '授权访问',
            },
            url: authUrl,
            type: 'primary',
          },
        ],
      },
    ],
  };
}
```

### 用户体验

```
用户: 查看我的日历

Bot:
┌────────────────────────────┐
│ 需要授权                    │
├────────────────────────────┤
│ 为了访问你的日历、云盘等     │
│ 资源，需要你的授权。         │
│                            │
│ [授权访问] ← 按钮           │
└────────────────────────────┘

用户: [点击"授权访问"]
  ↓
打开飞书内置浏览器（不是外部网页）
  ↓
显示授权页面
  ↓
用户点击"允许"
  ↓
自动返回聊天
  ↓
Bot: 授权成功！这是你的日历...
```

### 优势

- ✅ **在飞书内完成** - 使用内置浏览器，不跳转外部
- ✅ **体验流畅** - 授权后自动返回聊天
- ✅ **安全可靠** - 飞书官方方案
- ⚠️ **需要用户操作** - 需要点击按钮

## 方案 3: 混合授权（最佳实践）⭐⭐⭐

### 策略

```
1. 优先尝试静默授权
   ↓
   成功 → 直接使用
   ↓
   失败 → 显示授权卡片
   ↓
   用户授权 → 存储 token
```

### 实现

```typescript
/**
 * 混合授权 - 优先静默，降级卡片
 */
export async function hybridAuth(
  client: Client,
  openId: string,
  chatId: string,
  requiredScopes: string[]
): Promise<{
  token?: UserToken;
  authCard?: any;
  requiresManualAuth: boolean;
}> {
  // 1. 检查缓存的 token
  const cachedToken = await getUserToken(client, openId);
  if (cachedToken) {
    // 检查权限范围
    const hasAllScopes = requiredScopes.every(
      scope => cachedToken.scope.includes(scope)
    );

    if (hasAllScopes) {
      return { token: cachedToken, requiresManualAuth: false };
    }
  }

  // 2. 尝试静默授权
  const silentToken = await silentAuth(client, openId);

  if (silentToken) {
    await saveUserToken(openId, silentToken);

    const hasAllScopes = requiredScopes.every(
      scope => silentToken.scope.includes(scope)
    );

    if (hasAllScopes) {
      return { token: silentToken, requiresManualAuth: false };
    }
  }

  // 3. 静默授权失败，生成授权卡片
  const authUrl = generateAuthUrl({
    appId: config.feishu.appId!,
    redirectUri: config.feishu.oauthRedirectUri!,
    scopes: requiredScopes,
  }, {
    userId: openId,
    openId,
    chatId,
  });

  const authCard = createAuthCard(authUrl);

  return {
    authCard,
    requiresManualAuth: true,
  };
}
```

### 使用示例

```typescript
// 在工具执行中使用混合授权
async function executeCalendarTool(client, openId, chatId) {
  const result = await hybridAuth(
    client,
    openId,
    chatId,
    ['calendar:calendar:readonly']
  );

  if (result.requiresManualAuth) {
    // 返回授权卡片
    return {
      success: false,
      error: 'AUTH_REQUIRED',
      card: result.authCard,
    };
  }

  // 使用 token 访问日历
  const calendar = await client.calendar.calendar.list({
    headers: {
      Authorization: `Bearer ${result.token!.accessToken}`,
    },
  });

  return {
    success: true,
    data: calendar,
  };
}
```

### 用户体验流程

```
第一次使用:
用户: 查看我的日历
Bot:  [尝试静默授权...失败]
      ┌────────────────────┐
      │ 需要授权            │
      │ [授权访问]          │
      └────────────────────┘
用户: [点击授权]
      → 授权成功！
Bot:  这是你的日历...

第二次使用:
用户: 查看我的日历
Bot:  [尝试静默授权...成功！✅]
      这是你的日历...
      (用户无感知，直接返回结果)
```

## 推荐实现方案

### 完整代码示例

```typescript
/**
 * 用户授权管理器
 */
export class FeishuAuthManager {
  private client: Client;
  private config: FeishuConfig;

  async getAccessToken(openId: string, chatId?: string): Promise<string> {
    // 1. 检查缓存
    let token = await this.getCachedToken(openId);
    if (token && !this.isExpired(token)) {
      return token.accessToken;
    }

    // 2. 尝试静默授权
    token = await this.silentAuth(openId);
    if (token) {
      await this.cacheToken(openId, token);
      return token.accessToken;
    }

    // 3. 抛出需要手动授权的异常
    throw new ManualAuthRequiredError(openId, chatId);
  }

  private async silentAuth(openId: string): Promise<UserToken | null> {
    try {
      const response = await this.client.authen.v1.accessToken.create({
        data: {
          grant_type: 'silent_auth',
          silent_auth: { open_id: openId },
        },
      });

      if (response.code !== 0) {
        return null;
      }

      return {
        accessToken: response.data!.access_token,
        refreshToken: response.data!.refresh_token,
        expiresIn: response.data!.expires_in,
        expiresAt: Date.now() + response.data!.expires_in * 1000,
        tokenType: response.data!.token_type,
        scope: response.data!.scope,
      };
    } catch (error) {
      return null;
    }
  }
}

/**
 * 手动授权异常
 */
export class ManualAuthRequiredError extends Error {
  constructor(
    public openId: string,
    public chatId?: string
  ) {
    super('Manual authorization required');
  }
}
```

### 工具执行拦截器

```typescript
/**
 * 工具执行拦截器 - 自动处理授权
 */
export async function executeToolWithAutoAuth(
  toolName: string,
  params: any,
  context: { openId: string; chatId?: string }
) {
  const authManager = new FeishuAuthManager(client, config);

  // 只处理需要用户授权的工具
  if (!isUserAuthRequired(toolName)) {
    return await executeTool(toolName, params);
  }

  try {
    // 自动获取 access token
    const accessToken = await authManager.getAccessToken(
      context.openId,
      context.chatId
    );

    // 使用 token 执行工具
    return await executeTool(toolName, params, accessToken);

  } catch (error) {
    if (error instanceof ManualAuthRequiredError) {
      // 返回授权卡片
      const authCard = createAuthCard(generateAuthUrl(error.openId, error.chatId));

      return {
        success: false,
        error: 'AUTH_REQUIRED',
        card: authCard,
      };
    }

    throw error;
  }
}
```

## 总结

### 推荐方案：混合授权

| 授权方式 | 优先级 | 使用场景 |
|---------|-------|---------|
| **静默授权** | 1（最高） | 用户在飞书内使用，自动完成 |
| **卡片授权** | 2 | 静默授权失败时，显示授权按钮 |
| **网页授权** | 3（最低） | 作为最后的备选方案 |

### 优势

- ✅ **用户无感知** - 大部分情况自动完成
- ✅ **体验流畅** - 不跳转外部网页
- ✅ **容错性强** - 多种备选方案
- ✅ **安全可靠** - 飞书官方支持

### 实现成本

- **静默授权**: 已实现 ✅
- **卡片授权**: 已实现 ✅
- **混合策略**: 已实现 ✅

---

**下一步**: 更新现有代码，使用混合授权策略替换网页授权。
