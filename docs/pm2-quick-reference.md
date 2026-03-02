# PM2 Daemon 模式快速参考

## 🚀 快速启动

```bash
# 启动 bot + daemon（推荐）
bun run pm2:start

# 查看状态
bun run pm2:status

# 查看日志
bun run pm2:logs
```

## 📋 所有可用命令

### 启动相关

| 命令 | 说明 |
|------|------|
| `bun run pm2:start` | 启动 bot + daemon 模式（开发环境） |
| `bun run pm2:start:prod` | 启动 bot + daemon 模式（生产环境） |
| `bun run pm2:start:no-daemon` | 启动 bot 但不启用 daemon |

### 管理相关

| 命令 | 说明 |
|------|------|
| `bun run pm2:stop` | 停止服务 |
| `bun run pm2:restart` | 重启服务 |
| `bun run pm2:reload` | 优雅重载（0 秒停机） |
| `bun run pm2:delete` | 删除服务 |

### 监控相关

| 命令 | 说明 |
|------|------|
| `bun run pm2:status` | 查看进程列表 |
| `bun run pm2:info` | 查看详细信息 |
| `bun run pm2:logs` | 查看所有日志 |
| `bun run pm2:logs:err` | 只查看错误日志 |
| `bun run pm2:monit` | 打开监控面板 |

### 系统相关

| 命令 | 说明 |
|------|------|
| `bun run pm2:save` | 保存当前进程列表 |
| `bun run pm2:startup` | 生成开机自启动脚本 |
| `bun run pm2:flush` | 清空所有日志 |
| `bun run pm2:reset` | 重置进程计数器 |

## 🔧 配置文件说明

### 主要配置文件

| 文件 | 用途 |
|------|------|
| `ecosystem.config.cjs` | 标准配置（默认启用 daemon） |
| `ecosystem.flexible.cjs` | 灵活配置（可通过环境变量控制 daemon） |

### 关键配置项

```javascript
{
  name: 'beeclaw',
  script: 'src/bot.ts',
  interpreter: 'bun',
  args: '--daemon',  // ✅ 启用 daemon 模式的关键

  // 进程管理
  instances: 1,
  autorestart: true,
  max_memory_restart: '500M',
  cron_restart: '0 4 * * *',  // 每天凌晨 4 点重启

  // 日志配置
  error_file: './logs/beeclaw-error.log',
  out_file: './logs/beeclaw-out.log',
}
```

## ✅ 验证 Daemon 是否正常工作

### 1. 检查日志

```bash
bun run pm2:logs | grep -i daemon
```

应该看到：
```
⏰ Starting proactive daemon...
   Loaded X active schedules
```

### 2. 检查进程状态

```bash
bun run pm2:status
```

确保 `beeclaw` 进程状态为 `online`。

### 3. 检查心跳文件

```bash
cat data/memory/daemon/heartbeat.json
```

应该看到最近更新的时间戳（不超过 60 秒）。

### 4. 检查定时任务

```bash
bun run cli
> /proactive list
```

应该看到至少一个定时任务（如 "Daily Memory Compression"）。

## 🐛 常见问题

### Q: Daemon 没有启动？

**A:** 检查 `ecosystem.config.cjs` 中是否有 `args: '--daemon'`

### Q: 定时任务不执行？

**A:**
1. 确认进程在运行：`bun run pm2:status`
2. 检查任务是否启用：`cat data/memory/proactive/schedules.json | jq '.schedules[] | select(.enabled==true)'`
3. 查看执行日志：`bun run pm2:logs | grep Daemon`

### Q: 如何临时禁用 daemon？

**A:** 使用灵活配置：
```bash
bun run pm2:delete
bun run pm2:start:no-daemon
```

### Q: 如何开机自启动？

**A:**
```bash
bun run pm2:save
bun run pm2:startup
# 执行输出的命令
```

## 📊 监控指标

### 正常运行的指标

- ✅ 进程状态：`online`
- ✅ 重启次数：`0` 或很少
- ✅ 内存使用：稳定在某个范围内（如 200-400MB）
- ✅ CPU 使用：空闲时接近 0%，有任务时短暂升高
- ✅ 心跳更新：每 30 秒更新一次
- ✅ 日志输出：定期有 daemon 检查日志

### 异常指标

- ❌ 进程状态：`errored` 或频繁 `restarting`
- ❌ 内存使用：持续增长超过限制
- ❌ 心跳更新：超过 2 分钟未更新
- ❌ 日志输出：有错误或异常堆栈

## 🔄 日常运维

### 每日检查

```bash
# 查看状态
bun run pm2:status

# 查看最近日志
bun run pm2:logs --lines 50

# 检查 daemon 心跳
cat data/memory/daemon/heartbeat.json | jq '.timestamp'
```

### 每周维护

```bash
# 查看日志大小
ls -lh logs/

# 清理旧日志（如果需要）
bun run pm2:flush

# 检查定时任务执行情况
cat data/memory/proactive/schedules.json | jq '.schedules[] | {name, runCount, lastRun}'
```

### 更新部署

```bash
# 拉取最新代码
git pull

# 安装依赖
bun install

# 重启服务
bun run pm2:restart

# 查看启动日志
bun run pm2:logs --lines 20
```

## 📚 相关链接

- [详细文档](./pm2-daemon-guide.md)
- [定时任务机制](./proactive-scheduling.md)
- [PM2 官方文档](https://pm2.keymetrics.io/)

---

**💡 提示**:
- Daemon 模式会自动执行定时任务，确保 PM2 进程持续运行
- 定期检查日志和心跳文件以确保服务正常
- 使用 `pm2 save` 和 `pm2 startup` 配置开机自启动
