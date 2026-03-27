import { describe, test, expect, beforeEach, vi } from 'vitest';
import { LoopDetector, type LoopDetectorConfig } from '../loop-detector';

describe('LoopDetector', () => {
  let detector: LoopDetector;

  const defaultConfig: Partial<LoopDetectorConfig> = {
    exactDuplicateWindow: 10,
    maxExactDuplicates: 2,
    semanticSimilarityThreshold: 0.85,
    maxSemanticDuplicates: 3,
    progressStallWindow: 5,
    minInformationGain: 0.1,
    injectWarningFirst: true,
    maxWarningsBeforeBreak: 2,
  };

  beforeEach(() => {
    detector = new LoopDetector(defaultConfig);
  });

  describe('精确重复检测', () => {
    test('should not detect loop on first call', () => {
      const result = detector.check('tool1', { arg: 'value' });

      expect(result.detected).toBe(false);
      expect(result.action).toBe('continue');
    });

    test('should warn on exact duplicate', () => {
      const params = { arg: 'value' };

      // 记录第一次
      detector.recordToolCall('tool1', params, 1);
      detector.recordToolResult('result1');

      // 记录第二次
      detector.recordToolCall('tool1', params, 2);
      detector.recordToolResult('result1');

      // 第三次检查时应该检测到
      const result = detector.check('tool1', params);
      expect(result.detected).toBe(true);
      expect(result.level).toBe(1);
      expect(result.type).toBe('exact_duplicate');
      expect(result.action).toBe('warn');
      expect(result.warningMessage).toBeDefined();
    });

    test('should break after max warnings', () => {
      const params = { arg: 'value' };

      // 触发第一次警告
      for (let i = 0; i < 3; i++) {
        detector.recordToolCall('tool1', params, i);
        detector.recordToolResult('result1');
      }

      let result = detector.check('tool1', params);
      expect(result.action).toBe('warn');
      detector.acknowledgeWarning();

      // 继续循环
      for (let i = 0; i < 3; i++) {
        detector.recordToolCall('tool1', params, i);
        detector.recordToolResult('result1');
      }

      result = detector.check('tool1', params);
      expect(result.action).toBe('warn');
      detector.acknowledgeWarning();

      // 第三次 - 应该 break
      for (let i = 0; i < 3; i++) {
        detector.recordToolCall('tool1', params, i);
        detector.recordToolResult('result1');
      }

      result = detector.check('tool1', params);
      expect(result.action).toBe('break');
    });
  });

  describe('工具和统计', () => {
    test('should compute fingerprint consistently', () => {
      const params = { a: 1, b: 2 };

      // 第一次循环
      detector.recordToolCall('tool1', params, 1);
      detector.recordToolResult('result1');
      detector.recordToolCall('tool1', params, 2);
      detector.recordToolResult('result1');
      
      // 在相同的循环状态下检查
      const result1 = detector.check('tool1', params);
      
      // 重置后重复相同的操作
      detector.reset();
      detector.recordToolCall('tool1', params, 1);
      detector.recordToolResult('result1');
      detector.recordToolCall('tool1', params, 2);
      detector.recordToolResult('result1');
      
      const result2 = detector.check('tool1', params);

      // 相同历史应该产生相同的检测结果
      expect(result1.type).toBe(result2.type);
    });

    test('should ignore volatile fields', () => {
      const params1 = { data: 'test', timestamp: 1000 };
      const params2 = { data: 'test', timestamp: 2000 };

      detector.recordToolCall('tool1', params1, 1);
      detector.recordToolResult('result1');

      detector.recordToolCall('tool1', params2, 2);
      detector.recordToolResult('result1');

      // timestamp 应该被忽略，所以这两个调用应该被视为相同
      const result = detector.check('tool1', params1);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('exact_duplicate');
    });

    test('should get stats', () => {
      detector.recordToolCall('tool1', { a: 1 }, 1);
      detector.recordToolResult('result1');

      detector.recordToolCall('tool2', { b: 2 }, 2);
      detector.recordToolResult('result2');

      const stats = detector.getStats();

      expect(stats.totalCalls).toBe(2);
      expect(stats.uniqueFingerprints).toBe(2);
      expect(stats.uniqueResults).toBe(2);
      expect(stats.warningCount).toBe(0);
      expect(stats.topRepeatedTools).toHaveLength(2);
    });

    test('should reset properly', () => {
      detector.recordToolCall('tool1', { a: 1 }, 1);
      detector.recordToolResult('result1');
      detector.acknowledgeWarning();

      detector.reset();

      const stats = detector.getStats();
      expect(stats.totalCalls).toBe(0);
      expect(stats.warningCount).toBe(0);
    });
  });
});
