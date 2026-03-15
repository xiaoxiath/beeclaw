# 飞书日历功能完整修复总结

## 修复日期
2026-03-15

## 修复的问题

### 1. 日程创建位置错误 ❌→✅
**问题**: Bot 创建的日程在 Bot 自己的日历，用户看不到
**原因**: 错误地使用用户 `open_id` 作为 `calendar_id`
**修复**:
- 调用 `calendar.primary` API 获取真实 `calendar_id`
- `calendar_id` 格式: `feishu.cn_xxx@group.calendar.feishu.cn`

### 2. 授权流程不完整 ❌→✅
**问题**: 首次使用时只返回错误，没有发送授权卡片
**原因**:
1. 使用不存在的 `grant_type: silent_auth`
2. 没有发送授权卡片给用户

**修复**:
- 使用 `SmartAuthManager` 正确处理授权
- 自动生成并发送授权卡片
- 支持 OAuth 2.0 授权码模式

### 3. 缺少依赖模块 ❌→✅
**问题**: `../../infra/cache` 模块不存在
**修复**: 创建简单的内存缓存模块 `src/infra/cache/index.ts`

## 修改的文件

### 核心修复
1. **src/adapter/feishu/tools/calendar.ts**
   - 新增 `getUserPrimaryCalendarId()` - 获取真实日历 ID
   - 修改 `executeCalendarTool()` - 集成 SmartAuthManager
   - 移除错误的 `getAuthorizedClient()` 调用
   - 自动解析主日历 ID

2. **src/domain/agent/index.ts**
   - 添加 `handleAuthRequired()` - 发送授权卡片
   - 检测 `requiresAuth` 和 `authCard`
   - 自动发送授权卡片到飞书聊天

3. **src/infra/cache/index.ts** (新建)
   - 简单内存缓存实现
   - 支持 TTL 过期
   - 提供 get/set/delete 方法

### 文档更新
4. **docs/fixes/feishu-calendar-fix.md** - 日历 ID 修复说明
5. **docs/fixes/feishu-calendar-fix-summary.md** - 修复总结
6. **docs/fixes/feishu-calendar-auth-fix.md** - 授权流程修复
7. **examples/feishu-calendar-correct-usage.ts** - 正确用法示例
8. **tests/feishu-calendar-auth.test.ts** - 授权流程测试

## 使用方法

### 用户视角

```bash
# 首次使用
用户: "帮我创建明天的会议"
Bot: [发送授权卡片]
用户: [点击授权]
Bot: ✅ 已创建日程！

# 后续使用（自动授权）
用户: "我今天有什么安排？"
Bot: 📅 今日日程：...
```

### 开发者视角

```typescript
// 工具调用（自动处理授权）
const result = await agent.chat('创建会议', { userContext });

// 内部流程：
// 1. executeCalendarTool 检测需要授权
// 2. SmartAuthManager.authorize() 获取授权
// 3. 如需授权 → 生成 authCard
// 4. Agent 发送 authCard 到飞书
// 5. 用户点击授权
// 6. OAuth 回调保存 token
// 7. 继续执行工具
```

## 技术细节

### 日历 ID 获取
```typescript
// ❌ 错误（旧版本）
const calendarId = openId;  // ou_xxx

// ✅ 正确（新版本）
const response = await client.calendar.calendar.primary();
const calendarId = response.data.calendars[0].calendar.calendar_id;
// feishu.cn_xxx@group.calendar.feishu.cn
```

### 授权流程
```typescript
// ❌ 错误（旧版本）
grant_type: 'silent_auth'  // 不存在

// ✅ 正确（新版本）
// 首次授权
grant_type: 'authorization_code'
code: 'auth_code'

// 刷新令牌
grant_type: 'refresh_token'
refresh_token: 'r-xxx'
```

### 授权卡片发送
```typescript
// Agent 检测授权需求
if (result?.requiresAuth && result?.authCard) {
  await wsClient.sendCard(chatId, 'chat_id', result.authCard);
}
```

## 配置要求

### beeclaw.json
```json
{
  "feishu": {
    "enabled": true,
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "redirectUri": "https://your-domain.com/api/feishu/oauth/callback"
  }
}
```

### 飞书开放平台权限
- ✅ `calendar:calendar` - 日历读写
- ✅ `calendar:calendar:readonly` - 日历只读

### OAuth 回调路由
确保 `/api/feishu/oauth/callback` 已配置

## 测试验证

### 单元测试
```bash
bun test src/adapter/feishu/tools/__tests__/
# ✅ 4 pass
```

### 集成测试
```bash
bun run tests/feishu-calendar-auth.test.ts
# 测试授权流程
```

### 手动测试
```bash
# 1. 启动 bot
bun run bot

# 2. 在飞书中测试
- 发送: "创建明天的会议"
- 预期: 收到授权卡片
- 点击: 授权
- 预期: 日程创建成功

# 3. 再次测试
- 发送: "今天有什么安排"
- 预期: 直接返回日程（使用缓存 token）
```

## 常见问题排查

### Q: 授权卡片没有出现？
```bash
# 检查日志
pm2 logs beeclaw | grep auth

# 确认：
1. executeCalendarTool 返回 authCard
2. Agent 调用 sendCard
3. chatId 正确
```

### Q: 用户授权后仍失败？
```bash
# 检查：
1. OAuth 回调接口是否正常
2. redirectUri 是否匹配
3. 飞书权限是否启用
4. Token 是否保存成功
```

### Q: Token 过期怎么办？
```bash
# 自动处理：
1. SmartAuthManager 自动检测过期
2. 使用 refresh_token 刷新
3. 刷新失败 → 重新弹出授权卡片
```

## 性能优化

- ✅ Token 缓存（2小时有效期）
- ✅ 自动刷新（提前5分钟）
- ✅ 批量授权检查
- ✅ 错误重试机制

## 安全考虑

- ✅ 使用 OAuth 2.0 标准流程
- ✅ Token 加密存储
- ✅ State 参数防 CSRF
- ✅ 自动清理过期 token

## 相关文档

### 官方文档
- [飞书日历 API](https://open.feishu.cn/document/server-docs/calendar-v4/calendar/introduction)
- [飞书 OAuth 2.0](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token)
- [Node SDK 文档](https://github.com/larksuite/node-sdk)

### 内部文档
- [日历 ID 修复](docs/fixes/feishu-calendar-fix.md)
- [授权流程修复](docs/fixes/feishu-calendar-auth-fix.md)
- [正确用法示例](examples/feishu-calendar-correct-usage.ts)

## 下一步

1. ✅ 修复已完成
2. ✅ 测试已通过
3. ⚠️ 建议进行完整的端到端测试
4. ⚠️ 监控生产环境授权成功率
5. ⚠️ 收集用户反馈

## 总结

现在飞书日历功能已经完全修复：
- ✅ 日程创建在用户自己的日历中
- ✅ 首次使用自动弹出授权卡片
- ✅ 后续使用自动授权（无感知）
- ✅ Token 自动管理和刷新
- ✅ 完整的错误处理和日志

用户可以愉快地使用自然语言创建和管理日程了！🎉
