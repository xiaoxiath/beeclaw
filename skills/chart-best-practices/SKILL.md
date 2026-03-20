---
name: chart-best-practices
description: Best practices for creating effective data visualizations with create_chart tool
maturity: mature
tags: [visualization, charts, data-presentation, best-practices, feishu, vchart]
triggers:
  - when_user_mentions: [chart, charts, graph, visualize, visualization, 图表, 可视化, 数据可视化, 画图, 绘图]
  - when_tool_is_called: create_chart
---

# Chart Visualization Best Practices

Guide for creating clear, effective chart visualizations using the `create_chart` tool.

## Data Field Naming (IMPORTANT)

The chart renderer auto-detects field mappings based on field names. **Use descriptive field names** instead of generic `x`/`y`:

### ✅ Good - Descriptive Names
```json
[
  { "week": "周一", "steps": 8500 },
  { "week": "周二", "steps": 12000 }
]
```

### ❌ Avoid - Generic Names
```json
[
  { "x": "周一", "y": 8500 },
  { "x": "周二", "y": 12000 }
]
```

## Chart Type Selection Guide

### 1. Line Chart (`line`) - Trends Over Time
**Best for**: Showing changes over continuous time periods

```json
{
  "chartType": "line",
  "title": "📈 周度步数统计",
  "data": [
    { "week": "周一", "steps": 8500 },
    { "week": "周二", "steps": 12000 },
    { "week": "周三", "steps": 7800 }
  ],
  "aspectRatio": "2:1"
}
```

**Data format**: `[{ time_field: string, value_field: number }]`

### 2. Bar Chart (`bar`) - Comparisons
**Best for**: Comparing values across discrete categories

```json
{
  "chartType": "bar",
  "title": "🏆 销售排行榜",
  "data": [
    { "product": "iPhone", "sales": 4500 },
    { "product": "MacBook", "sales": 3200 },
    { "product": "iPad", "sales": 2800 }
  ],
  "aspectRatio": "16:9"
}
```

**Data format**: `[{ category_field: string, value_field: number }]`

### 3. Pie Chart (`pie`) - Proportions
**Best for**: Showing parts of a whole (≤ 6 categories)

```json
{
  "chartType": "pie",
  "title": "💰 本月支出分布",
  "data": [
    { "name": "房贷", "value": 12000 },
    { "name": "餐饮", "value": 3500 },
    { "name": "交通", "value": 800 }
  ],
  "aspectRatio": "1:1"
}
```

**Data format**: `[{ name: string, value: number }]`

### 4. Linear Progress (`linearProgress`) - Progress Tracking
**Best for**: Showing completion percentage

```json
{
  "chartType": "linearProgress",
  "title": "🎯 年度储蓄目标",
  "data": [
    { "value": 42, "total": 50 }
  ]
}
```

**Data format**: `[{ value: number, total: number }]`

### 5. Circular Progress (`circularProgress`) - Circular Progress
**Best for**: Circular progress indicators

```json
{
  "chartType": "circularProgress",
  "title": "🎯 项目进度",
  "data": [
    { "type": "总进度", "value": 0.15, "text": "15%" }
  ]
}
```

**Data format**: `[{ type: string, value: number (0-1), text?: string }]`
**IMPORTANT**:
- `value` should be normalized between 0-1 (e.g., 0.15 = 15%)
- `type` is required for category/label
- `text` is optional for display text

### 6. Scatter Plot (`scatter`) - Correlations
**Best for**: Showing relationships between two variables

```json
{
  "chartType": "scatter",
  "title": "📈 身高体重关系",
  "data": [
    { "height": 170, "weight": 65 },
    { "height": 175, "weight": 70 }
  ]
}
```

**Data format**: `[{ x_field: number, y_field: number }]`

## Common Field Name Patterns

The renderer recognizes these patterns for auto-detection:

**X-Axis / Category fields**:
- `week`, `day`, `month`, `year`, `time`, `date`
- `category`, `label`, `name`, `type`

**Y-Axis / Value fields**:
- `value`, `count`, `amount`, `sales`, `steps`
- `score`, `total`, `number`

## Aspect Ratio Selection

- **`1:1`** - Square, best for mobile and pie charts
- **`2:1`** - Wide, good for line/bar charts (default)
- **`4:3`** - Standard, balanced for most charts
- **`16:9`** - Widescreen, best for PC/dashboard

## Color Themes

- **`brand`** - Default Feishu theme (recommended)
- **`rainbow`** - Vibrant multi-color (good for pie charts)
- **`complementary`** - Two complementary colors
- **`primary`** - Single color gradient

## Advanced Customization with `spec`

Use the `spec` parameter for fine-grained control:

```json
{
  "chartType": "bar",
  "data": [...],
  "spec": {
    "legends": { "visible": true, "orient": "bottom" },
    "axes": [
      { "orient": "bottom", "title": { "text": "月份" } },
      { "orient": "left", "title": { "text": "销售额" } }
    ]
  }
}
```

## Best Practices

1. **Limit data points**:
   - Line/bar charts: ≤ 20 points
   - Pie charts: ≤ 6 slices
   - Scatter plots: ≤ 100 points

2. **Use clear titles**:
   - Include emoji for visual appeal: `"📈 销售趋势"`
   - Be specific: `"2024年Q1营收"` not `"数据"`

3. **Choose appropriate aspect ratio**:
   - Mobile users: prefer `1:1` or `2:1`
   - Time-series: prefer `16:9` for longer trends

4. **Avoid chart spam**:
   - Maximum 3-5 charts per message
   - Combine related data when possible

## Anti-Patterns to Avoid

❌ **Too many pie slices**:
```json
// Bad: 10 categories in pie chart
{ "chartType": "pie", "data": [ ...10 items... ] }
```
✅ **Use bar chart instead**:
```json
{ "chartType": "bar", "data": [ ...10 items... ] }
```

❌ **Missing descriptive fields**:
```json
// Bad: Generic field names
{ "chartType": "bar", "data": [{ "x": "A", "y": 10 }] }
```
✅ **Use meaningful names**:
```json
{ "chartType": "bar", "data": [{ "product": "iPhone", "sales": 10 }] }
```

## Examples by Use Case

### Financial Report
```json
{
  "chartType": "pie",
  "title": "💰 月度支出",
  "data": [
    { "name": "房租", "value": 8000 },
    { "name": "餐饮", "value": 3000 },
    { "name": "交通", "value": 500 }
  ],
  "aspectRatio": "1:1",
  "colorTheme": "rainbow"
}
```

### Fitness Tracking
```json
{
  "chartType": "line",
  "title": "🏃 本周步数",
  "data": [
    { "day": "周一", "steps": 8500 },
    { "day": "周二", "steps": 12000 },
    { "day": "周三", "steps": 7800 }
  ],
  "aspectRatio": "16:9"
}
```

### Sales Dashboard
```json
{
  "chartType": "bar",
  "title": "🏆 销售排行 TOP 5",
  "data": [
    { "name": "张三", "sales": 50000 },
    { "name": "李四", "sales": 45000 },
    { "name": "王五", "sales": 38000 }
  ],
  "aspectRatio": "4:3",
  "colorTheme": "brand"
}
```

## Resources

- VChart Documentation: https://www.visactor.io/vchart
- Feishu Card V2 Charts: See `skills/feishu/feishu-card-charts.md`
