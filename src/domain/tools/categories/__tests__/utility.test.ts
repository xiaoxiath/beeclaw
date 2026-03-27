import { describe, it, expect, vi } from 'vitest';

// Mock upstream modules
vi.mock('../../time-tools', () => ({
  timeTool: { name: 'time' },
  executeTime: vi.fn(() => Promise.resolve({ success: true })),
  weatherTool: { name: 'weather' },
  executeWeather: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../info-tools', () => ({
  beeclawInfoTool: { name: 'beeclaw_info' },
  executeBeeclawInfo: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../calc-tools', () => ({
  calcTool: { name: 'calc' },
  executeCalc: vi.fn(() => Promise.resolve({ success: true })),
  codeExecuteTool: { name: 'code_execute' },
  executeCode: vi.fn(() => Promise.resolve({ success: true })),
  claudeCodeTool: { name: 'claude_code' },
  executeClaudeCode: vi.fn(() => Promise.resolve({ success: true })),
  ClaudeCodeSchema: {},
}));

import {
  timeTool,
  executeTime,
  weatherTool,
  executeWeather,
  beeclawInfoTool,
  executeBeeclawInfo,
  calcTool,
  executeCalc,
  codeExecuteTool,
  executeCode,
  claudeCodeTool,
  executeClaudeCode,
  ClaudeCodeSchema,
} from '../utility';

describe('categories/utility re-exports', () => {
  it('exports timeTool', () => {
    expect(timeTool.name).toBe('time');
  });

  it('exports executeTime', () => {
    expect(typeof executeTime).toBe('function');
  });

  it('exports weatherTool', () => {
    expect(weatherTool.name).toBe('weather');
  });

  it('exports executeWeather', () => {
    expect(typeof executeWeather).toBe('function');
  });

  it('exports beeclawInfoTool', () => {
    expect(beeclawInfoTool.name).toBe('beeclaw_info');
  });

  it('exports executeBeeclawInfo', () => {
    expect(typeof executeBeeclawInfo).toBe('function');
  });

  it('exports calcTool', () => {
    expect(calcTool.name).toBe('calc');
  });

  it('exports executeCalc', () => {
    expect(typeof executeCalc).toBe('function');
  });

  it('exports codeExecuteTool', () => {
    expect(codeExecuteTool.name).toBe('code_execute');
  });

  it('exports executeCode', () => {
    expect(typeof executeCode).toBe('function');
  });

  it('exports claudeCodeTool', () => {
    expect(claudeCodeTool.name).toBe('claude_code');
  });

  it('exports executeClaudeCode', () => {
    expect(typeof executeClaudeCode).toBe('function');
  });

  it('exports ClaudeCodeSchema', () => {
    expect(ClaudeCodeSchema).toBeDefined();
  });
});
