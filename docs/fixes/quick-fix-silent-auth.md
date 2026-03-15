# 飞书日历授权问题快速修复

## 🚨 问题原因

错误日志显示：
```
❌ Silent auth failed: invalid request, grant_type should be authorization_code or refresh_token (code: 20001)
```

**根本原因**: `silent-auth.ts` 中使用了不存在的 `grant_type: 'silent_auth'`

## ✅ 已修复

修改了 `src/adapter/feishu/silent-auth.ts`:

**修复前** (错误):
```typescript
const response = await client.authen.v1.accessToken.create({
  data: {
    grant_type: 'silent_auth',  // ❌ 飞书不支持这个
    silent_auth: { open_id: openId },
  },
});
```

**修复后** (正确):
```typescript
// 1. 检查缓存的 access_token
const cachedToken = cache.get(`feishu:user:token:${openId}`);
if (cachedToken && !expired) {
  return { success: true, token: cachedToken };
}

// 2. 尝试使用 refresh_token 刷新
const cachedRefreshToken = cache.get(`feishu:user:refresh:${openId}`);
if (cachedRefreshToken) {
  const response = await client.authen.v1.accessToken.create({
    data: {
      grant_type: 'refresh_token',  // ✅ 正确
      refresh_token: cachedRefreshToken,
    },
  });
  // 刷新成功 → 返回新 token
}

// 3. 都失败 → 需要用户授权
return { success: false, error: '需要用户授权' };
```

## 📋 现在的流程

用户首次使用日历：
```
1. 检查缓存的 access_token → 没有
2. 检查 refresh_token → 没有
3. 返回 requiresAuth: true
4. Agent 发送授权卡片
5. 用户点击授权
6. OAuth 回调保存 token 和 refresh_token
7. 后续使用 refresh_token 自动刷新
```

后续使用：
```
1. 检查缓存的 access_token → 有但快过期
2. 使用 refresh_token 刷新 → 成功
3. 返回新 token → 无需用户操作
```

## 🧪 测试步骤

1. Bot 已重启，现在在飞书中测试：
```
用户: "帮我创建明天的会议"
```

2. 预期结果：
- ✅ 收到授权卡片
- ✅ 点击授权后可以正常创建日程

## 📝 注意事项

- 首次使用需要点击授权（这是正常的）
- 后续使用会自动刷新 token（无感知）
- 如果 refresh_token 也过期了，会再次弹出授权卡片

## 🔍 相关文件

- `src/adapter/feishu/silent-auth.ts` - 修复了 grant_type
- `src/infra/cache/index.ts` - 新增缓存模块
- `docs/fixes/feishu-calendar-auth-fix.md` - 完整修复说明
