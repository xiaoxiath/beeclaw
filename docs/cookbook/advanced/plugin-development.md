# 插件开发全流程

> 60分钟掌握 OpenClaw 兼容插件开发

## 场景

你需要开发一个"代码质量检查"插件，在用户提交代码前自动：
1. 运行 ESLint 检查
2. 检测代码复杂度
3. 给出优化建议

## 目标

- ✅ 理解插件系统架构
- ✅ 创建插件 manifest.json
- ✅ 实现 Hook 点位
- ✅ 注册自定义工具
- ✅ 测试和发布

## 前置条件

- [ ] 已完成 [系统架构](../../architecture.md) 学习
- [ ] TypeScript 基础
- [ ] 理解 [插件系统](../../guide/plugin-system.md)

---

## 步骤

### 步骤 1：创建插件目录

```bash
mkdir -p plugins/code-quality
cd plugins/code-quality
```

### 步骤 2：编写 manifest.json

```json
{
  "name": "code-quality",
  "version": "1.0.0",
  "description": "代码质量检查插件",
  "author": "Your Name",
  "main": "dist/index.js",
  "hooks": [
    "onToolCall",
    "onAgentMessage"
  ],
  "tools": [
    "code_lint",
    "code_complexity"
  ]
}
```

### 步骤 3：实现插件逻辑

```typescript
// src/index.ts
import { Plugin, Tool, Hook } from 'beeclaw-plugin-sdk';

export default class CodeQualityPlugin implements Plugin {
  name = 'code-quality';

  // Hook: 工具调用前
  async onToolCall(context: ToolCallContext) {
    if (context.tool === 'file_write' && isCodeFile(context.params.path)) {
      // 自动运行 lint
      const lintResult = await this.runLint(context.params.content);
      if (lintResult.errors > 0) {
        context.addMessage({
          role: 'assistant',
          content: `⚠️ 检测到 ${lintResult.errors} 个代码问题`
        });
      }
    }
  }

  // 工具: 代码检查
  @Tool({
    name: 'code_lint',
    description: '运行 ESLint 检查',
    parameters: {
      code: { type: 'string', required: true }
    }
  })
  async lintCode(params: { code: string }) {
    // 实现逻辑...
  }

  // 工具: 复杂度分析
  @Tool({
    name: 'code_complexity',
    description: '分析代码复杂度'
  })
  async analyzeComplexity(params: { code: string }) {
    // 实现逻辑...
  }
}
```

### 步骤 4：测试插件

```bash
# 构建
bun run build

# 本地测试
beeclaw --plugin ./plugins/code-quality

# 验证
> 检查这段代码的质量：[代码]
```

### 步骤 5：发布

```bash
# 发布到 npm
npm publish @beeclaw/plugin-code-quality

# 或复制到全局插件目录
cp -r dist ~/.beeclaw/plugins/
```

---

## 验证

- [ ] 插件能正确加载
- [ ] Hook 正常触发
- [ ] 工具可被调用
- [ ] 错误处理完善

---

**预计完成时间**: 60分钟
**难度**: ⭐⭐⭐
**标签**: 插件开发、Hook、工具扩展
