/**
 * Chart Element Tests
 */

import { describe, test, expect, vi } from 'vitest';
import {
  ChartElementSchema,
  createChartElement,
} from '../types/elements';

describe('Chart Element', () => {
  describe('ChartElementSchema', () => {
    test('should validate basic line chart', () => {
      const chartData = {
        tag: 'chart',
        chart_spec: {
          type: 'line',
          title: { text: 'Test Chart' },
          data: {
            values: [
              { x: 1, y: 10 },
              { x: 2, y: 20 },
            ],
          },
          xField: 'x',
          yField: 'y',
        },
      };

      const result = ChartElementSchema.safeParse(chartData);
      expect(result.success).toBe(true);
    });

    test('should validate chart with all optional fields', () => {
      const chartData = {
        tag: 'chart',
        element_id: 'chart_1',
        margin: '10px',
        aspect_ratio: '16:9',
        color_theme: 'rainbow',
        chart_spec: {
          type: 'bar',
          data: { values: [{ category: 'A', value: 100 }] },
          xField: 'category',
          yField: 'value',
        },
        preview: true,
        height: '400px',
      };

      const result = ChartElementSchema.safeParse(chartData);
      expect(result.success).toBe(true);
    });

    test('should reject invalid aspect ratio', () => {
      const chartData = {
        tag: 'chart',
        chart_spec: { type: 'line' },
        aspect_ratio: '3:2', // Invalid ratio
      };

      const result = ChartElementSchema.safeParse(chartData);
      expect(result.success).toBe(false);
    });

    test('should reject invalid color theme', () => {
      const chartData = {
        tag: 'chart',
        chart_spec: { type: 'bar' },
        color_theme: 'custom', // Invalid theme
      };

      const result = ChartElementSchema.safeParse(chartData);
      expect(result.success).toBe(false);
    });
  });

  describe('createChartElement', () => {
    test('should create line chart with minimal options', () => {
      const chart = createChartElement({
        chartSpec: {
          type: 'line',
          data: {
            values: [
              { time: '2024-01', value: 100 },
              { time: '2024-02', value: 150 },
            ],
          },
          xField: 'time',
          yField: 'value',
        },
      });

      expect(chart.tag).toBe('chart');
      expect(chart.chart_spec.type).toBe('line');
      expect(chart.chart_spec.data.values).toHaveLength(2);
    });

    test('should create bar chart with all options', () => {
      const chart = createChartElement({
        chartSpec: {
          type: 'bar',
          title: { text: 'Sales Report' },
          data: {
            values: [
              { category: 'Electronics', sales: 5000 },
              { category: 'Clothing', sales: 3000 },
            ],
          },
          xField: 'category',
          yField: 'sales',
          legends: { visible: true, orient: 'bottom' },
        },
        aspectRatio: '16:9',
        colorTheme: 'brand',
        preview: true,
        height: 'auto',
        margin: '10px 0',
        elementId: 'sales_chart',
      });

      expect(chart.tag).toBe('chart');
      expect(chart.aspect_ratio).toBe('16:9');
      expect(chart.color_theme).toBe('brand');
      expect(chart.preview).toBe(true);
      expect(chart.height).toBe('auto');
      expect(chart.margin).toBe('10px 0');
      expect(chart.element_id).toBe('sales_chart');
    });

    test('should create pie chart', () => {
      const chart = createChartElement({
        chartSpec: {
          type: 'pie',
          title: { text: 'Market Share' },
          data: {
            values: [
              { type: 'Product A', value: 40 },
              { type: 'Product B', value: 35 },
              { type: 'Product C', value: 25 },
            ],
          },
          valueField: 'value',
          categoryField: 'type',
          outerRadius: 0.9,
          innerRadius: 0.4,
        },
        aspectRatio: '1:1',
        colorTheme: 'rainbow',
      });

      expect(chart.tag).toBe('chart');
      expect(chart.chart_spec.type).toBe('pie');
      expect(chart.chart_spec.outerRadius).toBe(0.9);
      expect(chart.chart_spec.innerRadius).toBe(0.4);
    });

    test('should create scatter plot', () => {
      const chart = createChartElement({
        chartSpec: {
          type: 'scatter',
          title: { text: 'Correlation Analysis' },
          data: {
            values: [
              { x: 10, y: 20 },
              { x: 15, y: 30 },
              { x: 20, y: 25 },
            ],
          },
          xField: 'x',
          yField: 'y',
        },
        aspectRatio: '4:3',
      });

      expect(chart.chart_spec.type).toBe('scatter');
      expect(chart.aspect_ratio).toBe('4:3');
    });

    test('should create radar chart', () => {
      const chart = createChartElement({
        chartSpec: {
          type: 'radar',
          title: { text: 'Performance Metrics' },
          data: {
            values: [
              { dimension: 'Speed', value: 80 },
              { dimension: 'Quality', value: 90 },
              { dimension: 'Reliability', value: 85 },
            ],
          },
          categoryField: 'dimension',
          valueField: 'value',
        },
        aspectRatio: '1:1',
      });

      expect(chart.chart_spec.type).toBe('radar');
    });

    test('should create funnel chart', () => {
      const chart = createChartElement({
        chartSpec: {
          type: 'funnel',
          title: { text: 'Conversion Funnel' },
          data: {
            values: [
              { stage: 'Visitors', value: 10000 },
              { stage: 'Signups', value: 5000 },
              { stage: 'Purchases', value: 1000 },
            ],
          },
          categoryField: 'stage',
          valueField: 'value',
        },
      });

      expect(chart.chart_spec.type).toBe('funnel');
    });
  });

  describe('Chart Types', () => {
    test('should support grouped bar chart', () => {
      const chart = createChartElement({
        chartSpec: {
          type: 'bar',
          data: {
            values: [
              { year: '2023', quarter: 'Q1', value: 100 },
              { year: '2023', quarter: 'Q2', value: 120 },
              { year: '2024', quarter: 'Q1', value: 110 },
              { year: '2024', quarter: 'Q2', value: 140 },
            ],
          },
          xField: ['year', 'quarter'],
          yField: 'value',
          seriesField: 'quarter',
          legends: { visible: true },
        },
      });

      expect(chart.chart_spec.type).toBe('bar');
      expect(chart.chart_spec.xField).toEqual(['year', 'quarter']);
    });

    test('should support combination chart', () => {
      const chart = createChartElement({
        chartSpec: {
          type: 'common',
          data: [
            { values: [{ x: 1, y: 10 }] },
            { values: [{ x: 1, y: 20 }] },
          ],
          series: [
            { type: 'bar', dataIndex: 0, xField: 'x', yField: 'y' },
            { type: 'line', dataIndex: 1, xField: 'x', yField: 'y' },
          ],
          axes: [{ orient: 'bottom' }, { orient: 'left' }],
        },
      });

      expect(chart.chart_spec.type).toBe('common');
      expect(chart.chart_spec.series).toHaveLength(2);
    });
  });
});
