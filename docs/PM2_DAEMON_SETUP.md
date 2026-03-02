# PM2 Daemon 模式配置总结

## 📝 修改文件列表

### 1. 修改的文件

#### ✅ `ecosystem.config.cjs`
**修改内容**：添加 `args: '--daemon'` 参数

```javascript
{
  name: 'beeclaw',
  script: 'src/bot.ts',
  interpreter: 'bun',
  args: '--daemon',  // ✅ 新增：启用 daemon 模式
  // ... 其他配置
}
```

**效果**：PM2 启动时会自动启用 daemon 模式，支持定时任务。

#### ✅ `package.json`
**修改内容**：新增 PM2 相关脚本命令

```json
{
  "scripts": {
    "pm2:start": "pm2 start ecosystem.config.cjs",
    "pm2:start:prod": "pm2 start ecosystem.config.cjs --env production",
    "pm2:start:no-daemon": "pm2 start ecosystem.flexible.cjs --env no_daemon",
    "pm2:stop": "pm2 stop beeclaw",
    "pm2:restart": "pm2 restart beeclaw",
    "pm2:reload": "pm2 reload beeclaw",
    "pm2:delete": "pm2 delete beeclaw",
    "pm2:logs": "pm2 logs beeclaw",
    "pm2:logs:err": "pm2 logs beeclaw --err",
    "pm2:monit": "pm2 monit",
    "pm2:status": "pm2 list",
    "pm2:info": "pm2 show beeclaw",
    "pm2:save": "pm2 save",
    "pm2:startup": "pm2 startup",
    "pm2:flush": "pm2 flush",
    "pm2:reset": "pm2 reset beeclaw"
  }
}
```

**效果**：提供更丰富的 PM2 管理命令。

#### ✅ `README.md`
**修改内容**：
1. 添加 daemon 模式启动说明
2. 添加 PM2 相关文档链接

**效果**：用户可以快速了解如何使用 PM2 和 daemon 模式。

### 2. 新增的文件

#### 📄 `ecosystem.flexible.cjs`
**用途**：灵活配置文件，可通过环境变量控制 daemon 模式

**使用场景**：
- 需要临时禁用 daemon 模式
- 测试环境不需要定时任务
- 多环境部署

#### 📄 `docs/pm2-daemon-guide.md`
**用途**：详细的 PM2 daemon 模式使用指南

**内容包括**：
- 快速开始
- 配置说明
- 开机自启动
- 高级配置
- 故障排查
- 监控和告警

#### 📄 `docs/pm2-quick-reference.md`
**用途**：PM2 daemon 模式快速参考卡片

**内容包括**：
- 快速启动命令
- 所有可用命令列表
- 配置文件说明
- 验证方法
- 常见问题
- 日常运维

## 🚀 使用方式

### 方式 1：标准 PM2 启动（推荐）

```bash
# 启动服务（自动启用 daemon）
bun run pm2:start

# 查看状态
bun run pm2:status

# 查看日志
bun run pm2:logs
```

### 方式 2：生产环境

```bash
# 启动生产环境配置
bun run pm2:start:prod

# 保存进程列表
bun run pm2:save

# 配置开机自启动
bun run pm2:startup
```

### 方式 3：灵活模式（可控制 daemon）

```bash
# 启动但不启用 daemon
bun run pm2:start:no-daemon

# 或者使用环境变量
ENABLE_DAEMON=false pm2 start ecosystem.flexible.cjs
```

## ✅ 验证 Daemon 是否正常工作

### 1. 检查日志

```bash
bun run pm2:logs | grep -i daemon
```

期望输出：
```
⏰ Starting proactive daemon...
   Loaded X active schedules
```

### 2. 检查进程状态

```bash
bun run pm2:status
```

期望：`beeclaw` 进程状态为 `online`

### 3. 检查心跳文件

```bash
cat data/memory/daemon/heartbeat.json | jq
```

期望：`timestamp` 字段为最近时间（不超过 60 秒）

### 4. 检查定时任务

```bash
bun run cli
> /proactive list
```

期望：至少有一个定时任务（如 "Daily Memory Compression"）

## 📊 架构说明

### Daemon 工作流程

```
PM2 启动
   ↓
Bot 初始化（bot.ts）
   ↓
检查 --daemon 参数
   ↓
启动 Daemon（daemon.ts）
   ↓
加载 Scheduler（scheduler.ts）
   ↓
启动定时器（每 60 秒检查）
   ↓
执行到期任务 → 记录结果 → 重新调度
```

### 关键组件

1. **ecosystem.config.cjs** - PM2 配置文件，定义如何启动进程
2. **src/bot.ts** - Bot 入口，解析 `--daemon` 参数
3. **src/proactive/daemon.ts** - 守护进程，管理定时任务生命周期
4. **src/proactive/scheduler.ts** - 调度器，管理 cron 任务
5. **data/memory/daemon/** - Daemon 状态存储目录
6. **data/memory/proactive/** - 定时任务存储目录

## 🔧 故障排查

### 问题 1：Daemon 没有启动

**检查**：
```bash
bun run pm2:logs | grep -i daemon
```

**解决**：
1. 确认 `ecosystem.config.cjs` 中有 `args: '--daemon'`
2. 重启服务：`bun run pm2:restart`

### 问题 2：定时任务不执行

**检查**：
```bash
cat data/memory/proactive/schedules.json | jq '.schedules[] | select(.enabled==true)'
```

**解决**：
1. 确认任务 `enabled: true`
2. 检查 cron 表达式是否正确
3. 查看执行日志：`bun run pm2:logs | grep Daemon`

### 问题 3：进程频繁重启

**检查**：
```bash
bun run pm2:info
```

**解决**：
1. 查看错误日志：`bun run pm2:logs:err`
2. 检查环境变量是否正确
3. 验证飞书连接

## 📚 相关文档

- [PM2 Daemon 快速参考](./pm2-quick-reference.md) - 快速查找命令和配置
- [PM2 Daemon 详细指南](./pm2-daemon-guide.md) - 完整使用文档
- [定时任务机制说明](../README.md) - Daemon 和 Scheduler 架构

## 🎯 下一步

1. **启动服务**：`bun run pm2:start`
2. **验证功能**：检查日志和心跳文件
3. **配置开机自启动**：`bun run pm2:save && bun run pm2:startup`
4. **创建定时任务**：通过对话创建或使用 proactive 工具
5. **监控运行**：定期检查进程状态和日志

---

**💡 提示**：
- PM2 模式适合生产环境长期运行
- Daemon 模式会自动执行定时任务
- 定期检查日志确保服务正常
- 使用 `pm2 monit` 实时监控资源使用
