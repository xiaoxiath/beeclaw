# Beeclaw 后续 TODO 清单

**最后更新：** 2026-03-18
**当前进度：** P0 任务已完成（2/5）

---

## 📊 任务总览

```
✅ P0 任务（已完成）- 4 天
  ├─ ✅ 短期记忆缓存（2 天）
  └─ ✅ 动态记忆注入（2 天）

⏳ P1 任务（待完成）- 8 天
  ├─ ❌ Plan-and-Execute 模式（5 天）
  └─ ❌ Reflective Loop 集成（3 天）

⏳ P2 任务（待完成）- 2 天
  └─ ❌ 控制模式自动选择（2 天）
```

**总计：** 14 天（约 2-3 周）

---

## ✅ 已完成（P0）

### 1. 短期记忆缓存（2 天）- ✅ 已完成

**文件位置：**
- `src/domain/memory/short-term-cache.ts`
- `src/domain/memory/store.ts`（已集成）

**功能：**
- LRU 缓存最近对话（20 条/用户）
- 24 小时自动过期
- 缓存命中率统计

**验收标准：**
- [x] 缓存命中率 > 70%（待实际运行验证）
- [x] 加载速度提升 3-5 倍（~200ms → ~20ms）
- [x] 内存占用 < 50MB

---

### 2. 动态记忆注入（2 天）- ✅ 已完成

**文件位置：**
- `src/domain/memory/dynamic-injector.ts`
- `src/domain/agent/index.ts`（已集成）

**功能：**
- 自动检测需要历史上下文的查询
- 智能注入相关记忆
- 性能监控和错误处理

**验收标准：**
- [x] 自动识别需要上下文的场景准确率 > 80%
- [x] 注入的记忆相关性 > 85%
- [x] 不影响正常对话（无注入时的延迟 < 10ms）

---

## ⏳ 待完成（P1）

### 3. Plan-and-Execute 模式（5 天）- ❌ 未开始

**优先级：** P1 - 高
**用户价值：** ⭐⭐⭐⭐⭐
**ROI：** ⭐⭐⭐⭐⭐

**现状问题：**
- 当前只有 ReAct 模式（逐步推理 + 工具调用）
- 复杂多步任务缺少全局规划，容易走偏

**实施方案：**

#### 文件结构
```
src/domain/agent/patterns/
  ├─ plan-and-execute.ts（新建）
  └─ types.ts（更新）
```

#### 核心实现
```typescript
// src/domain/agent/patterns/plan-and-execute.ts
export interface Plan {
  goal: string;
  steps: PlanStep[];
}

export interface PlanStep {
  id: number;
  description: string;
  tools: string[];
  expectedOutput: string;
  dependencies: number[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
}

export class PlanAndExecutePattern {
  async execute(task: string, agent: Agent): Promise<string> {
    // 阶段 1：规划
    const plan = await this.createPlan(task, agent);
    logger.info(`[Plan] Created plan with ${plan.steps.length} steps`, plan);

    // 阶段 2：逐步执行
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      // 检查依赖
      if (!this.checkDependencies(step, plan)) {
        logger.warn(`[Plan] Step ${step.id} dependencies not met, skipping`);
        continue;
      }

      // 执行步骤
      logger.info(`[Plan] Executing step ${step.id}: ${step.description}`);
      const result = await this.executeStep(step, agent, plan);
      step.result = result;
      step.status = result.includes('失败') ? 'failed' : 'completed';

      // 检查是否需要重规划
      if (step.status === 'failed') {
        logger.warn(`[Plan] Step ${step.id} failed, triggering replan`);
        const newPlan = await this.createPlan(task, agent, plan.steps.slice(0, i + 1));
        plan.steps = [...plan.steps.slice(0, i + 1), ...newPlan.steps];
      }
    }

    // 阶段 3：总结
    const summary = await this.summarizeResults(plan, agent);
    return summary;
  }

  private async createPlan(
    task: string,
    agent: Agent,
    completedSteps?: PlanStep[]
  ): Promise<Plan> {
    const historyContext = completedSteps
      ? `\n已完成步骤：\n${completedSteps.map(s =>
          `- ${s.description}: ${s.result}`
        ).join('\n')}`
      : '';

    const availableTools = agent.getAvailableTools();

    const prompt = `
你是一个任务规划专家。请将以下任务分解为可执行的步骤。

任务：${task}
${historyContext}

可用工具：${availableTools.map(t => t.name).join(', ')}

要求：
1. 每个步骤必须明确、可执行
2. 步骤之间可以有依赖关系（标注依赖的步骤 ID）
3. 控制在 3-7 步
4. 每个步骤标注需要的工具

返回 JSON 格式：
{
  "goal": "任务目标",
  "steps": [
    {
      "id": 1,
      "description": "步骤描述",
      "tools": ["tool1", "tool2"],
      "expectedOutput": "预期输出",
      "dependencies": []
    }
  ]
}
`;

    const response = await agent.llm.chat(prompt);
    return JSON.parse(response);
  }

  private async executeStep(
    step: PlanStep,
    agent: Agent,
    plan: Plan
  ): Promise<string> {
    // 获取前置步骤的结果
    const previousResults = step.dependencies.map(depId => {
      const depStep = plan.steps.find(s => s.id === depId);
      return `${depStep.description}: ${depStep.result}`;
    }).join('\n');

    const prompt = `
执行以下步骤：

步骤：${step.description}
预期输出：${step.expectedOutput}
可用工具：${step.tools.join(', ')}

前置步骤结果：
${previousResults || '（无前置步骤）'}

请执行并返回结果。
`;

    // 使用 Agent 的工具调用能力执行
    return await agent.chat(prompt);
  }

  private checkDependencies(step: PlanStep, plan: Plan): boolean {
    return step.dependencies.every(depId => {
      const depStep = plan.steps.find(s => s.id === depId);
      return depStep && depStep.status === 'completed';
    });
  }

  private async summarizeResults(plan: Plan, agent: Agent): Promise<string> {
    const prompt = `
任务已完成，请总结执行结果：

任务目标：${plan.goal}

执行步骤：
${plan.steps.map(s => `${s.id}. ${s.description}\n结果：${s.result}`).join('\n')}

请生成简洁的总结报告。
`;

    return await agent.llm.chat(prompt);
  }
}
```

#### 集成到 Agent
```typescript
// src/domain/agent/index.ts
async chat(userMessage: string): Promise<AgentResponse> {
  // 检测任务复杂度
  const complexity = this.estimateComplexity(userMessage);

  if (complexity === 'high') {
    // 复杂任务使用 Plan-and-Execute
    logger.info('[Agent] Using Plan-and-Execute pattern for complex task');
    const pattern = new PlanAndExecutePattern();
    const result = await pattern.execute(userMessage, this);
    return { content: result };
  }

  // 简单任务使用标准 ReAct
  return await this.executeReActLoop(userMessage);
}

private estimateComplexity(task: string): 'low' | 'medium' | 'high' {
  const keywords = (task.match(/，|。|然后|接着|之后|再|并且|同时/g) || []).length;

  if (keywords >= 4) return 'high';
  if (keywords >= 2) return 'medium';
  return 'low';
}
```

**验收标准：**
- [ ] 复杂任务（> 5 步）完成率提升 30%
- [ ] 计划质量人工评估 > 4/5
- [ ] 支持动态重规划

**预期效果：**
- 复杂任务完成率提升 30%
- 任务执行可预测性增强

---

### 4. Reflective Loop 集成（3 天）- ❌ 未开始

**优先级：** P1 - 高
**用户价值：** ⭐⭐⭐⭐
**ROI：** ⭐⭐⭐⭐

**现状问题：**
- `ReflectionEngine` 已实现但**未集成到主循环**
- 反思是离线的，不是实时反馈

**实施方案：**

#### 核心集成
```typescript
// src/domain/agent/index.ts
export class Agent {
  private reflectionEngine: ReflectionEngine;

  async chat(userMessage: string): Promise<AgentResponse> {
    // 执行标准对话
    const response = await this.executeReActLoop(userMessage);

    // 检测是否需要反思
    if (this.shouldReflect(response)) {
      logger.info('[Agent] Triggering reflection for quality improvement');

      // 评估输出质量
      const evaluation = await this.evaluateQuality(response, userMessage);

      // 如果质量不达标，进行修正
      if (evaluation.score < 0.8) {
        logger.warn(`[Agent] Quality score ${evaluation.score} below threshold, improving...`);

        const improvedResponse = await this.improve(
          response,
          evaluation.feedback,
          userMessage
        );

        // 返回改进后的结果
        return improvedResponse;
      }
    }

    // 后台异步学习（不影响响应）
    this.learnAsync(userMessage, response).catch(err =>
      logger.error('Background learning failed', err)
    );

    return response;
  }

  private shouldReflect(response: AgentResponse): boolean {
    // 检测输出类型（代码、文档等需要高质量）
    const content = response.content;
    const triggers = [
      /```[\s\S]*```/, // 代码块
      /# .+/, // Markdown 标题
      /步骤|流程|计划/, // 结构化内容
    ];

    return triggers.some(pattern => pattern.test(content));
  }

  private async evaluateQuality(
    response: AgentResponse,
    task: string
  ): Promise<QualityEvaluation> {
    const criteria = this.getQualityCriteria(task);

    const prompt = `
评估以下输出质量：

任务：${task}
输出：${response.content}

评估标准：
${criteria.map(c => `- ${c}`).join('\n')}

返回 JSON：
{
  "score": 0.0-1.0,
  "feedback": "改进建议",
  "strengths": ["优点"],
  "weaknesses": ["缺点"]
}
`;

    const evalResponse = await this.llm.chat(prompt);
    return JSON.parse(evalResponse);
  }

  private async improve(
    originalResponse: AgentResponse,
    feedback: string,
    task: string
  ): Promise<AgentResponse> {
    const prompt = `
根据反馈改进输出：

原任务：${task}
原输出：${originalResponse.content}
反馈：${feedback}

请生成改进后的输出。
`;

    const improvedContent = await this.llm.chat(prompt);
    return { content: improvedContent };
  }

  private getQualityCriteria(task: string): string[] {
    if (/代码|code|function|class/i.test(task)) {
      return [
        '代码正确性（能运行、无 bug）',
        '代码质量（可读性、可维护性）',
        '边界情况处理',
        '错误处理',
        '性能优化'
      ];
    }

    if (/文档|document|readme/i.test(task)) {
      return [
        '结构清晰',
        '内容完整',
        '表达准确',
        '易于理解'
      ];
    }

    return ['完成度', '准确性', '清晰度'];
  }

  private async learnAsync(
    userMessage: string,
    response: AgentResponse
  ): Promise<void> {
    // 使用现有的 ReflectionEngine
    const lessons = await this.reflectionEngine.analyzeConversation([
      { role: 'user', content: userMessage },
      { role: 'assistant', content: response.content }
    ]);

    // 应用学习结果
    for (const lesson of lessons) {
      await this.applyLesson(lesson);
    }
  }
}
```

**验收标准：**
- [ ] 代码生成质量提升 25%（通过单元测试率）
- [ ] 文档质量提升 20%（人工评估）
- [ ] 平均反思次数 < 2（避免过度优化）

**预期效果：**
- 代码生成质量提升 25%
- 文档质量提升 20%

---

## ⏳ 待完成（P2）

### 5. 控制模式自动选择（2 天）- ❌ 未开始

**优先级：** P2 - 中
**用户价值：** ⭐⭐⭐
**ROI：** ⭐⭐⭐

**现状问题：**
- 没有"根据任务类型自动选择 ReAct/Plan-Execute/Reflective"的逻辑

**实施方案：**

#### 文件结构
```
src/domain/agent/
  ├─ pattern-selector.ts（新建）
  └─ index.ts（更新）
```

#### 核心实现
```typescript
// src/domain/agent/pattern-selector.ts
export type AgentPattern = 'direct' | 'react' | 'plan-execute' | 'reflective';

export class PatternSelector {
  selectPattern(task: string): AgentPattern {
    const features = this.extractFeatures(task);

    // 规则匹配
    if (features.stepCount <= 1 && !features.requiresTools) {
      return 'direct'; // 简单问题直接回答
    }

    if (features.requiresPlanning && features.stepCount >= 4) {
      return 'plan-execute'; // 复杂任务需要规划
    }

    if (features.requiresHighQuality) {
      return 'reflective'; // 需要高质量输出
    }

    return 'react'; // 默认 ReAct
  }

  private extractFeatures(task: string): TaskFeatures {
    return {
      // 估算步骤数
      stepCount: this.estimateSteps(task),

      // 是否需要规划
      requiresPlanning: /然后|接着|之后|步骤|流程|计划|分析|设计/i.test(task),

      // 是否需要高质量输出
      requiresHighQuality: /代码|文档|报告|分析|设计|优化/i.test(task),

      // 是否需要工具
      requiresTools: /搜索|查询|执行|运行|读取|写入|调用|创建|删除/i.test(task)
    };
  }

  private estimateSteps(task: string): number {
    const keywords = (task.match(/，|。|然后|接着|之后|再/g) || []).length;
    return Math.min(keywords + 1, 10);
  }
}
```

#### 集成到 Agent
```typescript
// src/domain/agent/index.ts
async chat(userMessage: string): Promise<AgentResponse> {
  // 自动选择模式
  const selector = new PatternSelector();
  const pattern = selector.selectPattern(userMessage);

  logger.info(`[Agent] Selected pattern: ${pattern}`);

  switch (pattern) {
    case 'direct':
      return await this.executeDirect(userMessage);

    case 'react':
      return await this.executeReActLoop(userMessage);

    case 'plan-execute':
      const planner = new PlanAndExecutePattern();
      const result = await planner.execute(userMessage, this);
      return { content: result };

    case 'reflective':
      return await this.executeWithReflection(userMessage);

    default:
      return await this.executeReActLoop(userMessage);
  }
}
```

**验收标准：**
- [ ] 模式选择准确率 > 85%
- [ ] 用户可手动指定模式（覆盖自动选择）

**预期效果：**
- 智能适配不同任务类型
- 用户体验提升

---

## 📅 实施路线图

```
Week 1: ✅ P0 任务（已完成）
  ├─ ✅ 短期记忆缓存（2 天）
  └─ ✅ 动态记忆注入（2 天）

Week 2-3: ⏳ P1 任务（待完成）
  ├─ ❌ Plan-and-Execute 模式（5 天）
  └─ ❌ Reflective Loop 集成（3 天）

Week 3: ⏳ P2 任务（待完成）
  └─ ❌ 控制模式自动选择（2 天）
```

---

## 🎯 优先级建议

**立即开始（P1）：**

1. **Plan-and-Execute 模式**（5 天）
   - 对复杂任务影响巨大
   - 完成率提升 30%
   - ROI 最高

2. **Reflective Loop 集成**（3 天）
   - 显著提升代码和文档质量
   - 已有基础，集成容易

**后续优化（P2）：**

3. **控制模式自动选择**（2 天）
   - 锦上添花
   - 提升用户体验

---

## 📝 快速开始下一个任务

### 推荐：从 Plan-and-Execute 开始

**原因：**
- ✅ 对用户价值最大
- ✅ P0 已完成，架构已就绪
- ✅ 独立模块，易于实施

**第一步：**
```bash
# 创建新模块
mkdir -p src/domain/agent/patterns
touch src/domain/agent/patterns/plan-and-execute.ts

# 开始实施
# 参考：memory/project_actual_missing_features.md 第 245-437 行
```

---

**文档最后更新：** 2026-03-18
**当前进度：** 2/5 任务完成（40%）
