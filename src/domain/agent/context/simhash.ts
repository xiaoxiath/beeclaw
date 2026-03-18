/**
 * SimHash 近似去重算法
 *
 * SimHash 是一种局部敏感哈希（LSH），用于快速检测近似重复文本。
 * 核心思想：将文本映射为固定长度的二进制指纹，语义相似的文本产生相似的指纹。
 *
 * 算法步骤：
 * 1. 分词并计算每个 token 的 hash 值
 * 2. 将 hash 值的每一位加权（1 加 1，0 减 1）
 * 3. 将加权结果求和，生成最终指纹（和 > 0 则该位为 1，否则为 0）
 * 4. 比较两个指纹的汉明距离（不同位数）
 *
 * 时间复杂度：O(n) - 远优于逐对比较的 O(n^2)
 * 适用场景：长对话中的重复内容检测（用户反复描述同一问题）
 *
 * 参考：ch05-context-engineering.md 5.2.1
 */

import { logger } from '../../../infra/observability/logger';

/**
 * SimHash 近似去重器
 */
export class SimHasher {
  constructor(private hashBits: number = 64) {}

  /**
   * 计算文本的 SimHash 指纹
   *
   * @param text 输入文本
   * @returns 64 位指纹（BigInt）
   */
  computeHash(text: string): bigint {
    const tokens = this.tokenize(text);

    if (tokens.length === 0) {
      return 0n;
    }

    // 初始化权重数组（每一位的加权值）
    const weights = new Array(this.hashBits).fill(0);

    // 对每个 token 计算 hash 并加权
    for (const token of tokens) {
      const hash = this.fnv1aHash(token);

      // 对 hash 的每一位进行加权
      for (let i = 0; i < this.hashBits; i++) {
        const bit = Number((hash >> BigInt(i)) & 1n);
        weights[i] += bit === 1 ? 1 : -1;
      }
    }

    // 根据权重生成最终指纹
    let fingerprint = 0n;
    for (let i = 0; i < this.hashBits; i++) {
      if (weights[i] > 0) {
        fingerprint |= 1n << BigInt(i);
      }
    }

    return fingerprint;
  }

  /**
   * 判断两段文本是否为近似重复
   *
   * @param textA 文本 A
   * @param textB 文本 B
   * @param threshold 汉明距离阈值（默认 3，表示最多 3 位不同）
   * @returns 是否为近似重复
   */
  isNearDuplicate(textA: string, textB: string, threshold: number = 3): boolean {
    const hashA = this.computeHash(textA);
    const hashB = this.computeHash(textB);

    const hammingDistance = this.hammingDistance(hashA, hashB);

    return hammingDistance <= threshold;
  }

  /**
   * 计算两个指纹的汉明距离（不同位数）
   */
  hammingDistance(hashA: bigint, hashB: bigint): number {
    const xor = hashA ^ hashB;
    let distance = 0;

    // 计算异或结果中 1 的个数（即不同位数）
    let temp = xor;
    while (temp > 0n) {
      distance += Number(temp & 1n);
      temp >>= 1n;
    }

    return distance;
  }

  /**
   * 文本分词
   *
   * 简单实现：按空白字符分割，过滤短词
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(token => token.length >= 2); // 过滤单字符
  }

  /**
   * FNV-1a Hash 算法
   *
   * 一种快速的非加密 hash 函数，适合 SimHash
   */
  private fnv1aHash(text: string): bigint {
    const FNV_PRIME = 0x100000001b3n;
    const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;

    let hash = FNV_OFFSET_BASIS;

    for (let i = 0; i < text.length; i++) {
      hash ^= BigInt(text.charCodeAt(i));
      hash *= FNV_PRIME;
      hash &= (1n << BigInt(this.hashBits)) - 1n; // 限制在 hashBits 位内
    }

    return hash;
  }

  /**
   * 批量去重
   *
   * @param texts 文本数组
   * @param threshold 汉明距离阈值
   * @returns 去重后的文本数组（保留第一次出现的）
   */
  deduplicate(texts: string[], threshold: number = 3): string[] {
    const result: string[] = [];
    const fingerprints: bigint[] = [];

    for (const text of texts) {
      const fp = this.computeHash(text);

      // 检查是否与已保留的文本重复
      const isDuplicate = fingerprints.some(
        existingFp => this.hammingDistance(fp, existingFp) <= threshold
      );

      if (!isDuplicate) {
        result.push(text);
        fingerprints.push(fp);
      }
    }

    const duplicatesRemoved = texts.length - result.length;
    if (duplicatesRemoved > 0) {
      logger.info(
        `[SimHasher] Removed ${duplicatesRemoved} near-duplicate texts ` +
        `(${((duplicatesRemoved / texts.length) * 100).toFixed(1)}%)`
      );
    }

    return result;
  }

  /**
   * 批量去重（带元数据）
   *
   * @param items 带元数据的项数组
   * @param threshold 汉明距离阈值
   * @returns 去重后的项数组
   */
  deduplicateItems<T extends { content: string }>(
    items: T[],
    threshold: number = 3
  ): T[] {
    const result: T[] = [];
    const fingerprints: bigint[] = [];

    for (const item of items) {
      const fp = this.computeHash(item.content);

      const isDuplicate = fingerprints.some(
        existingFp => this.hammingDistance(fp, existingFp) <= threshold
      );

      if (!isDuplicate) {
        result.push(item);
        fingerprints.push(fp);
      }
    }

    return result;
  }
}

/**
 * 全局单例
 */
let globalSimHasher: SimHasher | null = null;

/**
 * 获取全局 SimHasher 实例
 */
export function getSimHasher(): SimHasher {
  if (!globalSimHasher) {
    globalSimHasher = new SimHasher();
  }
  return globalSimHasher;
}

/**
 * 重置全局实例（用于测试）
 */
export function resetSimHasher(): void {
  globalSimHasher = null;
}

/**
 * 辅助函数：快速判断两段文本是否重复
 */
export function isDuplicate(textA: string, textB: string, threshold = 3): boolean {
  return getSimHasher().isNearDuplicate(textA, textB, threshold);
}
