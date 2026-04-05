# 部署指南

> Beeclaw 生产环境部署

## 快速开始

### 使用 PM2 部署

```bash
# 安装 PM2
bun install -g pm2

# 启动服务（开发模式，含守护进程）
bun run pm2:start

# 查看日志
bun run pm2:logs

# 重启服务
bun run pm2:restart
```

### 其他运行模式

```bash
# Web UI 模式
bun run web

# Bot + Web 混合模式
bun run bot:web

# Bot 不启用守护进程
bun run pm2:start:no-daemon
```

## 环境准备

### 系统要求
- Bun >= 1.0（推荐最新版）
- 内存: >= 512MB
- 存储: >= 1GB

### 环境变量

```bash
# AI Provider
export ZHIPU_API_KEY=your_key

# Feishu Bot（可选）
export LARK_BEECLAW_APPID=...
export LARK_BEECLAW_AS=...
```

## PM2 配置

实际配置文件为 `ecosystem.config.cjs`：

```javascript
module.exports = {
  apps: [{
    name: 'beeclaw',
    script: 'src/entries/bot.ts',
    interpreter: 'bun',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    args: process.env.ENABLE_DAEMON === 'false' ? '' : '--daemon',
    // 日志
    error_file: './logs/beeclaw-error.log',
    out_file: './logs/beeclaw-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    // 环境
    env: {
      NODE_ENV: 'development',
      ENABLE_DAEMON: 'true',
    },
    env_production: {
      NODE_ENV: 'production',
      ENABLE_DAEMON: 'true',
    },
  }],
};
```

### 守护进程控制

```bash
# 启用守护进程（默认）
bun run pm2:start

# 禁用守护进程
ENABLE_DAEMON=false bun run pm2:start

# 生产环境
bun run pm2:start:prod
```

### 定时重启

```bash
# 每天凌晨 4 点自动重启
ENABLE_CRON_RESTART=true bun run pm2:start
```

## 监控和日志

### 日志位置
- 应用日志: `./logs/beeclaw-out.log`
- 错误日志: `./logs/beeclaw-error.log`

### 常用命令

```bash
bun run pm2:status    # 查看进程状态
bun run pm2:monit     # 实时监控
bun run pm2:logs      # 查看日志
bun run pm2:logs:err  # 仅查看错误日志
bun run pm2:info      # 查看进程详情
```

### 日志级别

在 `beeclaw.json` 中配置：

```json
{
  "logging": {
    "level": "info",
    "file": "logs/beeclaw.log"
  }
}
```

## 备份策略

### 需要备份的内容

| 路径 | 说明 |
|------|------|
| `beeclaw.json` | 配置文件 |
| `data/memory/` | 记忆数据（含 SQLite 数据库） |
| `data/sessions/` | 会话数据 |
| `data/sandbox/` | 沙箱工作区 |
| `data/schedules/` | 定时任务数据 |
| `skills/` | 自定义技能 |

### 备份脚本

```bash
#!/bin/bash
DATE=$(date +%Y%m%d)
tar -czf beeclaw-backup-$DATE.tar.gz \
  beeclaw.json \
  data/ \
  skills/
```

## 性能优化

### 内存管理
- 设置 `max_memory_restart: '500M'`（已在配置中）
- 监控内存使用：`bun run pm2:monit`
- 定期清理过期会话文件

### 并发控制
- 合理设置会话超时
- 控制并发请求数
- 子代理并行度：在 `beeclaw.json` 的 `subagent.maxParallelism` 中配置

## 故障排查

### 服务无法启动
1. 检查环境变量是否正确
2. 验证 `beeclaw.json` 配置格式
3. 查看错误日志：`bun run pm2:logs:err`

### 内存泄漏
1. 检查日志文件大小
2. 重启服务：`bun run pm2:restart`
3. 调整 `max_memory_restart`

### 连接问题
1. 检查网络配置
2. 验证 API Keys
3. 查看防火墙设置

## 相关文档

- [配置指南](../configuration.md)
- [故障排查](../troubleshooting/README.md)
