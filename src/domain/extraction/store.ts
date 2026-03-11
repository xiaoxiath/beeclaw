/**
 * 知识存储器
 *
 * 持久化提取的知识到 memory 系统
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ExtractedKnowledge, KnowledgeCategory } from './types';

// 每个类别的文件名映射
const CATEGORY_FILES: Record<KnowledgeCategory, string> = {
  personal: 'profile.md',
  family: 'family.md',
  work: 'work.md',
  finance: 'finance.md',
  health: 'health.md',
  preferences: 'preferences.md',
  events: 'events.md',
  lessons: 'lessons.md',
  goals: 'goals.md',
  relationships: 'relationships.md',
  skills: 'skills.md',
  decisions: 'decisions.md',
};

// 类别的中文标签
const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  personal: '个人信息',
  family: '家庭信息',
  work: '工作信息',
  finance: '财务信息',
  health: '健康信息',
  preferences: '偏好习惯',
  events: '重要事件',
  lessons: '经验教训',
  goals: '目标计划',
  relationships: '人际关系',
  skills: '技能特长',
  decisions: '决策记录',
};

export interface StoreResult {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export class KnowledgeStore {
  private memoryDir: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    this.ensureDirectories();
  }

  /**
   * 确保目录存在
   */
  private ensureDirectories(): void {
    // 确保 facts 目录存在
    const factsDir = path.join(this.memoryDir, 'facts');
    if (!fs.existsSync(factsDir)) {
      fs.mkdirSync(factsDir, { recursive: true });
    }

    // 初始化所有类别文件
    for (const category of Object.keys(CATEGORY_FILES) as KnowledgeCategory[]) {
      const filePath = this.getCategoryFilePath(category);
      if (!fs.existsSync(filePath)) {
        this.writeCategoryFile(category, []);
      }
    }
  }

  /**
   * 获取类别文件路径
   */
  private getCategoryFilePath(category: KnowledgeCategory): string {
    const filename = CATEGORY_FILES[category] || `${category}.md`;
    return path.join(this.memoryDir, 'facts', filename);
  }

  /**
   * 读取类别中的所有知识
   */
  readCategory(category: KnowledgeCategory): ExtractedKnowledge[] {
    const filePath = this.getCategoryFilePath(category);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parseCategoryFile(content, category);
  }

  /**
   * 解析类别文件
   */
  private parseCategoryFile(content: string, category: KnowledgeCategory): ExtractedKnowledge[] {
    const items: ExtractedKnowledge[] = [];

    // 匹配格式: - **key**: value <!-- meta: {...} -->
    const pattern = /- \*\*(.+?)\*\*:\s*(.+?)(?:\s*<!--\s*meta:\s*(\{.+?\})\s*-->)?$/gm;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const key = match[1].trim();
      const value = match[2].trim();
      let meta: any = {};

      if (match[3]) {
        try {
          meta = JSON.parse(match[3]);
        } catch {
          // 解析失败，使用默认值
        }
      }

      items.push({
        id: meta.id || `${category}_${key}_${Date.now()}`,
        category,
        key,
        value,
        confidence: meta.confidence || 0.8,
        source: meta.source || 'unknown',
        timestamp: meta.timestamp ? new Date(meta.timestamp) : new Date(),
        status: meta.status || 'confirmed',
      });
    }

    return items;
  }

  /**
   * 写入类别文件
   */
  private writeCategoryFile(category: KnowledgeCategory, items: ExtractedKnowledge[]): void {
    const filePath = this.getCategoryFilePath(category);
    const label = CATEGORY_LABELS[category];

    const lines: string[] = [
      `# ${label}`,
      '',
      `> 最后更新: ${new Date().toISOString().split('T')[0]}`,
      '',
    ];

    // 按 key 排序
    const sorted = [...items].sort((a, b) => a.key.localeCompare(b.key));

    for (const item of sorted) {
      const meta = {
        id: item.id,
        confidence: item.confidence,
        source: item.source,
        timestamp: item.timestamp.toISOString(),
        status: item.status,
      };

      const metaStr = `<!-- meta: ${JSON.stringify(meta)} -->`;
      lines.push(`- **${item.key}**: ${item.value} ${metaStr}`);
    }

    lines.push('');

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  }

  /**
   * 存储知识条目
   */
  store(items: ExtractedKnowledge[]): StoreResult {
    const result: StoreResult = {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    // 按类别分组
    const byCategory = this.groupByCategory(items);

    for (const [category, newItems] of byCategory) {
      try {
        const existing = this.readCategory(category);
        const updated = [...existing];

        for (const item of newItems) {
          const existingIndex = updated.findIndex(e => e.key === item.key);

          if (existingIndex >= 0) {
            // 更新现有条目
            const oldItem = updated[existingIndex];

            // 只有新条目置信度更高或时间更新时才更新
            if (item.confidence > oldItem.confidence ||
                item.timestamp > oldItem.timestamp) {
              updated[existingIndex] = {
                ...oldItem,
                value: item.value,
                confidence: Math.max(oldItem.confidence, item.confidence),
                timestamp: item.timestamp,
                status: item.status,
              };
              result.updated++;
            } else {
              result.skipped++;
            }
          } else {
            // 新增条目
            updated.push(item);
            result.added++;
          }
        }

        // 写回文件
        this.writeCategoryFile(category, updated);
      } catch (error) {
        result.errors.push(`Failed to store ${category}: ${error}`);
      }
    }

    return result;
  }

  /**
   * 更新单个条目
   */
  update(item: ExtractedKnowledge): boolean {
    const existing = this.readCategory(item.category);
    const index = existing.findIndex(e => e.key === item.key);

    if (index < 0) {
      return false;
    }

    existing[index] = item;
    this.writeCategoryFile(item.category, existing);
    return true;
  }

  /**
   * 删除条目
   */
  delete(category: KnowledgeCategory, key: string): boolean {
    const existing = this.readCategory(category);
    const index = existing.findIndex(e => e.key === key);

    if (index < 0) {
      return false;
    }

    existing.splice(index, 1);
    this.writeCategoryFile(category, existing);
    return true;
  }

  /**
   * 获取所有知识
   */
  getAll(): ExtractedKnowledge[] {
    const all: ExtractedKnowledge[] = [];

    for (const category of Object.keys(CATEGORY_FILES) as KnowledgeCategory[]) {
      all.push(...this.readCategory(category));
    }

    return all;
  }

  /**
   * 按类别获取知识
   */
  getByCategory(category: KnowledgeCategory): ExtractedKnowledge[] {
    return this.readCategory(category);
  }

  /**
   * 搜索知识
   */
  search(query: string): ExtractedKnowledge[] {
    const lowerQuery = query.toLowerCase();
    const all = this.getAll();

    return all.filter(item =>
      item.key.toLowerCase().includes(lowerQuery) ||
      item.value.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 获取待确认的知识
   */
  getPending(): ExtractedKnowledge[] {
    return this.getAll().filter(item => item.status === 'pending');
  }

  /**
   * 确认知识
   */
  confirm(id: string): boolean {
    for (const category of Object.keys(CATEGORY_FILES) as KnowledgeCategory[]) {
      const items = this.readCategory(category);
      const item = items.find(i => i.id === id);

      if (item) {
        item.status = 'confirmed';
        this.writeCategoryFile(category, items);
        return true;
      }
    }

    return false;
  }

  /**
   * 拒绝知识（删除）
   */
  reject(id: string): boolean {
    for (const category of Object.keys(CATEGORY_FILES) as KnowledgeCategory[]) {
      const items = this.readCategory(category);
      const index = items.findIndex(i => i.id === id);

      if (index >= 0) {
        items.splice(index, 1);
        this.writeCategoryFile(category, items);
        return true;
      }
    }

    return false;
  }

  /**
   * 按类别分组
   */
  private groupByCategory(items: ExtractedKnowledge[]): Map<KnowledgeCategory, ExtractedKnowledge[]> {
    const map = new Map<KnowledgeCategory, ExtractedKnowledge[]>();

    for (const item of items) {
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    }

    return map;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    byCategory: Record<KnowledgeCategory, number>;
    pending: number;
  } {
    const byCategory: Record<string, number> = {};
    let total = 0;
    let pending = 0;

    for (const category of Object.keys(CATEGORY_FILES) as KnowledgeCategory[]) {
      const items = this.readCategory(category);
      byCategory[category] = items.length;
      total += items.length;
      pending += items.filter(i => i.status === 'pending').length;
    }

    return {
      total,
      byCategory: byCategory as Record<KnowledgeCategory, number>,
      pending,
    };
  }
}

// 单例
let storeInstance: KnowledgeStore | null = null;

export function getKnowledgeStore(memoryDir?: string): KnowledgeStore {
  if (!storeInstance && memoryDir) {
    storeInstance = new KnowledgeStore(memoryDir);
  }
  if (!storeInstance) {
    throw new Error('KnowledgeStore not initialized. Call initKnowledgeStore first.');
  }
  return storeInstance;
}

export function initKnowledgeStore(memoryDir: string): KnowledgeStore {
  storeInstance = new KnowledgeStore(memoryDir);
  return storeInstance;
}

export function resetKnowledgeStore(): void {
  storeInstance = null;
}
