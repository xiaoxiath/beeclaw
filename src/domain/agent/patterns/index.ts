/**
 * Agent Patterns - 控制模式集合
 *
 * 提供多种 Agent 控制模式，根据任务特征自动选择最佳模式：
 * - Direct: 简单问题直接回答
 * - ReAct: 标准工具调用循环
 * - Plan-Execute: 复杂任务规划执行
 * - Reflective: 高质量输出反思改进
 */

// Plan-and-Execute Pattern
export {
  PlanAndExecutePattern,
  getPlanExecutePattern,
  resetPlanExecutePattern,
  type Plan,
  type PlanStep,
  type PlanExecutionResult,
} from './plan-and-execute';

// Reflective Loop Pattern
export {
  ReflectiveLoopPattern,
  getReflectiveLoopPattern,
  resetReflectiveLoopPattern,
  DEFAULT_REFLECTIVE_CONFIG,
  type QualityEvaluation,
  type ReflectiveConfig,
} from './reflective-loop';

// Pattern Selector
export {
  PatternSelector,
  getPatternSelector,
  resetPatternSelector,
  DEFAULT_SELECTOR_CONFIG,
  type AgentPattern,
  type TaskFeatures,
  type PatternSelectionResult,
  type PatternSelectorConfig,
} from './pattern-selector';
