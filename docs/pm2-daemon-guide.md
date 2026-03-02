# PM2 Daemon 模式使用指南

本文档说明如何使用 PM2 管理 Beeclaw Bot 的 Daemon 模式（支持定时任务）。

## 📋 前提条件

- 安装 PM2: `npm install -g pm2`
- 安装 Bun: <https://bun.sh>
- 配置好 `beeclaw.json` 和飞书环境变量

## 🚀 快速开始

### 启动服务

```bash
# 开发环境（启用 daemon）
bun run pm2:start

# 生产环境
bun run pm2:start:prod
```

### 查看状态

```bash
# 查看进程状态
bun run pm2:status
# 或
pm2 list

# 查看实时日志
bun run pm2:logs
# 或
pm2 logs beeclaw

# 监控面板
bun run pm2:monit
```

### 停止和重启

```bash
# 停止服务
bun run pm2:stop

# 重启服务
bun run pm2:restart

# 完全删除服务
pm2 delete beeclaw
```

## ⚙️ 配置说明

### Daemon 模式启用方式

在 `ecosystem.config.cjs` 中，通过 `args` 参数启用 daemon：

```javascript
{
  name: 'beeclaw',
  script: 'src/bot.ts',
  interpreter: 'bun',
  args: '--daemon',  // ✅ 启用 daemon 模式
  // ... 其他配置
}
```

### 环境变量配置

PM2 会自动加载 `beeclaw.json` 中引用的环境变量：

```bash
# 飞书配置
export LARK_BEECLAW_APPID="your-app-id"
export LARK_BEECLAW_AS="your-app-secret"

# AI Provider 配置
export ZHIPU_API_KEY="your-zhipu-key"
```

### 日志配置

日志文件位于 `./logs/` 目录：

- `beeclaw-out.log` - 标准输出日志
- `beeclaw-error.log` - 错误日志

查看日志：

```bash
# 实时查看所有日志
pm2 logs beeclaw

# 只查看最近 100 行
pm2 logs beeclaw --lines 100

# 只查看错误日志
pm2 logs beeclaw --err
```

## 🔄 开机自启动

### 保存当前 PM2 进程列表

```bash
pm2 save
```

### 生成开机启动脚本

```bash
pm2 startup
```

执行命令后会输出类似以下的命令，复制并执行：

```bash
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u yourname --hp /home/yourname
```

### 验证自启动

```bash
# 重启系统后
pm2 list
```

## 📊 Daemon 功能验证

### 1. 检查 Daemon 状态

启动后，日志中应该看到：

```
⏰ Starting proactive daemon...
   Loaded X active schedules
```

### 2. 查看定时任务

```bash
# 进入 CLI 模式
bun run cli

# 查看所有定时任务
> /proactive list

# 应该看到类似输出：
# 📅 Active Schedules (X):
# 1. Daily Memory Compression
#    - Cron: 0 3 * * *
#    - Next Run: 2026-03-04 03:00:00
```

### 3. 查看 Daemon 心跳

```bash
# 查看 daemon 状态文件
cat data/memory/daemon/state.json | jq

# 查看心跳文件
cat data/memory/daemon/heartbeat.json | jq
```

## 🛠️ 高级配置

### 自定义 Daemon 参数

修改 `ecosystem.config.cjs`：

```javascript
{
  name: 'beeclaw',
  args: '--daemon',

  // 自定义环境变量
  env: {
    NODE_ENV: 'development',
    DAEMON_CHECK_INTERVAL: '60000',     // 检查间隔 60 秒
    DAEMON_HEARTBEAT_INTERVAL: '30000', // 心跳间隔 30 秒
  },

  // 日志轮转（需要 pm2-logrotate）
  error_file: './logs/beeclaw-error.log',
  out_file: './logs/beeclaw-out.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
}
```

### 日志轮转

安装 `pm2-logrotate`:

```bash
pm2 install pm2-logrotate
```

配置：

```bash
# 设置最大文件大小为 10M
pm2 set pm2-logrotate:max_size 10M

# 保留最近 7 个日志文件
pm2 set pm2-logrotate:retain 7

# 启用压缩
pm2 set pm2-logrotate:compress true
```

### 多环境配置

创建不同的配置文件：

```javascript
// ecosystem.config.development.cjs
module.exports = {
  apps: [{
    name: 'beeclaw-dev',
    args: '--daemon',
    env: { NODE_ENV: 'development' }
  }]
}

// ecosystem.config.production.cjs
module.exports = {
  apps: [{
    name: 'beeclaw-prod',
    args: '--daemon',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '1G'
  }]
}
```

使用：

```bash
pm2 start ecosystem.config.development.cjs
pm2 start ecosystem.config.production.cjs
```

## 🐛 故障排查

### Daemon 未启动

**症状**: 日志中没有 "Starting proactive daemon" 消息

**解决方案**:

1. 检查 `ecosystem.config.cjs` 中 `args: '--daemon'` 是否存在
2. 查看完整日志：`pm2 logs beeclaw`
3. 手动测试：`bun run bot --daemon`

### 定时任务不执行

**症状**: Daemon 启动了但任务不执行

**解决方案**:

1. 检查任务状态：`cat data/memory/proactive/schedules.json`
2. 确认任务 `enabled: true`
3. 检查 cron 表达式是否正确
4. 查看 daemon 日志中的执行记录

### 内存泄漏

**症状**: 内存持续增长

**解决方案**:

1. 设置内存限制：`max_memory_restart: '500M'`
2. 定期重启：`cron_restart: '0 4 * * *'`
3. 监控内存：`pm2 monit`

### 进程频繁重启

**症状**: `restarts` 计数不断增加

**解决方案**:

1. 查看错误日志：`pm2 logs beeclaw --err`
2. 检查环境变量是否正确
3. 验证飞书连接是否正常
4. 增加重启延迟：`restart_delay: 5000`

## 📝 PM2 常用命令速查

```bash
# 启动
pm2 start ecosystem.config.cjs

# 停止
pm2 stop beeclaw
pm2 stop all

# 重启
pm2 restart beeclaw
pm2 restart all

# 删除
pm2 delete beeclaw
pm2 delete all

# 查看日志
pm2 logs
pm2 logs beeclaw
pm2 logs --lines 200

# 监控
pm2 monit
pm2 list
pm2 show beeclaw

# 保存和恢复
pm2 save
pm2 resurrect

# 更新 PM2
pm2 update
```

## 🔍 监控和告警

### 使用 PM2 Plus（可选）

1. 注册账号：https://pm2.io/
2. 连接进程：

```bash
pm2 link <secret_key> <public_key>
```

3. 在 Web 界面中监控：
   - CPU 和内存使用
   - 日志流
   - 异常告警
   - 自定义指标

### 自定义健康检查

创建 `healthcheck.sh`:

```bash
#!/bin/bash
# 检查 daemon 心跳文件是否更新

HEARTBEAT_FILE="data/memory/daemon/heartbeat.json"
MAX_AGE=120  # 最大 120 秒

if [ ! -f "$HEARTBEAT_FILE" ]; then
  echo "ERROR: Heartbeat file not found"
  exit 1
fi

LAST_UPDATE=$(jq -r '.timestamp' "$HEARTBEAT_FILE")
LAST_TIMESTAMP=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$LAST_UPDATE" "+%s" 2>/dev/null || date -d "$LAST_UPDATE" "+%s")
NOW=$(date "+%s")
AGE=$((NOW - LAST_TIMESTAMP))

if [ $AGE -gt $MAX_AGE ]; then
  echo "ERROR: Heartbeat too old: ${AGE} seconds"
  exit 1
else
  echo "OK: Heartbeat age: ${AGE} seconds"
  exit 0
fi
```

配合 cron 定期检查：

```bash
*/5 * * * * /path/to/healthcheck.sh || pm2 restart beeclaw
```

## 📚 相关文档

- [PM2 官方文档](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Beeclaw 定时任务机制](./proactive-scheduling.md)
- [飞书集成指南](./feishu-integration.md)

---

**提示**: Daemon 模式会自动执行定时任务（如内存压缩、目标进度检查等），确保 PM2 进程持续运行以保持定时任务正常工作。
