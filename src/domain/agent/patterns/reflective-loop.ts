/**
 * Reflective Loop Pattern (P1 任务)
 *
 * 质量驱动的反思-修正循环：
 * 1. 评估输出质量
 * 2. 识别改进空间
 * 3. 生成改进版本
 * 4. 迭代直到达标
 *
 * 适用场景：
 * - 代码生成（需要正确性和质量）
 * - 文档编写（需要完整性和清晰度）
 * - 关键任务（需要高质量输出）
 */

import { logger } from '@infra/observability/logger';
import type { Agent } from '../index';

// ---------------------------------------------------------------------------
// 1. 类型定义
// ---------------------------------------------------------------------------

export interface QualityEvaluation {
  score: number; // 0.0 - 1.0
  feedback: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

export interface ReflectiveConfig {
  enabled: boolean;
  maxIterations: number; // 最大反思次数
  qualityThreshold: number; // 质量阈值（0.0 - 1.0）
  autoImprove: boolean; // 是否自动改进
  learningEnabled: boolean; // 是否启用学习
}

export const DEFAULT_REFLECTIVE_CONFIG: ReflectiveConfig = {
  enabled: true,
  maxIterations: 2,
  qualityThreshold: 0.8,
  autoImprove: true,
  learningEnabled: true,
};

// ---------------------------------------------------------------------------
// 2. Reflective Loop 实现
// ---------------------------------------------------------------------------

export class ReflectiveLoopPattern {
  private config: ReflectiveConfig;
  private stats = {
    reflections: 0,
    improvements: 0,
    averageScoreBefore: 0,
    averageScoreAfter: 0,
  };

  constructor(config: Partial<ReflectiveConfig> = {}) {
    this.config = { ...DEFAULT_REFLECTIVE_CONFIG, ...config };
    logger.info('[ReflectiveLoop] Initialized', this.config);
  }

  /**
   * 执行 Reflective Loop 模式
   */
  async execute(
    task: string,
    initialResponse: string,
    agent: Agent
  ): Promise<string> {
    if (!this.config.enabled) {
      return initialResponse;
    }

    logger.info('[ReflectiveLoop] Starting reflective loop', {
      taskLength: task.length,
      responseLength: initialResponse.length,
    });

    let currentResponse = initialResponse;
    let iteration = 0;

    while (iteration < this.config.maxIterations) {
      // 评估当前输出
      const evaluation = await this.evaluateQuality(
        currentResponse,
        task,
        agent
      );

      logger.info('[ReflectiveLoop] Quality evaluation', {
        iteration,
        score: evaluation.score,
        threshold: this.config.qualityThreshold,
        weaknesses: evaluation.weaknesses.length,
      });

      // 如果质量达标，返回
      if (evaluation.score >= this.config.qualityThreshold) {
        logger.info('[ReflectiveLoop] Quality threshold met, returning', {
          finalScore: evaluation.score,
          iterations: iteration,
        });
        return currentResponse;
      }

      // 如果不达标且允许改进，进行改进
      if (this.config.autoImprove && iteration < this.config.maxIterations - 1) {
        logger.info('[ReflectiveLoop] Quality below threshold, improving', {
          currentScore: evaluation.score,
          feedback: evaluation.feedback,
        });

        currentResponse = await this.improve(
          currentResponse,
          evaluation,
          task,
          agent
        );

        this.stats.improvements++;
        iteration++;
        this.stats.reflections++;
      } else {
        // 达到最大迭代次数，返回当前版本
        logger.warn('[ReflectiveLoop] Max iterations reached, returning current version', {
          iterations: iteration,
          finalScore: evaluation.score,
        });
        break;
      }
    }

    // 异步学习（不影响返回）
    if (this.config.learningEnabled) {
      this.learnAsync(task, currentResponse, agent).catch(err =>
        logger.error('[ReflectiveLoop] Background learning failed', err)
      );
    }

    return currentResponse;
  }

  /**
   * 评估输出质量
   */
  private async evaluateQuality(
    response: string,
    task: string,
    agent: Agent
  ): Promise<QualityEvaluation> {
    const criteria = this.getQualityCriteria(task);

    const prompt = `你是一个质量评估专家。请评估以下输出的质量。

任务：${task}

输出：
${response}

评估标准：
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

请严格按照以下 JSON 格式返回（不要包含任何其他文字）：
{
  "score": 0.0-1.0,
  "feedback": "总体反馈（一句话）",
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["缺点1", "缺点2"],
  "suggestions": ["改进建议1", "改进建议2"]
}

评分标准：
- 0.9-1.0: 优秀（几乎完美，无需改进）
- 0.8-0.89: 良好（达标，可以接受）
- 0.7-0.79: 一般（有改进空间）
- 0.6-0.69: 较差（需要改进）
- 0.0-0.59: 不合格（必须重做）`;

    try {
      const evalResponse = await agent.chat(prompt, {
        tools: [],
        pattern: 'direct', // 强制使用 direct 模式，避免递归
      });

      // 提取 JSON
      const jsonMatch = evalResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to extract evaluation JSON');
      }

      const evaluation: QualityEvaluation = JSON.parse(jsonMatch[0]);

      // 验证分数范围
      if (typeof evaluation.score !== 'number' || evaluation.score < 0 || evaluation.score > 1) {
        logger.warn('[ReflectiveLoop] Invalid score, defaulting to 0.7', { evaluation });
        evaluation.score = 0.7;
      }

      return evaluation;
    } catch (error) {
      logger.error('[ReflectiveLoop] Quality evaluation failed', error);

      // 降级：返回默认评估
      return {
        score: 0.75,
        feedback: '评估失败，使用默认分数',
        strengths: ['输出已生成'],
        weaknesses: ['无法评估'],
        suggestions: ['人工审核建议'],
      };
    }
  }

  /**
   * 改进输出
   */
  private async improve(
    currentResponse: string,
    evaluation: QualityEvaluation,
    task: string,
    agent: Agent
  ): Promise<string> {
    const prompt = `请根据质量反馈改进输出。

原任务：${task}

当前输出：
${currentResponse}

质量评估：
- 评分：${evaluation.score}/1.0
- 反馈：${evaluation.feedback}

优点：
${evaluation.strengths.map(s => `- ${s}`).join('\n')}

缺点：
${evaluation.weaknesses.map(w => `- ${w}`).join('\n')}

改进建议：
${evaluation.suggestions.map(s => `- ${s}`).join('\n')}

要求：
1. 保持优点，改进缺点
2. 实施所有改进建议
3. 输出改进后的完整版本（不要标注修改）
4. 确保输出是完整、独立的`;

    const improvedResponse = await agent.chat(prompt, {
      pattern: 'direct', // 强制使用 direct 模式，避免递归
    });

    logger.info('[ReflectiveLoop] Output improved', {
      originalLength: currentResponse.length,
      improvedLength: improvedResponse.length,
      scoreBefore: evaluation.score,
    });

    return improvedResponse;
  }

  /**
   * 获取质量评估标准
   */
  private getQualityCriteria(task: string): string[] {
    const taskLower = task.toLowerCase();

    // 代码生成任务
    if (
      /代码|code|function|class|实现|implement/i.test(taskLower) ||
      /```[\s\S]*```/.test(task)
    ) {
      return [
        '代码正确性（能运行、无语法错误、无逻辑bug）',
        '代码质量（可读性、命名规范、结构清晰）',
        '边界情况处理（输入验证、异常处理）',
        '性能优化（避免不必要的计算、合理的数据结构）',
        '最佳实践（遵循语言/框架的最佳实践）',
      ];
    }

    // 文档编写任务
    if (/文档|document|readme|说明|指南/i.test(taskLower)) {
      return [
        '结构清晰（标题、章节、段落组织合理）',
        '内容完整（覆盖所有必要信息）',
        '表达准确（无歧义、专业术语使用正确）',
        '易于理解（语言简洁、示例充分）',
        '格式规范（Markdown 语法正确）',
      ];
    }

    // 分析报告任务
    if (/分析|报告|总结|review/i.test(taskLower)) {
      return [
        '分析深度（有洞察、非表面描述）',
        '逻辑清晰（因果关系明确）',
        '数据支撑（有事实依据）',
        '可操作性（有明确的建议）',
        '完整性（覆盖所有关键点）',
      ];
    }

    // 通用任务
    return [
      '完成度（是否完全回应了任务）',
      '准确性（信息是否正确）',
      '清晰度（表达是否清楚）',
      '实用性（是否有实际价值）',
    ];
  }

  /**
   * 异步学习（不影响主流程）
   */
  private async learnAsync(
    task: string,
    finalResponse: string,
    agent: Agent
  ): Promise<void> {
    try {
      const prompt = `请总结这次任务的执行经验：

任务：${task}

最终输出：
${finalResponse.slice(0, 500)}...

请提取可复用的经验教训（简洁，1-2 句话）：
1. 什么方法有效？
2. 什么方法无效？
3. 有什么可以改进？`;

      const lessons = await agent.chat(prompt, {
        tools: [],
        pattern: 'direct', // 强制使用 direct 模式，避免递归
      });

      logger.info('[ReflectiveLoop] Learning completed', {
        lessonsLength: lessons.length,
      });

      // 这里可以集成到记忆系统或知识库
      // 例如：await memoryStore.record('lessons', lessons);
    } catch (error) {
      logger.warn('[ReflectiveLoop] Learning failed (non-critical)', error);
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      config: this.config,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<ReflectiveConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('[ReflectiveLoop] Config updated', this.config);
  }
}

// ---------------------------------------------------------------------------
// 3. 单例模式
// ---------------------------------------------------------------------------

let reflectiveInstance: ReflectiveLoopPattern | null = null;

export function getReflectiveLoopPattern(
  config?: Partial<ReflectiveConfig>
): ReflectiveLoopPattern {
  if (!reflectiveInstance) {
    reflectiveInstance = new ReflectiveLoopPattern(config);
  }
  return reflectiveInstance;
}

export function resetReflectiveLoopPattern(): void {
  reflectiveInstance = null;
}
