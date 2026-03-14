# Cookbook 改进 TODO

## 问题

当前 Cookbook 案例存在严重的设计问题：

### ❌ 错误的方式（当前）
- 让用户手动创建文件
- 让用户手动编辑配置
- 让用户理解技术细节
- 像"开发者文档"而不是"用户手册"

### ✅ 正确的方式（目标）
- 用户通过**对话**告诉 Beeclaw 需求
- Beeclaw 帮用户完成任务
- 用户不需要了解技术细节
- 像"AI 助手使用手册"

---

## 已修改 ✅

### 基础案例
- ✅ `basic/first-skill.md` - 通过对话创建技能（5分钟）
- ✅ `basic/memory-workflow.md` - 通过对话管理记忆（10分钟）
- ✅ `cookbook/README.md` - 更新说明和结构

---

## 待修改 📝

### 基础案例
- [ ] `basic/research-task.md`
  - **问题**: 让用户配置搜索 API、手动执行工具
  - **改进**: 用户说"帮我研究XXX"，Beeclaw 自动完成

### 进阶案例
- [ ] `advanced/subagent-orchestration.md`
  - **问题**: 让用户理解 DAG、手动编排任务
  - **改进**: 用户说"帮我并行做这几件事"，Beeclaw 自动编排

- [ ] `advanced/plugin-development.md`
  - **问题**: 让用户手动创建文件、写代码
  - **改进**: 分成两个案例：
    1. **用户视角**: 通过对话让 Beeclaw 开发插件
    2. **开发者视角**: （保留技术细节）

- [ ] `advanced/proactive-scheduling.md`
  - **问题**: 让用户配置 cron 表达式
  - **改进**: 用户说"每周五下午5点提醒我"，Beeclaw 自动配置

### 集成案例
- [ ] `integration/feishu-bot-deploy.md`
  - **问题**: 让用户手动配置环境变量、启动服务
  - **改进**: 用户说"帮我部署到飞书"，Beeclaw 指导操作

---

## 修改模板

### 标准结构

```markdown
# 案例标题

> X分钟学会通过对话让 Beeclaw 完成 XXX

## 场景

描述用户想解决的真实问题。

## 目标

- ✅ 学会如何与 Beeclaw 对话完成 XXX
- ✅ 理解 Beeclaw 能帮你做什么

---

## 步骤

### 步骤 1：告诉 Beeclaw 你需要什么

```
用户: [自然语言描述需求]
```

**Beeclaw 会**:
1. ✅ 理解需求
2. ✅ 执行操作
3. ✅ 返回结果

**预期回复**:
```
Beeclaw: [响应示例]
```

---

### 步骤 2：验证结果

```
用户: [验证对话]
```

---

## 常见问题

Q: 用户可能遇到的问题
A: Beeclaw 如何解决

---

**预计完成时间**: X分钟
**难度**: ⭐
**标签**: 对话式、自动化
```

---

## 修改原则

1. **用户视角优先**
   - 用户不关心技术实现
   - 用户只关心如何对话完成工作

2. **自然语言交互**
   - 所有操作通过对话完成
   - 避免 CLI 命令、配置文件

3. **展示 AI 能力**
   - Beeclaw 自动理解意图
   - Beeclaw 自动执行任务
   - Beeclaw 主动反馈结果

4. **简化步骤**
   - 从"10个技术步骤"到"3个对话步骤"
   - 从"30分钟"到"10分钟"

---

## 示例对比

### ❌ 错误（当前 research-task.md）

```markdown
## 步骤 1：配置搜索服务

export TAVILY_API_KEY=tvly-xxxxx

## 步骤 2：基础搜索

在 CLI 中执行：
> web_search({"query": "..."})

## 步骤 3：抓取网页

使用 web_fetch 工具...
```

### ✅ 正确（目标）

```markdown
## 步骤 1：告诉 Beeclaw 研究主题

```
用户: 帮我研究"2024年电动汽车市场趋势"，从技术、市场、政策三个角度分析
```

**Beeclaw 会**:
1. ✅ 自动搜索多个维度
2. ✅ 抓取关键内容
3. ✅ 生成研究报告

**预期输出**:
```
Beeclaw: 已完成研究！生成了 2500 字报告：

# 2024年电动汽车市场趋势研究

## 核心发现
...
```
```

---

## 执行计划

### Phase 1: 核心案例（本周）
- [ ] research-task.md（深度研究）
- [ ] proactive-scheduling.md（主动调度）

### Phase 2: 进阶案例（下周）
- [ ] subagent-orchestration.md（子代理）
- [ ] plugin-development.md（插件开发 - 分离用户/开发者）

### Phase 3: 集成案例（后续）
- [ ] feishu-bot-deploy.md（飞书部署）

---

**维护者**: Beeclaw Team
**优先级**: P0
**最后更新**: 2026-03-14
