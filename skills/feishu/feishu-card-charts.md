---
name: feishu-card-charts
description: Create interactive data visualization charts in Feishu Card V2 messages
maturity: mature
tags: [feishu, card-v2, charts, visualization, vchart]
version: 1.0.0
---

# Feishu Card V2 Charts

Create interactive data visualizations using Feishu Card V2 chart components based on VChart.

## Supported Chart Types

1. **Line Chart** (`type: "line"`) - Show trends over time
2. **Area Chart** (`type: "area"`) - Emphasize cumulative trends
3. **Bar Chart** (`type: "bar"`) - Compare values across categories
4. **Pie/Donut Chart** (`type: "pie"`) - Show proportions of a whole
5. **Scatter Plot** (`type: "scatter"`) - Show relationships between two variables
6. **Radar Chart** (`type: "radar"`) - Compare multiple dimensions
7. **Funnel Chart** (`type: "funnel"`) - Show conversion through stages
8. **Word Cloud** (`type: "wordCloud"`) - Display word frequency
9. **Linear Progress** (`type: "linearProgress"`) - Show progress bars
10. **Circular Progress** (`type: "circularProgress"`) - Show circular progress
11. **Common/Combo** (`type: "common"`) - Combine multiple chart types

## Basic Usage

### Line Chart Example

```typescript
import { createChartElement } from '../adapter/feishu/card-v2/types/elements';

const chartElement = createChartElement({
  chartSpec: {
    type: 'line',
    title: { text: 'Temperature Trend' },
    data: {
      values: [
        { time: '2:00', value: 8 },
        { time: '4:00', value: 9 },
        { time: '6:00', value: 11 },
        { time: '8:00', value: 14 },
        { time: '10:00', value: 16 },
      ]
    },
    xField: 'time',
    yField: 'value'
  },
  aspectRatio: '16:9',
  colorTheme: 'brand'
});
```

### Bar Chart Example

```typescript
const chartElement = createChartElement({
  chartSpec: {
    type: 'bar',
    title: { text: 'Sales by Category' },
    data: {
      values: [
        { category: 'Electronics', sales: 4500 },
        { category: 'Clothing', sales: 3200 },
        { category: 'Food', sales: 2800 },
      ]
    },
    xField: 'category',
    yField: 'sales',
    legends: { visible: true, orient: 'bottom' }
  },
  aspectRatio: '4:3'
});
```

### Pie Chart Example

```typescript
const chartElement = createChartElement({
  chartSpec: {
    type: 'pie',
    title: { text: 'Market Share' },
    data: {
      values: [
        { type: 'Product A', value: 40 },
        { type: 'Product B', value: 30 },
        { type: 'Product C', value: 20 },
        { type: 'Others', value: 10 },
      ]
    },
    valueField: 'value',
    categoryField: 'type',
    outerRadius: 0.9,
    innerRadius: 0.4, // Donut chart when innerRadius > 0
    legends: { visible: true }
  },
  aspectRatio: '1:1'
});
```

### Grouped Bar Chart

```typescript
const chartElement = createChartElement({
  chartSpec: {
    type: 'bar',
    title: { text: 'Revenue Comparison' },
    data: {
      values: [
        { year: '2023', type: 'Q1', value: 100 },
        { year: '2023', type: 'Q2', value: 120 },
        { year: '2024', type: 'Q1', value: 110 },
        { year: '2024', type: 'Q2', value: 140 },
      ]
    },
    xField: ['year', 'type'],
    yField: 'value',
    seriesField: 'type',
    legends: { visible: true, orient: 'bottom' }
  }
});
```

### Combination Chart (Line + Bar)

```typescript
const chartElement = createChartElement({
  chartSpec: {
    type: 'common',
    title: { text: 'Sales & Profit Trend' },
    data: [
      { values: salesData },
      { values: profitData }
    ],
    series: [
      {
        type: 'bar',
        dataIndex: 0,
        xField: 'month',
        yField: 'sales',
        seriesField: 'type'
      },
      {
        type: 'line',
        dataIndex: 1,
        xField: 'month',
        yField: 'profit',
        seriesField: 'type'
      }
    ],
    axes: [
      { orient: 'bottom' },
      { orient: 'left' }
    ],
    legends: { visible: true }
  }
});
```

## Chart Configuration Options

### Aspect Ratio
- `'1:1'` - Square (mobile default)
- `'2:1'` - Wide
- `'4:3'` - Standard
- `'16:9'` - Widescreen (PC default)

### Color Themes
- `'brand'` - Default Feishu theme
- `'rainbow'` - Rainbow colors
- `'complementary'` - Complementary colors
- `'converse'` - Contrasting colors
- `'primary'` - Single primary color

### Common VChart Properties

#### Title
```typescript
title: {
  text: 'Chart Title',
  subtext: 'Optional subtitle',
  visible: true
}
```

#### Legends
```typescript
legends: {
  visible: true,
  orient: 'bottom' | 'top' | 'left' | 'right'
}
```

#### Axes
```typescript
axes: [
  {
    orient: 'bottom' | 'left',
    title: { text: 'Axis Label', visible: true },
    type: 'linear' | 'band'
  }
]
```

#### Labels
```typescript
label: {
  visible: true,
  position: 'top' | 'inside',
  style: { fontSize: 12 }
}
```

## Best Practices

1. **Data Preparation**: Always prepare clean, structured data before creating charts
2. **Chart Selection**: Choose the right chart type for your data:
   - Trends → Line/Area charts
   - Comparisons → Bar charts
   - Proportions → Pie/Donut charts
   - Relationships → Scatter plots
   - Multi-dimensional → Radar charts
   - Progress → Linear/Circular progress

3. **Mobile Optimization**:
   - Use `'1:1'` aspect ratio for mobile
   - Limit data points to avoid clutter
   - Use clear labels

4. **Performance**:
   - Limit charts to 5 per card maximum
   - Avoid too many data series
   - Use appropriate data aggregation

## Integration with MessageCardRenderer

When rendering charts in Card V2 messages:

```typescript
import { MessageCardRenderer } from '../adapter/feishu/card-v2/message-card-renderer';
import { createChartElement } from '../adapter/feishu/card-v2/types/elements';

// In your ContentBlock renderer
if (block.type === 'chart_data') {
  const chartElement = createChartElement({
    chartSpec: block.chartSpec,
    aspectRatio: block.aspectRatio || '16:9'
  });
  elements.push(chartElement);
}
```

## VChart Version Compatibility

- Feishu 7.1-7.6: VChart 1.2.2
- Feishu 7.7-7.9: VChart 1.6.6
- Feishu 7.10-7.15: VChart 1.8.3
- Feishu 7.16-7.26: VChart 1.10.1
- Feishu 7.27+: VChart 1.12.3

Always check VChart documentation for the correct version: https://www.visactor.io/vchart

## Common Issues

1. **Charts not displaying**: Ensure `chart_spec` is a valid VChart spec object
2. **Mobile rendering issues**: Some VChart features not supported on mobile (texture, conical gradient, etc.)
3. **Too many charts**: Limit to 5 charts per card for optimal performance

## Examples in Action

### Dashboard Card with Multiple Charts

```typescript
const dashboardCard = {
  type: 'card',
  header: {
    title: { tag: 'plain_text', content: '📊 Sales Dashboard' },
    template: 'blue'
  },
  elements: [
    { tag: 'markdown', content: '**📈 Revenue Trend**' },
    createChartElement({
      chartSpec: { type: 'line', data: revenueData, xField: 'month', yField: 'revenue' },
      aspectRatio: '16:9'
    }),
    { tag: 'markdown', content: '**🏆 Top Products**' },
    createChartElement({
      chartSpec: { type: 'bar', data: productData, xField: 'product', yField: 'sales' },
      aspectRatio: '16:9'
    })
  ]
};
```

## Resources

- [VChart Documentation](https://www.visactor.io/vchart)
- [Feishu Card V2 Chart Component](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/content-components/chart)
- [VChart Examples](https://www.visactor.io/vchart/example)
