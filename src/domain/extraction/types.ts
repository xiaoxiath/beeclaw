/**
 * 自动知识提取 - 类型定义
 */

// 知识类别
export type KnowledgeCategory =
  | 'personal'      // 个人信息: 名字、生日、地址
  | 'family'        // 家庭: 家人信息
  | 'work'          // 工作: 公司、职位、项目
  | 'finance'       // 财务: 收入、资产、投资
  | 'health'        // 健康: 疾病、用药、运动
  | 'preferences'   // 偏好: 食物、娱乐、习惯
  | 'events'        // 事件: 日程、计划、历史
  | 'lessons'       // 教训: 错误、经验
  | 'goals'         // 目标: 短期、长期计划
  | 'relationships' // 关系: 朋友、同事
  | 'skills'        // 技能: 已掌握、想学习
  | 'decisions';    // 决策: 做过的选择

// 提取的知识条目
export interface ExtractedKnowledge {
  id: string;              // UUID
  category: KnowledgeCategory;
  key: string;              // 唯一标识: "wife.company"
  value: string;            // 值: " A 司"
  confidence: number;       // 置信度: 0-1
  source: string;           // 来源会话 ID
  timestamp: Date;
  context?: string;         // 原始上下文
  status: 'confirmed' | 'pending' | 'superseded';
}

// 提取结果
export interface ExtractionResult {
  extractions: ExtractionItem[];
  summary?: string;
}

export interface ExtractionItem {
  category: KnowledgeCategory;
  key: string;
  value: string;
  confidence: number;
  reason: string;  // 提取原因
}

// 去重结果
export interface DeduplicationResult {
  toAdd: ExtractedKnowledge[];
  toUpdate: Array<{
    existing: ExtractedKnowledge;
    new: ExtractedKnowledge;
    merged: ExtractedKnowledge;
  }>;
  duplicates: ExtractedKnowledge[];
}

// 触发类型
export type TriggerType =
  | 'phrase'       // 关键短语触发
  | 'conversation_end'  // 对话结束
  | 'periodic'     // 周期性触发
  | 'explicit';    // 用户明确请求

// 触发检测结果
export interface TriggerCheckResult {
  trigger: boolean;
  type: TriggerType | null;
  urgency: 'immediate' | 'background';
  reason: string;
}

// 提取配置
export interface ExtractionConfig {
  enabled: boolean;
  triggerPhrases: string[];       // 触发短语
  periodicInterval: number;        // 周期性触发间隔（消息数）
  confidenceThreshold: number;     // 高置信度阈值
  lowConfidenceThreshold: number;  // 低置信度阈值
  maxExtractionsPerRun: number;    // 每次最多提取条数
  notifyOnHighConfidence: boolean; // 高置信度时通知用户
  sensitivePatterns: string[];     // 敏感信息正则模式
  skipSensitiveContent: boolean;   // 是否跳过含敏感内容
}

// 默认配置
export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  enabled: true,
  triggerPhrases: [],  // 不再使用硬编码短语，让 LLM 自己判断
  periodicInterval: 10,  // 每 10 轮对话
  confidenceThreshold: 0.9,  // ≥ 0.9 视为高置信度
  lowConfidenceThreshold: 0.7,  // < 0.7 标记为待确认
  maxExtractionsPerRun: 20,
  notifyOnHighConfidence: true,
  sensitivePatterns: [
    'password', 'passwd', 'pwd',
    'secret', 'api_key', 'apikey', 'api-key',
    'token', 'access_token', 'accessToken',
    'private_key', 'privatekey', 'private-key',
    '密钥', '密码', '口令', '私钥',
    '-----BEGIN', '-----END',
    'sk-[a-zA-Z0-9]',  // OpenAI keys
    'ghp_[a-zA-Z0-9]',  // GitHub tokens
    'xox[bB]-',  // Slack tokens
  ],
  skipSensitiveContent: true,
};
