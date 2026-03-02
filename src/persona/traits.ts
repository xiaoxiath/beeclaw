/**
 * Psychological Traits Module
 *
 * Implements trait-driven personality modeling for AIEOS
 */

import type { MBTI, OCEAN, LinguisticStyle, TraitsProfile, Motivation } from './types';

// ============================================================
// MBTI Utilities
// ============================================================

/**
 * MBTI dimension descriptions
 */
export const MBTI_DIMENSIONS = {
  E_I: {
    E: 'Extroversion - 从外部世界获取能量',
    I: 'Introversion - 从内心世界获取能量',
  },
  S_N: {
    S: 'Sensing - 关注具体事实和细节',
    N: 'Intuition - 关注模式和可能性',
  },
  T_F: {
    T: 'Thinking - 基于逻辑做决策',
    F: 'Feeling - 基于价值观做决策',
  },
  J_P: {
    J: 'Judging - 偏好结构和计划',
    P: 'Perceiving - 偏好灵活和开放',
  },
} as const;

/**
 * Parse MBTI type into dimensions
 */
export function parseMBTI(mbti: MBTI): {
  ei: 'E' | 'I';
  sn: 'S' | 'N';
  tf: 'T' | 'F';
  jp: 'J' | 'P';
} {
  return {
    ei: mbti[0] as 'E' | 'I',
    sn: mbti[1] as 'S' | 'N',
    tf: mbti[2] as 'T' | 'F',
    jp: mbti[3] as 'J' | 'P',
  };
}

/**
 * Get MBTI description
 */
export function getMBTIDescription(mbti: MBTI): string {
  const dims = parseMBTI(mbti);
  const descriptions: string[] = [];

  descriptions.push(MBTI_DIMENSIONS.E_I[dims.ei]);
  descriptions.push(MBTI_DIMENSIONS.S_N[dims.sn]);
  descriptions.push(MBTI_DIMENSIONS.T_F[dims.tf]);
  descriptions.push(MBTI_DIMENSIONS.J_P[dims.jp]);

  return descriptions.join('; ');
}

/**
 * Generate system prompt modifier based on MBTI
 */
export function mbtiToPromptModifier(mbti: MBTI): string {
  const dims = parseMBTI(mbti);
  const modifiers: string[] = [];

  // E vs I
  if (dims.ei === 'I') {
    modifiers.push('倾向于深思熟虑后再回应，不急于表达');
  } else {
    modifiers.push('倾向于主动交流，通过对话思考');
  }

  // S vs N
  if (dims.sn === 'N') {
    modifiers.push('关注大局和可能性，喜欢探索创新方案');
  } else {
    modifiers.push('关注具体事实和细节，偏好实用可行的方案');
  }

  // T vs F
  if (dims.tf === 'T') {
    modifiers.push('决策时优先考虑逻辑和客观分析');
  } else {
    modifiers.push('决策时考虑他人感受和价值观');
  }

  // J vs P
  if (dims.jp === 'J') {
    modifiers.push('偏好有计划地完成任务，重视截止日期');
  } else {
    modifiers.push('保持灵活性，适应变化，不拘泥于计划');
  }

  return modifiers.join('。') + '。';
}

// ============================================================
// OCEAN (Big Five) Utilities
// ============================================================

/**
 * Default OCEAN profile for a helpful AI assistant
 */
export const DEFAULT_OCEAN: OCEAN = {
  openness: 0.8,        // High openness - curious and creative
  conscientiousness: 0.85, // High conscientiousness - reliable and organized
  extraversion: 0.5,    // Balanced - neither too outgoing nor too reserved
  agreeableness: 0.7,   // Moderately agreeable - cooperative but can push back
  neuroticism: 0.2,     // Low neuroticism - emotionally stable
};

/**
 * OCEAN trait descriptions
 */
export const OCEAN_DESCRIPTIONS = {
  openness: {
    high: '高度开放：富有想象力、好奇心强、欣赏艺术、追求新奇体验',
    low: '较低开放：务实、专注常规、偏好熟悉的事物',
  },
  conscientiousness: {
    high: '高度尽责：自律、有组织、可靠、目标导向、深思熟虑',
    low: '较低尽责：灵活、随性、可能冲动、不那么注重计划',
  },
  extraversion: {
    high: '高度外向：精力充沛、善于社交、积极、喜欢刺激',
    low: '较低外向：内敛、独立、偏好独处、思考深度',
  },
  agreeableness: {
    high: '高度宜人：信任他人、乐于助人、合作、富有同情心',
    low: '较低宜人：竞争性、怀疑性、直接、不易妥协',
  },
  neuroticism: {
    high: '较高神经质：敏感、易焦虑、情绪波动较大',
    low: '较低神经质：情绪稳定、冷静、压力下保持镇定',
  },
} as const;

/**
 * Get OCEAN trait level
 */
export function getOCEANLevel(trait: keyof OCEAN, value: number): 'high' | 'medium' | 'low' {
  if (value >= 0.66) return 'high';
  if (value >= 0.33) return 'medium';
  return 'low';
}

/**
 * Get description for OCEAN trait
 */
export function getOCEANDescription(trait: keyof OCEAN, value: number): string {
  const level = getOCEANLevel(trait, value);
  if (level === 'medium') {
    const high = OCEAN_DESCRIPTIONS[trait].high;
    const low = OCEAN_DESCRIPTIONS[trait].low;
    return `平衡水平：介于 "${low.split('：')[0]}" 和 "${high.split('：')[0]}" 之间`;
  }
  return OCEAN_DESCRIPTIONS[trait][level === 'high' ? 'high' : 'low'];
}

/**
 * Generate system prompt modifier based on OCEAN
 */
export function oceanToPromptModifier(ocean: OCEAN): string {
  const modifiers: string[] = [];

  // Openness
  if (ocean.openness >= 0.7) {
    modifiers.push('积极探索新想法和可能性，富有创造力');
  } else if (ocean.openness <= 0.3) {
    modifiers.push('专注于实用和已验证的方法');
  }

  // Conscientiousness
  if (ocean.conscientiousness >= 0.7) {
    modifiers.push('严谨细致，注重质量和完成度');
  } else if (ocean.conscientiousness <= 0.3) {
    modifiers.push('灵活应对，适应变化');
  }

  // Extraversion
  if (ocean.extraversion >= 0.7) {
    modifiers.push('交流积极主动，善于引导对话');
  } else if (ocean.extraversion <= 0.3) {
    modifiers.push('深思熟虑后再回应，不过度主动');
  }

  // Agreeableness
  if (ocean.agreeableness >= 0.7) {
    modifiers.push('友善合作，乐于助人');
  } else if (ocean.agreeableness <= 0.3) {
    modifiers.push('直接坦率，敢于提出不同意见');
  }

  // Neuroticism (inverse for stability)
  if (ocean.neuroticism <= 0.3) {
    modifiers.push('情绪稳定，压力下保持冷静');
  } else if (ocean.neuroticism >= 0.7) {
    modifiers.push('对用户情绪敏感，共情能力强');
  }

  return modifiers.join('；') + '。';
}

// ============================================================
// Linguistic Style Utilities
// ============================================================

/**
 * Default linguistic style for a helpful AI assistant
 */
export const DEFAULT_LINGUISTIC_STYLE: LinguisticStyle = {
  formality: 0.3,      // Slightly informal - friendly but not too casual
  humor: 0.3,          // Moderate humor - appropriate but not excessive
  directness: 0.7,     // Fairly direct - clear and concise
  verbosity: 0.4,      // Moderately concise - not too brief or verbose
  empathy: 0.6,        // Moderately empathetic - understanding but objective
  technicalDepth: 0.7, // Technical - detailed explanations when appropriate
};

/**
 * Generate system prompt modifier based on linguistic style
 */
export function linguisticStyleToPromptModifier(style: LinguisticStyle): string {
  const modifiers: string[] = [];

  // Formality
  if (style.formality >= 0.7) {
    modifiers.push('使用正式、专业的语言风格');
  } else if (style.formality <= 0.3) {
    modifiers.push('使用轻松、自然的日常语言');
  }

  // Humor
  if (style.humor >= 0.7) {
    modifiers.push('可以适当使用幽默来活跃气氛');
  } else if (style.humor <= 0.2) {
    modifiers.push('保持严肃专业的语气');
  }

  // Directness
  if (style.directness >= 0.7) {
    modifiers.push('直接表达观点，不绕弯子');
  } else if (style.directness <= 0.3) {
    modifiers.push('委婉表达，考虑对方感受');
  }

  // Verbosity
  if (style.verbosity >= 0.7) {
    modifiers.push('详细解释，提供充分的背景信息');
  } else if (style.verbosity <= 0.3) {
    modifiers.push('简洁明了，直击要点');
  }

  // Empathy
  if (style.empathy >= 0.7) {
    modifiers.push('关注用户情绪，表达理解和支持');
  } else if (style.empathy <= 0.3) {
    modifiers.push('保持客观中立，专注于事实');
  }

  // Technical depth
  if (style.technicalDepth >= 0.7) {
    modifiers.push('使用专业术语，深入技术细节');
  } else if (style.technicalDepth <= 0.3) {
    modifiers.push('用通俗易懂的方式解释复杂概念');
  }

  return modifiers.join('；') + '。';
}

// ============================================================
// Complete Traits Profile Utilities
// ============================================================

/**
 * Default traits profile
 */
export const DEFAULT_TRAITS_PROFILE: TraitsProfile = {
  mbti: 'INTJ',
  ocean: DEFAULT_OCEAN,
  linguisticStyle: DEFAULT_LINGUISTIC_STYLE,
  motivation: {
    primary: ['帮助用户达成目标', '持续学习和成长'],
    secondary: ['提供高质量的建议', '建立信任关系'],
    avoided: ['提供不完整的信息', '做出不可靠的承诺'],
  },
};

/**
 * Generate complete system prompt modifier from traits
 */
export function traitsToPromptModifier(traits: TraitsProfile): string {
  const sections: string[] = [];

  sections.push('## 心理特质与行为风格\n');

  if (traits.mbti) {
    sections.push(`### 人格类型: ${traits.mbti}`);
    sections.push(mbtiToPromptModifier(traits.mbti));
    sections.push('');
  }

  if (traits.ocean) {
    sections.push('### 性格特质');
    sections.push(oceanToPromptModifier(traits.ocean));
    sections.push('');
  }

  if (traits.linguisticStyle) {
    sections.push('### 语言风格');
    sections.push(linguisticStyleToPromptModifier(traits.linguisticStyle));
    sections.push('');
  }

  if (traits.motivation) {
    sections.push('### 核心动机');
    if (traits.motivation.primary.length > 0) {
      sections.push(`主要动机: ${traits.motivation.primary.join('、')}`);
    }
    if (traits.motivation.secondary.length > 0) {
      sections.push(`次要动机: ${traits.motivation.secondary.join('、')}`);
    }
    if (traits.motivation.avoided.length > 0) {
      sections.push(`避免: ${traits.motivation.avoided.join('、')}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Validate traits profile
 */
export function validateTraitsProfile(traits: Partial<TraitsProfile>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (traits.mbti && !MBTI_DIMENSIONS) {
    errors.push(`Invalid MBTI type: ${traits.mbti}`);
  }

  if (traits.ocean) {
    for (const [key, value] of Object.entries(traits.ocean)) {
      if (typeof value !== 'number' || value < 0 || value > 1) {
        errors.push(`OCEAN trait ${key} must be between 0 and 1`);
      }
    }
  }

  if (traits.linguisticStyle) {
    for (const [key, value] of Object.entries(traits.linguisticStyle)) {
      if (typeof value !== 'number' || value < 0 || value > 1) {
        errors.push(`Linguistic style ${key} must be between 0 and 1`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
