/**
 * Plan-and-Execute Pattern (P1 任务)
 *
 * 复杂任务的两阶段规划执行模式：
 * 1. Planning: 分解任务为可执行步骤
 * 2. Execution: 逐步执行并支持动态重规划
 *
 * 适用场景：
 * - 多步骤任务（> 4 步）
 * - 需要全局规划的任务
 * - 有依赖关系的复杂流程
 */

import { logger } from '@infra/observability/logger';
import type { Agent } from '../index';

// ---------------------------------------------------------------------------
// 1. 类型定义
// ---------------------------------------------------------------------------

export interface PlanStep {
  id: number;
  description: string;
  tools: string[];
  expectedOutput: string;
  dependencies: number[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
  createdAt: string;
}

export interface PlanExecutionResult {
  plan: Plan;
  finalResult: string;
  success: boolean;
  completedSteps: number;
  totalSteps: number;
}

// ---------------------------------------------------------------------------
// 2. Plan-and-Execute 实现
// ---------------------------------------------------------------------------

export class PlanAndExecutePattern {
  private maxReplans = 2; // 最大重规划次数
  private replanCount = 0;

  /**
   * 执行 Plan-and-Execute 模式
   */
  async execute(task: string, agent: Agent): Promise<string> {
    logger.info('[PlanExecute] Starting Plan-and-Execute pattern', { task });
    this.replanCount = 0;

    try {
      // 阶段 1: 创建初始计划
      const plan = await this.createPlan(task, agent);
      logger.info('[PlanExecute] Plan created', {
        goal: plan.goal,
        steps: plan.steps.length,
      });

      // 阶段 2: 逐步执行
      const executionResult = await this.executePlan(task, plan, agent);

      // 阶段 3: 生成最终报告
      const summary = await this.summarizeResults(executionResult, agent);

      logger.info('[PlanExecute] Execution completed', {
        success: executionResult.success,
        completedSteps: executionResult.completedSteps,
        totalSteps: executionResult.totalSteps,
      });

      return summary;
    } catch (error) {
      logger.error('[PlanExecute] Execution failed', error);

      // 降级：返回错误信息和建议
      return `任务执行遇到问题：${error instanceof Error ? error.message : String(error)}

建议：
1. 尝试简化任务描述
2. 分解为多个小任务
3. 使用标准对话模式`;
    }
  }

  /**
   * 创建执行计划
   */
  private async createPlan(
    task: string,
    agent: Agent,
    completedSteps?: PlanStep[]
  ): Promise<Plan> {
    const historyContext = completedSteps
      ? `\n\n已完成步骤：\n${completedSteps
          .filter(s => s.status === 'completed')
          .map(s => `${s.id}. ${s.description}\n   结果：${s.result}`)
          .join('\n')}`
      : '';

    const prompt = `你是一个任务规划专家。请将以下任务分解为可执行的步骤。

任务：${task}${historyContext}

要求：
1. 每个步骤必须明确、可执行
2. 步骤之间可以有依赖关系（标注依赖的步骤 ID）
3. 控制在 3-7 步
4. 每个步骤应该是原子操作，不可再分
5. 考虑错误处理和备选方案

返回严格的 JSON 格式（不要包含任何其他文字）：
{
  "goal": "任务目标",
  "steps": [
    {
      "id": 1,
      "description": "步骤描述（动词开头，如：读取、分析、生成）",
      "tools": ["tool1", "tool2"],
      "expectedOutput": "预期输出",
      "dependencies": []
    }
  ]
}`;

    try {
      const response = await agent.chat(prompt, {
        tools: [], // 不使用工具，纯规划
      });

      // 提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.error('[PlanExecute] Failed to extract plan JSON from response', {
          responseLength: response.length,
          responsePreview: response.slice(0, 200),
        });
        throw new Error('Failed to extract plan JSON from response');
      }

      const planData = JSON.parse(jsonMatch[0]);

      // 验证计划结构
      if (!planData.goal || !Array.isArray(planData.steps)) {
        logger.error('[PlanExecute] Invalid plan structure', {
          hasGoal: !!planData.goal,
          hasSteps: Array.isArray(planData.steps),
          planData,
        });
        throw new Error('Invalid plan structure');
      }

      // 初始化步骤状态
      const steps: PlanStep[] = planData.steps.map((step: any) => ({
        id: step.id,
        description: step.description,
        tools: step.tools || [],
        expectedOutput: step.expectedOutput || '',
        dependencies: step.dependencies || [],
        status: 'pending' as const,
      }));

      return {
        goal: planData.goal,
        steps,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('[PlanExecute] Failed to create plan', error);

      // 降级：创建简单计划
      return {
        goal: task,
        steps: [
          {
            id: 1,
            description: '执行任务',
            tools: [],
            expectedOutput: '任务完成',
            dependencies: [],
            status: 'pending',
          },
        ],
        createdAt: new Date().toISOString(),
      };
    }
  }

  /**
   * 执行计划
   */
  private async executePlan(
    task: string,
    plan: Plan,
    agent: Agent
  ): Promise<PlanExecutionResult> {
    let completedSteps = 0;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      // 检查依赖
      if (!this.checkDependencies(step, plan)) {
        logger.warn('[PlanExecute] Step dependencies not met, skipping', {
          stepId: step.id,
          dependencies: step.dependencies,
        });
        step.status = 'failed';
        step.result = '依赖步骤未完成';
        continue;
      }

      // 执行步骤
      logger.info('[PlanExecute] Executing step', {
        stepId: step.id,
        description: step.description,
      });

      step.status = 'running';

      try {
        const result = await this.executeStep(step, agent, plan);
        step.result = result;
        step.status = 'completed';
        completedSteps++;

        logger.info('[PlanExecute] Step completed', {
          stepId: step.id,
          resultLength: result.length,
        });
      } catch (error) {
        step.status = 'failed';
        step.result = `执行失败：${error instanceof Error ? error.message : String(error)}`;

        logger.error('[PlanExecute] Step failed', {
          stepId: step.id,
          error,
        });

        // 检查是否需要重规划
        if (this.shouldReplan(step, plan)) {
          const newPlan = await this.replan(task, agent, plan, i);
          if (newPlan) {
            plan = newPlan;
            // 继续执行新计划
          }
        }
      }
    }

    const success = completedSteps === plan.steps.length;

    return {
      plan,
      finalResult: this.buildFinalResult(plan),
      success,
      completedSteps,
      totalSteps: plan.steps.length,
    };
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: PlanStep,
    agent: Agent,
    plan: Plan
  ): Promise<string> {
    // 获取前置步骤的结果
    const previousResults = step.dependencies
      .map(depId => {
        const depStep = plan.steps.find(s => s.id === depId);
        if (!depStep || depStep.status !== 'completed') return null;
        return `步骤 ${depStep.id} (${depStep.description}):\n${depStep.result}`;
      })
      .filter(Boolean)
      .join('\n\n');

    const prompt = `执行以下步骤：

步骤：${step.description}
预期输出：${step.expectedOutput}
${step.tools.length > 0 ? `建议工具：${step.tools.join(', ')}` : ''}

${previousResults ? `前置步骤结果：\n${previousResults}` : ''}

请执行并返回结果。如果遇到问题，说明原因和可能的解决方案。`;

    // 使用 Agent 执行（会自动使用工具）
    const result = await agent.chat(prompt);

    return result;
  }

  /**
   * 检查步骤依赖是否满足
   */
  private checkDependencies(step: PlanStep, plan: Plan): boolean {
    if (step.dependencies.length === 0) return true;

    return step.dependencies.every(depId => {
      const depStep = plan.steps.find(s => s.id === depId);
      return depStep && depStep.status === 'completed';
    });
  }

  /**
   * 判断是否需要重规划
   */
  private shouldReplan(failedStep: PlanStep, plan: Plan): boolean {
    // 检查是否已达到最大重规划次数
    if (this.replanCount >= this.maxReplans) {
      logger.warn('[PlanExecute] Max replan count reached, skipping replan');
      return false;
    }

    // 如果失败步骤有后续步骤，需要重规划
    const hasDependentSteps = plan.steps.some(
      s => s.dependencies.includes(failedStep.id) && s.status === 'pending'
    );

    return hasDependentSteps;
  }

  /**
   * 动态重规划
   */
  private async replan(
    originalTask: string,
    agent: Agent,
    currentPlan: Plan,
    failedStepIndex: number
  ): Promise<Plan | null> {
    this.replanCount++;
    logger.info('[PlanExecute] Triggering replan', {
      replanCount: this.replanCount,
      failedStepIndex,
    });

    try {
      const completedSteps = currentPlan.steps.filter(
        s => s.status === 'completed'
      );

      const newPlan = await this.createPlan(
        originalTask,
        agent,
        completedSteps
      );

      logger.info('[PlanExecute] Replan created', {
        newSteps: newPlan.steps.length,
      });

      return newPlan;
    } catch (error) {
      logger.error('[PlanExecute] Replan failed', error);
      return null;
    }
  }

  /**
   * 构建最终结果
   */
  private buildFinalResult(plan: Plan): string {
    const completedSteps = plan.steps.filter(s => s.status === 'completed');
    const failedSteps = plan.steps.filter(s => s.status === 'failed');

    let result = `## 任务执行报告\n\n`;
    result += `**任务目标**：${plan.goal}\n\n`;
    result += `**执行状态**：${completedSteps.length}/${plan.steps.length} 步骤完成\n\n`;

    result += `### 执行步骤\n\n`;
    for (const step of plan.steps) {
      const status = step.status === 'completed' ? '✅' : '❌';
      result += `${status} **步骤 ${step.id}**：${step.description}\n`;
      if (step.result) {
        result += `   结果：${step.result.slice(0, 200)}${step.result.length > 200 ? '...' : ''}\n`;
      }
    }

    if (failedSteps.length > 0) {
      result += `\n### 失败步骤\n\n`;
      for (const step of failedSteps) {
        result += `- 步骤 ${step.id}：${step.result}\n`;
      }
    }

    return result;
  }

  /**
   * 生成总结报告
   */
  private async summarizeResults(
    executionResult: PlanExecutionResult,
    agent: Agent
  ): Promise<string> {
    const prompt = `任务已完成，请生成简洁的总结报告：

任务目标：${executionResult.plan.goal}

执行状态：
- 完成步骤：${executionResult.completedSteps}/${executionResult.totalSteps}
- 执行结果：${executionResult.success ? '成功' : '部分失败'}

执行详情：
${executionResult.finalResult}

请生成简洁的总结（包含关键成果和下一步建议）。`;

    return await agent.chat(prompt);
  }
}

// ---------------------------------------------------------------------------
// 3. 单例模式
// ---------------------------------------------------------------------------

let planExecuteInstance: PlanAndExecutePattern | null = null;

export function getPlanExecutePattern(): PlanAndExecutePattern {
  if (!planExecuteInstance) {
    planExecuteInstance = new PlanAndExecutePattern();
  }
  return planExecuteInstance;
}

export function resetPlanExecutePattern(): void {
  planExecuteInstance = null;
}
