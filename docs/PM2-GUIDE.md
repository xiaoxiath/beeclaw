# PM2 进程管理指南

本文档介绍如何使用 PM2 管理 Beeclaw 进程，实现自动重启、日志管理和开机自启。

## 为什么使用 PM2？

| 特性 | 说明 |
|-----|------|
| 自动重启 | 进程崩溃或异常退出时自动恢复 |
| 日志管理 | 自动收集 stdout/stderr，支持日志轮转 |
| 开机自启 | 系统重启后自动启动服务 |
| 进程监控 | 实时查看 CPU、内存使用情况 |
| 零停机重载 | 支持优雅重启 |

## 安装

```bash
# 全局安装 PM2
npm install -g pm2

# 验证安装
pm2 --version
```

## 快速开始

### 1. 基本启动

```bash
# 启动 Feishu Bot（前台模式，用于测试）
pm2 start ecosystem.config.cjs

# 或者直接命令行启动
pm2 start src/bot.ts --name beeclaw --interpreter bun
```

### 2. 常用命令

```bash
# 查看所有进程
pm2 list

# 查看详细信息
pm2 show beeclaw

# 查看实时日志
pm2 logs beeclaw

# 查看最近 100 行日志
pm2 logs beeclaw --lines 100

# 重启服务
pm2 restart beeclaw

# 停止服务
pm2 stop beeclaw

# 删除服务
pm2 delete beeclaw

# 监控面板
pm2 monit
```

### 3. Daemon 模式（推荐生产环境）

```bash
# 启动带主动调度功能的 Bot
pm2 start ecosystem.config.cjs --env production
```

## 配置文件说明

`ecosystem.config.cjs` 配置项说明：

```javascript
module.exports = {
  apps: [{
    name: 'beeclaw',
    script: 'src/bot.ts',
    interpreter: 'bun',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    },
    // 日志配置
    error_file: './logs/beeclaw-error.log',
    out_file: './logs/beeclaw-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
  }]
};
```

### 关键配置项

| 配置项 | 说明 | 推荐值 |
|-------|------|--------|
| `interpreter` | 解释器路径 | `bun` |
| `instances` | 实例数量 | `1`（Bot 只需单实例） |
| `autorestart` | 自动重启 | `true` |
| `watch` | 文件监控自动重启 | `false`（生产环境） |
| `max_memory_restart` | 内存超限重启 | `500M` |
| `restart_delay` | 重启延迟 | `3000`（毫秒） |
| `max_restarts` | 最大重启次数 | `10` |

## 日志管理

### 日志位置

```
logs/
├── beeclaw-out.log    # 标准输出
├── beeclaw-error.log  # 错误日志
└── beeclaw-combined.log  # 合并日志（可选）
```

### 日志轮转（PM2 Logrotate）

```bash
# 安装 pm2-logrotate
pm2 install pm2-logrotate

# 配置日志轮转
pm2 set pm2-logrotate:max_size 10M        # 单文件最大 10MB
pm2 set pm2-logrotate:retain 7            # 保留 7 天
pm2 set pm2-logrotate:compress true       # 压缩旧日志
```

### 手动清理日志

```bash
# 清空所有日志
pm2 flush

# 清空特定应用日志
pm2 flush beeclaw
```

## 开机自启

### 1. 生成启动脚本

```bash
# 生成 systemd 服务
pm2 startup

# 按照提示执行输出的命令，例如：
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u username --hp /home/username
```

### 2. 保存当前进程列表

```bash
# 保存当前运行的进程
pm2 save

# 恢复进程列表（通常自动执行）
pm2 resurrect
```

### 3. 验证

```bash
# 重启系统后检查
pm2 list
```

## 环境变量管理

### 方式一：.env 文件

```bash
# 创建 .env 文件
cp .env.example .env

# 编辑环境变量
vim .env
```

PM2 会自动加载 `.env` 文件。

### 方式二：配置文件中指定

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'beeclaw',
    // ...
    env_file: '.env',
  }]
};
```

### 方式三：命令行传递

```bash
# 设置环境变量
export TUSHARE_TOKEN=your_token
export QWEATHER_TOKEN=your_token

# 启动
pm2 start ecosystem.config.cjs
```

## 监控与告警

### 实时监控

```bash
# 终端监控面板
pm2 monit

# Web 监控面板（可选）
pm2 plus
```

### 进程状态检查

```bash
# JSON 格式输出（适合脚本）
pm2 jlist

# 检查进程是否运行
pm2 pid beeclaw
```

### 健康检查脚本

```bash
#!/bin/bash
# healthcheck.sh

if ! pm2 pid beeclaw > /dev/null 2>&1; then
    echo "Beeclaw is not running!"
    # 发送告警通知
    exit 1
fi

echo "Beeclaw is healthy"
exit 0
```

## 常见问题

### 1. 进程频繁重启

```bash
# 查看重启次数
pm2 show beeclaw | grep restart

# 查看错误日志
pm2 logs beeclaw --err

# 检查内存使用
pm2 monit
```

### 2. Bun 解释器找不到

```bash
# 使用绝对路径
which bun
# /Users/xxx/.bun/bin/bun

# 在配置中使用绝对路径
interpreter: '/Users/xxx/.bun/bin/bun'
```

### 3. 权限问题

```bash
# 确保 logs 目录有写权限
mkdir -p logs
chmod 755 logs
```

### 4. 环境变量未生效

```bash
# 使用 --env 指定环境
pm2 start ecosystem.config.cjs --env production

# 或者重启 PM2 守护进程
pm2 update
pm2 restart all
```

## 生产环境检查清单

- [ ] 配置 `ecosystem.config.cjs` 文件
- [ ] 设置 `max_memory_restart` 防止内存泄漏
- [ ] 安装 `pm2-logrotate` 日志轮转
- [ ] 配置 `pm2 startup` 开机自启
- [ ] 执行 `pm2 save` 保存进程列表
- [ ] 验证日志正常输出
- [ ] 测试崩溃后自动恢复

## 命令速查表

| 命令 | 说明 |
|-----|------|
| `pm2 start` | 启动应用 |
| `pm2 stop` | 停止应用 |
| `pm2 restart` | 重启应用 |
| `pm2 delete` | 删除应用 |
| `pm2 list` | 查看所有应用 |
| `pm2 logs` | 查看日志 |
| `pm2 monit` | 监控面板 |
| `pm2 flush` | 清空日志 |
| `pm2 save` | 保存进程列表 |
| `pm2 resurrect` | 恢复进程列表 |
| `pm2 startup` | 生成启动脚本 |
| `pm2 update` | 更新 PM2 内存进程 |
