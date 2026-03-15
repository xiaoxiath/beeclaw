# ✅ Feishu CLI 配置完成

## 当前状态

**状态**: ✅ 已配置并正常运行

```
   📨 Feishu channel registered
   🔧 Feishu CLI runner initialized
```

## 配置来源

凭证来自 `.env` 文件：

```bash
LARK_BEECLAW_APPID=cli_***
LARK_BEECLAW_AS=***
```

## 配置优先级

应用按以下优先级查找凭证：

1. **环境变量**（最高优先级）
   - `LARK_BEECLAW_APPID` + `LARK_BEECLAW_AS`
   - `FEISHU_APP_ID` + `FEISHU_APP_SECRET`

2. **beeclaw.json 配置文件**
   - `feishu.appId` + `feishu.appSecret`
   - 支持环境变量插值：`"${LARK_BEECLAW_APPID}"`

## 可选 CLI 配置

在 `beeclaw.json` 中可以自定义 CLI 行为：

```json
{
  "feishu": {
    "enabled": true,
    "cliPath": "feishu",        // feishu-cli 二进制路径
    "cliTimeout": 30000,         // 超时时间（毫秒）
    "cliRetries": 2,             // 重试次数
    "logLevel": "error",
    "useCardV2": true
  }
}
```

## 验证工具

测试 Feishu 工具是否正常工作：

```
你: 列出我的飞书日历
你: 列出云空间文件
你: 搜索知识库
```

## 相关文档

- [完整配置指南](./FEISHU_CLI_CONFIG.md)
- [迁移完成报告](./FINAL_FIX_COMPLETE.md)

---

**配置时间**: 2026-03-16
**状态**: ✅ 正常运行
