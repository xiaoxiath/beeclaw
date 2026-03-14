# 飞书 Bot 部署全流程

> 45分钟完成飞书机器人部署

## 场景

你需要在飞书群聊中部署 Beeclaw Bot，让团队成员能：
1. 通过 @Bot 提问
2. 接收流式消息（Card V2）
3. 获取主动推送的通知

## 目标

- ✅ 创建飞书应用
- ✅ 配置 WebSocket 连接
- ✅ 部署 Bot 服务
- ✅ 测试消息收发

## 前置条件

- [ ] 已完成 [快速开始](../../getting-started.md)
- [ ] 飞书管理员权限
- [ ] 服务器或本地运行环境

---

## 步骤

### 步骤 1：创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 点击"创建企业自建应用"
3. 填写应用信息：
   - 应用名称: Beeclaw Bot
   - 应用描述: AI 智能助手
   - 应用图标: [上传图标]

### 步骤 2：配置权限

在"权限管理"中添加：

| 权限 | 说明 |
|------|------|
| `im:message` | 获取与发送消息 |
| `im:message:send_as_bot` | 以应用身份发消息 |
| `im:chat` | 获取群组信息 |

### 步骤 3：获取凭证

在"凭证与基础信息"中获取：
```
App ID: cli_xxxxxxxxxxxx
App Secret: xxxxxxxxxxxxxxxx
```

### 步骤 4：配置环境变量

```bash
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="your-app-secret"
```

### 步骤 5：启动 Bot

```bash
bun run bot
```

**预期输出**:
```
✓ 飞书 Bot 启动成功
✓ WebSocket 连接已建立
✓ 监听事件: im.message.receive_v1
```

### 步骤 6：测试 Bot

在飞书群聊中：
```
@Beeclaw Bot 你好
```

**预期**: Bot 回复流式消息卡片

---

## Card V2 流式消息

Beeclaw 支持 Card V2 格式，提供更好的消息体验：

**特性**:
- ✅ 实时进度反馈
- ✅ 可折叠工具面板
- ✅ 富 Markdown 渲染
- ✅ 流式更新（500ms 防抖）

**配置**:
```json
{
  "feishu": {
    "useCardV2": true
  }
}
```

---

## PM2 生产部署

```bash
# 启动
bun run pm2:start

# 查看日志
bun run pm2:logs

# 重启
bun run pm2:restart
```

---

## 验证

- [ ] Bot 在飞书中可见
- [ ] @Bot 能收到回复
- [ ] 流式消息正常显示
- [ ] 主动通知能推送

---

**预计完成时间**: 45分钟
**难度**: ⭐⭐
**标签**: 飞书集成、Bot 部署、Card V2
