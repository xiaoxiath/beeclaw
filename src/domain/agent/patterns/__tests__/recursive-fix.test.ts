import { describe, test, expect } from 'bun:test';
import { PlanAndExecutePattern } from '../plan-and-execute';

describe('Plan-Execute Pattern Options', () => {
  test('should pass pattern option to agent.chat', async () => {
    // Mock agent
    const chatCalls: Array<{ message: string; options?: any }> = [];

    const mockAgent = {
      chat: async (message: string, options?: any) => {
        chatCalls.push({ message, options });

        // Simulate plan creation
        if (message.includes('任务规划专家')) {
          return JSON.stringify({
            goal: '测试目标',
            steps: [
              { id: 1, description: '步骤1', tools: [], expectedOutput: '输出1', dependencies: [] },
              { id: 2, description: '步骤2', tools: ['test_tool'], expectedOutput: '输出2', dependencies: [1] },
            ]
          });
        }

        // Simulate step execution
        if (message.includes('执行以下步骤')) {
          return '步骤执行结果';
        }

        // Simulate summary
        if (message.includes('任务已完成')) {
          return '任务总结';
        }

        return '默认响应';
      },
    } as any;

    const pattern = new PlanAndExecutePattern();
    await pattern.execute('测试任务', mockAgent as any);

    // Check that pattern options were passed
    const planCall = chatCalls.find(c => c.message.includes('任务规划专家'));
    expect(planCall?.options?.pattern).toBe('direct');

    // Check step 1 (no tools) uses direct
    const step1Call = chatCalls.find(c => c.message.includes('步骤1'));
    expect(step1Call?.options?.pattern).toBe('direct');

    // Check step 2 (has tools) uses react
    const step2Call = chatCalls.find(c => c.message.includes('步骤2'));
    expect(step2Call?.options?.pattern).toBe('react');

    // Check summary uses direct
    const summaryCall = chatCalls.find(c => c.message.includes('任务已完成'));
    expect(summaryCall?.options?.pattern).toBe('direct');

    console.log('All agent.chat calls:', chatCalls.map(c => ({
      hasPattern: !!c.options?.pattern,
      pattern: c.options?.pattern,
      hasTools: c.options?.tools !== undefined
    })));
  });
});
