# 问题分析：Extraction 和 Session 错误

## 问题 1: ExtractionManager - `toItems is not a function`

### 根本原因
**重构遗留 Bug**：`KnowledgeExtractor` 类缺少 `toItems` 方法

```typescript
// 错误位置: src/domain/extraction/index.ts:183
const extractions = await this.extractor.extractIncremental(messages, existingKnowledge);
// extractions 类型: ExtractionItem[]

const newItems = this.extractor.toItems(extractions, source);
// ❌ this.extractor.toItems 不存在
```

### 类型不匹配
- `extractIncremental()` 返回 `ExtractionItem[]`（简化类型）
- `store()` 需要 `ExtractedKnowledge[]`（完整类型）
- 缺少转换逻辑

### 解决方案
添加 `toItems` 方法将 `ExtractionItem` 转换为 `ExtractedKnowledge`：

```typescript
// 需要添加的字段：
interface ExtractedKnowledge {
  id: string;              // UUID（需生成）
  source: string;          // 来源（需添加）
  timestamp: Date;         // 时间戳（需添加）
  status: 'confirmed';     // 状态（需添加）
  context?: string;        // 上下文（可选）

  // 继承自 ExtractionItem
  category: KnowledgeCategory;
  key: string;
  value: string;
  confidence: number;
}
```

---

## 问题 2: Session 加载失败

### 错误信息
```
[Session] Failed to load session feishu-oc_3efa8f561880abb0b4b40f9bc12cdba9-on_453ee6c7ab356a018e87d6bd79f35401 (corrupted or missing)
```

### 可能原因
1. **文件损坏**：Session 文件写入时进程崩溃
2. **格式错误**：JSON 解析失败
3. **文件丢失**：被意外删除

### 影响
- 会话历史丢失
- 用户需要重新开始对话

---

## 修复优先级

### P0 - 紧急
✅ **修复 ExtractionManager.toItems** - 导致功能完全不可用

### P1 - 重要
⚠️ **增强 Session 容错** - 添加自动恢复机制

---

## 修复代码
