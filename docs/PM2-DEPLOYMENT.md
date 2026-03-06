# PM2 部署指南

本文档提供 Beeclaw 的完整 PM2 部署指南，包括进程管理、Daemon 模式、日志管理、监控和故障排查。

## 概述

### 为什么使用 PM2？

PM2 是一个生产级 Node.js 进程管理器，为 Beeclaw 提供以下核心特性：

| 特性 | 说明 |
|-----|------|
| 自动重启 | 进程崩溃或异常退出时自动恢复 |
| 日志管理 | 自动收集 stdout/stderr，支持日志轮转 |
| 开机自启 | 系统重启后自动启动服务 |
| 进程监控 | 实时查看 CPU、内存使用情况 |
| 零停机重载 | 支持优雅重启和 cron 定时重启 |
| Daemon 模式 | 支持后台定时任务调度和主动提醒 |

### 核心优势

- **生产级稳定性**：7x24 小时稳定运行，自动恢复崩溃
- **定时任务支持**：Daemon 模式支持定时内存压缩、目标检查、主动聊天
- **资源管理**：内存超限自动重启，防止内存泄漏
- **完整日志**：所有输出自动记录，支持轮转和压缩
- **监控告警**：实时监控和健康检查

## 快速开始

### 安装 PM2

```bash
# 全局安装 PM2
npm install -g pm2

# 验证安装
pm2 --version
```

### 基本启动命令

```bash
# 方式 1：使用 package.json 脚本（推荐）
bun run pm2:start              # 开发环境（默认启用 daemon）
bun run pm2:start:prod         # 生产环境

# 方式 2：使用配置文件
pm2 start ecosystem.config.cjs

# 方式 3：直接命令行启动
pm2 start src/bot.ts --name beeclaw --interpreter bun -- --daemon
```

### 验证运行

```bash
# 查看进程状态
bun run pm2:status
# 或
pm2 list

# 查看实时日志
bun run pm2:logs

# 检查 daemon 是否启动
bun run pm2:logs | grep -i daemon
# 期望输出：
# ⏰ Starting proactive daemon...
#    Loaded X active schedules

# 检查进程详细信息
pm2 show beeclaw
```

## Daemon 模式（后台调度）

### 什么是 Daemon 模式？

Daemon 模式是 Beeclaw 的后台调度系统，支持：

- **定时任务**：内存压缩、目标进度检查、数据清理
- **主动聊天**：根据上下文主动发起对话（如每日问候、会议提醒）
- **提醒系统**：用户创建的定时提醒和通知
- **心跳监控**：定期更新心跳文件，便于健康检查

### 启动守护进程

```bash
# 标准启动（自动启用 daemon）
bun run pm2:start

# 生产环境启动
bun run pm2:start:prod

# 不启用 daemon 的模式
bun run pm2:start:no-daemon
```

### 定时任务配置

Daemon 模式会自动加载 `data/memory/proactive/schedules.json` 中的定时任务：

```bash
# 查看所有定时任务
bun run cli
> /proactive list

# 应该看到至少一个任务：
# 📅 Active Schedules (1):
# 1. Daily Memory Compression
#    - Cron: 0 3 * * *
#    - Next Run: 2026-03-07 03:00:00
```

### Proactive 系统

Daemon 支持的主动任务类型：

| 任务类型 | 说明 | 示例 |
|---------|------|------|
| `memory_compression` | 内存压缩 | 每天凌晨 3 点压缩旧记忆 |
| `goal_check` | 目标进度检查 | 每周检查目标完成情况 |
| `reminder` | 用户提醒 | "明天 9 点提醒我开会" |
| `llm_proactive_chat` | AI 主动聊天 | 每天早上问候并提供日程 |

### 验证 Daemon 功能

#### 1. 检查日志

```bash
bun run pm2:logs | grep -i daemon
```

期望看到：
```
⏰ Starting proactive daemon...
   Loaded 2 active schedules
```

#### 2. 检查心跳文件

```bash
cat data/memory/daemon/heartbeat.json | jq
```

期望输出：
```json
{
  "timestamp": "2026-03-06T15:30:45.123Z",
  "status": "running",
  "uptime": 3600
}
```

心跳时间戳应该在 60 秒内更新。

#### 3. 检查定时任务

```bash
cat data/memory/proactive/schedules.json | jq '.schedules[] | {name, enabled, nextRun}'
```

#### 4. 查看 Daemon 状态

```bash
cat data/memory/daemon/state.json | jq
```

## 配置参考

### ecosystem.config.cjs 详解

```javascript
module.exports = {
  apps: [{
    name: 'beeclaw',
    script: 'src/bot.ts',
    interpreter: 'bun',
    args: '--daemon',  // ✅ 启用 daemon 模式的关键

    // 进程管理
    instances: 1,               // Bot 只需单实例
    autorestart: true,          // 自动重启
    watch: false,               // 生产环境禁用文件监控
    max_memory_restart: '500M', // 内存超限重启
    restart_delay: 3000,        // 重启延迟 3 秒
    max_restarts: 10,           // 最大重启次数
    cron_restart: '0 4 * * *',  // 每天凌晨 4 点定时重启

    // 环境变量
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    },

    // 日志配置
    error_file: './logs/beeclaw-error.log',
    out_file: './logs/beeclaw-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
  }]
};
```

### 关键配置项说明

| 配置项 | 说明 | 推荐值 |
|-------|------|--------|
| `interpreter` | 解释器路径 | `bun` 或绝对路径 |
| `args` | 启动参数 | `--daemon`（启用定时任务） |
| `instances` | 实例数量 | `1`（Bot 只需单实例） |
| `autorestart` | 自动重启 | `true` |
| `watch` | 文件监控自动重启 | `false`（生产环境） |
| `max_memory_restart` | 内存超限重启 | `500M` - `1G` |
| `restart_delay` | 重启延迟 | `3000`（毫秒） |
| `max_restarts` | 最大重启次数 | `10` |
| `cron_restart` | 定时重启 | `0 4 * * *`（每天凌晨 4 点） |

### 环境变量配置

#### 方式一：.env 文件（推荐）

```bash
# 创建 .env 文件
cp .env.example .env

# 编辑环境变量
vim .env
```

PM2 会自动加载 `.env` 文件。

#### 方式二：配置文件中指定

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'beeclaw',
    env_file: '.env',
  }]
};
```

#### 方式三：shell 环境变量

```bash
# 设置环境变量
export LARK_BEECLAW_APPID="cli_xxx"
export LARK_BEECLAW_AS="your-secret"
export ZHIPU_API_KEY="your-key"

# 启动
pm2 start ecosystem.config.cjs
```

### 日志配置

#### 日志位置

```
logs/
├── beeclaw-out.log      # 标准输出
├── beeclaw-error.log    # 错误日志
└── beeclaw-combined.log # 合并日志（可选）
```

#### 日志轮转（pm2-logrotate）

```bash
# 安装 pm2-logrotate
pm2 install pm2-logrotate

# 配置日志轮转
pm2 set pm2-logrotate:max_size 10M        # 单文件最大 10MB
pm2 set pm2-logrotate:retain 7            # 保留 7 天
pm2 set pm2-logrotate:compress true       # 压缩旧日志
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD-HH-mm-ss
```

#### 手动清理日志

```bash
# 清空所有日志
pm2 flush

# 清空特定应用日志
pm2 flush beeclaw
```

### 灵活配置（可选）

创建 `ecosystem.flexible.cjs` 用于多环境部署：

```javascript
module.exports = {
  apps: [{
    name: 'beeclaw',
    script: 'src/bot.ts',
    interpreter: 'bun',
    args: process.env.ENABLE_DAEMON === 'false' ? '' : '--daemon',

    env: {
      NODE_ENV: process.env.NODE_ENV || 'development',
      DAEMON_CHECK_INTERVAL: '60000',     // 检查间隔 60 秒
      DAEMON_HEARTBEAT_INTERVAL: '30000', // 心跳间隔 30 秒
    },
  }]
};
```

使用方式：

```bash
# 启用 daemon
pm2 start ecosystem.flexible.cjs

# 禁用 daemon
ENABLE_DAEMON=false pm2 start ecosystem.flexible.cjs
```

## 运维操作

### 查看状态

```bash
# 查看所有进程
bun run pm2:status
# 或
pm2 list

# 查看详细信息
pm2 show beeclaw

# JSON 格式输出（适合脚本）
pm2 jlist

# 检查进程是否运行
pm2 pid beeclaw
```

### 查看日志

```bash
# 查看实时日志
bun run pm2:logs

# 查看最近 100 行日志
pm2 logs beeclaw --lines 100

# 只查看错误日志
pm2 logs beeclaw --err

# 实时监控面板
bun run pm2:monit
```

### 重启和停止

```bash
# 重启服务
bun run pm2:restart

# 优雅重载（0 秒停机）
bun run pm2:reload

# 停止服务
bun run pm2:stop

# 完全删除服务
pm2 delete beeclaw

# 停止所有进程
pm2 stop all

# 重启所有进程
pm2 restart all
```

### 监控

#### 实时监控

```bash
# 终端监控面板
bun run pm2:monit

# Web 监控面板（PM2 Plus，可选）
pm2 plus
```

#### 使用 PM2 Plus

1. 注册账号：https://pm2.io/
2. 连接进程：

```bash
pm2 link <secret_key> <public_key>
```

3. 在 Web 界面监控：
   - CPU 和内存使用
   - 日志流
   - 异常告警
   - 自定义指标

#### 进程状态检查

```bash
# 检查进程状态
pm2 show beeclaw | grep status

# 查看重启次数
pm2 show beeclaw | grep restart

# 检查内存使用
pm2 show beeclaw | grep memory

# 实时监控资源
pm2 monit
```

### 开机自启

#### 1. 生成启动脚本

```bash
# 保存当前进程列表
bun run pm2:save

# 生成 systemd 服务
bun run pm2:startup

# 按照提示执行输出的命令，例如：
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u username --hp /home/username
```

#### 2. 验证自启动

```bash
# 重启系统后
pm2 list

# 检查 systemd 服务状态
systemctl status pm2-username
```

#### 3. 管理自启动

```bash
# 保存当前进程列表
pm2 save

# 恢复进程列表（通常自动执行）
pm2 resurrect

# 清空保存的进程列表
pm2 cleardump
```

### 健康检查脚本

创建 `healthcheck.sh`：

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
# 每 5 分钟检查一次
*/5 * * * * /path/to/healthcheck.sh || pm2 restart beeclaw
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

# 验证服务正常
bun run pm2:status
```

## 故障排查

### 常见问题

#### 1. Daemon 未启动

**症状**: 日志中没有 "Starting proactive daemon" 消息

**解决方案**:

```bash
# 检查配置
cat ecosystem.config.cjs | grep args

# 确保有 args: '--daemon'
# 如果没有，添加该配置

# 重启服务
bun run pm2:restart

# 查看日志验证
bun run pm2:logs | grep -i daemon
```

#### 2. 定时任务不执行

**症状**: Daemon 启动了但任务不执行

**解决方案**:

```bash
# 检查任务状态
cat data/memory/proactive/schedules.json | jq '.schedules[] | select(.enabled==true)'

# 确认任务 enabled: true
# 检查 cron 表达式是否正确
# 查看执行日志
bun run pm2:logs | grep Daemon
```

#### 3. 进程频繁重启

**症状**: `restarts` 计数不断增加

**解决方案**:

```bash
# 查看重启次数
pm2 show beeclaw | grep restart

# 查看错误日志
pm2 logs beeclaw --err

# 检查内存使用
pm2 monit

# 检查环境变量是否正确
pm2 env 0  # 0 是进程 ID

# 增加重启延迟
# 在 ecosystem.config.cjs 中添加：
# restart_delay: 5000
```

#### 4. Bun 解释器找不到

**症状**: 启动失败，提示找不到 bun

**解决方案**:

```bash
# 查找 bun 路径
which bun
# /Users/xxx/.bun/bin/bun

# 在配置中使用绝对路径
# ecosystem.config.cjs:
interpreter: '/Users/xxx/.bun/bin/bun'
```

#### 5. 权限问题

**症状**: 无法写入日志或数据文件

**解决方案**:

```bash
# 确保 logs 目录有写权限
mkdir -p logs
chmod 755 logs

# 确保 data 目录有写权限
chmod -R 755 data/

# 检查文件所有者
ls -la logs/
```

#### 6. 环境变量未生效

**症状**: 配置的环境变量未加载

**解决方案**:

```bash
# 使用 --env 指定环境
pm2 start ecosystem.config.cjs --env production

# 或者重启 PM2 守护进程
pm2 update
pm2 restart all

# 检查环境变量
pm2 env 0  # 0 是进程 ID
```

#### 7. 内存泄漏

**症状**: 内存持续增长

**解决方案**:

```bash
# 设置内存限制
# 在 ecosystem.config.cjs 中：
max_memory_restart: '500M'

# 定期重启
cron_restart: '0 4 * * *'

# 监控内存
pm2 monit

# 查看内存历史
pm2 show beeclaw | grep memory
```

### 调试方法

#### 查看完整日志

```bash
# 查看所有日志
pm2 logs beeclaw --lines 500

# 只看错误日志
pm2 logs beeclaw --err

# 查看日志文件
tail -f logs/beeclaw-out.log
tail -f logs/beeclaw-error.log
```

#### 手动测试

```bash
# 停止 PM2 进程
pm2 stop beeclaw

# 手动运行
bun run bot --daemon

# 查看输出，确认是否有错误

# 测试完成后重新启动
pm2 start ecosystem.config.cjs
```

#### 检查 Daemon 状态

```bash
# 查看 daemon 状态文件
cat data/memory/daemon/state.json | jq

# 查看心跳文件
cat data/memory/daemon/heartbeat.json | jq

# 查看定时任务
cat data/memory/proactive/schedules.json | jq

# 查看 daemon 日志
grep "Daemon" logs/beeclaw-out.log | tail -20
```

#### 重置进程

```bash
# 停止并删除进程
pm2 delete beeclaw

# 清空日志
pm2 flush

# 重新启动
pm2 start ecosystem.config.cjs
```

## 快速参考

### 常用命令列表

#### 启动相关

| 命令 | 说明 |
|------|------|
| `bun run pm2:start` | 启动 bot + daemon 模式（开发环境） |
| `bun run pm2:start:prod` | 启动 bot + daemon 模式（生产环境） |
| `bun run pm2:start:no-daemon` | 启动 bot 但不启用 daemon |
| `pm2 start ecosystem.config.cjs` | 使用配置文件启动 |
| `pm2 start src/bot.ts --name beeclaw --interpreter bun -- --daemon` | 命令行启动 |

#### 管理相关

| 命令 | 说明 |
|------|------|
| `bun run pm2:stop` | 停止服务 |
| `bun run pm2:restart` | 重启服务 |
| `bun run pm2:reload` | 优雅重载（0 秒停机） |
| `bun run pm2:delete` | 删除服务 |
| `pm2 stop all` | 停止所有进程 |
| `pm2 restart all` | 重启所有进程 |

#### 监控相关

| 命令 | 说明 |
|------|------|
| `bun run pm2:status` | 查看进程列表 |
| `bun run pm2:info` | 查看详细信息 |
| `bun run pm2:logs` | 查看所有日志 |
| `bun run pm2:logs:err` | 只查看错误日志 |
| `bun run pm2:monit` | 打开监控面板 |
| `pm2 logs beeclaw --lines 100` | 查看最近 100 行日志 |
| `pm2 show beeclaw` | 查看详细信息 |

#### 系统相关

| 命令 | 说明 |
|------|------|
| `bun run pm2:save` | 保存当前进程列表 |
| `bun run pm2:startup` | 生成开机自启动脚本 |
| `bun run pm2:flush` | 清空所有日志 |
| `bun run pm2:reset` | 重置进程计数器 |
| `pm2 update` | 更新 PM2 守护进程 |
| `pm2 resurrect` | 恢复进程列表 |

### 配置模板

#### 最小配置

```javascript
module.exports = {
  apps: [{
    name: 'beeclaw',
    script: 'src/bot.ts',
    interpreter: 'bun',
    args: '--daemon',
  }]
};
```

#### 生产环境配置

```javascript
module.exports = {
  apps: [{
    name: 'beeclaw',
    script: 'src/bot.ts',
    interpreter: 'bun',
    args: '--daemon',

    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
    cron_restart: '0 4 * * *',
    restart_delay: 3000,
    max_restarts: 10,

    env_production: {
      NODE_ENV: 'production'
    },

    error_file: './logs/beeclaw-error.log',
    out_file: './logs/beeclaw-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
  }]
};
```

### 监控指标

#### 正常运行的指标

- ✅ 进程状态：`online`
- ✅ 重启次数：`0` 或很少
- ✅ 内存使用：稳定在某个范围内（如 200-400MB）
- ✅ CPU 使用：空闲时接近 0%，有任务时短暂升高
- ✅ 心跳更新：每 30 秒更新一次
- ✅ 日志输出：定期有 daemon 检查日志

#### 异常指标

- ❌ 进程状态：`errored` 或频繁 `restarting`
- ❌ 内存使用：持续增长超过限制
- ❌ 心跳更新：超过 2 分钟未更新
- ❌ 日志输出：有错误或异常堆栈

### 生产环境检查清单

- [ ] 配置 `ecosystem.config.cjs` 文件
- [ ] 设置 `args: '--daemon'` 启用定时任务
- [ ] 设置 `max_memory_restart` 防止内存泄漏
- [ ] 设置 `cron_restart` 定期重启
- [ ] 安装 `pm2-logrotate` 日志轮转
- [ ] 配置 `pm2 startup` 开机自启
- [ ] 执行 `pm2 save` 保存进程列表
- [ ] 验证日志正常输出
- [ ] 测试崩溃后自动恢复
- [ ] 验证 daemon 功能正常
- [ ] 配置健康检查脚本

### 日常运维

#### 每日检查

```bash
# 查看状态
bun run pm2:status

# 查看最近日志
bun run pm2:logs --lines 50

# 检查 daemon 心跳
cat data/memory/daemon/heartbeat.json | jq '.timestamp'
```

#### 每周维护

```bash
# 查看日志大小
ls -lh logs/

# 清理旧日志（如果需要）
bun run pm2:flush

# 检查定时任务执行情况
cat data/memory/proactive/schedules.json | jq '.schedules[] | {name, runCount, lastRun}'

# 检查重启次数
pm2 show beeclaw | grep restart
```

#### 紧急恢复

```bash
# 停止服务
pm2 stop beeclaw

# 清空日志
pm2 flush

# 重置进程
pm2 reset beeclaw

# 重新启动
pm2 restart beeclaw

# 查看启动日志
pm2 logs beeclaw --lines 20
```

## 相关文档

- [PM2 官方文档](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Beeclaw 定时任务机制](./proactive-scheduling.md)
- [飞书集成指南](./feishu-integration.md)
- [主动能力指南](./proactive-capabilities-guide.md)

---

**提示**:
- Daemon 模式会自动执行定时任务，确保 PM2 进程持续运行以保持定时任务正常工作
- 定期检查日志和心跳文件以确保服务正常
- 使用 `pm2 save` 和 `pm2 startup` 配置开机自启动
- 生产环境建议配置日志轮转和健康检查
