/**
 * Enhanced Token Estimator  (P2-#2)
 *
 * 原始实现使用硬编码比例（中文 ~1.5、英文 ~4），对于混合内容偏差较大。
 * 优化方案：
 *  1. 支持注入真实 Tokenizer（tiktoken / 各模型官方 tokenizer）
 *  2. 保留启发式估算作为 fallback，但改进混合内容的加权策略
 *  3. 引入 Provider 级别的校准系数，不同模型家族用不同系数
 *  4. 增加估算结果缓存，避免对同一内容重复计算
 *
 * ⚡ 新增文件 — 不替换 context.ts，而是提供可选增强模块
 */

import type { MultimodalContent } from './types';

// ---------------------------------------------------------------------------
// 1. Tokenizer Provider 接口（依赖注入）
// ---------------------------------------------------------------------------

/**
 * 外部精确 Tokenizer 接口。
 * 实现方只需提供 countTokens 即可。
 */
export interface TokenizerProvider {
  /** 精确计算给定文本的 token 数 */
  countTokens(text: string): number;
  /** 可选：指明此 tokenizer 适用于哪些模型前缀 */
  modelPrefixes?: string[];
}

// 注册表：模型前缀 → TokenizerProvider
const tokenizerRegistry = new Map<string, TokenizerProvider>();
// 默认 tokenizer（全局 fallback）
let defaultTokenizer: TokenizerProvider | null = null;

/**
 * 注册一个精确 Tokenizer。
 * @param provider   tokenizer 实现
 * @param asDefault  是否设为全局默认
 */
export function registerTokenizer(provider: TokenizerProvider, asDefault = false): void {
  if (provider.modelPrefixes) {
    for (const prefix of provider.modelPrefixes) {
      tokenizerRegistry.set(prefix.toLowerCase(), provider);
    }
  }
  if (asDefault || !defaultTokenizer) {
    defaultTokenizer = provider;
  }
}

/**
 * 根据模型名查找最匹配的 Tokenizer。
 */
function resolveTokenizer(model?: string): TokenizerProvider | null {
  if (!model) return defaultTokenizer;

  const lower = model.toLowerCase();
  // 优先精确匹配
  for (const [prefix, provider] of tokenizerRegistry) {
    if (lower.startsWith(prefix) || lower.includes(prefix)) {
      return provider;
    }
  }
  return defaultTokenizer;
}

// ---------------------------------------------------------------------------
// 2. 模型家族校准系数
// ---------------------------------------------------------------------------

/**
 * 不同模型家族的 token 编码效率差异。
 * 系数 > 1 表示该家族对同等内容消耗更多 token。
 */
export interface CalibrationProfile {
  /** 中文字符 → token 比率 (chars per token) */
  chineseRatio: number;
  /** 英文字符 → token 比率 */
  englishRatio: number;
  /** 代码字符 → token 比率 */
  codeRatio: number;
  /** 消息结构 overhead token 数 */
  messageOverhead: number;
}

const CALIBRATION_PROFILES: Record<string, CalibrationProfile> = {
  // cl100k_base (GPT-4, GPT-3.5)
  'gpt': { chineseRatio: 1.4, englishRatio: 4.0, codeRatio: 2.8, messageOverhead: 4 },
  // Claude tokenizer
  'claude': { chineseRatio: 1.6, englishRatio: 4.2, codeRatio: 3.0, messageOverhead: 4 },
  // GLM tokenizer (对中文优化)
  'glm': { chineseRatio: 1.8, englishRatio: 3.5, codeRatio: 2.5, messageOverhead: 3 },
  // MiniMax tokenizer
  'abab': { chineseRatio: 1.5, englishRatio: 3.8, codeRatio: 2.8, messageOverhead: 4 },
  // DeepSeek
  'deepseek': { chineseRatio: 1.6, englishRatio: 4.0, codeRatio: 2.8, messageOverhead: 4 },
  // Moonshot
  'moonshot': { chineseRatio: 1.5, englishRatio: 4.0, codeRatio: 3.0, messageOverhead: 4 },
  // 通用 fallback
  'default': { chineseRatio: 1.5, englishRatio: 4.0, codeRatio: 3.0, messageOverhead: 4 },
};

// 自定义校准
const customCalibrations = new Map<string, CalibrationProfile>();

/**
 * 注册/覆盖某个模型前缀的校准系数。
 */
export function setCalibrationProfile(modelPrefix: string, profile: Partial<CalibrationProfile>): void {
  const base = resolveCalibration(modelPrefix);
  customCalibrations.set(modelPrefix.toLowerCase(), { ...base, ...profile });
}

function resolveCalibration(model?: string): CalibrationProfile {
  if (!model) return CALIBRATION_PROFILES['default'];

  const lower = model.toLowerCase();

  // 自定义优先
  for (const [prefix, profile] of customCalibrations) {
    if (lower.startsWith(prefix) || lower.includes(prefix)) return profile;
  }

  // 内置匹配
  for (const [prefix, profile] of Object.entries(CALIBRATION_PROFILES)) {
    if (prefix !== 'default' && (lower.startsWith(prefix) || lower.includes(prefix))) {
      return profile;
    }
  }

  return CALIBRATION_PROFILES['default'];
}

// ---------------------------------------------------------------------------
// 3. LRU 缓存
// ---------------------------------------------------------------------------

class LRUTokenCache {
  private cache = new Map<string, number>();
  private maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  get(key: string): number | undefined {
    const val = this.cache.get(key);
    if (val !== undefined) {
      // Move to end (most recent)
      this.cache.delete(key);
      this.cache.set(key, val);
    }
    return val;
  }

  set(key: string, value: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

const tokenCache = new LRUTokenCache(500);

/**
 * 清除 token 缓存（测试/调试用）。
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}

// ---------------------------------------------------------------------------
// 4. 增强版 Token 估算
// ---------------------------------------------------------------------------

/**
 * 文本内容分析结果
 */
interface ContentAnalysis {
  chineseChars: number;
  englishChars: number;
  codeChars: number;
  whitespaceChars: number;
  totalChars: number;
}

/**
 * 分析文本内容组成。
 */
function analyzeContent(text: string): ContentAnalysis {
  let chineseChars = 0;
  let codeChars = 0;
  let whitespaceChars = 0;

  for (const char of text) {
    const code = char.charCodeAt(0);
    // CJK 统一汉字 + 扩展A
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF)) {
      chineseChars++;
    }
    // CJK 扩展 B-F (通过长度判断，surrogate pair)
    else if (code >= 0xD800 && code <= 0xDBFF) {
      chineseChars++; // Simplified: treat all surrogates as CJK
    }
    // 日韩字符也按中文比例估算
    else if (
      (code >= 0x3000 && code <= 0x303F) || // CJK 标点
      (code >= 0x3040 && code <= 0x30FF) || // 平假名+片假名
      (code >= 0xAC00 && code <= 0xD7AF)    // 韩文
    ) {
      chineseChars++;
    }
    // 代码特征字符
    else if (/[{}[\]()<>:=;,.!?@#$%^&*+\-/\\|`~]/.test(char)) {
      codeChars++;
    }
    // 空白
    else if (/\s/.test(char)) {
      whitespaceChars++;
    }
  }

  const englishChars = text.length - chineseChars - codeChars - whitespaceChars;

  return {
    chineseChars,
    englishChars: Math.max(0, englishChars),
    codeChars,
    whitespaceChars,
    totalChars: text.length,
  };
}

/**
 * 检测内容是否以代码为主。
 */
function isCodeHeavy(text: string): boolean {
  const codeBlockCount = (text.match(/```/g) || []).length / 2;
  if (codeBlockCount >= 1) {
    // 粗略估计代码块占比
    let codeLength = 0;
    const regex = /```[\s\S]*?```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      codeLength += match[0].length;
    }
    return codeLength / text.length > 0.5;
  }
  return false;
}

/**
 * 增强版 Token 估算。
 *
 * 优先使用注册的精确 Tokenizer，fallback 到基于模型校准的启发式估算。
 *
 * @param text  待估算文本
 * @param model 可选模型名称，用于选择校准系数
 */
export function estimateTokensEnhanced(text: string, model?: string): number {
  if (!text) return 0;

  // 缓存查找
  const cacheKey = `${model || '_'}:${text.length > 200 ? text.slice(0, 200) : text}`;
  const cached = tokenCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result: number;

  // 尝试精确 Tokenizer
  const tokenizer = resolveTokenizer(model);
  if (tokenizer) {
    try {
      result = tokenizer.countTokens(text);
      tokenCache.set(cacheKey, result);
      return result;
    } catch {
      // fallback to heuristic
    }
  }

  // 启发式估算（模型感知）
  const profile = resolveCalibration(model);
  const analysis = analyzeContent(text);

  // 代码密集型内容使用 code 比率更大的权重
  const codeHeavy = isCodeHeavy(text);

  let tokens: number;
  if (codeHeavy) {
    // 代码为主：整体按代码比例，但中文注释单独算
    tokens = analysis.chineseChars / profile.chineseRatio
      + (analysis.totalChars - analysis.chineseChars) / profile.codeRatio;
  } else {
    tokens = analysis.chineseChars / profile.chineseRatio
      + analysis.englishChars / profile.englishRatio
      + analysis.codeChars / profile.codeRatio
      + analysis.whitespaceChars / 6; // 空白大约 6 个字符一个 token
  }

  result = Math.ceil(tokens + profile.messageOverhead);
  tokenCache.set(cacheKey, result);
  return result;
}

/**
 * 增强版消息 Token 估算。
 */
export function estimateMessageTokensEnhanced(
  message: {
    role: string;
    content?: string | MultimodalContent[];
    tool_calls?: Array<{ function: { name: string; arguments: string } }>;
    tool_call_id?: string;
  },
  model?: string,
): number {
  const profile = resolveCalibration(model);
  let tokens = profile.messageOverhead; // role overhead

  if (message.content) {
    if (typeof message.content === 'string') {
      tokens += estimateTokensEnhanced(message.content, model);
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          tokens += estimateTokensEnhanced(part.text, model);
        } else if (part.type === 'image_url' && part.image_url?.url) {
          // 图片 token：低分辨率 ~85, 高分辨率 ~170, 取保守值
          tokens += 100;
        }
      }
    }
  }

  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      tokens += estimateTokensEnhanced(call.function.name, model);
      tokens += estimateTokensEnhanced(call.function.arguments, model);
      tokens += 4; // tool call structure overhead
    }
  }

  if (message.tool_call_id) {
    tokens += estimateTokensEnhanced(message.tool_call_id, model);
    tokens += 2;
  }

  return tokens;
}

/**
 * 批量估算消息 token 总数。
 */
export function estimateTotalTokensEnhanced(
  messages: Array<{
    role: string;
    content?: string | MultimodalContent[];
    tool_calls?: Array<{ function: { name: string; arguments: string } }>;
    tool_call_id?: string;
  }>,
  model?: string,
): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokensEnhanced(msg, model), 0);
}

// ---------------------------------------------------------------------------
// 5. 精度验证工具（可选，用于开发调试）
// ---------------------------------------------------------------------------

export interface AccuracyReport {
  text: string;
  estimated: number;
  actual: number;
  errorRate: number; // (estimated - actual) / actual
}

/**
 * 对比启发式估算与精确 Tokenizer 的差异，用于校准。
 */
export function benchmarkAccuracy(
  samples: string[],
  exactTokenizer: TokenizerProvider,
  model?: string,
): AccuracyReport[] {
  return samples.map(text => {
    const estimated = (() => {
      const profile = resolveCalibration(model);
      const analysis = analyzeContent(text);
      const tokens = analysis.chineseChars / profile.chineseRatio
        + analysis.englishChars / profile.englishRatio
        + analysis.codeChars / profile.codeRatio
        + analysis.whitespaceChars / 6;
      return Math.ceil(tokens + profile.messageOverhead);
    })();

    const actual = exactTokenizer.countTokens(text);
    const errorRate = actual > 0 ? (estimated - actual) / actual : 0;

    return { text: text.slice(0, 80), estimated, actual, errorRate };
  });
}
