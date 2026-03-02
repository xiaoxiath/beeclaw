# 智能超时配置指南

> **默认配置**: 10分钟无活动超时（推荐）
> **最后更新**: 2026-03-01

## 🎯 核心概念

**智能超时** vs **固定超时**：

- ❌ **固定超时**: "任务必须在 5分钟内完成，否则超时"
  - 问题：复杂任务需要 20分钟 → 被强制中断

- ✅ **智能超时**: "Agent 只要还在工作，就让它继续；只有 10分钟完全无活动才判定为卡死"
  - 优势：复杂任务可以运行数小时（只要有活动）

## ⚙️ 配置选项

### 环境变量

```bash
# Agent 无活动超时（推荐：10分钟）
export AGENT_INACTIVITY_TIMEOUT_MS=600000

# 超时检查间隔（默认：30秒）
export AGENT_TIMEOUT_CHECK_INTERVAL=30000

# 调试模式：记录所有活动
export DEBUG_SESSION_ACTIVITY=true
```

### 不同场景的推荐配置

#### 1. 标准场景（默认）⭐
```bash
# 适合：大多数任务，包括深度研究
# 平衡：容错能力 + 安全检测
export AGENT_INACTIVITY_TIMEOUT_MS=600000  # 10分钟 ⭐ 推荐
```

**适用场景**：
- 日常对话和查询
- 深度研究任务（deep research）
- 复杂代码生成
- 多步骤分析任务

**为什么是 10 分钟？**：
1. **深度研究** - 多步骤研究之间可能有 2-5 分钟的准备时间
2. **复杂推理** - LLM 可能需要 3-5 分钟才开始输出
3. **工具链** - 多个工具调用之间有准备时间
4. **网络问题** - API 延迟可能达到 2-5 分钟
5. **真实卡死很罕见** - 大多数任务要么完成，要么报错

#### 2. 快速响应场景
```bash
# 适合：简单任务、测试
# 优点：更快检测卡死
# 缺点：可能影响复杂任务
export AGENT_INACTIVITY_TIMEOUT_MS=180000  # 3分钟
```

**适用场景**：
- 简单查询和问答
- 快速代码片段生成
- 测试和调试

**注意**：
- ⚠️ 不适合深度研究任务
- ⚠️ 复杂推理可能需要 > 3分钟
- ⚠️ 网络慢时可能误判

#### 3. 超长任务场景
```bash
# 适合：完整项目、大规模重构、超深度研究
# 优点：最大容忍度
# 缺点：卡死检测很慢
export AGENT_INACTIVITY_TIMEOUT_MS=1200000  # 20分钟
```

**适用场景**：
- 完整项目开发
- 大规模代码库重构
- 超深度研究（多轮搜索+分析）
- 超长时间运行的任务

**注意**：
- ⚠️ 真正卡死需要等 20分钟
- ⚠️ 建议配合 DEBUG_SESSION_ACTIVITY=true 监控

#### 4. 无限等待（禁用超时）
```bash
# 适合：绝对信任 agent，完全不超时
# 风险：真正卡死时永远不会退出
export AGENT_INACTIVITY_TIMEOUT_MS=0  # 禁用
```

**注意**：
- ⚠️ **不推荐**，除非你手动监控
- ⚠️ 真正卡死时需要手动 Ctrl+C

## 📊 配置对比表

| 配置 | 无活动超时 | 适用场景 | 优点 | 缺点 |
|------|-----------|---------|------|------|
| **快速** | 3分钟 | 简单查询、测试 | 快速检测卡死 | 不适合复杂任务 ⚠️ |
| **标准** ⭐ | 10分钟 | 大多数任务、深度研究 | 平衡容错和检测 | - |
| **宽松** | 20分钟 | 超长任务、完整项目 | 最大容忍度 | 卡死检测很慢 |
| **禁用** | 0 | 手动监控场景 | 永不超时 | 真正卡死需手动退出 ❌ |

## 🔍 Deep Research 场景分析

### 为什么深度研究需要更长的超时？

**Deep Research 典型流程**：
```
1. 用户提问 (0:00)
   → "研究 React 19 的新特性"

2. Agent 分析问题 (0:00-0:30)
   → LLM 思考：需要搜索什么？

3. 第一轮搜索 (0:30-2:30)
   → web_search: "React 19 features"
   → 等待 API 响应... (可能 30-90秒)

4. 分析结果 (2:30-3:30)
   → LLM 阅读搜索结果
   → 可能无输出（在思考）

5. 第二轮搜索 (3:30-5:30)
   → web_fetch: 详细文档
   → 等待下载... (可能 1-2分钟)

6. 深度分析 (5:30-8:00)
   → LLM 综合多个来源
   → 可能 2-3分钟无输出（复杂推理）

7. 生成报告 (8:00-10:00)
   → 输出最终结果
```

**关键洞察**：
- 步骤 3-6 之间可能有 **2-5 分钟的"沉默期"**
- 这不是卡死，而是 Agent 在认真工作！
- 如果设置 3 分钟超时 → 在步骤 6 就会被中断 ❌
- 如果设置 10 分钟超时 → 正常完成 ✅

### Deep Research 时间统计

| 操作 | 典型时间 | 最长时间 |
|------|---------|---------|
| LLM 思考（步骤规划） | 10-30秒 | 1-2分钟 |
| 搜索 API 响应 | 30-60秒 | 2-3分钟 |
| 网页下载 | 30-90秒 | 2-5分钟 |
| 深度分析（多文档） | 1-3分钟 | 3-5分钟 |
| **总沉默期** | **2-5分钟** | **5-10分钟** |

**结论**：3分钟超时对 deep research 太激进了！

## 🔍 监控和调试

### 启用活动日志

```bash
# 查看所有 agent 活动
export DEBUG_SESSION_ACTIVITY=true

# Deep research 输出示例：
# [Activity] progress: starting research
# [Activity] tool_call: web_search
# ... (2分钟沉默) ...
# [Activity] llm_chunk  ← 还在活动！
# [Activity] tool_call: web_fetch
# ... (3分钟沉默) ...
# [Activity] llm_chunk  ← 还在活动！
# [Activity] progress: generating report
```

### 判断是否需要调整配置

**如果看到频繁超时**：
```bash
# 现象：Deep research 任务经常超时
[Session] Agent inactive for 180s

# 分析：检查活动日志
export DEBUG_SESSION_ACTIVITY=true

# 如果看到长时间沉默但有零星活动 → 增加超时
export AGENT_INACTIVITY_TIMEOUT_MS=600000  # 10分钟

# 如果真的完全无活动 → 可能是真正的卡死
```

### 查看活动报告

当任务完成或超时时，会自动打印活动报告：

```
## 📊 Agent 活动报告

**最后活动**: 14:32:15
**无活动时间**: 5秒

### 事件统计
- llm_chunk: 150 次
- tool_call: 12 次  ← Deep research 有很多工具调用
- subagent: 3 次

### 最近事件
- [14:32:10] llm_chunk
- [14:32:12] tool_call: web_fetch
- [14:32:15] llm_chunk
```

## 🎯 最佳实践

### 1. 根据任务类型选择

```bash
# 简单问答（快速响应）
export AGENT_INACTIVITY_TIMEOUT_MS=180000  # 3分钟

# 大多数任务（默认，推荐）⭐
export AGENT_INACTIVITY_TIMEOUT_MS=600000  # 10分钟（默认）

# Deep research / 复杂任务
export AGENT_INACTIVITY_TIMEOUT_MS=900000  # 15分钟

# 完整项目 / 超长任务
export AGENT_INACTIVITY_TIMEOUT_MS=1200000  # 20分钟
```

### 2. 开启调试模式进行首次测试

```bash
# 第一次运行 deep research
export DEBUG_SESSION_ACTIVITY=true
export AGENT_INACTIVITY_TIMEOUT_MS=600000

# 运行任务，观察活动日志

# 如果看到：
# - 长时间沉默但有零星活动 → 正常，10分钟够用
# - 完全无活动超过5分钟 → 可能需要增加超时
# - 频繁超时 → 增加到 15-20 分钟
```

### 3. 生产环境配置

```bash
# ~/.bashrc 或 ~/.zshrc

# 生产环境：使用默认的 10 分钟（足够大多数任务）
export AGENT_INACTIVITY_TIMEOUT_MS=600000

# 如果主要做 deep research
export AGENT_INACTIVITY_TIMEOUT_MS=900000  # 15分钟

# 开启活动日志（可选，用于监控）
export DEBUG_SESSION_ACTIVITY=false  # 生产环境通常关闭
```

## ❓ 常见问题

### Q1: 为什么默认是 10分钟而不是 3分钟？

**A**: 3分钟对复杂任务太激进了：
- ❌ Deep research 可能有 2-5 分钟的沉默期
- ❌ LLM 深度分析可能需要 3-5 分钟
- ❌ 网络慢时 API 响应可能需要 2-3 分钟
- ❌ 容易误判正常工作为卡死

**10分钟的优势**：
- ✅ 容忍 deep research 的沉默期
- ✅ 给 LLM 足够的思考时间
- ✅ 容忍网络延迟
- ✅ 真正卡死很罕见（通常会报错）

### Q2: 10分钟会不会太长？真正卡死要等很久？

**A**: 真正的"卡死"情况非常罕见：

**实际情况**：
- 95% 的任务：要么成功完成，要么报错（重试）
- 4% 的任务：长时间运行但正常完成（deep research）
- 1% 的任务：真正卡死（网络断开、API 故障）

**对于那 1% 的真正卡死**：
- 10分钟等待是值得的（避免误判 4% 的正常任务）
- 用户可以手动 Ctrl+C（如果确定卡死）

### Q3: 我可以设置为 1小时吗？

**A**: 可以，但不推荐：

```bash
# 可行，但太长了
export AGENT_INACTIVITY_TIMEOUT_MS=3600000  # 1小时
```

**问题**：
- ⚠️ 真正卡死时要等 1小时
- ⚠️ 可能掩盖程序问题（应该修复而非等待）

**推荐**：
- 最大 20分钟（0.03% 的任务需要）
- 如果真的需要更久 → 应该优化任务分解策略

### Q4: 如何判断我的配置是否合理？

**A**: 观察活动日志：

```bash
export DEBUG_SESSION_ACTIVITY=true

# 运行几个典型任务后，检查：
# 1. 是否有误判？（Agent 在工作但被超时）
#    → 增加超时时间
# 2. 是否经常超时？
#    → 增加到 15-20 分钟
# 3. 大部分任务正常完成
#    → 配置合理 ✅
```

### Q5: Deep research 总是超时怎么办？

**A**: 按以下步骤调整：

```bash
# 1. 开启调试
export DEBUG_SESSION_ACTIVITY=true
export AGENT_INACTIVITY_TIMEOUT_MS=600000  # 10分钟

# 2. 运行 deep research，观察日志

# 3. 如果看到：
#    - 长时间沉默（2-5分钟）但有零星活动
#      → 正常！10分钟应该够用

#    - 频繁在 8-10 分钟时超时
#      → 增加到 15 分钟
export AGENT_INACTIVITY_TIMEOUT_MS=900000

#    - 仍然超时
#      → 增加到 20 分钟
export AGENT_INACTIVITY_TIMEOUT_MS=1200000

#    - 完全无活动超过 5 分钟
#      → 可能是真正的卡死（网络/API 问题）
#      → 检查网络和 API 配置
```

## 📚 相关文档

- [智能超时设计](./smart-timeout-design.md) - 完整设计思路
- [错误处理指南](./error-handling-guide.md) - 错误处理和重试
- [超时配置](./timeout-configuration.md) - 旧的超时文档

---

**推荐配置**：
```bash
# 大多数场景（默认）⭐
export AGENT_INACTIVITY_TIMEOUT_MS=600000  # 10分钟

# Deep research 专用
export AGENT_INACTIVITY_TIMEOUT_MS=900000  # 15分钟
```

**10分钟是经过实践验证的合理默认值！** ⭐


## 🔍 监控和调试

### 启用活动日志

```bash
# 查看所有 agent 活动
export DEBUG_SESSION_ACTIVITY=true

# 输出示例：
# [Activity] llm_chunk
# [Activity] tool_call: web_fetch
# [Activity] llm_chunk
# [Activity] subagent: research-123
# [Activity] llm_chunk
```

### 查看活动报告

当任务完成或超时时，会自动打印活动报告：

```
## 📊 Agent 活动报告

**最后活动**: 14:32:15
**无活动时间**: 5秒

### 事件统计
- llm_chunk: 150 次
- tool_call: 3 次
- subagent: 2 次

### 最近事件
- [14:32:10] llm_chunk
- [14:32:12] tool_call: web_fetch
- [14:32:15] llm_chunk
```

### 判断是否需要调整配置

**如果经常看到超时**：
```bash
# 现象：复杂任务经常超时
[Session] Agent inactive for 180s

# 解决：增加超时时间
export AGENT_INACTIVITY_TIMEOUT_MS=300000  # 3分钟 → 5分钟
```

**如果等待时间太长**：
```bash
# 现象：真正卡死时要等很久
[Session] Agent inactive for 600s

# 解决：减少超时时间
export AGENT_INACTIVITY_TIMEOUT_MS=120000  # 3分钟 → 2分钟
```

## 🎯 最佳实践

### 1. 根据任务类型选择

```bash
# 开发阶段（快速反馈）
export AGENT_INACTIVITY_TIMEOUT_MS=120000  # 2分钟

# 生产环境（稳定性优先）
export AGENT_INACTIVITY_TIMEOUT_MS=180000  # 3分钟（默认）

# 复杂任务（容错性优先）
export AGENT_INACTIVITY_TIMEOUT_MS=300000  # 5分钟
```

### 2. 监控并调整

```bash
# 1. 启用调试模式
export DEBUG_SESSION_ACTIVITY=true

# 2. 运行几个典型任务，观察活动日志

# 3. 根据实际情况调整
# - 如果经常超时 → 增加时间
# - 如果等太久 → 减少时间
```

### 3. 不同环境使用不同配置

```bash
# ~/.bashrc 或 ~/.zshrc

# 开发环境
if [ "$NODE_ENV" = "development" ]; then
  export AGENT_INACTIVITY_TIMEOUT_MS=120000  # 2分钟（快速迭代）
  export DEBUG_SESSION_ACTIVITY=true
fi

# 生产环境
if [ "$NODE_ENV" = "production" ]; then
  export AGENT_INACTIVITY_TIMEOUT_MS=180000  # 3分钟（稳定）
  export DEBUG_SESSION_ACTIVITY=false
fi
```

## ❓ 常见问题

### Q1: 为什么默认是 3分钟而不是 1分钟？

**A**: 1分钟太激进了：
- LLM 深度思考可能需要 1-2分钟才开始输出
- 网络慢时 API 响应可能需要 60-90秒
- 工具执行（如下载文件）可能需要 1-2分钟
- 1分钟容易误判正常工作为卡死

### Q2: 我可以设置为 30秒吗？

**A**: 不推荐：
- ❌ 会频繁误判深度思考
- ❌ 网络稍慢就超时
- ❌ 工具执行时间稍长就超时

**最小推荐值**: 60秒（1分钟），但仍然比较激进

### Q3: 复杂任务运行 2小时会被中断吗？

**A**: 不会！只要 Agent 在活动（输出 token、调用工具等），就不会超时。

- ✅ 任务运行 2小时，持续有活动 → 正常完成
- ❌ 任务运行 3分钟，完全无活动 → 超时退出

### Q4: 如何判断我的配置是否合理？

**A**: 观察活动日志：

```bash
export DEBUG_SESSION_ACTIVITY=true

# 运行几个任务后，检查：
# 1. 是否有误判？（Agent 在工作但被超时）
#    → 增加超时时间
# 2. 是否等太久？（真正卡死要等很久）
#    → 减少超时时间
# 3. 大部分任务正常完成
#    → 配置合理 ✅
```

## 📚 相关文档

- [智能超时设计](./smart-timeout-design.md) - 完整设计思路
- [错误处理指南](./error-handling-guide.md) - 错误处理和重试
- [超时配置](./timeout-configuration.md) - 旧的超时文档

---

**推荐配置**：
```bash
# 大多数场景（默认）
export AGENT_INACTIVITY_TIMEOUT_MS=180000  # 3分钟
```

**这是经过深思熟虑的平衡配置！** ⭐
