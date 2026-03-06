# Onboarding Wizard - 首次初始化向导

## 功能说明

Beeclaw 在首次初始化时会自动检测 `SOUL.md` 和 `USER.md` 文件是否存在。如果不存在，会启动初始化向导帮助用户创建这些文件。

## 工作流程

### 1. 自动检测

在 `initApp()` 初始化过程中，系统会检查 memory 目录下是否存在这两个核心文件：

```typescript
if (needsOnboarding(memoryPath)) {
  // 启动向导
}
```

### 2. 交互式向导（TTY 模式）

如果在交互式终端（TTY）中运行，会启动交互式向导：

```
╔════════════════════════════════════════════════════════╗
║  🎉 Welcome to Beeclaw!                                ║
║                                                        ║
║  Let's set up your personal AI assistant.              ║
║  This will only take a few minutes.                    ║
╚════════════════════════════════════════════════════════╝
```

向导会询问：

#### SOUL.md（AI 人格）设置：
1. **核心价值观** - AI 应该具备哪些价值观？
   - 示例：helpful, honest, creative, concise, thorough
2. **沟通风格** - AI 应该如何沟通？
   - 示例：casual, formal, friendly, professional
3. **专业领域** - AI 应该专注于哪些领域？
   - 示例：programming, writing, analysis, brainstorming
4. **行为准则** - 特定的行为指导？
   - 示例："Be proactive", "Ask before acting"

#### USER.md（用户信息）设置：
1. **姓名和角色** - 用户是谁？
2. **背景** - 技能、经验、兴趣
3. **目标** - 使用 AI 助手的主要目标
4. **偏好** - 对 AI 响应的偏好
5. **语言** - 首选沟通语言

### 3. 快速设置（非 TTY 模式）

如果在非交互式环境（如 daemon、bot 模式）中运行，会使用快速设置创建默认文件：

```typescript
await quickSetup(memoryPath);
```

这会创建包含合理默认值的 SOUL.md 和 USER.md 文件。

## 文件结构

### SOUL.md 示例

```markdown
# SOUL

## Core Values

- Helpful and supportive
- Honest and transparent
- Clear and concise
- Practical and solution-oriented

## Communication Style

- Friendly but professional
- Adapts to user's needs
- Provides explanations when helpful
- Direct and efficient

## Expertise Areas

- General assistance and problem-solving
- Learning and research
- Task automation and productivity
- Programming and technical help

## Behavioral Guidelines

Be proactive but ask before important actions.
Provide context and reasoning when helpful.
Respect user's time with concise responses.
Learn from interactions to improve over time.

---

_This file defines my personality and behavior. Feel free to edit it to customize my responses._
```

### USER.md 示例

```markdown
# USER

## Basic Information

- **Name/Role**: Developer
- **Language**: 中文

## Background

Full-stack developer interested in AI and automation.

## Goals

- Get helpful assistance with various tasks
- Learn and improve productivity
- Automate repetitive work

## Preferences

- Clear and practical responses
- Explanations when learning new concepts
- Efficient solutions

---

_This file describes you. Update it anytime to help the AI better understand your needs._
```

## 自定义

### 手动编辑

用户可以随时编辑 `data/memory/SOUL.md` 和 `data/memory/USER.md` 来自定义 AI 的行为。

### 重新初始化

要重新运行向导：
1. 删除或重命名现有的 SOUL.md 和 USER.md
2. 重启 Beeclaw

```bash
cd data/memory
mv SOUL.md SOUL.md.backup
mv USER.md USER.md.backup
# 重启 beeclaw
```

## 实现细节

### 核心文件

1. **`src/app/onboarding.ts`** - 向导实现
   - `needsOnboarding()` - 检测是否需要初始化
   - `runOnboardingWizard()` - 交互式向导
   - `quickSetup()` - 快速设置（默认值）

2. **`src/app/index.ts`** - 初始化逻辑
   - 在 `initApp()` 中调用向导
   - 区分 TTY 和非 TTY 模式

3. **`src/memory/store.ts`** - 内存存储
   - 修改 `ensureCoreMemoryFiles()` 不再自动创建空模板
   - 由 onboarding 系统负责创建

### 环境检测

```typescript
const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

if (isInteractive) {
  await runOnboardingWizard(memoryPath);
} else {
  await quickSetup(memoryPath);
}
```

## 测试

运行测试脚本：

```bash
bun run scripts/test-onboarding.ts
```

测试覆盖：
- ✅ 检测空目录需要 onboarding
- ✅ quickSetup 创建文件
- ✅ 设置后不再需要 onboarding
- ✅ 文件内容格式正确

## 最佳实践

1. **首次运行** - 在交互式终端中首次运行以获得个性化体验
2. **Bot 模式** - 自动使用快速设置，无需交互
3. **定期更新** - 随时编辑文件以调整 AI 行为
4. **备份** - 重要的自定义应该备份或版本控制

## 未来改进

- [ ] 支持从模板导入 SOUL/USER 配置
- [ ] 提供多种预设人格模板
- [ ] 支持通过配置文件跳过向导
- [ ] 添加验证和格式检查
