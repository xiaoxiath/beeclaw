/**
 * 修复 Agent 循环检测集成
 */
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.resolve(process.cwd(), 'src/domain/agent/index.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. 添加 import（在第一行后）
if (!content.includes("from '../../infra/resilience/loop-detector'")) {
  content = content.replace(
    /import { getCircuitBreakerRegistry.*?from '..\/..\/infra\/resilience\/circuit-breaker';/,
    `$&\nimport { LoopDetector, createLoopDetector, type LoopDetectionResult } from '../../infra/resilience/loop-detector';`
  );
  console.log('✅ Added LoopDetector import');
}

// 2. 在 Agent 类中添加属性（找到 lastToolCalls 定义后）
if (!content.includes('private loopDetector: LoopDetector')) {
  content = content.replace(
    /(private lastToolCalls: Array<\{[\s\S]*?\}> = \[\];)/,
    `$1\n  private loopDetector: LoopDetector = createLoopDetector();`
  );
  console.log('✅ Added loopDetector property');
}

// 3. 在 chat() 中重置 loopDetector
if (!content.includes('this.loopDetector.reset()')) {
  content = content.replace(
    /(this\.lastToolCalls = \[\]; \/\/ Clear tool calls from previous turn)/,
    `$1\n    this.loopDetector.reset(); // Reset loop detector for new turn`
  );
  console.log('✅ Added loopDetector.reset() in chat()');
}

// 4. 在工具执行循环中添加循环检测
// 找到 batch.map 里的工具执行部分
if (!content.includes('this.loopDetector.check(')) {
  // 在 const result = await this.toolExecutor 之前插入检测逻辑
  const toolExecPattern = /(const result = await this\.toolExecutor\(call\.function\.name, params\);)/;
  
  const loopCheckCode = `// 循环检测：执行前检查
              const loopCheck = this.loopDetector.check(call.function.name, params);
              if (loopCheck.action === 'warn') {
                // 注入警告给 LLM
                this.messages.push({
                  role: 'system',
                  content: loopCheck.warningMessage || '检测到可能的循环行为',
                });
                this.loopDetector.acknowledgeWarning();
              } else if (loopCheck.action === 'break') {
                // 强制退出
                const errorMsg = \`检测到循环行为: \${loopCheck.details}。请尝试不同的方法。\`;
                options?.onToolResult?.(call.function.name, { success: false, error: errorMsg });
                return errorMsg;
              }
              
              // 记录工具调用
              this.loopDetector.recordToolCall(call.function.name, params, iterations);
              
              $1`;
  
  content = content.replace(toolExecPattern, loopCheckCode);
  console.log('✅ Added loop check before tool execution');
}

// 5. 在工具执行后记录结果
if (!content.includes('this.loopDetector.recordToolResult(result)')) {
  // 在 options?.onToolResult?.(call.function.name, result); 后面添加
  const afterResultPattern = /(options\?\.onToolResult\?\.\(call\.function\.name, result\);)/;
  
  content = content.replace(
    afterResultPattern,
    `$1\n\n              // 记录工具结果用于循环检测\n              this.loopDetector.recordToolResult(result);`
  );
  console.log('✅ Added recordToolResult after tool execution');
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('\n✨ Loop detector integration complete!');
