/**
 * Pattern Selector (P2 任务)
 *
 * 智能选择 Agent 控制模式：
 * - direct: 简单问题直接回答
 * - react: 标准工具调用循环
 * - plan-execute: 复杂任务规划执行
 * - reflective: 高质量输出反思改进
 *
 * 选择依据：
 * - 任务复杂度（步骤数）
 * - 任务类型（代码、文档、分析等）
 * - 质量要求（是否需要高质量输出）
 */

import { logger } from '@infra/observability/logger';

// ---------------------------------------------------------------------------
// 1. 类型定义
// ---------------------------------------------------------------------------

export type AgentPattern = 'direct' | 'react' | 'plan-execute' | 'reflective';

export interface TaskFeatures {
  stepCount: number;
  requiresPlanning: boolean;
  requiresHighQuality: boolean;
  requiresTools: boolean;
  taskType: 'code' | 'document' | 'analysis' | 'general';
  complexity: 'low' | 'medium' | 'high';
}

export interface PatternSelectionResult {
  pattern: AgentPattern;
  features: TaskFeatures;
  reasoning: string;
}

export interface PatternSelectorConfig {
  enabled: boolean;
  logSelection: boolean; // 是否记录选择日志
  preferPlanExecute: boolean; // 偏好 Plan-Execute
  qualityThreshold: number; // 触发 Reflective 的阈值
}

export const DEFAULT_SELECTOR_CONFIG: PatternSelectorConfig = {
  enabled: true,
  logSelection: true,
  preferPlanExecute: false,
  qualityThreshold: 0.8,
};

// ---------------------------------------------------------------------------
// 2. Pattern Selector 实现
// ---------------------------------------------------------------------------

export class PatternSelector {
  private config: PatternSelectorConfig;
  private stats = {
    selections: {
      direct: 0,
      react: 0,
      'plan-execute': 0,
      reflective: 0,
    },
    totalSelections: 0,
  };

  constructor(config: Partial<PatternSelectorConfig> = {}) {
    this.config = { ...DEFAULT_SELECTOR_CONFIG, ...config };
    logger.info('[PatternSelector] Initialized', this.config);
  }

  /**
   * 选择最佳模式
   */
  selectPattern(task: string): PatternSelectionResult {
    if (!this.config.enabled) {
      return {
        pattern: 'react',
        features: this.extractFeatures(task),
        reasoning: 'Pattern selector disabled, using default react',
      };
    }

    const features = this.extractFeatures(task);
    const pattern = this.determinePattern(features, task);
    const reasoning = this.explainSelection(pattern, features);

    // 更新统计
    this.stats.selections[pattern]++;
    this.stats.totalSelections++;

    if (this.config.logSelection) {
      logger.info('[PatternSelector] Pattern selected', {
        pattern,
        taskType: features.taskType,
        complexity: features.complexity,
        stepCount: features.stepCount,
        reasoning,
      });
    }

    return { pattern, features, reasoning };
  }

  /**
   * 提取任务特征
   */
  private extractFeatures(task: string): TaskFeatures {
    const stepCount = this.estimateSteps(task);
    const taskType = this.detectTaskType(task);
    const complexity = this.estimateComplexity(task, stepCount);

    return {
      stepCount,
      requiresPlanning: this.requiresPlanning(task),
      requiresHighQuality: this.requiresHighQuality(task, taskType),
      requiresTools: this.requiresTools(task),
      taskType,
      complexity,
    };
  }

  /**
   * 确定最佳模式
   */
  private determinePattern(features: TaskFeatures): AgentPattern {
    // 规则 1: 复杂任务使用 Plan-Execute（最高优先级）
    if (
      (features.requiresPlanning && features.stepCount >= 4) ||
      features.complexity === 'high' ||
      this.config.preferPlanExecute
    ) {
      return 'plan-execute';
    }

    // 规则 2: 高质量要求使用 Reflective（次高优先级）
    if (features.requiresHighQuality) {
      return 'reflective';
    }

    // 规则 3: 简单问题直接回答
    if (features.stepCount <= 1 && !features.requiresTools && features.complexity === 'low') {
      return 'direct';
    }

    // 规则 4: 默认使用 ReAct
    return 'react';
  }

  /**
   * 估算步骤数
   */
  private estimateSteps(task: string): number {
    // 统计分隔符和连接词
    const delimiters = (task.match(/，|。|；|、/g) || []).length;
    const connectors = (task.match(/然后|接着|之后|再|并且|同时|以及/g) || []).length;
    const verbs = (task.match(/分析|设计|实现|编写|创建|生成|优化|修改|删除/g) || []).length;

    const estimate = Math.max(delimiters, connectors, verbs) + 1;
    return Math.min(estimate, 10); // 最多 10 步
  }

  /**
   * 检测任务类型
   */
  private detectTaskType(task: string): 'code' | 'document' | 'analysis' | 'general' {
    const taskLower = task.toLowerCase();

    // 代码相关
    if (
      /代码|code|function|class|实现|implement|编写函数|开发|编程/i.test(taskLower) ||
      /```[\s\S]*```/.test(task)
    ) {
      return 'code';
    }

    // 文档相关
    if (
      /文档|document|readme|说明|指南|教程|手册/i.test(taskLower) ||
      /编写.*文档|生成.*说明/i.test(taskLower)
    ) {
      return 'document';
    }

    // 分析相关
    if (
      /分析|报告|总结|review|评估|对比|调研/i.test(taskLower) ||
      /分析.*项目|总结.*经验/i.test(taskLower)
    ) {
      return 'analysis';
    }

    return 'general';
  }

  /**
   * 估算任务复杂度
   */
  private estimateComplexity(
    task: string,
    stepCount: number
  ): 'low' | 'medium' | 'high' {
    // 检查是否涉及多个模块或文件（优先级最高）
    const multiModuleKeywords = /系统|架构|模块|组件|多个|全部|整个/i;
    if (multiModuleKeywords.test(task)) return 'high';

    // 检查步骤数
    if (stepCount >= 5) return 'high';
    if (stepCount >= 3) return 'medium';

    // 检查是否涉及复杂逻辑
    const complexKeywords = /复杂|集成|优化|重构|迁移|升级/i;
    if (complexKeywords.test(task)) return 'medium';

    return 'low';
  }

  /**
   * 判断是否需要规划
   */
  private requiresPlanning(task: string): boolean {
    const planningKeywords = [
      /然后|接着|之后|步骤|流程|计划|安排/i,
      /首先.*其次.*最后/i,
      /第一阶段|第二阶段/i,
      /分析.*然后.*实现/i,
    ];

    return planningKeywords.some(pattern => pattern.test(task));
  }

  /**
   * 判断是否需要高质量输出
   */
  private requiresHighQuality(task: string, taskType: string): boolean {
    // 代码任务通常需要高质量
    if (taskType === 'code') return true;

    // 文档任务需要高质量
    if (taskType === 'document') return true;

    // 明确要求高质量
    const qualityKeywords = /高质量|完美|专业|正式|严格|仔细|精确/i;
    if (qualityKeywords.test(task)) return true;

    // 关键任务
    const criticalKeywords = /重要|关键|核心|紧急|生产|上线/i;
    if (criticalKeywords.test(task)) return true;

    return false;
  }

  /**
   * 判断是否需要工具
   */
  private requiresTools(task: string): boolean {
    const toolKeywords = [
      /搜索|查询|执行|运行|读取|写入/i,
      /调用|创建|删除|修改|更新/i,
      /获取|下载|上传|发送/i,
      /memory_|skill_|web_|file_/i,
    ];

    return toolKeywords.some(pattern => pattern.test(task));
  }

  /**
   * 解释模式选择原因
   */
  private explainSelection(pattern: AgentPattern, features: TaskFeatures): string {
    const reasons: string[] = [];

    switch (pattern) {
      case 'direct':
        reasons.push('简单任务，无需工具');
        reasons.push(`步骤数：${features.stepCount}`);
        break;

      case 'react':
        reasons.push('标准任务，使用工具调用循环');
        if (features.requiresTools) reasons.push('需要工具支持');
        break;

      case 'plan-execute':
        reasons.push('复杂任务，需要全局规划');
        reasons.push(`复杂度：${features.complexity}`);
        reasons.push(`步骤数：${features.stepCount}`);
        break;

      case 'reflective':
        reasons.push('需要高质量输出');
        reasons.push(`任务类型：${features.taskType}`);
        if (features.requiresHighQuality) reasons.push('质量优先');
        break;
    }

    return reasons.join('；');
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      distribution: {
        direct: `${((this.stats.selections.direct / this.stats.totalSelections) * 100 || 0).toFixed(1)}%`,
        react: `${((this.stats.selections.react / this.stats.totalSelections) * 100 || 0).toFixed(1)}%`,
        'plan-execute': `${((this.stats.selections['plan-execute'] / this.stats.totalSelections) * 100 || 0).toFixed(1)}%`,
        reflective: `${((this.stats.selections.reflective / this.stats.totalSelections) * 100 || 0).toFixed(1)}%`,
      },
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<PatternSelectorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('[PatternSelector] Config updated', this.config);
  }
}

// ---------------------------------------------------------------------------
// 3. 单例模式
// ---------------------------------------------------------------------------

let selectorInstance: PatternSelector | null = null;

export function getPatternSelector(
  config?: Partial<PatternSelectorConfig>
): PatternSelector {
  if (!selectorInstance) {
    selectorInstance = new PatternSelector(config);
  }
  return selectorInstance;
}

export function resetPatternSelector(): void {
  selectorInstance = null;
}
