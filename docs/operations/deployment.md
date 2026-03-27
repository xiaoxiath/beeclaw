# 部署指南

> Beeclaw 生产环境部署

## 快速开始

### 使用 PM2 部署

```bash
# 安装 PM2
bun install -g pm2

# 启动服务
bun run pm2:start

# 查看日志
bun run pm2:logs

# 重启服务
bun run pm2:restart
```

## 环境准备

### 系统要求
- Node.js >= 18 或 Bun >= 1.0
- 内存: >= 512MB
- 存储: >= 1GB

### 环境变量

```bash
# AI Provider
export ZHIPU_API_KEY=your_key

# Feishu Bot (可选)
export LARK_BEECLAW_APPID=...
export LARK_BEECLAW_AS=...
```

## PM2 配置

`ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'beeclaw-bot',
    script: 'bun',
    args: 'run bot --daemon',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

## 监控和日志

### 日志位置
- PM2 日志: `~/.pm2/logs/`
- 应用日志: `logs/beeclaw.log`

### 日志级别

```json
{
  "logging": {
    "level": "info",
    "file": "logs/beeclaw.log"
  }
}
```

## 性能优化

### 内存管理
- 设置 `max_memory_restart`
- 监控内存使用
- 定期清理会话文件

### 并发控制
- 合理设置会话超时
- 控制并发请求数

## 备份策略

### 需要备份的内容
- `beeclaw.json` - 配置文件
- `data/memory/` - 记忆数据
- `data/sessions/` - 会话数据
- `skills/` - 自定义技能

### 备份脚本

```bash
#!/bin/bash
DATE=$(date +%Y%m%d)
tar -czf beeclaw-backup-$DATE.tar.gz \
  beeclaw.json \
  data/ \
  skills/
```

## 故障排查

### 服务无法启动
1. 检查环境变量
2. 验证配置文件
3. 查看错误日志

### 内存泄漏
1. 检查日志文件大小
2. 重启服务
3. 调整 `max_memory_restart`

### 连接问题
1. 检查网络配置
2. 验证 API Keys
3. 查看防火墙设置

## 相关文档

- [配置指南](../configuration.md)
- [配置指南](../configuration.md)
