# 插件开发全流程

> 让 Beeclaw 帮你扩展功能（用户视角 + 开发者视角）

---

## 🎯 两种使用方式

### 方式 1：用户视角（推荐）
让 Beeclaw 帮你开发插件 - 无需编程知识

### 方式 2：开发者视角
自己开发插件 - 需要 TypeScript 基础

---

# 方式 1：用户视角 - 让 Beeclaw 开发插件

## 场景

你希望 Beeclaw 在代码提交前自动：
1. 运行代码质量检查
2. 检测复杂度
3. 给出优化建议

## 步骤

### 步骤 1：告诉 Beeclaw 你的需求

```
用户: 帮我开发一个插件，在代码提交前自动运行 ESLint 检查，并给出优化建议
```

**Beeclaw 会**:
1. ✅ 理解你的需求
2. ✅ 设计插件架构
3. ✅ 编写插件代码
4. ✅ 安装和测试

**预期回复**:
```
Beeclaw: 好的！我来帮你开发"代码质量检查"插件。

插件功能：
- ✅ 自动运行 ESLint 检查
- ✅ 检测代码复杂度
- ✅ 给出优化建议
- ✅ 在代码提交前自动触发

开发进度：
[1/4] 设计插件架构... ✅
[2/4] 编写 manifest.json... ✅
[3/4] 实现 Hook 逻辑... ✅
[4/4] 安装到 Beeclaw... ✅

✅ 插件已安装并启用！

测试方法：
写代码时我会自动检查质量，或者你说"检查这段代码的质量"
```

---

### 步骤 2：测试插件

```
用户: 检查这段代码的质量：

function calculateTotal(items) {
  var total = 0;
  for (var i = 0; i < items.length; i++) {
    total = total + items[i].price * items[i].quantity;
  }
  return total;
}
```

**预期输出**:
```
Beeclaw: 代码质量检查结果：

## ✅ 功能正确性
代码逻辑正确，能正确计算总价。

## ⚠️ 代码质量问题（3个）

1. **使用 var 而非 let/const**
   - 位置: 第 2-3 行
   - 建议: 使用 const 或 let 代替 var
   - 原因: var 有变量提升问题

2. **缺少类型定义**
   - 建议: 添加 TypeScript 类型注解
   - 示例: `function calculateTotal(items: Item[]): number`

3. **使用传统 for 循环**
   - 建议: 使用 reduce 方法更简洁
   - 示例: `items.reduce((sum, item) => sum + item.price * item.quantity, 0)`

## 🎯 优化后代码

```typescript
interface Item {
  price: number;
  quantity: number;
}

function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
```

需要我自动修复这些问题吗？
```

---

### 步骤 3：改进插件

```
用户: 插件还需要添加：
1. 检测代码重复
2. 检查命名规范
3. 支持多种语言（JavaScript, TypeScript, Python）
```

**Beeclaw 会**:
1. ✅ 理解改进需求
2. ✅ 更新插件代码
3. ✅ 重新加载插件

---

### 步骤 4：管理插件

```
用户: 查看我安装的所有插件
```

**预期输出**:
```
Beeclaw: 你有 3 个插件：

1. **代码质量检查** ⭐⭐⭐
   - 版本: 1.2.0
   - 状态: ✅ 启用
   - 功能: ESLint、复杂度检测、代码重复检查

2. **自动文档生成** ⭐⭐
   - 版本: 1.0.0
   - 状态: ✅ 启用
   - 功能: 从代码自动生成文档

3. **性能监控** ⭐
   - 版本: 0.5.0
   - 状态: ⏸️ 暂停
   - 功能: 监控代码性能

需要管理某个插件吗？
```

---

### 步骤 5：禁用/删除插件

```
用户: 暂停"性能监控"插件
```

**预期回复**:
```
Beeclaw: ✅ 已暂停"性能监控"插件

插件仍然保留，但不会执行。
需要时可以说"启用性能监控插件"。
```

---

# 方式 2：开发者视角 - 自己开发插件

## 前置条件

- [ ] TypeScript 基础
- [ ] 理解 Beeclaw 插件架构
- [ ] 熟悉 Hook 机制

---

## 步骤

### 步骤 1：创建插件项目

让 Beeclaw 帮你创建插件脚手架：

```
用户: 创建一个插件开发环境，插件名是"代码质量检查"
```

**Beeclaw 会**:
1. 创建目录结构
2. 生成配置文件
3. 创建示例代码

**预期输出**:
```
Beeclaw: ✅ 已创建插件开发环境

插件目录: plugins/code-quality/
├── plugin.json       # 插件清单
├── src/
│   └── index.ts      # 入口文件
├── package.json
└── tsconfig.json

需要我帮你实现插件逻辑吗？
```

---

### 步骤 2：实现插件逻辑

告诉 Beeclaw 你需要的功能：

```
用户: 实现以下功能：
1. Hook onToolCall，在 file_write 时自动检查代码
2. 提供工具 code_lint 运行 ESLint
3. 提供工具 code_complexity 分析复杂度
```

**Beeclaw 会**:
1. 编写 Hook 逻辑
2. 实现工具函数
3. 添加类型定义

---

### 步骤 3：测试插件

```
用户: 测试"代码质量检查"插件
```

**预期输出**:
```
Beeclaw: 正在测试插件...

✅ 插件加载成功
✅ Hook 注册成功
✅ 工具可调用

测试结果：
- onToolCall Hook: ✅ 正常
- code_lint 工具: ✅ 正常
- code_complexity 工具: ✅ 正常

插件已经可以使用了。
```

---

### 步骤 4：发布插件

#### 发布到 npm

```
用户: 发布插件到 npm
```

**Beeclaw 会**:
1. 构建生产版本
2. 发布到 npm
3. 提供安装命令

---

#### 或发布到本地

```
用户: 安装插件到 Beeclaw
```

**预期回复**:
```
Beeclaw: ✅ 插件已安装

安装位置: ~/.beeclaw/plugins/code-quality
状态: ✅ 启用

其他用户可以通过以下命令安装：
beeclaw plugin install code-quality
```

---

## 插件开发最佳实践

### 1. Hook 使用

**常用 Hook 点位**:
- `onToolCall` - 工具调用前/后
- `onAgentMessage` - Agent 生成消息时
- `onMemoryWrite` - 写入记忆时
- `onSkillExecute` - 执行技能时

### 2. 工具设计

**原则**:
- 单一职责
- 参数简洁
- 错误处理完善
- 返回结构化结果

### 3. 性能优化

**建议**:
- 异步操作
- 缓存结果
- 按需加载
- 避免阻塞主流程

---

## 常见问题

### Q1: 用户视角 vs 开发者视角，选哪个？

**A**:
- **用户视角**：推荐！无需编程，Beeclaw 帮你完成
- **开发者视角**：需要完全控制、或者要发布给其他用户

### Q2: 插件会影响 Beeclaw 性能吗？

**A**: Beeclaw 会优化：
- 插件按需加载
- 异步执行
- 失败不影响主流程

### Q3: 如何调试插件？

**A**: 告诉 Beeclaw：
```
用户: 调试"代码质量检查"插件，查看详细日志
```

### Q4: 插件可以调用其他插件吗？

**A**: 可以！Beeclaw 会协调插件间的调用。

### Q5: 如何分享插件？

**A**:
- 发布到 npm（公开）
- 导出为文件（私有）
- 通过 Beeclaw 市场（未来功能）

---

## 验证

### 用户视角验证

- [ ] 能让 Beeclaw 创建插件
- [ ] 插件功能符合预期
- [ ] 能改进插件
- [ ] 能管理插件

### 开发者视角验证

- [ ] 插件能正确加载
- [ ] Hook 正常触发
- [ ] 工具可被调用
- [ ] 错误处理完善

---

## 下一步

- **[创建第一个技能](../basic/first-skill.md)** - 技能 vs 插件，选择合适的
- **[子代理编排](./subagent-orchestration.md)** - 在插件中使用子代理

---

**预计完成时间**: 用户视角 10分钟 / 开发者视角 60分钟
**难度**: ⭐⭐⭐
**标签**: 插件开发、Hook、工具扩展、对话式开发
