/**
 * Context Health Dashboard Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  ContextHealthDashboard,
  HealthMessage,
  DEFAULT_ALERT_THRESHOLDS,
  getContextHealthDashboard,
  resetContextHealthDashboard,
} from '../health-dashboard';

describe('ContextHealthDashboard', () => {
  let dashboard: ContextHealthDashboard;

  beforeEach(() => {
    resetContextHealthDashboard();
    dashboard = new ContextHealthDashboard();
  });

  describe('measure', () => {
    test('应该正确测量健康指标', () => {
      const messages: HealthMessage[] = [
        { role: 'user', content: 'Hello world', timestamp: Date.now() - 1000 },
        { role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
      ];

      const metrics = dashboard.measure(messages, 10000);

      expect(metrics.tokenUtilization).toBeGreaterThanOrEqual(0);
      expect(metrics.tokenUtilization).toBeLessThanOrEqual(1);
      expect(metrics.redundancyRate).toBeGreaterThanOrEqual(0);
      expect(metrics.redundancyRate).toBeLessThanOrEqual(1);
      expect(metrics.freshnessScore).toBeGreaterThanOrEqual(0);
      expect(metrics.freshnessScore).toBeLessThanOrEqual(1);
    });

    test('空消息列表应返回默认值', () => {
      const metrics = dashboard.measure([], 10000);

      expect(metrics.tokenUtilization).toBe(0);
      expect(metrics.redundancyRate).toBe(0);
      expect(metrics.freshnessScore).toBe(1);
    });
  });

  describe('checkAlerts', () => {
    test('高 token 使用率应触发告警', () => {
      const metrics = {
        tokenUtilization: 0.96,
        redundancyRate: 0.1,
        freshnessScore: 0.8,
        coherenceScore: 0.8,
        informationDensity: 0.8,
      };

      const alerts = dashboard.checkAlerts(metrics);

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts.some(a => a.metric === 'tokenUtilization')).toBe(true);
    });

    test('正常指标不应触发告警', () => {
      const metrics = {
        tokenUtilization: 0.5,
        redundancyRate: 0.1,
        freshnessScore: 0.8,
        coherenceScore: 0.8,
        informationDensity: 0.8,
      };

      const alerts = dashboard.checkAlerts(metrics);

      expect(alerts.length).toBe(0);
    });
  });

  describe('trend', () => {
    test('应该计算趋势斜率', () => {
      // 添加多个采样
      for (let i = 0; i < 10; i++) {
        dashboard.measure(
          [{ role: 'user', content: `Message ${i}`, timestamp: Date.now() }],
          10000
        );
      }

      const trend = dashboard.trend('tokenUtilization', 10);

      expect(typeof trend).toBe('number');
    });

    test('数据不足时应返回 0', () => {
      dashboard.measure(
        [{ role: 'user', content: 'Test', timestamp: Date.now() }],
        10000
      );

      const trend = dashboard.trend('tokenUtilization', 10);

      expect(trend).toBe(0);
    });
  });

  describe('全局单例', () => {
    test('应该返回同一个实例', () => {
      const instance1 = getContextHealthDashboard();
      const instance2 = getContextHealthDashboard();

      expect(instance1).toBe(instance2);
    });

    test('reset 应该重置实例', () => {
      const instance1 = getContextHealthDashboard();
      resetContextHealthDashboard();
      const instance2 = getContextHealthDashboard();

      expect(instance1).not.toBe(instance2);
    });
  });
});
