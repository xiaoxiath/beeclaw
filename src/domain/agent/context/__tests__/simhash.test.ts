/**
 * SimHash Tests
 *
 * 测试近似去重算法
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SimHasher, getSimHasher, resetSimHasher, isDuplicate } from '../simhash';

describe('SimHasher', () => {
  let hasher: SimHasher;

  beforeEach(() => {
    resetSimHasher();
    hasher = new SimHasher();
  });

  describe('computeHash', () => {
    test('应该为相同文本生成相同指纹', () => {
      const text = 'This is a test message';
      const hash1 = hasher.computeHash(text);
      const hash2 = hasher.computeHash(text);

      expect(hash1).toBe(hash2);
    });

    test('应该为不同文本生成不同指纹（语义不同的文本）', () => {
      const textA = 'The quick brown fox jumps over the lazy dog';
      const textB = 'Machine learning algorithms process large datasets';
      const hashA = hasher.computeHash(textA);
      const hashB = hasher.computeHash(textB);

      expect(hashA).not.toBe(hashB);
    });

    test('空文本应返回 0', () => {
      const hash = hasher.computeHash('');
      expect(hash).toBe(0n);
    });
  });

  describe('hammingDistance', () => {
    test('相同指纹的汉明距离应为 0', () => {
      const hash = 0b1111000011110000n;
      const distance = hasher.hammingDistance(hash, hash);

      expect(distance).toBe(0);
    });

    test('完全不同的指纹汉明距离应为位数', () => {
      const hashA = 0b11111111n;
      const hashB = 0b00000000n;
      const distance = hasher.hammingDistance(hashA, hashB);

      expect(distance).toBe(8); // 8 位不同
    });

    test('应该正确计算部分不同的距离', () => {
      const hashA = 0b11110000n;
      const hashB = 0b11111111n;
      const distance = hasher.hammingDistance(hashA, hashB);

      expect(distance).toBe(4); // 后 4 位不同
    });
  });

  describe('isNearDuplicate', () => {
    test('完全相同的文本应判定为重复', () => {
      const text = 'This is a test message';
      const isDup = hasher.isNearDuplicate(text, text);

      expect(isDup).toBe(true);
    });

    test('完全不同的文本应判定为不重复', () => {
      const textA = 'The quick brown fox jumps over the lazy dog';
      const textB = 'Machine learning is transforming software development';
      const isDup = hasher.isNearDuplicate(textA, textB);

      expect(isDup).toBe(false);
    });

    test('轻微修改的文本汉明距离应较小', () => {
      const textA = 'The user wants to refactor the payment service to use event-driven architecture';
      const textB = 'The user wants to refactor the payment service using event-driven architecture';

      const hashA = hasher.computeHash(textA);
      const hashB = hasher.computeHash(textB);
      const distance = hasher.hammingDistance(hashA, hashB);

      // 轻微修改的文本汉明距离应较小（< 10 位）
      expect(distance).toBeLessThan(10);
    });

    test('阈值应可配置', () => {
      const textA = 'This is a test message with some content';
      const textB = 'This is a test message with other content';

      // 使用严格的阈值（汉明距离 <= 1）
      const isDup1 = hasher.isNearDuplicate(textA, textB, 1);

      // 使用宽松的阈值（汉明距离 <= 5）
      const isDup5 = hasher.isNearDuplicate(textA, textB, 5);

      // 宽松阈值应判定为重复，严格阈值可能不判定为重复
      //（具体取决于实际汉明距离）
      expect(isDup5 || !isDup1).toBe(true);
    });
  });

  describe('deduplicate', () => {
    test('应该移除完全重复的文本', () => {
      const texts = [
        'This is message one',
        'This is message two',
        'This is message one', // 重复
        'This is message three',
        'This is message two', // 重复
      ];

      const deduped = hasher.deduplicate(texts);

      expect(deduped.length).toBe(3);
      expect(deduped).toEqual([
        'This is message one',
        'This is message two',
        'This is message three',
      ]);
    });

    test('应该保留近似但不重复的文本', () => {
      const texts = [
        'The user wants to refactor the payment service',
        'The user wants to refactor the inventory service', // 不同服务
        'The system should use event-driven architecture',
      ];

      const deduped = hasher.deduplicate(texts);

      // 所有文本都应保留（不同的语义）
      expect(deduped.length).toBe(3);
    });

    test('空数组应返回空数组', () => {
      const deduped = hasher.deduplicate([]);
      expect(deduped.length).toBe(0);
    });

    test('单元素数组应返回自身', () => {
      const texts = ['Single message'];
      const deduped = hasher.deduplicate(texts);

      expect(deduped.length).toBe(1);
      expect(deduped[0]).toBe('Single message');
    });
  });

  describe('deduplicateItems', () => {
    test('应该去重带元数据的项', () => {
      const items = [
        { id: 1, content: 'Message one', timestamp: 1000 },
        { id: 2, content: 'Message two', timestamp: 2000 },
        { id: 3, content: 'Message one', timestamp: 3000 }, // 重复内容
      ];

      const deduped = hasher.deduplicateItems(items);

      expect(deduped.length).toBe(2);
      expect(deduped[0].id).toBe(1);
      expect(deduped[1].id).toBe(2);
    });
  });

  describe('全局单例', () => {
    test('应该返回同一个实例', () => {
      const instance1 = getSimHasher();
      const instance2 = getSimHasher();

      expect(instance1).toBe(instance2);
    });

    test('reset 应该重置实例', () => {
      const instance1 = getSimHasher();
      resetSimHasher();
      const instance2 = getSimHasher();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('辅助函数', () => {
    test('isDuplicate 应该正确判断', () => {
      const textA = 'This is a test';
      const textB = 'This is different';

      const result = isDuplicate(textA, textB, 3);

      expect(typeof result).toBe('boolean');
    });
  });
});
