/**
 * AIEOS Protocol Types
 *
 * Type definitions for the AIEOS (Portable AI Personas) protocol
 */

import { z } from 'zod';

// ============================================================
// Psychological Trait Models
// ============================================================

// MBTI Personality Types
export const MBTI_TYPES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
] as const;

export const MBTISchema = z.enum(MBTI_TYPES);

export type MBTI = z.infer<typeof MBTISchema>;

// OCEAN (Big Five) Personality Traits
export const OCEANSchema = z.object({
  openness: z.number().min(0).max(1).describe('开放性 - 好奇心、创造力、新颖体验'),
  conscientiousness: z.number().min(0).max(1).describe('尽责性 - 自律、组织性、可靠性'),
  extraversion: z.number().min(0).max(1).describe('外向性 - 社交性、活力、积极性'),
  agreeableness: z.number().min(0).max(1).describe('宜人性 - 合作性、同理心、信任'),
  neuroticism: z.number().min(0).max(1).describe('神经质 - 情绪稳定性、焦虑倾向'),
});

export type OCEAN = z.infer<typeof OCEANSchema>;

// Linguistic Style
export const LinguisticStyleSchema = z.object({
  formality: z.number().min(0).max(1).default(0.3).describe('正式程度 (0=随意, 1=正式)'),
  humor: z.number().min(0).max(1).default(0.4).describe('幽默程度 (0=严肃, 1=风趣)'),
  directness: z.number().min(0).max(1).default(0.7).describe('直接程度 (0=委婉, 1=直接)'),
  verbosity: z.number().min(0).max(1).default(0.4).describe('冗长程度 (0=简洁, 1=详细)'),
  empathy: z.number().min(0).max(1).default(0.6).describe('同理心表达 (0=客观, 1=情感化)'),
  technicalDepth: z.number().min(0).max(1).default(0.7).describe('技术深度 (0=通俗, 1=专业)'),
});

export type LinguisticStyle = z.infer<typeof LinguisticStyleSchema>;

// Core Motivations
export const MotivationSchema = z.object({
  primary: z.array(z.string()).default([]).describe('主要动机'),
  secondary: z.array(z.string()).default([]).describe('次要动机'),
  avoided: z.array(z.string()).default([]).describe('避免的行为'),
});

export type Motivation = z.infer<typeof MotivationSchema>;

// Complete Traits Profile
export const TraitsProfileSchema = z.object({
  mbti: MBTISchema.optional().describe('MBTI 人格类型'),
  ocean: OCEANSchema.optional().describe('大五人格特质'),
  linguisticStyle: LinguisticStyleSchema.optional().describe('语言风格'),
  motivation: MotivationSchema.optional().describe('核心动机'),
});

export type TraitsProfile = z.infer<typeof TraitsProfileSchema>;

// ============================================================
// AIEOS Standard Files
// ============================================================

// IDENTITY.md - Basic identity
export const IdentitySchema = z.object({
  name: z.string().describe('AI 名称'),
  version: z.string().default('1.0.0').describe('人格版本'),
  created: z.string().describe('创建日期'),
  modified: z.string().describe('最后修改日期'),
  creator: z.string().optional().describe('创建者'),
  description: z.string().optional().describe('简要描述'),
  tags: z.array(z.string()).default([]).describe('标签'),
  baseModel: z.string().optional().describe('基础模型推荐'),
  compatibleModels: z.array(z.string()).default([]).describe('兼容模型列表'),
});

export type Identity = z.infer<typeof IdentitySchema>;

// SOUL.md - Core personality (already exists, add schema)
export const SoulSchema = z.object({
  essence: z.string().describe('核心本质 - 你是谁'),
  values: z.array(z.string()).default([]).describe('核心价值观'),
  communicationStyle: z.string().optional().describe('沟通风格'),
  growthGoals: z.array(z.string()).default([]).describe('成长目标'),
  lessonsLearned: z.array(z.string()).default([]).describe('经验教训'),
  boundaries: z.array(z.string()).default([]).describe('行为边界'),
});

export type Soul = z.infer<typeof SoulSchema>;

// AGENTS.md - Behavior guidelines
export const AgentGuidelinesSchema = z.object({
  taskExecution: z.array(z.string()).default([]).describe('任务执行规则'),
  decisionMaking: z.string().optional().describe('决策逻辑'),
  toolUsage: z.array(z.string()).default([]).describe('工具使用指南'),
  errorHandling: z.string().optional().describe('错误处理方式'),
  escalationRules: z.array(z.string()).default([]).describe('升级规则'),
  prohibitedActions: z.array(z.string()).default([]).describe('禁止行为'),
});

export type AgentGuidelines = z.infer<typeof AgentGuidelinesSchema>;

// USER.md - User profile (already exists, add schema)
export const UserProfileSchema = z.object({
  name: z.string().optional().describe('用户姓名'),
  nickname: z.string().optional().describe('昵称'),
  background: z.string().optional().describe('背景信息'),
  preferences: z.record(z.unknown()).optional().describe('偏好设置'),
  goals: z.array(z.string()).default([]).describe('用户目标'),
  communicationPreferences: z.record(z.unknown()).optional().describe('沟通偏好'),
  contextNotes: z.array(z.string()).default([]).describe('上下文备注'),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// ============================================================
// Complete Persona Package
// ============================================================

export const PersonaPackageSchema = z.object({
  // Metadata
  schema: z.literal('aieos/v1').default('aieos/v1'),
  exportedAt: z.string().describe('导出时间'),
  sourceSystem: z.string().optional().describe('来源系统'),

  // Core files
  identity: IdentitySchema,
  soul: SoulSchema.optional(),
  agents: AgentGuidelinesSchema.optional(),
  user: UserProfileSchema.optional(),

  // Traits
  traits: TraitsProfileSchema.optional(),

  // Additional context
  memories: z.array(z.object({
    category: z.string(),
    content: z.string(),
    importance: z.number().min(0).max(1).optional(),
  })).optional().describe('核心记忆'),

  skills: z.array(z.object({
    name: z.string(),
    description: z.string(),
    triggers: z.array(z.string()).optional(),
  })).optional().describe('技能列表'),
});

export type PersonaPackage = z.infer<typeof PersonaPackageSchema>;

// ============================================================
// Import/Export Options
// ============================================================

export const ExportOptionsSchema = z.object({
  includeMemories: z.boolean().default(true).describe('是否包含记忆'),
  includeSkills: z.boolean().default(true).describe('是否包含技能'),
  includeConversations: z.boolean().default(false).describe('是否包含对话历史'),
  includeGoals: z.boolean().default(true).describe('是否包含目标'),
  format: z.enum(['json', 'markdown', 'tarball']).default('json').describe('导出格式'),
});

export type ExportOptions = z.infer<typeof ExportOptionsSchema>;

export const ImportOptionsSchema = z.object({
  merge: z.boolean().default(false).describe('是否合并而非覆盖'),
  mergeStrategy: z.enum(['keep-existing', 'keep-imported', 'merge-smart']).default('merge-smart'),
  validateOnly: z.boolean().default(false).describe('仅验证不导入'),
});

export type ImportOptions = z.infer<typeof ImportOptionsSchema>;

// ============================================================
// Tool Result Type
// ============================================================

export type PersonaToolResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};
