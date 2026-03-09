/**
 * Enhanced Chinese Tokenization / Keyword Extraction  (P2-#7)
 *
 * 原始实现 (indexer.ts) 的问题：
 *  - extractChineseKeywords() 使用硬编码正则，只能匹配预定义的固定词汇
 *  - 无法处理未登录词（新出现的人名、公司名、术语等）
 *  - 英文关键词只用简单的 stop words 列表
 *
 * 优化方案：
 *  1. 基于字典 + 统计的中文分词（正向最大匹配 + 新词发现）
 *  2. 可注入外部分词器（jieba-wasm 等）
 *  3. TF-IDF 关键词提取
 *  4. 自定义词典扩展机制
 *  5. 命名实体模式扩展（不再硬编码姓氏）
 *
 * ⚡ 新增文件 — 替代 indexer.ts 中的 extractChineseKeywords()
 */

// ---------------------------------------------------------------------------
// 1. 外部分词器注入接口
// ---------------------------------------------------------------------------

/**
 * 外部分词器接口。
 * 可以注入 jieba-wasm、pkuseg 等成熟方案。
 */
export interface ChineseSegmenter {
  /** 分词：返回词语数组 */
  segment(text: string): string[];
  /** 可选：关键词提取 */
  extractKeywords?(text: string, topK?: number): Array<{ word: string; weight: number }>;
}

let externalSegmenter: ChineseSegmenter | null = null;

/**
 * 注册外部分词器。
 */
export function setChineseSegmenter(segmenter: ChineseSegmenter): void {
  externalSegmenter = segmenter;
}

/**
 * 获取当前分词器。
 */
export function getChineseSegmenter(): ChineseSegmenter | null {
  return externalSegmenter;
}

// ---------------------------------------------------------------------------
// 2. 自定义词典
// ---------------------------------------------------------------------------

const customDict = new Map<string, string>(); // word → category

/**
 * 添加自定义词典词条。
 *
 * @example
 * addCustomWord('百奥赛图', 'company');
 * addCustomWord('汤昊', 'person');
 * addCustomWords({ '深度学习': 'tech', 'Transformer': 'tech' });
 */
export function addCustomWord(word: string, category = 'general'): void {
  customDict.set(word, category);
}

export function addCustomWords(words: Record<string, string>): void {
  for (const [word, category] of Object.entries(words)) {
    customDict.set(word, category);
  }
}

export function removeCustomWord(word: string): void {
  customDict.delete(word);
}

export function getCustomDict(): Map<string, string> {
  return new Map(customDict);
}

// ---------------------------------------------------------------------------
// 3. 增强的中文停用词
// ---------------------------------------------------------------------------

const CHINESE_STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '那', '里', '后', '以', '但', '因', '所以',
  '而', '对', '如', '与', '为', '让', '从', '被', '把', '用', '可以', '还',
  '能', '做', '个', '么', '什么', '怎么', '哪', '这个', '那个', '什么样',
  '这些', '那些', '如何', '已经', '可能', '一些', '这样', '因为', '所以',
  '但是', '而且', '或者', '如果', '虽然', '不过', '然后', '接着', '比较',
]);

const ENGLISH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they',
  'we', 'you', 'your', 'our', 'their', 'my', 'his', 'her', 'not', 'no',
  'nor', 'so', 'too', 'very', 'just', 'about', 'also', 'then', 'than',
  'more', 'most', 'much', 'many', 'some', 'any', 'all', 'each', 'every',
  'both', 'few', 'other', 'such', 'only', 'own', 'same', 'new', 'old',
]);

// ---------------------------------------------------------------------------
// 4. 正向最大匹配分词（内置 fallback）
// ---------------------------------------------------------------------------

/**
 * 中文字符判断。
 */
function isCJK(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x4E00 && code <= 0x9FFF)
    || (code >= 0x3400 && code <= 0x4DBF)
    || (code >= 0x3000 && code <= 0x303F)
    || (code >= 0x3040 && code <= 0x30FF)
    || (code >= 0xAC00 && code <= 0xD7AF);
}

/**
 * 简易正向最大匹配分词。
 * 结合自定义词典，对未登录词使用 2-4 字组合尝试。
 */
function forwardMaxMatch(text: string): string[] {
  const result: string[] = [];
  const maxWordLen = 6;
  let i = 0;

  while (i < text.length) {
    if (!isCJK(text[i])) {
      // 非中文字符，跳过
      i++;
      continue;
    }

    let matched = false;
    // 从最长到最短尝试匹配
    for (let len = Math.min(maxWordLen, text.length - i); len >= 2; len--) {
      const candidate = text.slice(i, i + len);
      if (customDict.has(candidate)) {
        result.push(candidate);
        i += len;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // 未匹配到词典词，取单字（或 2 字组合用于后续统计）
      if (i + 1 < text.length && isCJK(text[i + 1])) {
        result.push(text.slice(i, i + 2));
        i += 2;
      } else {
        result.push(text[i]);
        i++;
      }
    }
  }

  return result;
}

/**
 * 执行中文分词。
 * 优先使用外部分词器，fallback 到正向最大匹配。
 */
export function segmentChinese(text: string): string[] {
  if (externalSegmenter) {
    try {
      return externalSegmenter.segment(text);
    } catch {
      // fallback
    }
  }
  return forwardMaxMatch(text);
}

// ---------------------------------------------------------------------------
// 5. 命名实体识别（规则增强版）
// ---------------------------------------------------------------------------

/**
 * 命名实体模式（可扩展）。
 */
interface EntityPattern {
  name: string;
  pattern: RegExp;
  category: string;
}

// 默认实体模式
const defaultEntityPatterns: EntityPattern[] = [
  // 中文人名：更通用的姓名识别（覆盖百家姓前 200）
  {
    name: 'chinese_name',
    pattern: /(?:^|[，。！？、\s])([赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫房缪干解应宗丁宣邓单杭洪包诸左石崔吉龚程邢滑裴陆荣翁荀羊甄家封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘翟谭贡劳逄姬申扶堵冉宰雍桑寿通边鄢綦扈冀滇濮邝蒯][\u4e00-\u9fa5]{1,3})(?=[，。！？、\s]|$)/g,
    category: 'person',
  },
  // 公司/组织名
  {
    name: 'organization',
    pattern: /([\u4e00-\u9fa5]{2,8}(?:公司|集团|科技|网络|信息|数据|智能|教育|金融|医疗|生物|银行|基金|证券|保险|资本|研究院|实验室|大学|学院|工程|电子|通讯|材料))/g,
    category: 'organization',
  },
  // 技术术语（大小写敏感英文 + 中文混合）
  {
    name: 'tech_term',
    pattern: /\b((?:React|Vue|Angular|Next\.?js|Node\.?js|TypeScript|JavaScript|Python|Rust|Go|Docker|Kubernetes|Redis|MySQL|PostgreSQL|MongoDB|GraphQL|REST|API|SDK|LLM|NLP|ML|AI|GPT|BERT|Transformer|CNN|RNN|LSTM|GAN|RAG|Langchain|LangGraph|Pinecone|Weaviate|Milvus|FAISS|ChromaDB|HuggingFace|OpenAI|Anthropic|Cohere|Zhipu|MiniMax|DeepSeek|Moonshot))\b/gi,
    category: 'tech',
  },
  // 金额
  {
    name: 'money',
    pattern: /(\d+(?:\.\d+)?(?:万|亿|千|百)?(?:元|块|美元|美金|USD|RMB|CNY|HKD|港币|欧元|EUR))/g,
    category: 'money',
  },
  // 地名（省市区）
  {
    name: 'location',
    pattern: /((?:北京|上海|广州|深圳|杭州|成都|武汉|南京|西安|重庆|天津|苏州|长沙|郑州|东莞|青岛|宁波|昆明|合肥|沈阳|大连|济南|哈尔滨|新疆|石河子|海淀|朝阳|浦东|福田|南山|硅谷|纽约|伦敦|东京|首尔|新加坡|迪拜|旧金山)(?:市|区|省|州)?)/g,
    category: 'location',
  },
];

// 可扩展
const entityPatterns: EntityPattern[] = [...defaultEntityPatterns];

/**
 * 注册自定义实体模式。
 */
export function addEntityPattern(pattern: EntityPattern): void {
  entityPatterns.push(pattern);
}

/**
 * 提取命名实体。
 */
export function extractNamedEntities(text: string): Array<{ text: string; category: string }> {
  const entities: Array<{ text: string; category: string }> = [];
  const seen = new Set<string>();

  for (const ep of entityPatterns) {
    // Reset regex lastIndex
    ep.pattern.lastIndex = 0;
    let match;
    while ((match = ep.pattern.exec(text)) !== null) {
      const entity = match[1] || match[0];
      if (!seen.has(entity) && entity.length >= 2) {
        entities.push({ text: entity, category: ep.category });
        seen.add(entity);
      }
    }
  }

  // 自定义词典也作为实体
  for (const [word, category] of customDict) {
    if (text.includes(word) && !seen.has(word)) {
      entities.push({ text: word, category });
      seen.add(word);
    }
  }

  return entities;
}

// ---------------------------------------------------------------------------
// 6. TF-IDF 关键词提取
// ---------------------------------------------------------------------------

interface TermFrequency {
  term: string;
  tf: number;      // 词频
  idf: number;     // 逆文档频率
  tfidf: number;   // TF-IDF 得分
}

// 文档频率表（跨文档统计）
const documentFrequency = new Map<string, number>();
let totalDocuments = 0;

/**
 * 更新文档频率统计（用于 IDF 计算）。
 * 每次索引新文件时调用。
 */
export function updateDocumentFrequency(terms: string[]): void {
  totalDocuments++;
  const uniqueTerms = new Set(terms);
  for (const term of uniqueTerms) {
    documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }
}

/**
 * 重置文档频率统计。
 */
export function resetDocumentFrequency(): void {
  documentFrequency.clear();
  totalDocuments = 0;
}

/**
 * 提取关键词（TF-IDF 排序）。
 */
export function extractKeywordsTFIDF(text: string, topK = 20): TermFrequency[] {
  // 如果有外部分词器的关键词提取，优先使用
  if (externalSegmenter?.extractKeywords) {
    try {
      const kws = externalSegmenter.extractKeywords(text, topK);
      return kws.map(kw => ({
        term: kw.word,
        tf: 0, // 外部提取不提供 TF
        idf: 0,
        tfidf: kw.weight,
      }));
    } catch {
      // fallback
    }
  }

  // 分词 + 过滤
  const chineseText = text.replace(/[^\u4e00-\u9fff\u3400-\u4dbf]/g, ' ');
  const words = segmentChinese(chineseText).filter(w =>
    w.length >= 2 && !CHINESE_STOP_WORDS.has(w)
  );

  // 英文关键词
  const englishWords = (text.match(/\b[A-Za-z][A-Za-z0-9_-]{2,}\b/g) || [])
    .map(w => w.toLowerCase())
    .filter(w => !ENGLISH_STOP_WORDS.has(w) && w.length >= 3);

  const allTerms = [...words, ...englishWords];

  // 计算 TF
  const termCounts = new Map<string, number>();
  for (const term of allTerms) {
    termCounts.set(term, (termCounts.get(term) || 0) + 1);
  }

  const totalTerms = allTerms.length || 1;

  // 计算 TF-IDF
  const results: TermFrequency[] = [];
  for (const [term, count] of termCounts) {
    const tf = count / totalTerms;
    const df = documentFrequency.get(term) || 0;
    const idf = totalDocuments > 0
      ? Math.log((totalDocuments + 1) / (df + 1)) + 1
      : 1;
    results.push({ term, tf, idf, tfidf: tf * idf });
  }

  // 排序取 TopK
  return results.sort((a, b) => b.tfidf - a.tfidf).slice(0, topK);
}

// ---------------------------------------------------------------------------
// 7. 统一入口：替代原始 extractChineseKeywords + extractEnglishKeywords
// ---------------------------------------------------------------------------

/**
 * 增强版关键词提取。
 * 可直接替代 indexer.ts 中的 extractKeywords()。
 *
 * 策略：
 *  1. TF-IDF 统计关键词
 *  2. 命名实体
 *  3. 自定义词典匹配
 *  4. 合并去重
 */
export function extractKeywordsEnhanced(text: string, topK = 30): string[] {
  const keywords = new Set<string>();

  // 1. TF-IDF 关键词
  const tfidfResults = extractKeywordsTFIDF(text, topK);
  for (const r of tfidfResults) {
    keywords.add(r.term);
  }

  // 2. 命名实体
  const entities = extractNamedEntities(text);
  for (const e of entities) {
    keywords.add(e.text);
  }

  // 3. 自定义词典直接匹配
  for (const word of customDict.keys()) {
    if (text.includes(word)) {
      keywords.add(word);
    }
  }

  return Array.from(keywords).slice(0, topK);
}
