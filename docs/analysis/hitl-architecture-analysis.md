# HITL（Human-in-the-Loop）系统架构说明

## 📋 当前 HITL 触发机制

### 1. 工具主动请求确认

工具执行时返回 `needsConfirmation: true`，Agent 自动暂停并显示确认卡片。

**触发方式**：
```typescript
// 在工具执行器中
return {
  success: false,
  needsConfirmation: true,
  riskLevel: 'high',  // low | medium | high | critical
  confirmationMessage: '即将执行危险操作',
  timeoutMs: 60000,  // 可选：超时时间
};
```

**效果**：
- 显示确认卡片：`[✅ 批准执行] [❌ 拒绝操作]`
- Agent 暂停执行，等待用户决策
- 用户点击按钮后，Agent 继续执行

**使用场景**：
- 执行高风险操作（删除文件、执行 shell 命令）
- 不可逆操作
- 需要明确授权的操作

### 2. 工具主动请求用户输入

工具执行时返回 `needsUserInput: true`，Agent 暂停并显示输入卡片。

**触发方式**：
```typescript
// 在工具执行器中
return {
  success: false,
  needsUserInput: true,
  question: '请选择操作类型',
  options: ['选项1', '选项2', '选项3'],
  inputType: 'choice',  // text | choice | multi_choice | confirmation
  context: '需要知道您的偏好',
};
```

**效果**：
- 显示输入卡片（文本框/下拉菜单/确认按钮）
- Agent 暂停执行，等待用户输入
- 用户提交后，Agent 继续处理

**使用场景**：
- 缺少必要参数
- 需要用户选择方案
- 需要澄清意图

### 3. Agent 主动询问用户

Agent 调用 `ask_user_question` 工具主动请求信息。

**调用方式**：
```typescript
// Agent 决定调用工具
{
  name: 'ask_user_question',
  parameters: {
    question: '您希望使用哪种方案？',
    options: ['方案A（快速）', '方案B（安全）'],
    inputType: 'choice',
    context: '有两种方案可选',
  }
}
```

**效果**：
- 显示输入卡片
- Agent 等待用户响应
- 用户回复后，Agent 继续推理

**使用场景**：
- Agent 遇到歧义
- Agent 需要用户偏好信息
- Agent 需要用户做决策

## 🎯 架构分析

### 当前架构的优势

1. **灵活性高**
   - 工具可以自主决定是否需要确认
   - Agent 可以主动请求信息
   - 支持多种交互类型

2. **解耦良好**
   - 工具执行 → 返回标志
   - Agent → 处理 HITL 逻辑
   - 渲染器 → 显示卡片
   - 回调处理器 → 处理用户响应

3. **易于扩展**
   - 添加新的交互类型很容易
   - 可以自定义风险等级
   - 可以设置超时

### 当前架构的不足

1. **缺少声明式配置**
   - 需要在工具代码中硬编码确认逻辑
   - 风险等级难以动态调整
   - 无法通过配置文件控制

2. **缺少最佳实践指导**
   - Agent 不知道何时应该使用 HITL
   - 没有统一的交互规范
   - 缺少示例和模板

3. **缺少自动风险评估**
   - 所有确认都需要手动标记
   - 无法根据参数自动判断风险
   - 缺少智能化的风险分级

## 💡 改进建议

### 方案 1: 创建 HITL Skill（推荐）

创建一个 skill 来指导 Agent 如何使用 HITL。

**优势**：
- 提供 HITL 使用指南
- 包含最佳实践和示例
- 指导 Agent 何时使用确认/询问
- 不改变现有架构

**示例**：
```markdown
---
name: human-in-the-loop
description: Human-in-the-Loop interaction best practices
maturity: mature
---

# Human-in-the-Loop Interaction Guide

## When to Request Confirmation

Always request user confirmation for:
1. **Destructive operations**: Deleting files, dropping databases
2. **Irreversible actions**: Sending emails, deploying to production
3. **High-risk commands**: Shell execution with sudo
4. **Sensitive data access**: Reading credentials, personal data

## How to Use

### For Tool Developers

Return confirmation request in tool result:

```typescript
return {
  success: false,
  needsConfirmation: true,
  riskLevel: 'high',
  confirmationMessage: 'About to delete all temporary files',
};
```

### For Agent

Use `ask_user_question` when:
- Information is ambiguous
- Multiple valid approaches exist
- User preference matters

Example:
```json
{
  "name": "ask_user_question",
  "parameters": {
    "question": "Which approach do you prefer?",
    "options": ["Fast (riskier)", "Safe (slower)"],
    "inputType": "choice"
  }
}
```
```

### 方案 2: 添加确认配置系统

在配置文件中声明哪些工具需要确认。

**优势**：
- 无需修改工具代码
- 可以动态调整
- 支持环境变量覆盖

**示例配置**：
```json
{
  "hitl": {
    "confirmations": {
      "shell_exec": {
        "enabled": true,
        "riskLevel": "high",
        "conditions": {
          "command": "rm -rf|sudo|chmod"
        }
      },
      "file_write": {
        "enabled": true,
        "riskLevel": "medium",
        "conditions": {
          "path": "/etc/|/usr/"
        }
      }
    }
  }
}
```

**实现逻辑**：
```typescript
// 在 agent 执行工具前
const confirmationConfig = getConfirmationConfig(toolName, params);
if (confirmationConfig.enabled) {
  return {
    success: false,
    needsConfirmation: true,
    riskLevel: confirmationConfig.riskLevel,
    confirmationMessage: `Tool ${toolName} requires confirmation`,
  };
}
```

### 方案 3: 智能风险评估（高级）

使用 FastLLMJudge 自动评估工具风险。

**优势**：
- 无需手动配置
- 根据上下文动态评估
- 更智能的决策

**示例**：
```typescript
// 在工具执行前
const riskAssessment = await fastLLMJudge.judge({
  taskName: 'tool-risk-assessment',
  promptTemplate: `Assess the risk level of this tool call:
    Tool: {toolName}
    Parameters: {params}
    Context: {context}

    Risk levels: low, medium, high, critical`,
  promptVariables: { toolName, params, context },
  validateOutput: (output) => ['low', 'medium', 'high', 'critical'].includes(output),
  defaultValue: 'medium',
});

if (riskAssessment === 'critical' || riskAssessment === 'high') {
  return {
    success: false,
    needsConfirmation: true,
    riskLevel: riskAssessment,
  };
}
```

## 📊 对比分析

| 方案 | 实现难度 | 灵活性 | 可维护性 | 推荐度 |
|------|---------|--------|---------|--------|
| 创建 HITL Skill | ⭐ 简单 | ⭐⭐⭐ 高 | ⭐⭐⭐ 高 | ⭐⭐⭐⭐⭐ |
| 确认配置系统 | ⭐⭐ 中等 | ⭐⭐ 中 | ⭐⭐⭐ 高 | ⭐⭐⭐⭐ |
| 智能风险评估 | ⭐⭐⭐ 困难 | ⭐⭐⭐⭐ 很高 | ⭐⭐ 中 | ⭐⭐⭐ |
| 当前架构（无改进） | - | ⭐⭐ 中 | ⭐ 低 | ⭐⭐ |

## 🎯 最终建议

**推荐方案：组合方案 1 + 方案 2**

1. **立即实施**：创建 HITL Skill
   - 提供 HITL 使用指南
   - 包含最佳实践
   - 无需修改代码

2. **中期实施**：添加确认配置系统
   - 支持配置驱动的确认规则
   - 减少硬编码
   - 提高可维护性

3. **长期考虑**：智能风险评估
   - 使用 FastLLMJudge 自动评估
   - 根据上下文动态调整
   - 需要更多测试和调优

## 🚀 下一步行动

1. ✅ 创建 `skills/interaction/human-in-the-loop.md`
2. ⏳ 添加确认配置系统到 `beeclaw.json`
3. ⏳ 为高风险工具添加配置规则
4. ⏳ 测试和优化交互流程

---

**总结**：HITL 不需要做成新工具（`ask_user_question` 已经是工具），但应该创建 Skill 来指导 Agent 使用，并添加配置系统来管理确认规则。
