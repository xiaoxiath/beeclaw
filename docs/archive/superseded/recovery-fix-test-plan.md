# 重启恢复功能修复 - 测试方案

## 问题回顾

### 根本原因
1. **Recovery 重复处理已响应消息**: Recovery 逻辑只检查最后一条消息是否是 user，没有检查是否已有 AI 响应
2. **`pendingRecovery` 标志清除时机错误**: 只在发送到 Feishu 后清除，而不是 AI 响应后立即清除
3. **竞态条件**: 多条消息并发时，replay 逻辑可能跳过正在处理的消息

### 修复内容
1. **src/session/recovery.ts**: 添加检查，跳过已响应的 session，清除过时的 `pendingRecovery` 标志
2. **src/session/index.ts**: AI 响应后立即清除 `pendingRecovery` 标志
3. **src/routes/proactive.ts**: 使用 `markResponseDelivered` 替代 `clearRecoveryFlag`
4. **src/session/__tests__/message-order.test.ts**: 新增测试覆盖消息顺序场景

---

## 测试方案

### 1. 单元测试（自动）

#### 1.1 运行消息顺序测试
```bash
bun test src/session/__tests__/message-order.test.ts
```

**测试场景**:
- ✅ 清除已响应 session 的过时 `pendingRecovery` 标志
- ✅ 不检测已有 assistant 响应的 session 为未回答
- ✅ 检测真正未回答的 session（即使有 `pendingRecovery`）
- ✅ 正确处理快速连续发送的多条消息
- ✅ 只检测最后一个未回答的消息
- ✅ 边界情况（空 session、只有 assistant 消息、channel 过滤）

#### 1.2 运行所有 session 测试
```bash
bun test src/session/__tests__/
```

**预期结果**: 40 个测试全部通过

---

### 2. 集成测试（手动）

#### 2.1 测试环境准备

1. **启动本地开发环境**:
   ```bash
   # 终端 1: 启动 Bot（不使用 daemon）
   bun run bot

   # 终端 2: 监控日志
   tail -f logs/bot-out.log | grep -E "\[Recovery\]|\[Session\]|\[FeishuWS\]"
   ```

2. **准备测试飞书群**:
   - 创建一个测试群或使用现有群
   - 确保 Bot 已加入群聊

---

#### 2.2 测试场景 1: 单条消息 + 重启恢复

**目的**: 验证 Recovery 不会重复处理已响应的消息

**步骤**:
1. 在飞书群发送消息: "测试消息 A"
2. 等待 Bot 响应
3. **立即**手动重启 Bot（在响应发送后 5 秒内）:
   ```bash
   # 终端 1
   Ctrl+C  # 停止 Bot

   # 等待 3 秒
   sleep 3

   # 重新启动
   bun run bot
   ```

4. 观察日志

**预期日志**:
```
[Recovery] 🔍 Scanning for unanswered sessions...
[Recovery] 🧹 Clearing stale pendingRecovery flag for answered session feishu-xxx-xxx
[Recovery] ✓ No unanswered sessions found
```

**预期行为**:
- ✅ Bot 不重新处理消息 A
- ✅ 不发送重复响应
- ✅ `pendingRecovery` 标志被清除

---

#### 2.3 测试场景 2: 快速发送多条消息

**目的**: 验证消息顺序正确，回复内容匹配

**步骤**:
1. 在飞书群快速发送 3 条消息（每条间隔 2 秒）:
   - 消息 1: "你好，我想了解 A"
   - 消息 2: "另外请问 B"
   - 消息 3: "还有 C"

2. 观察每条响应的引用内容

**预期行为**:
- ✅ 每条响应都正确引用对应的消息
- ✅ 响应 1 针对消息 A
- ✅ 响应 2 针对消息 B
- ✅ 响应 3 针对消息 C
- ✅ 没有消息被跳过或重复处理

---

#### 2.4 测试场景 3: 重启时正在处理的消息

**目的**: 验证 Recovery 正确恢复中断的消息

**步骤**:
1. 在飞书群发送消息: "请帮我写一个复杂的 Python 脚本..."
2. **立即**重启 Bot（在 AI 开始处理但未响应前）:
   ```bash
   # 终端 1
   Ctrl+C  # 停止 Bot（在看到 "[Session] Processing message..." 后立即停止）

   sleep 2

   bun run bot
   ```

3. 观察日志和飞书群

**预期日志**:
```
[Recovery] 🔍 Scanning for unanswered sessions...
[Recovery] 📨 Found 1 unanswered session(s)
[Recovery] 🔄 Session feishu-xxx-xxx marked as pending recovery (bot restarted during processing)
[Recovery] 🔄 Recovering session feishu-xxx-xxx
[Recovery] ✅ Session recovered
[Recovery] 📤 Response sent to Feishu
```

**预期行为**:
- ✅ Recovery 检测到中断的消息
- ✅ 自动重新处理并发送响应
- ✅ 用户收到完整响应
- ✅ `pendingRecovery` 标志在 AI 响应后清除

---

#### 2.5 测试场景 4: PM2 定时重启

**目的**: 验证生产环境下的定时重启不会丢失消息

**步骤**:
1. 使用 PM2 启动（配置 daily restart）:
   ```bash
   bun run pm2:start
   ```

2. 在重启时间点（如 4:00 AM）前后发送消息:
   - 3:59:50 - 发送消息 A
   - 4:00:05 - 发送消息 B（重启后）

3. 监控日志:
   ```bash
   tail -f logs/bot-out.log | grep -E "\[Recovery\]|\[PM2\]"
   ```

**预期行为**:
- ✅ 消息 A 在重启前完成处理，或被 Recovery 恢复
- ✅ 消息 B 在重启后正常处理
- ✅ 两条消息都有正确的响应
- ✅ 没有消息丢失或重复

---

### 3. 压力测试（可选）

#### 3.1 并发消息测试

**目的**: 验证高并发下的消息顺序

**脚本**: `test-concurrent-messages.sh`
```bash
#!/bin/bash

# 快速发送 10 条消息
for i in {1..10}; do
  echo "发送消息 $i"
  # 使用飞书 API 或 Webhook 发送消息
  # curl -X POST "https://open.feishu.cn/..." ...
  sleep 0.5
done

echo "等待所有响应..."
sleep 30

# 检查是否有重复或错误顺序
```

**预期行为**:
- ✅ 所有 10 条消息都有响应
- ✅ 没有重复响应
- ✅ 响应顺序正确（或至少内容匹配）

---

### 4. 回归测试清单

每次修改相关代码后，运行以下测试：

```bash
# 1. 单元测试
bun test src/session/__tests__/message-order.test.ts
bun test src/session/__tests__/recovery.test.ts
bun test src/session/__tests__/session.test.ts

# 2. 集成测试（至少测试场景 1 和 2）
# 手动执行测试场景 1 和 2

# 3. 检查日志标记
tail -f logs/bot-out.log | grep -E "pendingRecovery|Clearing stale"
```

---

## 监控和告警

### 日志标记

**成功的 Recovery**:
```
[Recovery] 🧹 Clearing stale pendingRecovery flag for answered session ...
[Recovery] ✅ Session recovered
```

**异常情况** (需要告警):
```
[Recovery] ❌ Failed to recover session
[Recovery] 📊 Done: X recovered, Y failed, Z skipped
```

### Prometheus 指标 (建议添加)

```typescript
// src/session/recovery.ts
recovery_sessions_detected_total{status="unanswered"}
recovery_sessions_recovered_total{status="success|failed"}
recovery_stale_flags_cleared_total
```

---

## 故障排查

### 问题: 消息被重复处理

**症状**:
- 用户收到两条相同的响应
- 日志显示同一个 session 被处理两次

**检查**:
```bash
# 检查 session 文件
cat data/memory/sessions/feishu-xxx.json | jq '.pendingRecovery, .messages[-2:]'

# 检查日志
grep "Recovering session feishu-xxx" logs/bot-out.log
```

**修复**: 确保 `pendingRecovery` 在 AI 响应后立即清除（已在修复中实现）

---

### 问题: 消息顺序混乱

**症状**:
- 响应内容与引用的消息不匹配
- 用户说 "B"，Bot 回复 "关于 A..."

**检查**:
```bash
# 检查 session 消息顺序
cat data/memory/sessions/feishu-xxx.json | jq '.messages[] | {role, content, timestamp}'

# 检查 replay 逻辑
grep "Replay conversation history" logs/bot-out.log
```

**修复**: 确保每个消息的 timestamp 正确，replay 逻辑按时间顺序（已在代码中实现）

---

## 持续改进建议

### 短期（1-2 周）
1. ✅ 添加消息顺序测试（已完成）
2. ⏸️ 添加 Prometheus 指标
3. ⏸️ 设置告警规则

### 中期（1 个月）
1. ⏸️ 实现分布式锁（防止多实例并发 recovery）
2. ⏸️ 添加消息去重机制（message ID 哈希）
3. ⏸️ 优化 replay 性能（缓存 agent context）

### 长期（3 个月）
1. ⏸️ 实现消息追踪系统（端到端追踪）
2. ⏸️ 添加自动恢复测试（集成测试框架）
3. ⏸️ 实现消息顺序保证机制（消息队列）

---

## 总结

**修复的核心改进**:
1. ✅ AI 响应后立即清除 `pendingRecovery` 标志
2. ✅ Recovery 跳过已响应的 session
3. ✅ 清除历史遗留的过时 `pendingRecovery` 标志
4. ✅ 完整的测试覆盖

**测试策略**:
- 单元测试: 40+ 测试，覆盖所有场景
- 集成测试: 4 个关键场景，手动验证
- 压力测试: 并发消息测试
- 监控: 日志标记 + Prometheus 指标

**预期效果**:
- ✅ 不再重复处理已响应的消息
- ✅ 消息顺序正确，回复内容匹配
- ✅ 重启恢复可靠，不丢失消息
- ✅ 生产环境稳定运行
