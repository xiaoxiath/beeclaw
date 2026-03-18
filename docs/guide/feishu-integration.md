# 飞书集成

> Beeclaw 的飞书 Bot 集成指南

## 概述

Beeclaw 支持作为飞书机器人运行，提供对话、工具调用、卡片消息等功能。

## 快速开始

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 获取 `App ID` 和 `App Secret`

### 2. 配置环境变量

```bash
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="your-app-secret"
```

### 3. 配置 beeclaw.json

```json
{
  "feishu": {
    "enabled": true,
    "appId": "${LARK_BEECLAW_APPID}",
    "appSecret": "${LARK_BEECLAW_AS}",
    "useCardV2": true
  }
}
```

### 4. 启动 Bot

```bash
bun run bot
```

## 权限配置

在飞书开放平台配置以下权限：

### 必需权限
- `im:message` - 获取与发送消息
- `im:message:send_as_bot` - 以应用身份发消息

### 可选权限
- `drive:drive:readonly` - 读取云文档
- `contact:user.base:readonly` - 读取用户基本信息
- `calendar:calendar:readonly` - 读取日历

## Card V2 支持

Beeclaw 支持 Feishu Card Schema 2.0，提供更丰富的消息体验：

- **流式更新**: 实时显示 AI 思考过程
- **可折叠面板**: 工具调用结果折叠显示
- **富文本渲染**: 支持 Markdown、代码高亮

### 启用 Card V2

```json
{
  "feishu": {
    "useCardV2": true
  }
}
```

## 部署到生产

使用 PM2 部署：

```bash
bun run pm2:start
bun run pm2:logs
```

## 故障排查

### 连接问题
- 检查 App ID 和 Secret 是否正确
- 确认 IP 白名单配置
- 查看日志: `logs/beeclaw.log`

### 权限错误
- 确认权限已申请并审核通过
- 使用权限检查脚本: `bun run check:permissions`

## 相关文档

- [部署指南](../operations/deployment.md)
- [故障排查](../troubleshooting/README.md)
