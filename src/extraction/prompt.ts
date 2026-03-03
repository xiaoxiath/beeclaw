/**
 * 知识提取提示词
 */

import type { ExtractionItem, KnowledgeCategory } from './types';

// 主提取提示词
export const EXTRACTION_PROMPT = `你是一个知识提取专家。分析以下对话，提取应该长期记住的信息。

## 提取规则

### 值得记录的信息
1. **个人信息** (personal): 用户的基本信息
   - 名字、年龄、生日、住址
   - 职业、公司、职位
   - 联系方式、社交媒体账号

2. **家庭信息** (family): 家庭成员相关信息
   - 配偶、子女、父母的信息
   - 家人的工作、学校、喜好
   - 家庭重要日期（纪念日、生日）

3. **工作信息** (work): 职业相关信息
   - 公司动态、项目进展
   - 同事信息、团队结构
   - 工作计划、面试经历

4. **财务信息** (finance): 金钱相关
   - 收入、资产、负债
   - 投资组合、股票持仓
   - 消费习惯、预算规划

5. **偏好习惯** (preferences): 个人喜好
   - 食物口味、娱乐偏好
   - 作息时间、运动习惯
   - 技术/工具偏好

6. **重要事件** (events): 日程和历史
   - 近期计划、待办事项
   - 重要日期、历史事件
   - 旅行计划、会议安排

7. **经验教训** (lessons): 从错误中学习
   - 犯过的错误
   - 学到的经验
   - 最佳实践

8. **目标计划** (goals): 短期和长期目标
   - 学习目标
   - 职业规划
   - 生活目标

### 不应该记录的信息
- 临时性的聊天内容（天气、新闻等）
- 明显的假设或"如果"场景
- 一次性查询结果
- 密码、密钥、token 等敏感信息
- 他人的隐私信息（未经授权）

## 输出格式

以 JSON 数组输出，每个提取项包含：
\`\`\`json
{
  "extractions": [
    {
      "category": "family",
      "key": "wife.company",
      "value": "字节跳动",
      "confidence": 0.95,
      "reason": "用户明确提到妻子的公司"
    }
  ]
}
\`\`\`

### 字段说明
- **category**: 类别（personal/family/work/finance/preferences/events/lessons/goals）
- **key**: 唯一标识，格式为 "子类别.属性"（如 wife.company, investment.stocks）
- **value**: 提取的值（简洁明了）
- **confidence**: 置信度 0-1（1=非常确定，0.5=推测）
- **reason**: 提取原因（简短说明）

## 对话内容

{conversation}

## 提取结果

仅输出 JSON，不要有其他内容：`;

// 增量提取提示词（只处理新消息）
export const INCREMENTAL_EXTRACTION_PROMPT = `你是知识提取专家。分析新增的对话内容，提取新知识。

## 已有知识
{existingKnowledge}

## 新对话内容
{conversation}

## 要求
1. 只提取**新增的**或**更新的**信息
2. 如果与已有知识重复，提高 confidence 并更新 value
3. 如果与已有知识冲突，标记为待确认

{outputFormat}

仅输出 JSON：`;

// 冲突检测提示词
export const CONFLICT_DETECTION_PROMPT = `检测以下新旧知识是否存在冲突：

## 现有知识
{existing}

## 新提取
{newExtraction}

## 判断
如果冲突，返回：
\`\`\`json
{
  "hasConflict": true,
  "conflictType": "contradiction" | "update" | "supersede",
  "recommendation": "keep_old" | "keep_new" | "merge" | "ask_user",
  "reason": "说明原因"
}
\`\`\`

如果不冲突，返回：
\`\`\`json
{
  "hasConflict": false
}
\`\`\`

仅输出 JSON：`;

// 敏感信息检测提示词
export const SENSITIVE_DETECTION_PROMPT = `检测以下信息是否包含敏感内容：

{content}

## 敏感类型
- 密码/passwd
- API密钥/token
- 私钥
- 银行卡号
- 身份证号
- 其他认证凭据

返回 JSON：
\`\`\`json
{
  "isSensitive": true/false,
  "type": "password" | "api_key" | "private_key" | "credit_card" | "id_card" | "other" | null,
  "action": "skip" | "redact" | "keep"
}
\`\`\`

仅输出 JSON：`;

/**
 * 格式化对话为提取输入
 */
export function formatConversationForExtraction(
  messages: Array<{ role: string; content: string | unknown }>,
  maxLength: number = 8000
): string {
  const lines: string[] = [];

  let currentLength = 0;
  for (let i = messages.length - 1; i >= 0 && currentLength < maxLength; i--) {
    const msg = messages[i];
    const role = msg.role === 'user' ? '用户' : '助手';
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

    // 截断过长的内容
    const truncated = content.length > 500
      ? content.slice(0, 500) + '...[截断]'
      : content;

    lines.unshift(`[${role}] ${truncated}`);
    currentLength += truncated.length + 20;
  }

  return lines.join('\n\n');
}

/**
 * 解析 LLM 提取结果
 */
export function parseExtractionResult(response: string): ExtractionItem[] {
  // Handle empty or invalid response
  if (!response || !response.trim()) {
    return [];
  }

  try {
    // 尝试提取 JSON
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;

    // Check for empty JSON string
    if (!jsonStr || !jsonStr.trim()) {
      return [];
    }

    const parsed = JSON.parse(jsonStr.trim());

    if (parsed.extractions && Array.isArray(parsed.extractions)) {
      return parsed.extractions.map((item: any) => ({
        category: item.category as KnowledgeCategory,
        key: item.key,
        value: String(item.value),
        confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)),
        reason: item.reason || '',
      }));
    }

    if (Array.isArray(parsed)) {
      return parsed.map((item: any) => ({
        category: item.category as KnowledgeCategory,
        key: item.key,
        value: String(item.value),
        confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)),
        reason: item.reason || '',
      }));
    }

    return [];
  } catch (error) {
    // Silently return empty array for parse errors (common when LLM returns non-JSON)
    console.debug('[Extraction] Failed to parse result, returning empty array');
    return [];
  }
}

/**
 * 验证提取结果
 */
export function validateExtraction(item: ExtractionItem): boolean {
  // 检查必要字段
  if (!item.category || !item.key || !item.value) {
    return false;
  }

  // 检查 key 格式
  if (!/^[a-zA-Z0-9_\-.]+$/.test(item.key)) {
    return false;
  }

  // 检查 value 不为空
  if (item.value.trim().length === 0) {
    return false;
  }

  // 检查置信度范围
  if (item.confidence < 0 || item.confidence > 1) {
    return false;
  }

  return true;
}
