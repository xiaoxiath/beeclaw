# Phase 3.1: LLM 钩子实施计划

## 目标

实施 4 个高优先级 LLM 相关钩子：
1. `before_prompt_build` - 提示构建前
2. `llm_input` - LLM 调用前
3. `llm_output` - LLM 响应后
4. `before_model_resolve` - 模型解析前（暂缓）

## 实施步骤

### 步骤 1: before_prompt_build 钩子 ✅

**位置**: `src/agent/index.ts` - `buildSystemPromptWithHooks()` 方法

**状态**: 已添加辅助方法，需要在 `refreshMemory()` 和 `createAgent()` 中使用

**代码**:
```typescript
private async buildSystemPromptWithHooks(
  basePrompt: string,
  coreContext?: { user: string; soul: string; facts?: string; skills?: string },
  sessionContext?: Session
): Promise<string> {
  // Trigger before_prompt_build hook
  if (this.hookRunner) {
    const modifiedContext = await this.hookRunner.runBeforePromptBuild({
      basePrompt,
      coreContext,
      sessionContext,
      timestamp: new Date().toISOString(),
    });

    // Use modified context if returned
    if (modifiedContext) {
      basePrompt = modifiedContext.basePrompt || basePrompt;
      coreContext = modifiedContext.coreContext || coreContext;
      sessionContext = modifiedContext.sessionContext || sessionContext;
    }
  }

  // Build the prompt
  return buildSystemPrompt(basePrompt, coreContext, sessionContext);
}
```

### 步骤 2: llm_input 钩子（待实施）

**位置**: `src/agent/index.ts` - `chat()` 方法中，在 `callAI()` 调用前

**实施代码**:
```typescript
// 在 callAI 之前添加
let aiCallParams = {
  provider: this.options.provider,
  model: this.options.model,
  messages: this.messages,
  tools,
  temperature: this.options.temperature,
  topP: this.options.topP,
  maxTokens: this.options.maxTokens,
};

// Trigger llm_input hook
if (this.hookRunner) {
  const inputEvent = {
    ...aiCallParams,
    timestamp: new Date().toISOString(),
  };
  
  const modifiedInput = await this.hookRunner.runLlmInput(inputEvent);
  
  // Use modified input if returned
  if (modifiedInput) {
    aiCallParams = {
      provider: modifiedInput.provider || aiCallParams.provider,
      model: modifiedInput.model || aiCallParams.model,
      messages: modifiedInput.messages || aiCallParams.messages,
      tools: modifiedInput.tools || aiCallParams.tools,
      temperature: modifiedInput.temperature ?? aiCallParams.temperature,
      topP: modifiedInput.topP ?? aiCallParams.topP,
      maxTokens: modifiedInput.maxTokens ?? aiCallParams.maxTokens,
    };
  }
}

const response = await callAI(aiCallParams);
```

### 步骤 3: llm_output 钩子（待实施）

**位置**: `src/agent/index.ts` - `chat()` 方法中，在 `callAI()` 响应后

**实施代码**:
```typescript
const response = await callAI(aiCallParams);

// Trigger llm_output hook
let finalResponse = response;
if (this.hookRunner) {
  const outputEvent = {
    response,
    timestamp: new Date().toISOString(),
  };
  
  const modifiedOutput = await this.hookRunner.runLlmOutput(outputEvent);
  
  // Use modified response if returned
  if (modifiedOutput?.response) {
    finalResponse = modifiedOutput.response;
  }
}

const assistantMessage = finalResponse.choices[0].message;
```

### 步骤 4: before_model_resolve 钩子（暂缓）

**原因**: Beeclaw 当前没有动态模型解析机制，此钩子暂时无法实现

**建议**: 在未来添加模型路由功能时实施

## 测试计划

### 测试用例 1: before_prompt_build
```typescript
// 插件中注册钩子
api.on("before_prompt_build", async (event) => {
  // 修改系统提示
  return {
    basePrompt: event.basePrompt + "\n\nAdditional instructions...",
  };
});
```

### 测试用例 2: llm_input
```typescript
// 插件中注册钩子
api.on("llm_input", async (event) => {
  // 过滤敏感信息
  const filteredMessages = event.messages.map(msg => {
    if (msg.role === 'user') {
      msg.content = msg.content.replace(/password=\S+/g, 'password=***');
    }
    return msg;
  });
  
  return { messages: filteredMessages };
});
```

### 测试用例 3: llm_output
```typescript
// 插件中注册钩子
api.on("llm_output", async (event) => {
  // 修改 AI 响应
  const modifiedResponse = {
    ...event.response,
    choices: event.response.choices.map(choice => ({
      ...choice,
      message: {
        ...choice.message,
        content: choice.message.content + "\n\n[Plugin signature]",
      },
    })),
  };
  
  return { response: modifiedResponse };
});
```

## 预计时间

- **before_prompt_build**: 已完成辅助方法，需集成到调用点（0.5h）
- **llm_input**: 添加到 callAI 前（0.5h）
- **llm_output**: 添加到 callAI 后（0.5h）
- **测试**: 创建测试用例（1h）
- **总计**: 2.5 小时

## 注意事项

1. **异步处理**: 所有钩子都是异步的，需要在 async 函数中调用
2. **错误处理**: 钩子错误不应影响主流程
3. **性能**: 钩子应该快速执行，避免阻塞 AI 调用
4. **数据一致性**: 修改后的数据应该保持类型一致

## 实施建议

**推荐做法**: 
1. 先完成 `llm_input` 和 `llm_output` 钩子
2. 创建测试插件验证功能
3. 编写文档和示例

**快速实施**:
- 可以先实施基本功能，暂不处理复杂的修改逻辑
- 使用简单的日志输出来验证钩子触发
- 后续再完善数据修改功能

---

**创建时间**: 2026-03-06
**预计完成时间**: 2.5 小时
**优先级**: 🔴 高
