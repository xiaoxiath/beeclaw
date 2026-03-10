# Beeclaw Bot 性能与交互优化方案

## 问题分析

当前 Beeclaw Bot 响应较慢，主要瓶颈：

### 1. **AI 响应延迟** (主要瓶颈)
- LLM API 调用：2-10秒
- 多轮工具调用：每次 1-5秒
- 总响应时间：3-15秒

### 2. **系统处理延迟** (次要瓶颈)
- Memory 加载：50-200ms
- Session 压缩：100-500ms
- 工具执行：100-1000ms
- Feishu API 调用：100-300ms

### 3. **用户感知延迟** (体验问题)
- 无进度反馈：用户不知道在处理中
- 无即时响应：等待时间长
- 无预估时间：不知道要等多久

## 优化方案

### 方案 A：性能优化 (降低实际延迟)

#### A1. **并行化处理** ⭐⭐⭐⭐⭐

**当前问题**:
```typescript
// 顺序执行
const memory = await loadMemory();        // 100-200ms
const skills = await loadSkills();        // 50-100ms
const context = await buildContext();     // 50-100ms
const response = await callLLM();         // 2000-10000ms
// 总耗时: 2300-10400ms
```

**优化方案**:
```typescript
// 并行执行
const [memory, skills, context] = await Promise.all([
  loadMemory(),      // 并行
  loadSkills(),      // 并行
  buildContext(),    // 并行
]);
const response = await callLLM(memory, skills, context);
// 总耗时: 2000-10300ms (节省 200-300ms)
```

**预期效果**: 节省 200-500ms

#### A2. **缓存优化** ⭐⭐⭐⭐

**优化点**:
1. **System Prompt 缓存**
   - 当前：每次都构建
   - 优化：缓存构建结果，只在配置变更时重建
   - 预期节省：50-100ms

2. **Memory 缓存**
   - 当前：每次请求都加载
   - 优化：内存中缓存，只在文件变更时重新加载
   - 预期节省：100-200ms

3. **Skills 缓存**
   - 当前：每次都列出所有技能
   - 优化：缓存技能列表，定期刷新
   - 预期节省：50-100ms

**预期效果**: 节省 200-400ms

#### A3. **流式响应** ⭐⭐⭐⭐⭐

**当前问题**:
- 用户等待完整响应（3-15秒）才开始看到内容

**优化方案**:
```typescript
// 使用流式 API
const stream = await callLLMStream(prompt);

// 立即发送"正在思考"提示
await client.sendText(messageId, "正在思考...");

// 逐块发送响应
for await (const chunk of stream) {
  accumulated += chunk;
  if (accumulated.length > 100) {
    // 每累积 100 字符就发送一次
    await client.updateText(messageId, accumulated);
  }
}
```

**预期效果**:
- 首 字节时间：从 3-15秒 降低到 1-3秒
- 用户感知延迟：降低 60-80%

#### A4. **快速路径** ⭐⭐⭐

**优化方案**: 对简单查询使用快速处理

```typescript
// 简单查询检测
function isSimpleQuery(message: string): boolean {
  // 简短问题 (< 20字符)
  // 无需工具调用
  // 无需记忆访问
  return message.length < 20 &&
         !message.includes('?') &&
         !needsToolAccess(message);
}

// 快速路径
if (isSimpleQuery(message)) {
  // 跳过 memory 加载
  // 跳过 skills 匹配
  // 直接调用 LLM
  return await quickLLMCall(message);
}
```

**预期效果**: 简单查询响应时间降低 30-50%

#### A5. **预加载优化** ⭐⭐⭐

**优化方案**:
```typescript
// 在 bot 启动时预加载
async function preloadResources() {
  await Promise.all([
    loadAllMemory(),
    loadAllSkills(),
    warmUpLLMConnection(),
  ]);
}

// 用户消息来时直接使用
```

**预期效果**: 节省 200-300ms

---

### 方案 B：交互优化 (改善用户感知)

#### B1. **即时反馈** ⭐⭐⭐⭐⭐

**当前问题**: 用户发送消息后无任何反馈，不知道是否收到

**优化方案**:
```typescript
// 收到消息立即回复
wsClient.on('message', async (message) => {
  // 1. 立即发送"收到"反馈 (< 100ms)
  const thinkingMsg = await client.replyText(
    messageId,
    '💭 收到消息，正在思考...'
  );

  // 2. 开始处理
  const result = await processMessage(message);

  // 3. 更新为实际响应
  await client.updateText(thinkingMsg, result.response);
});
```

**预期效果**:
- 用户感知延迟：从 3-15秒 降低到 < 1秒
- 用户体验：大幅提升

#### B2. **进度提示** ⭐⭐⭐⭐

**优化方案**:
```typescript
// 显示处理进度
async function processWithProgress(message: string) {
  const steps = [
    '📚 加载记忆中...',
    '🛠️ 查找相关技能...',
    '🤔 思考中...',
    '✍️ 生成回复中...'
  ];

  let currentStep = 0;
  const progressMsg = await client.replyText(messageId, steps[0]);

  // 后台处理，定期更新进度
  const progressInterval = setInterval(() => {
    currentStep = (currentStep + 1) % steps.length;
    client.updateText(progressMsg, steps[currentStep]);
  }, 2000);

  try {
    const result = await processMessage(message);
    clearInterval(progressInterval);
    await client.updateText(progressMsg, result.response);
  } catch (error) {
    clearInterval(progressInterval);
    await client.updateText(progressMsg, '❌ 处理失败，请重试');
  }
}
```

**预期效果**: 用户知道系统在工作，焦虑感降低

#### B3. **预计时间提示** ⭐⭐⭐

**优化方案**:
```typescript
// 根据任务复杂度预估时间
function estimateProcessingTime(message: string): string {
  if (isSimpleQuery(message)) return '约 3-5 秒';
  if (needsTools(message)) return '约 10-20 秒';
  if (needsDeepAnalysis(message)) return '约 30-60 秒';
  return '约 5-10 秒';
}

// 在反馈中显示预估时间
await client.replyText(
  messageId,
  `💭 收到消息，正在处理中（预计 ${estimateProcessingTime(message)}）...`
);
```

**预期效果**: 用户有心理预期，焦虑感降低

#### B4. **打字动画** ⭐⭐⭐

**优化方案**:
```typescript
// 模拟打字效果
async function sendWithTypingEffect(message: string, text: string) {
  const thinkingMsg = await client.replyText(messageId, '💬');

  // 逐字符显示
  let displayText = '';
  for (const char of text) {
    displayText += char;
    if (displayText.length % 5 === 0) {
      await client.updateText(thinkingMsg, displayText);
      await sleep(50); // 50ms 延迟
    }
  }
  await client.updateText(thinkingMsg, displayText);
}
```

**预期效果**: 用户感觉更自然，像真人在回复

#### B5. **后台任务通知** ⭐⭐⭐⭐⭐

**优化方案**: 对于长时间任务，立即返回，后台处理

```typescript
// 检测长时间任务
if (isLongRunningTask(message)) {
  // 立即回复
  await client.replyText(
    messageId,
    '✅ 已收到任务，我会在后台处理，完成后通知你。你可以继续聊天！'
  );

  // 后台处理
  spawn_subagent({
    type: 'code',
    task: message,
  }).then(result => {
    // 完成后推送结果
    client.sendText(chatId, `✨ 任务完成！\n\n${result.response}`);
  });

  return; // 立即返回，不阻塞
}
```

**预期效果**:
- 用户可以继续对话
- 不阻塞主流程
- 体验极佳

---

## 推荐实施顺序

### 第一阶段：立即实施 (1-2天)

1. **B1. 即时反馈** ⭐⭐⭐⭐⭐
   - 工作量：小
   - 效果：立竿见影
   - 风险：低

2. **B5. 后台任务通知** ⭐⭐⭐⭐⭐
   - 工作量：小
   - 效果：解决长时间任务阻塞问题
   - 风险：低

### 第二阶段：短期优化 (3-5天)

3. **A1. 并行化处理** ⭐⭐⭐⭐⭐
   - 工作量：中
   - 效果：节省 200-500ms
   - 风险：中

4. **A2. 缓存优化** ⭐⭐⭐⭐
   - 工作量：中
   - 效果：节省 200-400ms
   - 风险：低

5. **B2. 进度提示** ⭐⭐⭐⭐
   - 工作量：小
   - 效果：改善用户体验
   - 风险：低

### 第三阶段：中期优化 (1-2周)

6. **A3. 流式响应** ⭐⭐⭐⭐⭐
   - 工作量：大
   - 效果：首 字节时间降低 60-80%
   - 风险：中

7. **A5. 预加载优化** ⭐⭐⭐
   - 工作量：中
   - 效果：节省 200-300ms
   - 风险：低

### 第四阶段：长期优化 (可选)

8. **A4. 快速路径** ⭐⭐⭐
   - 工作量：中
   - 效果：简单查询快 30-50%
   - 风险：中

9. **B3. 预计时间提示** ⭐⭐⭐
   - 工作量：小
   - 效果：改善用户体验
   - 风险：低

10. **B4. 打字动画** ⭐⭐⭐
    - 工作量：小
    - 效果：增加自然感
    - 风险：低

---

## 快速实施方案 (今天就能完成)

### 最小可行方案：即时反馈

在 `src/routes/proactive.ts` 中添加：

```typescript
// 收到消息时
wsClient.on('message', async (message) => {
  // 1. 立即发送"思考中"反馈
  const thinkingMsg = await client.replyText(
    messageId,
    '💭 收到消息，正在思考...'
  );

  // 2. 处理消息
  const result = await sendProactiveMessage({...});

  // 3. 更新为实际响应
  if (result.success) {
    await client.updateText(thinkingMsg, result.response);
  } else {
    await client.updateText(thinkingMsg, '❌ 处理失败，请重试');
  }
});
```

**效果**:
- 实施时间：1小时
- 用户感知延迟：从 3-15秒 → < 1秒
- 用户体验：显著提升

---

## 预期总体效果

### 实施第一阶段后:
- **用户感知延迟**: 3-15秒 → < 1秒 (降低 70-90%)
- **实际响应时间**: 基本不变
- **用户体验**: 显著提升

### 实施第二阶段后:
- **用户感知延迟**: < 1秒
- **实际响应时间**: 降低 15-25%
- **用户体验**: 大幅提升

### 实施第三阶段后:
- **用户感知延迟**: < 1秒
- **实际响应时间**: 降低 40-60%
- **首 字节时间**: 降低 60-80%
- **用户体验**: 极佳

---

## 监控指标

建议添加以下指标监控：

1. **响应时间分布**
   - P50, P90, P95 响应时间
   - 首 字节时间 (TTFB)
   - 总响应时间

2. **用户感知指标**
   - 即时反馈时间 (< 1秒)
   - 进度更新频率
   - 用户等待时长

3. **系统性能指标**
   - Memory 加载时间
   - Skills 加载时间
   - LLM API 调用时间
   - 工具执行时间

4. **缓存命中率**
   - Memory 缓存命中率
   - Skills 缓存命中率
   - System Prompt 缓存命中率
