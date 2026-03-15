# 🔧 Feishu CLI 配置指南

## 问题描述

错误信息：
```
Feishu CLI runner not initialized. Make sure CLI is configured in beeclaw.json.
```

## 原因

Feishu CLI runner 需要 App ID 和 App Secret 才能初始化。这些凭证可以从以下来源获取（按优先级）：

1. `beeclaw.json` 配置文件
2. 环境变量

## 解决方案

### 方案 1：使用环境变量（推荐）

设置以下环境变量：

```bash
# 方式 1：使用 LARK_* 环境变量（优先级更高）
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="xxxxxxxxxxxxxxxx"

# 方式 2：使用 FEISHU_* 环境变量
export FEISHU_APP_ID="cli_xxxxxxxxxxxx"
export FEISHU_APP_SECRET="xxxxxxxxxxxxxxxx"
```

**优点**：
- ✅ 安全（不提交到代码仓库）
- ✅ 简单（无需修改配置文件）
- ✅ 适合生产环境

### 方案 2：修改 beeclaw.json

在 `beeclaw.json` 中添加 `appId` 和 `appSecret`：

```json
{
  "feishu": {
    "enabled": true,
    "appId": "cli_xxxxxxxxxxxx",
    "appSecret": "xxxxxxxxxxxxxxxx",
    "logLevel": "error",
    "useCardV2": true,
    "cliPath": "feishu",
    "cliTimeout": 30000,
    "cliRetries": 2
  }
}
```

**注意**：
- ⚠️ 不要将包含真实凭证的 `beeclaw.json` 提交到代码仓库
- ✅ 可以使用环境变量插值：`"appId": "${LARK_BEECLAW_APPID}"`

### 方案 3：混合方式（最佳实践）

在 `beeclaw.json` 中引用环境变量：

```json
{
  "feishu": {
    "enabled": true,
    "appId": "${LARK_BEECLAW_APPID}",
    "appSecret": "${LARK_BEECLAW_AS}",
    "logLevel": "error",
    "useCardV2": true,
    "cliPath": "feishu",
    "cliTimeout": 30000,
    "cliRetries": 2
  }
}
```

然后在 `.env` 文件或环境中设置：
```bash
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="xxxxxxxxxxxxxxxx"
```

## 完整配置示例

### 最小配置

```json
{
  "feishu": {
    "enabled": true
  }
}
```

配合环境变量：
```bash
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="xxxxxxxxxxxxxxxx"
```

### 完整配置

```json
{
  "feishu": {
    "enabled": true,
    "appId": "${LARK_BEECLAW_APPID}",
    "appSecret": "${LARK_BEECLAW_AS}",

    // CLI 配置
    "cliPath": "/usr/local/bin/feishu",  // feishu-cli 二进制路径
    "cliTimeout": 30000,                  // CLI 命令超时（毫秒）
    "cliRetries": 2,                      // 失败重试次数

    // 其他配置
    "logLevel": "error",
    "useCardV2": true
  }
}
```

## 配置字段说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | false | 是否启用 Feishu 集成 |
| `appId` | string | - | 飞书应用 ID（App ID） |
| `appSecret` | string | - | 飞书应用密钥（App Secret） |
| `cliPath` | string | "feishu" | feishu-cli 二进制路径 |
| `cliTimeout` | number | 30000 | CLI 命令超时（毫秒） |
| `cliRetries` | number | 2 | 失败重试次数 |
| `logLevel` | string | "error" | 日志级别 |
| `useCardV2` | boolean | false | 是否使用 Card 2.0 |

## 验证配置

### 1. 检查启动日志

正确配置后，启动时应该看到：

```
   📨 Feishu channel registered
   🔧 Feishu CLI runner initialized
```

如果配置缺失，会看到：

```
   📨 Feishu channel registered
   ⚠️  Feishu CLI runner not initialized (missing appId/appSecret)
      Set LARK_BEECLAW_APPID and LARK_BEECLAW_AS environment variables
      Or add appId and appSecret to beeclaw.json feishu config
```

### 2. 测试工具调用

尝试调用一个 Feishu 工具：

```bash
# 在 CLI 模式下
你: 列出我的飞书日历

# 预期结果
助手: [调用 feishu_calendar_list 工具]
```

如果配置正确，工具会成功执行。如果配置错误，会返回：

```
{
  "success": false,
  "error": "Feishu CLI runner not initialized. Make sure CLI is configured in beeclaw.json."
}
```

## 获取飞书应用凭证

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 创建企业自建应用
3. 获取 **App ID** 和 **App Secret**

### 2. 配置权限

根据需要配置应用权限：

**基础权限**：
- `contact:user.base:readonly` - 获取用户基本信息

**日历权限**：
- `calendar:calendar:readonly` - 读取日历
- `calendar:calendar` - 管理日历

**云文档权限**：
- `drive:drive:readonly` - 读取云空间
- `drive:drive` - 管理云空间
- `docs:doc:readonly` - 读取文档
- `docs:doc` - 编辑文档
- `wiki:wiki:readonly` - 读取知识库
- `wiki:wiki` - 管理知识库

### 3. 发布应用

1. 配置权限后，提交应用审核
2. 审核通过后，发布到企业
3. 企业内用户可用该应用

## 安装 feishu-cli

### macOS/Linux

```bash
# 使用安装脚本
curl -fsSL https://raw.githubusercontent.com/riba2534/feishu-cli/main/install.sh | bash

# 或使用 Homebrew
brew install riba2534/tap/feishu-cli
```

### 验证安装

```bash
feishu version
```

### 配置 feishu-cli

feishu-cli 会自动从环境变量读取凭证：

```bash
export FEISHU_APP_ID="cli_xxxxxxxxxxxx"
export FEISHU_APP_SECRET="xxxxxxxxxxxxxxxx"

# 测试连接
feishu auth test
```

## 故障排查

### 问题 1：CLI runner 未初始化

**症状**：
```
⚠️  Feishu CLI runner not initialized (missing appId/appSecret)
```

**解决**：
1. 检查环境变量是否设置
2. 检查 beeclaw.json 是否包含 appId 和 appSecret
3. 重启应用

### 问题 2：feishu-cli 命令找不到

**症状**：
```
CLI_BINARY_NOT_FOUND
```

**解决**：
1. 确认 feishu-cli 已安装：`which feishu`
2. 在 beeclaw.json 中指定完整路径：`"cliPath": "/usr/local/bin/feishu"`

### 问题 3：权限不足

**症状**：
```
CLI_PERMISSION_DENIED
```

**解决**：
1. 检查飞书应用是否配置了所需权限
2. 检查应用是否已发布
3. 检查用户是否授权

### 问题 4：超时

**症状**：
```
CLI_PROCESS_TIMEOUT
```

**解决**：
1. 增加 `cliTimeout` 值（默认 30000ms）
2. 检查网络连接
3. 检查 feishu-cli 版本

## 生产环境建议

### 使用环境变量

```bash
# .env 文件（不提交到 Git）
LARK_BEECLAW_APPID=cli_xxxxxxxxxxxx
LARK_BEECLAW_AS=xxxxxxxxxxxxxxxx
```

```json
// beeclaw.json（提交到 Git）
{
  "feishu": {
    "enabled": true,
    "appId": "${LARK_BEECLAW_APPID}",
    "appSecret": "${LARK_BEECLAW_AS}",
    "cliPath": "feishu",
    "cliTimeout": 60000,
    "cliRetries": 3,
    "logLevel": "error"
  }
}
```

### PM2 配置

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'beeclaw',
    script: 'bun',
    args: 'run bot',
    env: {
      LARK_BEECLAW_APPID: 'cli_xxxxxxxxxxxx',
      LARK_BEECLAW_AS: 'xxxxxxxxxxxxxxxx',
    },
    env_production: {
      LARK_BEECLAW_APPID: process.env.LARK_BEECLAW_APPID,
      LARK_BEECLAW_AS: process.env.LARK_BEECLAW_AS,
    }
  }]
};
```

### Docker 配置

```yaml
# docker-compose.yml
services:
  beeclaw:
    image: beeclaw:latest
    environment:
      - LARK_BEECLAW_APPID=${LARK_BEECLAW_APPID}
      - LARK_BEECLAW_AS=${LARK_BEECLAW_AS}
```

## 相关文档

- [Feishu SDK 迁移完成报告](./FINAL_FIX_COMPLETE.md)
- [飞书开放平台文档](https://open.feishu.cn/document/)
- [feishu-cli GitHub](https://github.com/riba2534/feishu-cli)

---

**最后更新**: 2026-03-16
**维护者**: Beeclaw Team
